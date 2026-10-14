import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import {
  HttpTransport,
  MlDsa65Signer,
  PrivateKeySigner,
  createThruputClient,
  createPubkeyAccount,
  createWalletClient,
  defaultWalletAdapter,
  localnet,
  prepareContractDeployment,
  createContractCodecContext,
  defineContractEvent,
  deriveEntrypointID,
  encodeCalldata,
} from "@thruputchain/client";
import { codec as specCodec, deserialize } from "@thruputchain/contract-spec";
import {
  ThruputRpcErrorCode,
  JsonRpcError,
} from "@thruputchain/client/transport";
import {
  DefaultWallet,
  ERC20,
  decodeERC20Event,
  groundhog_erc20_if,
} from "@thruputchain/client/contracts";
import {
  ExecResult,
  HOG_ADDRESS,
  Uint64Codec,
  deserializeCxs,
  gasAmount,
} from "@thruputchain/protocol";
import versions from "../../scripts/integration-versions.json" with { type: "json" };
import {
  airdropTimeoutMs,
  eventsTimeoutMs,
  receiptTimeoutMs,
  rpcTimeoutMs,
  suiteTimeoutMs as timeout,
} from "../../scripts/integration-timeouts.mjs";

function assertChainConfig({ execution, ...stated }) {
  const assertLimits = (limits) => {
    for (const value of Object.values(limits)) {
      assert.ok(
        value === null ||
          (Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff),
      );
    }
  };
  assertLimits(stated);
  if (execution === undefined) return;

  assert.equal(typeof execution.observedTip.height, "bigint");
  assert.ok(execution.observedTip.height >= 0n);
  assert.equal(execution.observedTip.blockHash.length, 32);
  assert.equal(execution.configHash.length, 32);
  assertLimits(execution.effectiveLimits);
  for (const value of Object.values(execution.storageCosts)) {
    assert.equal(typeof value, "bigint");
    assert.ok(value >= 0n && value <= (1n << 64n) - 1n);
  }
  assert.ok(execution.storageCosts.bytestringCostPerByte <= 0xffff_ffffn);
}

test("chain config integration assertions accept stated and execution readings", async () => {
  const stated = { maxContractSizeBytes: 524288 };
  const execution = {
    observedTip: { height: "42", blockHash: `0x${"11".repeat(32)}` },
    configHash: `0x${"22".repeat(32)}`,
    effectiveLimits: { ...stated, maxRv32MemoryBytes: 65536 },
    storageCosts: {
      baseDataItemCost: "12000",
      bytestringCostPerByte: "10",
      baseContractDeploymentCost: "12000",
      contractDeploymentCostPerByte: "10",
      authPerKeyCost: "1111",
      rcqCostPerEntry: "8",
      replayCacheCostPerEntry: "7",
      balanceCost: "1234",
    },
  };
  for (const result of [stated, { ...stated, execution }]) {
    const client = await createThruputClient({
      transport: { request: async () => result },
    });
    assertChainConfig(await client.getChainConfig());
  }
});

test("built SDK against a real local node", { timeout }, async (t) => {
  const rpcUrl = process.env.THRUPUT_RPC_URL;
  assert.ok(rpcUrl, "Run through npm run test:integration");
  assert.ok(process.env.THRUPUT_RUNTIME_MANIFEST);
  const transport = new HttpTransport(rpcUrl, { timeoutMs: rpcTimeoutMs });
  const client = await createThruputClient({
    cluster: localnet({ rpcUrl }),
    transport,
  });
  // Shared with the getEvents subtest below.
  let transfer;

  await t.test(
    "connects and decodes network, version, and chain tip",
    async () => {
      const manifest = JSON.parse(
        await readFile(process.env.THRUPUT_RUNTIME_MANIFEST, "utf8"),
      );
      assert.equal(
        Buffer.from(client.network.networkHash).toString("hex"),
        manifest.networkHash.replace(/^0x/, ""),
      );
      const version = await client.getVersion();
      assert.equal(
        version.implementation,
        process.env.THRUPUT_EXPECTED_CLI_VERSION ?? versions.cli,
      );
      assert.match(version.wireFormat, /^\d+\.\d+\.\d+$/);
      // The released node can predate optional additions in the SDK's schema.
      assert.equal(
        version.wireFormat,
        process.env.THRUPUT_EXPECTED_WIRE_FORMAT ?? versions.wireFormat,
      );
      const tip = await client.getChainTip();
      assert.equal(typeof tip.height, "bigint");
      assert.ok(tip.height >= 1n);
      assert.equal(tip.blockHash.length, 32);
      const config = await client.getChainConfig();
      assertChainConfig(config);
      assert.ok(
        config.execution,
        "the pinned runtime must return execution rules",
      );
      assert.ok(config.execution.observedTip.height >= tip.height);
      for (const limit of Object.values(config.execution.effectiveLimits)) {
        assert.notEqual(
          limit,
          null,
          "the pinned runtime must resolve every limit",
        );
      }
      for (const [name, price] of Object.entries(
        config.execution.storageCosts,
      )) {
        assert.equal(price, BigInt(manifest.bootstrap.storageCostModel[name]));
      }
    },
  );

  await t.test(
    "reads absent authorization data at a committed height",
    async () => {
      const account = createPubkeyAccount({
        signer: new PrivateKeySigner(randomBytes(32)),
      });
      const result = await client.getAddressAuthData(account.address);
      assert.deepEqual(result.address, account.address);
      assert.equal(result.authData, null);
      assert.ok(result.height >= 1n);
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
    const batchedClient = await createThruputClient({
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
    assert.equal(invalid.reason.code, ThruputRpcErrorCode.InvalidParams);
  });

  await t.test(
    "funds pubkey wallets, transfers HOG, and decodes receipt, event, and view",
    async (t) => {
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
      const balance = (minHeight, signal) =>
        ERC20.v0_1.getBalanceOf.view({
          client: wallet,
          contract: HOG_ADDRESS,
          caller: sender.address,
          args: { addr: recipient.address },
          minHeight,
          signal,
        });
      const before = await balance();
      const amount = 1_000n;
      await t.test(
        "simulates an authenticated wallet transfer and reads its temporary balance",
        {
          skip:
            (process.env.THRUPUT_EXPECTED_WIRE_FORMAT ??
              versions.wireFormat) === "11.1.0"
              ? "The pinned node predates view auth; use matching source builds with wire 11.2.0"
              : false,
        },
        async () => {
          const invocation = defaultWalletAdapter.createBatchRootInvocation(
            sender.address,
            {
              gasLimit: gasAmount(2_000_000n),
              invocations: [
                ERC20.v0_1.transfer.invocation(
                  HOG_ADDRESS,
                  gasAmount(500_000n),
                  {
                    receiver: recipient.address,
                    amount,
                  },
                ),
                ERC20.v0_1.getBalanceOf.invocation(
                  HOG_ADDRESS,
                  gasAmount(500_000n),
                  {
                    addr: recipient.address,
                  },
                ),
              ],
            },
          );
          const root = {
            contract: sender.address,
            entrypoint: invocation.entrypoint,
            calldata: invocation.calldata,
            gasLimit: invocation.gas_limit,
            minHeight: before.height,
          };
          assert.equal((await client.view(root)).output.result, "abort");
          const simulated = await client.view({
            ...root,
            authClaim: sender.authClaim,
          });
          const values = DefaultWallet.v0_1.execute.decodeView(simulated).value;
          assert.equal(
            ERC20.v0_1.getBalanceOf.decodeReturn(values[1]),
            before.value + amount,
          );
          const { minHeight, ...call } = root;
          const batch = await client.viewBatch({
            minHeight,
            calls: [
              { ...call, authClaim: sender.authClaim },
              { ...call, authClaim: recipient.authClaim },
              { ...call, authClaim: sender.authClaim },
            ],
          });
          assert.deepEqual(
            batch.results.map(({ output }) => output.result),
            ["return", "abort", "return"],
          );
          for (const index of [0, 2]) {
            assert.deepEqual(batch.results[index].output, simulated.output);
          }
          assert.equal((await balance(before.height)).value, before.value);
        },
      );
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
      const freshnessDeadline = AbortSignal.timeout(receiptTimeoutMs);
      let after;
      for (;;) {
        try {
          after = await balance(receipt.height, freshnessDeadline);
          break;
        } catch (error) {
          if (
            !(error instanceof JsonRpcError) ||
            error.code !== ThruputRpcErrorCode.ViewHeightUnavailable
          ) {
            throw error;
          }
          await sleep(100, undefined, { signal: freshnessDeadline });
        }
      }
      assert.ok(after.height >= receipt.height);
      assert.equal(after.value - before.value, amount);
      const snapshot = await client.readViews({
        calls: [sender, recipient].map(({ address }) =>
          ERC20.v0_1.getBalanceOf.viewRequest({
            contract: HOG_ADDRESS,
            args: { addr: address },
          }),
        ),
        minHeight: receipt.height,
      });
      assert.ok(
        snapshot.results.every(
          (result) =>
            result.kind === "return" && result.height === snapshot.height,
        ),
      );
      assert.equal(snapshot.results[1].value, after.value);
      transfer = { sender, recipient, amount, hash, receipt };
    },
  );

  await t.test(
    "commits a DefaultWallet transfer signed in TS with a hedged ML-DSA-65 key",
    async () => {
      // hogd verifies with mldsa-native; this is the TS-sign, C++-verify path
      // with real (hedged) randomness rather than the deterministic vectors.
      const sender = createPubkeyAccount({
        signer: MlDsa65Signer.fromSeed(randomBytes(32)),
      });
      const recipient = createPubkeyAccount({
        signer: new PrivateKeySigner(randomBytes(32)),
      });
      const wallet = createWalletClient({ client, account: sender });
      const airdrop = await wallet.requestAirdrop({
        recipient: sender.address,
        timeoutMs: airdropTimeoutMs,
      });
      assert.equal(airdrop.status.result, "ok");
      const amount = 1_000n;
      const { receipt } = await wallet.executeCallsAndWait(
        {
          calls: [
            ERC20.v0_1.transfer.call({
              contract: HOG_ADDRESS,
              gasLimit: gasAmount(500_000n),
              args: { receiver: recipient.address, amount },
            }),
          ],
          gasLimit: gasAmount(1_000_000n),
        },
        { timeoutMs: receiptTimeoutMs },
      );
      assert.equal(receipt.execResult, ExecResult.ExecResultOK);
      const event =
        groundhog_erc20_if.v0_1.events.TransferEvent.singleFromReceipt(
          receipt,
          { contractAddress: HOG_ADDRESS },
        );
      assert.deepEqual(event.topics, {
        from: sender.address,
        to: recipient.address,
      });
      assert.equal(event.fields.amount, amount);
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
          assert.equal(error.code, ThruputRpcErrorCode.TxInvalid);
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
    const client = await createThruputClient({
      cluster: localnet({ rpcUrl: process.env.THRUPUT_RPC_URL }),
      transport: new HttpTransport(process.env.THRUPUT_RPC_URL, {
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
      (status) => status.status !== "pending" && status.status !== "unknown",
    );
    assert.deepEqual(failure, {
      status: "retry",
      error: {
        source: "executor",
        code: ExecResult.ExecResultTxNonDeterministicError,
      },
    });
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
