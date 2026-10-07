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
  decodeERC20Event,
  groundhog_erc20_if,
} from "@groundhogchain/client/contracts";
import {
  ExecResult,
  HOG_ADDRESS,
  Uint64Codec,
  deserializeCxs,
  gasAmount,
} from "@groundhogchain/protocol";
import versions from "../../scripts/integration-versions.json" with { type: "json" };
import openrpcSpec from "../../specs/openrpc.json" with { type: "json" };
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
      const manifest = JSON.parse(
        await readFile(process.env.GROUNDHOG_RUNTIME_MANIFEST, "utf8"),
      );
      assert.equal(
        Buffer.from(client.network.networkHash).toString("hex"),
        manifest.networkHash.replace(/^0x/, ""),
      );
      const version = await client.getVersion();
      assert.equal(
        version.implementation,
        process.env.GROUNDHOG_EXPECTED_CLI_VERSION ?? versions.cli,
      );
      assert.match(version.wireFormat, /^\d+\.\d+\.\d+$/);
      // The pinned spec must describe the wire format the pinned node serves.
      assert.equal(
        version.wireFormat.split(".")[0],
        openrpcSpec.info.version.split(".")[0],
      );
      const tip = await client.getChainTip();
      assert.equal(typeof tip.height, "bigint");
      assert.ok(tip.height >= 1n);
      assert.equal(tip.blockHash.length, 32);
      const config = await client.getChainConfig();
      for (const value of Object.values(config)) {
        assert.ok(value === null || Number.isInteger(value));
      }
    },
  );

  await t.test("batches independent reads over one HTTP request", async () => {
    const bodies = [];
    const batchedTransport = new HttpTransport(rpcUrl, {
      batch: true,
      timeoutMs: rpcTimeoutMs,
      fetch: async (input, init) => {
        bodies.push(JSON.parse(init.body));
        return fetch(input, init);
      },
    });
    const batchedClient = await createGroundhogClient({
      transport: batchedTransport,
    });
    const hash = `0x${"00".repeat(32)}`;
    const [version, tip, missing, duplicate, invalid] =
      await Promise.allSettled([
        batchedClient.getVersion(),
        batchedClient.getChainTip(),
        batchedTransport.request("groundhog_getTransactionReceipt", [hash]),
        batchedTransport.request("groundhog_getTransactionReceipt", [hash]),
        batchedTransport.request("groundhog_getTransactionReceipt", [
          "bad-hash",
        ]),
      ]);
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].length, 5);
    assert.equal(version.status, "fulfilled");
    assert.deepEqual(version.value, await client.getVersion());
    assert.equal(tip.status, "fulfilled");
    assert.equal(typeof tip.value.height, "bigint");
    assert.deepEqual(missing, { status: "fulfilled", value: null });
    assert.deepEqual(duplicate, missing);
    assert.equal(invalid.status, "rejected");
    assert.ok(invalid.reason instanceof JsonRpcError);
    assert.equal(invalid.reason.code, GroundhogRpcErrorCode.InvalidParams);
  });

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
        ERC20.v0_1.getBalanceOf.view({
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
            ERC20.v0_1.transfer.call({
              contract: HOG_ADDRESS,
              gasLimit: gasAmount(500_000n),
              args: {
                receiver: recipient.address,
                amount,
              },
            }),
          ],
          gasLimit: gasAmount(1_000_000n),
        },
        { timeoutMs: receiptTimeoutMs },
      );
      assert.equal(hash.length, 32);
      assert.deepEqual(values, [undefined]);
      assert.deepEqual(receipt.txHash, hash);
      assert.equal(receipt.execResult, ExecResult.ExecResultOK);
      assert.deepEqual(
        DefaultWallet.v0_1.execute.decodeReceipt(receipt).value,
        [new Uint8Array()],
      );
      const receiptEvent =
        groundhog_erc20_if.v0_1.events.TransferEvent.singleFromReceipt(
          receipt,
          {
            contractAddress: HOG_ADDRESS,
          },
        );
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
          groundhog_erc20_if.v0_1.events.TransferEvent.filter({
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
      assert.deepEqual(
        groundhog_erc20_if.v0_1.events.TransferEvent.decode(identified.event),
        {
          name: "TransferEvent",
          topics: { from: sender.address, to: recipient.address },
          fields: { amount },
        },
      );
    },
  );

  await t.test(
    "reads typed pages, resumes within a block, and starts a fresh walk for new blocks",
    async () => {
      assert.ok(transfer, "requires the transfer subtest to have passed");
      const { sender, recipient, amount, hash, receipt } = transfer;
      const wallet = createWalletClient({ client, account: sender });
      const secondAmount = 2_000n;
      const call = ERC20.v0_1.transfer.call({
        contract: HOG_ADDRESS,
        gasLimit: gasAmount(500_000n),
        args: { receiver: recipient.address, amount: secondAmount },
      });
      // Two events in one transaction put the continuation inside a block.
      const second = await wallet.executeCallsAndWait(
        {
          calls: [call, call],
          gasLimit: gasAmount(3_000_000n),
        },
        { timeoutMs: receiptTimeoutMs },
      );
      const query = {
        event: groundhog_erc20_if.v0_1.events.TransferEvent,
        contractAddresses: [HOG_ADDRESS],
        topics: { from: sender.address },
        order: "ascending",
        anchor: { height: receipt.height },
        limit: 1,
      };
      const deadline = Date.now() + eventsTimeoutMs;
      let first;
      for (;;) {
        first = await client.getContractEvents(query);
        if (first.latestBlock >= second.receipt.height) break;
        assert.ok(
          Date.now() < deadline,
          "event indexer did not reach the second transfer",
        );
        await sleep(250);
      }
      assert.equal(first.events.length, 1);
      assert.equal(first.events[0].fields.amount, amount);
      assert.deepEqual(first.events[0].txHash, hash);
      assert.deepEqual(first.events[0].contractAddress, HOG_ADDRESS);
      assert.deepEqual(first.events[0].topics.to, recipient.address);
      assert.ok(
        first.cursor.length > 0,
        "limit: 1 should return a continuation cursor",
      );
      const next = await client.getContractEvents({
        ...query,
        cursor: first.cursor,
      });
      assert.equal(next.events.length, 1);
      assert.equal(next.events[0].fields.amount, secondAmount);
      assert.deepEqual(next.events[0].txHash, second.txHash);
      assert.ok(next.cursor.length > 0);

      const rawQuery = {
        filters: [groundhog_erc20_if.v0_1.events.TransferEvent.filter(query)],
        order: query.order,
        anchor: query.anchor,
        limit: 1,
      };
      const found = [];
      let pageCount = 0;
      for await (const page of client.iterateEventPages(rawQuery)) {
        pageCount++;
        assert.ok(page.events.length <= 1);
        found.push(...page.events);
      }
      assert.ok(pageCount >= 3);
      assert.deepEqual(
        found.map((event) => event.txHash),
        [hash, second.txHash, second.txHash],
      );

      const third = await wallet.executeAndWait(
        { invocation: call.invocation, gasLimit: gasAmount(1_000_000n) },
        { timeoutMs: receiptTimeoutMs },
      );
      assert.ok(third.receipt.height > second.receipt.height);

      // Wait for indexer readiness before testing either walk. Reusing the old
      // cursor below must still exclude the now-indexed third transfer.
      const thirdIndexDeadline = Date.now() + eventsTimeoutMs;
      for (;;) {
        const indexed = await client.getContractEvents(query);
        if (indexed.latestBlock >= third.receipt.height) break;
        assert.ok(
          Date.now() < thirdIndexDeadline,
          "event indexer did not reach the third transfer",
        );
        await sleep(250);
      }

      // A saved cursor finishes its original walk, excluding the later block.
      const resumed = [];
      for await (const page of client.iterateEventPages({
        ...rawQuery,
        cursor: next.cursor,
      })) {
        resumed.push(...page.events);
      }
      assert.deepEqual(resumed, [found[2]]);

      // A fresh row-height scan includes the whole saved block and newer rows.
      const fresh = [];
      for await (const page of client.iterateEventPages({
        ...rawQuery,
        anchor: { height: second.receipt.height },
      })) {
        fresh.push(...page.events);
      }
      assert.deepEqual(
        fresh.map((event) => event.txHash),
        [second.txHash, second.txHash, third.txHash],
      );
      assert.deepEqual(fresh.slice(0, 2), found.slice(1));
    },
  );

  await t.test(
    "atomically funds, deploys and initializes a contract, then reads its state and scalar event",
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
      // Read the pinned ABI rather than importing SDK source into this built-package test.
      const spec = deserialize(
        await readFile(
          new URL("../../specs/contracts/counter.spec.xdr", import.meta.url),
        ),
        specCodec.ContractSpec,
      );
      const iface = spec.interfaces.find((entry) => entry.name === "Counter");
      const event = spec.events.find(
        (entry) => entry.name.declared === "PingEvent",
      );
      assert.ok(iface);
      assert.ok(event);
      const rootGas = gasAmount(10_000_000n);
      const result = await wallet.deployContractAndWait(
        deployment,
        {
          gasLimit: rootGas,
          amount: 50_000_000n,
          initializer: {
            invoked_address: deployment.address,
            entrypoint: deriveEntrypointID(
              iface.name,
              iface.vers,
              "initialize",
            ),
            gas_limit: gasAmount(500_000n),
            calldata: encodeCalldata(spec, iface.name, "initialize", [42n], {}),
          },
        },
        { timeoutMs: receiptTimeoutMs },
      );
      assert.deepEqual(result.address, deployment.address);
      assert.equal(result.receipt.execResult, ExecResult.ExecResultOK);
      assert.equal("account" in client, false);
      const initialized = await wallet.executeAndWait(
        {
          invocation: {
            invoked_address: result.address,
            entrypoint: deriveEntrypointID(iface.name, iface.vers, "get"),
            gas_limit: gasAmount(500_000n),
            calldata: encodeCalldata(spec, iface.name, "get", [], {}),
          },
          gasLimit: rootGas,
        },
        { timeoutMs: receiptTimeoutMs },
      );
      assert.deepEqual(
        DefaultWallet.v0_1.execute.decodeReceipt(initialized.receipt).value,
        [new Uint8Array([42])],
      );
      const view = await client.view({
        contract: result.address,
        entrypoint: deriveEntrypointID(iface.name, iface.vers, "get"),
        calldata: encodeCalldata(spec, iface.name, "get", [], {}),
        caller: sender.address,
      });
      assert.equal(view.output.result, "return");
      assert.equal(deserializeCxs(view.output.returnData, Uint64Codec), 42n);
      const ping = defineContractEvent({
        name: event.name.declared,
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

test(
  "fresh HOG funding covers the recipient balance-item deposit",
  { timeout },
  async () => {
    const client = await createGroundhogClient({
      cluster: localnet({ rpcUrl: process.env.GROUNDHOG_RPC_URL }),
      transport: new HttpTransport(process.env.GROUNDHOG_RPC_URL, {
        timeoutMs: rpcTimeoutMs,
      }),
    });
    const funder = createWalletClient({
      client,
      account: createPubkeyAccount({
        signer: new PrivateKeySigner(randomBytes(32)),
        nonce: 0n,
      }),
    });
    const funding = await funder.requestAirdrop({
      timeoutMs: airdropTimeoutMs,
    });
    assert.equal(funding.status.result, "ok");
    const freshAccount = () =>
      createPubkeyAccount({ signer: new PrivateKeySigner(randomBytes(32)) });
    const sender = freshAccount();
    const smallRecipient = freshAccount();
    const fundedRecipient = freshAccount();
    const send = (wallet, receiver, amount) =>
      wallet.execute({
        invocation: ERC20.v0_1.transfer.invocation(
          HOG_ADDRESS,
          gasAmount(500_000n),
          { receiver, amount },
        ),
        gasLimit: gasAmount(1_000_000n),
      });
    const balance = (account) => client.getBalance(account.address);
    async function until(read, ready) {
      const deadline = Date.now() + receiptTimeoutMs;
      for (;;) {
        const value = await read();
        if (ready(value)) return value;
        assert.ok(
          Date.now() < deadline,
          "funding state did not become visible",
        );
        await sleep(100);
      }
    }

    // Leave room for the funder's first-credit storage deposit.
    await send(funder, sender.address, 90_000_000n);
    await until(
      () => balance(sender),
      ({ rawBalance }) => rawBalance > 1_000_000n,
    );
    const wallet = createWalletClient({ client, account: sender });
    const smallHash = await send(wallet, smallRecipient.address, 1_000n);
    const failure = await until(
      () => client.getTransactionStatus(smallHash),
      (status) => status.status === "recentFailure",
    );
    assert.equal(failure.cause.kind, "dbConflict");
    assert.equal(failure.cause.conflict.code, "insufficientFunds");
    assert.deepEqual(failure.cause.conflict.address, smallRecipient.address);
    assert.equal((await balance(smallRecipient)).rawBalance, 0n);

    // A sufficient first credit can fund its own balance item: a prior faucet
    // airdrop is not a universal prerequisite for receiving native HOG.
    await send(wallet, fundedRecipient.address, 100_000n);
    const funded = await until(
      () => balance(fundedRecipient),
      ({ rawBalance }) => rawBalance > 0n,
    );
    assert.ok(
      funded.rawBalance < 100_000n,
      "the first credit locks a storage deposit",
    );
    await send(wallet, fundedRecipient.address, 1_000n);
    const toppedUp = await until(
      () => balance(fundedRecipient),
      ({ rawBalance }) => rawBalance > funded.rawBalance,
    );
    assert.equal(toppedUp.rawBalance - funded.rawBalance, 1_000n);
  },
);
