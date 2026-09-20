import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import {
  HttpTransport,
  PrivateKeySigner,
  createGroundhogClient,
  createPubkeyAccount,
  createWalletClient,
  localnet,
  prepareContractDeployment,
  createContractCodecContext,
  defineContractEvent,
  deriveEntrypointID,
  encodeCalldata,
} from "@groundhogchain/client";
import { codec as specCodec, deserialize } from "@groundhogchain/contract-spec";
import {
  GroundhogRpcErrorCode,
  JsonRpcError,
} from "@groundhogchain/client/transport";
import {
  DefaultWallet,
  ERC20,
  ERC20TransferEvent,
  decodeERC20Event,
} from "@groundhogchain/client/contracts";
import { loadLocalDevAccount } from "@groundhogchain/client/local-dev";
import { ExecResult, HOG_ADDRESS, gasAmount } from "@groundhogchain/protocol";
import versions from "../../scripts/integration-versions.json" with { type: "json" };
import {
  airdropTimeoutMs,
  eventsTimeoutMs,
  receiptTimeoutMs,
  rpcTimeoutMs,
  suiteTimeoutMs as timeout,
} from "../../scripts/integration-timeouts.mjs";

test("built SDK against a real local node", { timeout }, async (t) => {
  const rpcUrl = process.env.GROUNDHOG_RPC_URL;
  assert.ok(rpcUrl, "Run through npm run test:integration");
  assert.ok(process.env.GROUNDHOG_RUNTIME_MANIFEST);
  const transport = new HttpTransport(rpcUrl, { timeoutMs: rpcTimeoutMs });
  const client = await createGroundhogClient({
    cluster: localnet({ rpcUrl }),
    transport,
  });
  // Shared with the getEvents subtest below.
  let transfer;

  await t.test(
    "connects and decodes network, version, and chain tip",
    async () => {
      const account = await loadLocalDevAccount();
      assert.deepEqual(client.network.networkHash, account.networkHash);
      const version = await client.getVersion();
      assert.equal(version.implementation, versions.cli);
      assert.match(version.wireFormat, /^\d+\.\d+\.\d+$/);
      const tip = await client.getChainTip();
      assert.equal(typeof tip.height, "bigint");
      assert.ok(tip.height >= 1n);
      assert.equal(tip.blockHash.length, 32);
    },
  );

  await t.test(
    "funds pubkey wallets, transfers HOG, and decodes receipt, event, and view",
    async () => {
      const sender = createPubkeyAccount({
        signer: new PrivateKeySigner(randomBytes(32)),
      });
      const recipient = createPubkeyAccount({
        signer: new PrivateKeySigner(randomBytes(32)),
      });
      const wallet = createWalletClient({ client, account: sender });
      for (const account of [sender, recipient]) {
        const airdrop = await wallet.requestAirdrop({
          recipient: account.address,
          timeoutMs: airdropTimeoutMs,
        });
        assert.equal(airdrop.status.result, "ok");
        assert.ok(airdrop.rawAmount > 0n);
        assert.deepEqual(airdrop.recipient, account.address);
      }
      const balance = () =>
        ERC20.getBalanceOf.view({
          client: wallet,
          contract: HOG_ADDRESS,
          caller: sender.address,
          args: { addr: recipient.address },
        });
      const before = await balance();
      const amount = 1_000n;
      const {
        txHash: hash,
        receipt,
        values,
      } = await wallet.executeCallsAndWait(
        {
          calls: [
            ERC20.transfer.call({
              contract: HOG_ADDRESS,
              gasLimit: gasAmount(500_000n),
              args: {
                receiver: recipient.address,
                amount,
              },
            }),
          ],
          gasLimit: gasAmount(10_000_000n),
        },
        { timeoutMs: receiptTimeoutMs },
      );
      assert.equal(hash.length, 32);
      assert.deepEqual(values, [undefined]);
      assert.deepEqual(receipt.txHash, hash);
      assert.equal(receipt.execResult, ExecResult.ExecResultOK);
      assert.deepEqual(DefaultWallet.execute.decodeReceipt(receipt).value, [
        new Uint8Array(),
      ]);
      const receiptEvent = ERC20TransferEvent.singleFromReceipt(receipt, {
        contractAddress: HOG_ADDRESS,
      });
      assert.deepEqual(receiptEvent.topics, {
        from: sender.address,
        to: recipient.address,
      });
      assert.equal(receiptEvent.fields.amount, amount);
      assert.ok(
        receipt.events.some(
          (event) => decodeERC20Event(event)?.name === "TransferEvent",
        ),
      );
      const after = await balance();
      assert.ok(after.height >= receipt.height);
      assert.equal(after.value - before.value, amount);
      transfer = { sender, recipient, amount, hash, receipt };
    },
  );

  await t.test(
    "queries the transfer back through getEvents with a populated filter",
    async () => {
      assert.ok(transfer, "requires the transfer subtest to have passed");
      const { sender, recipient, amount, hash, receipt } = transfer;
      // Exercises the request shape the node actually requires (a full
      // EventTopicFilter with a populated topic0/topic1) and the nested
      // IdentifiedEvent response envelope, against a real node rather than a
      // hand-written fixture.  A fresh random sender has exactly one outgoing
      // transfer, so the filter must match exactly one event.
      const query = {
        filters: [
          ERC20TransferEvent.filter({
            contractAddresses: [HOG_ADDRESS],
            topics: { from: sender.address },
          }),
        ],
        order: "ascending",
        anchor: "beginning",
        limit: 50,
      };
      // The indexer may trail consensus; poll until it has processed the
      // receipt's block, after which the result set is definitive.  An empty
      // page with a non-empty cursor is not "no matches", so walk every page.
      const deadline = Date.now() + eventsTimeoutMs;
      let events;
      for (;;) {
        events = [];
        let cursor = new Uint8Array();
        let latestBlock;
        do {
          const page = await client.getEvents({ ...query, cursor });
          events.push(...page.events);
          ({ cursor, latestBlock } = page);
        } while (cursor.length > 0);
        if (latestBlock >= receipt.height) break;
        assert.ok(
          Date.now() < deadline,
          `indexer did not reach block ${receipt.height} within ${eventsTimeoutMs}ms (at ${latestBlock})`,
        );
        await sleep(250);
      }
      assert.equal(events.length, 1);
      const [identified] = events;
      assert.deepEqual(identified.txHash, hash);
      assert.equal(identified.blockHeight, receipt.height);
      assert.equal(typeof identified.sequenceNumber, "number");
      assert.deepEqual(identified.event.contractAddress, HOG_ADDRESS);
      assert.deepEqual(ERC20TransferEvent.decode(identified.event), {
        name: "TransferEvent",
        topics: { from: sender.address, to: recipient.address },
        fields: { amount },
      });
    },
  );

  await t.test(
    "prefunds and deploys a contract, then decodes and filters its scalar event",
    async () => {
      const sender = createPubkeyAccount({
        signer: new PrivateKeySigner(randomBytes(32)),
      });
      const wallet = createWalletClient({ client, account: sender });
      await wallet.requestAirdrop({ timeoutMs: airdropTimeoutMs });
      const deployment = prepareContractDeployment({
        deployer: sender.address,
        contract: await readFile(
          new URL("../../examples/fixtures/counter.rv32a", import.meta.url),
        ),
      });
      const rootGas = gasAmount(10_000_000n);
      await wallet.executeAndWait(
        {
          invocation: ERC20.transfer.invocation(
            HOG_ADDRESS,
            gasAmount(500_000n),
            { receiver: deployment.address, amount: 10_000_000n },
          ),
          gasLimit: rootGas,
        },
        { timeoutMs: receiptTimeoutMs },
      );
      const result = await wallet.deployContractAndWait(deployment, rootGas, {
        timeoutMs: receiptTimeoutMs,
      });
      assert.deepEqual(result.address, deployment.address);
      assert.equal(result.receipt.execResult, ExecResult.ExecResultOK);
      assert.equal("account" in client, false);

      // Read the pinned ABI rather than importing SDK source into this built-package test.
      const spec = deserialize(
        await readFile(
          new URL("../../specs/contracts/counter.spec.xdr", import.meta.url),
        ),
        specCodec.ContractSpec,
      );
      const iface = spec.interfaces.find((entry) => entry.name === "Counter");
      const event = spec.events.find((entry) => entry.name === "PingEvent");
      assert.ok(iface);
      assert.ok(event);
      const ping = defineContractEvent({
        name: event.name,
        signature: event.signature,
        topics: event.topics.map((field) => ({
          name: field.name,
          type: field.ty,
          representation: "u64",
        })),
        fields: event.fields.map((field) => ({
          name: field.name,
          type: field.ty,
        })),
        codecs: createContractCodecContext(spec.type_defs),
      });
      const tag = 0x0102_0304n;
      const { receipt } = await wallet.executeAndWait(
        {
          invocation: {
            invoked_address: result.address,
            entrypoint: deriveEntrypointID(iface.name, iface.vers, "ping"),
            gas_limit: gasAmount(500_000n),
            calldata: encodeCalldata(spec, iface.name, "ping", [tag], {}),
          },
          gasLimit: rootGas,
        },
        { timeoutMs: receiptTimeoutMs },
      );
      assert.equal(
        ping.singleFromReceipt(receipt, { contractAddress: result.address })
          .topics.tag,
        tag,
      );
      const filter = ping.filter({
        contractAddresses: [result.address],
        topics: { tag },
      });
      const raw = receipt.events.find(
        (entry) =>
          entry.topics.length > 0 &&
          Buffer.from(entry.topics[0]).equals(event.signature),
      );
      assert.ok(raw);
      assert.deepEqual(filter.topics.topic1[0], raw.topics[1]);
    },
  );

  await t.test(
    "preserves a real JSON-RPC transaction validation error",
    async () => {
      await assert.rejects(
        transport.request("groundhog_sendRawTransaction", ["not-valid-hex"]),
        (error) => {
          assert.ok(error instanceof JsonRpcError);
          assert.equal(error.code, GroundhogRpcErrorCode.TxInvalid);
          assert.equal(error.method, "groundhog_sendRawTransaction");
          assert.match(error.message, /invalid hex/i);
          return true;
        },
      );
    },
  );
});
