import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import {
  HttpTransport,
  MockTransport,
  MlDsa65Signer,
  Ed25519Signer,
  createThruputClient,
  createPubkeyAccount,
  createWalletClient,
  defaultWalletAdapter,
  localnet,
  prepareContractDeployment,
  createContractCodecContext,
  defineContractEvent,
  toBase58,
  deriveEntrypointID,
  encodeCalldata,
} from "@thruputchain/client";
import { codec as specCodec, deserialize } from "@thruputchain/contract-spec";
import {
  NativeRpcErrorCode,
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
  NATIVE_TOKEN_ADDRESS,
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

function assumed(account) {
  const { pubkey_hash, nonce } = account.authClaim.pubkey_preimage;
  return {
    kind: "pubkeySignature",
    pubkeyHash: pubkey_hash,
    accountNonce: nonce,
  };
}

function assertChainConfig({ execution, stated }) {
  const assertLimits = (limits) => {
    for (const value of Object.values(limits)) {
      assert.ok(Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff);
    }
  };
  assertLimits(stated);
  if (execution === undefined) return;

  assert.equal(typeof execution.observedTip.blockHeight, "bigint");
  assert.ok(execution.observedTip.blockHeight >= 0n);
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
    observedTip: {
      blockHeight: "42",
      blockHash: toBase58(new Uint8Array(32).fill(0x11)),
    },
    configHash: toBase58(new Uint8Array(32).fill(0x22)),
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
  for (const result of [{ stated }, { stated, execution }]) {
    const discovery = new MockTransport();
    const client = await createThruputClient({
      transport: {
        request: (method, params, options) =>
          method === "getChainConfig"
            ? Promise.resolve(result)
            : discovery.request(method, params, options),
      },
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
      assert.equal(toBase58(client.network.networkHash), manifest.networkHash);
      const version = await client.getVersionInfo();
      assert.equal(
        version.implementation,
        process.env.THRUPUT_EXPECTED_CLI_VERSION ?? versions.cli,
      );
      assert.match(version.wireFormat, /^\d+\.\d+\.\d+$/);
      assert.equal(
        version.wireFormat,
        process.env.THRUPUT_EXPECTED_WIRE_FORMAT ?? versions.wireFormat,
      );
      const tip = await client.getChainTip();
      assert.equal(typeof tip.blockHeight, "bigint");
      assert.ok(tip.blockHeight >= 1n);
      assert.equal(tip.blockHash.length, 32);
      const config = await client.getChainConfig();
      assertChainConfig(config);
      assert.ok(
        config.execution,
        "the pinned runtime must return execution rules",
      );
      assert.ok(config.execution.observedTip.blockHeight >= tip.blockHeight);
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
        signer: new Ed25519Signer(randomBytes(32)),
      });
      const result = await client.getRegisteredAuth({
        address: account.address,
      });
      assert.deepEqual(result.address, account.address);
      assert.equal(result.configuration, null);
      assert.ok(result.stateBlockHeight >= 1n);
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
    bodies.length = 0; // Discovery is already complete.
    const hash = toBase58(new Uint8Array(32));
    const [version, tip, missing, duplicate, invalid] =
      await Promise.allSettled([
        batchedClient.getVersionInfo(),
        batchedClient.getChainTip(),
        batchedTransport.request("getTransactionReceipt", {
          transactionHash: hash,
        }),
        batchedTransport.request("getTransactionReceipt", {
          transactionHash: hash,
        }),
        batchedTransport.request("getTransactionReceipt", {
          transactionHash: "bad-hash",
        }),
      ]);
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].length, 5);
    assert.equal(version.status, "fulfilled");
    assert.deepEqual(version.value, await client.getVersionInfo());
    assert.equal(tip.status, "fulfilled");
    assert.equal(typeof tip.value.blockHeight, "bigint");
    assert.deepEqual(missing, { status: "fulfilled", value: null });
    assert.deepEqual(duplicate, missing);
    assert.equal(invalid.status, "rejected");
    assert.ok(invalid.reason instanceof JsonRpcError);
    assert.equal(invalid.reason.code, NativeRpcErrorCode.InvalidParams);
  });

  await t.test(
    "funds pubkey wallets, transfers native tokens, and decodes receipt, event, and view",
    async (t) => {
      const sender = createPubkeyAccount({
        signer: new Ed25519Signer(randomBytes(32)),
      });
      const recipient = createPubkeyAccount({
        signer: new Ed25519Signer(randomBytes(32)),
      });
      const wallet = createWalletClient({ client, account: sender });
      for (const account of [sender, recipient]) {
        const airdrop = await wallet.requestAirdrop({
          recipient: account.address,
          timeoutMs: airdropTimeoutMs,
        });
        assert.equal(airdrop.execution.result, "return");
        assert.ok(airdrop.rawAmount > 0n);
        assert.deepEqual(airdrop.recipient, account.address);
      }
      const balance = (minStateBlockHeight, signal) =>
        ERC20.v0_1.getBalanceOf.view({
          client: wallet,
          address: NATIVE_TOKEN_ADDRESS,
          caller: sender.address,
          args: { addr: recipient.address },
          minStateBlockHeight,
          signal,
        });
      const before = await balance();
      const amount = 1_000n;
      await t.test(
        "simulates an authenticated wallet transfer and reads its temporary balance",
        async () => {
          const invocation = defaultWalletAdapter.createBatchRootInvocation(
            sender.address,
            {
              gasLimit: gasAmount(2_000_000n),
              invocations: [
                ERC20.v0_1.transfer.invocation(
                  NATIVE_TOKEN_ADDRESS,
                  gasAmount(500_000n),
                  {
                    receiver: recipient.address,
                    amount,
                  },
                ),
                ERC20.v0_1.getBalanceOf.invocation(
                  NATIVE_TOKEN_ADDRESS,
                  gasAmount(500_000n),
                  {
                    addr: recipient.address,
                  },
                ),
              ],
            },
          );
          const root = {
            address: sender.address,
            entrypoint: invocation.entrypoint,
            calldata: invocation.calldata,
            gasLimit: invocation.gas_limit,
            minStateBlockHeight: before.stateBlockHeight,
          };
          assert.equal(
            (await client.simulateInvocation(root)).output.result,
            "abort",
          );
          const simulated = await client.simulateInvocation({
            ...root,
            assumedAuth: assumed(sender),
          });
          const values = DefaultWallet.v0_1.execute.decodeView(simulated).value;
          assert.equal(
            ERC20.v0_1.getBalanceOf.decodeReturn(values[1]),
            before.value + amount,
          );
          const { minStateBlockHeight, ...call } = root;
          const batch = await client.simulateInvocations({
            minStateBlockHeight,
            invocations: [
              { ...call, assumedAuth: assumed(sender) },
              { ...call, assumedAuth: assumed(recipient) },
              { ...call, assumedAuth: assumed(sender) },
            ],
          });
          assert.deepEqual(
            batch.results.map(({ output }) => output.result),
            ["return", "abort", "return"],
          );
          for (const index of [0, 2]) {
            assert.deepEqual(batch.results[index].output, simulated.output);
          }
          assert.equal(
            (await balance(before.stateBlockHeight)).value,
            before.value,
          );
        },
      );
      const {
        transactionHash: hash,
        receipt,
        values,
      } = await wallet.executeCallsAndWait(
        {
          calls: [
            ERC20.v0_1.transfer.call({
              address: NATIVE_TOKEN_ADDRESS,
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
      assert.deepEqual(receipt.transactionHash, hash);
      assert.equal(receipt.execution.result, "return");
      assert.deepEqual(
        DefaultWallet.v0_1.execute.decodeReceipt(receipt).value,
        [new Uint8Array()],
      );
      const receiptEvent =
        groundhog_erc20_if.v0_1.events.TransferEvent.singleFromReceipt(
          receipt,
          {
            address: NATIVE_TOKEN_ADDRESS,
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
          after = await balance(receipt.blockHeight, freshnessDeadline);
          break;
        } catch (error) {
          if (
            !(error instanceof JsonRpcError) ||
            error.code !== NativeRpcErrorCode.StateHeightUnavailable
          ) {
            throw error;
          }
          await sleep(100, undefined, { signal: freshnessDeadline });
        }
      }
      assert.ok(after.stateBlockHeight >= receipt.blockHeight);
      assert.equal(after.value - before.value, amount);
      const snapshot = await client.readViews({
        calls: [sender, recipient].map(({ address }) =>
          ERC20.v0_1.getBalanceOf.viewRequest({
            address: NATIVE_TOKEN_ADDRESS,
            args: { addr: address },
          }),
        ),
        minStateBlockHeight: receipt.blockHeight,
      });
      assert.ok(
        snapshot.results.every(
          (result) =>
            result.kind === "return" &&
            result.stateBlockHeight === snapshot.stateBlockHeight,
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
        signer: new Ed25519Signer(randomBytes(32)),
      });
      const wallet = createWalletClient({ client, account: sender });
      for (const account of [sender, recipient]) {
        const airdrop = await wallet.requestAirdrop({
          recipient: account.address,
          timeoutMs: airdropTimeoutMs,
        });
        assert.equal(airdrop.execution.result, "return");
      }
      const amount = 1_000n;
      const { receipt } = await wallet.executeCallsAndWait(
        {
          calls: [
            ERC20.v0_1.transfer.call({
              address: NATIVE_TOKEN_ADDRESS,
              gasLimit: gasAmount(500_000n),
              args: { receiver: recipient.address, amount },
            }),
          ],
          gasLimit: gasAmount(1_000_000n),
        },
        { timeoutMs: receiptTimeoutMs },
      );
      assert.equal(receipt.execution.result, "return");
      const event =
        groundhog_erc20_if.v0_1.events.TransferEvent.singleFromReceipt(
          receipt,
          { address: NATIVE_TOKEN_ADDRESS },
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
      // A fresh sender has exactly one outgoing transfer. Exercise address
      // and encoded topic filtering through the real indexer.
      const query = {
        filters: [
          groundhog_erc20_if.v0_1.events.TransferEvent.filter({
            addresses: [NATIVE_TOKEN_ADDRESS],
            topics: { from: sender.address },
          }),
        ],
        start: { order: "ascending", anchor: { kind: "atBeginning" } },
        limit: 50,
      };
      // The indexer may trail consensus; poll until it has processed the
      // receipt's block, after which the result set is definitive.  An empty
      // page with a non-empty cursor is not "no matches", so walk every page.
      const deadline = Date.now() + eventsTimeoutMs;
      let events;
      for (;;) {
        events = [];
        let cursor;
        let latestIndexedBlockHeight;
        do {
          const { start, ...continued } = query;
          const page = await client.getEvents(
            cursor === undefined ? query : { ...continued, cursor },
          );
          events.push(...page.events);
          cursor = page.nextCursor;
          latestIndexedBlockHeight = page.latestIndexedBlockHeight;
        } while (cursor !== null);
        if (latestIndexedBlockHeight >= receipt.blockHeight) break;
        assert.ok(
          Date.now() < deadline,
          `indexer did not reach block ${receipt.blockHeight} within ${eventsTimeoutMs}ms (at ${latestIndexedBlockHeight})`,
        );
        await sleep(250);
      }
      assert.equal(events.length, 1);
      const [identified] = events;
      assert.deepEqual(identified.transactionHash, hash);
      assert.equal(identified.blockHeight, receipt.blockHeight);
      assert.equal(typeof identified.sequenceNumber, "number");
      assert.deepEqual(identified.event.address, NATIVE_TOKEN_ADDRESS);
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
        address: NATIVE_TOKEN_ADDRESS,
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
        addresses: [NATIVE_TOKEN_ADDRESS],
        topics: { from: sender.address },
        start: {
          order: "ascending",
          anchor: { kind: "atHeight", blockHeight: receipt.blockHeight },
        },
        limit: 1,
      };
      const deadline = Date.now() + eventsTimeoutMs;
      let first;
      for (;;) {
        first = await client.getContractEvents(query);
        if (first.latestIndexedBlockHeight >= second.receipt.blockHeight) break;
        assert.ok(
          Date.now() < deadline,
          "event indexer did not reach the second transfer",
        );
        await sleep(250);
      }
      assert.equal(first.events.length, 1);
      assert.equal(first.events[0].fields.amount, amount);
      assert.deepEqual(first.events[0].transactionHash, hash);
      assert.deepEqual(first.events[0].address, NATIVE_TOKEN_ADDRESS);
      assert.deepEqual(first.events[0].topics.to, recipient.address);
      assert.ok(
        first.nextCursor !== null,
        "limit: 1 should return a continuation cursor",
      );
      const { start, ...continuedQuery } = query;
      const next = await client.getContractEvents({
        ...continuedQuery,
        cursor: first.nextCursor,
      });
      assert.equal(next.events.length, 1);
      assert.equal(next.events[0].fields.amount, secondAmount);
      assert.deepEqual(next.events[0].transactionHash, second.transactionHash);
      assert.ok(next.nextCursor !== null);

      const rawQuery = {
        filters: [groundhog_erc20_if.v0_1.events.TransferEvent.filter(query)],
        start: query.start,
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
        found.map((event) => event.transactionHash),
        [hash, second.transactionHash, second.transactionHash],
      );

      const third = await wallet.executeAndWait(
        { invocation: call.invocation, gasLimit: gasAmount(1_000_000n) },
        { timeoutMs: receiptTimeoutMs },
      );
      assert.ok(third.receipt.blockHeight > second.receipt.blockHeight);

      // Wait for indexer readiness before testing either walk. Reusing the old
      // cursor below must still exclude the now-indexed third transfer.
      const thirdIndexDeadline = Date.now() + eventsTimeoutMs;
      for (;;) {
        const indexed = await client.getContractEvents(query);
        if (indexed.latestIndexedBlockHeight >= third.receipt.blockHeight)
          break;
        assert.ok(
          Date.now() < thirdIndexDeadline,
          "event indexer did not reach the third transfer",
        );
        await sleep(250);
      }

      // A raw saved cursor finishes its original walk, excluding the later block.
      // The iterator requires an explicit start so its completion watermark is known.
      const resumed = [];
      let cursor = next.nextCursor;
      do {
        const page = await client.getEvents({
          filters: rawQuery.filters,
          limit: 1,
          cursor,
        });
        resumed.push(...page.events);
        cursor = page.nextCursor;
      } while (cursor !== null);
      assert.deepEqual(resumed, [found[2]]);

      // A fresh row-height scan includes the whole saved block and newer rows.
      const fresh = [];
      for await (const page of client.iterateEventPages({
        ...rawQuery,
        start: {
          order: "ascending",
          anchor: { kind: "atHeight", blockHeight: second.receipt.blockHeight },
        },
      })) {
        fresh.push(...page.events);
      }
      assert.deepEqual(
        fresh.map((event) => event.transactionHash),
        [second.transactionHash, second.transactionHash, third.transactionHash],
      );
      assert.deepEqual(fresh.slice(0, 2), found.slice(1));
    },
  );

  await t.test(
    "atomically funds, deploys and initializes a contract, then reads its state and scalar event",
    async () => {
      const sender = createPubkeyAccount({
        signer: new Ed25519Signer(randomBytes(32)),
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
      assert.equal(result.receipt.execution.result, "return");
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
      const view = await client.simulateInvocation({
        address: result.address,
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
        ping.singleFromReceipt(receipt, { address: result.address }).topics.tag,
        tag,
      );
      const filter = ping.filter({
        addresses: [result.address],
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

  await t.test("preserves a real JSON-RPC invalid-params error", async () => {
    await assert.rejects(
      transport.request("sendTransaction", {
        signedTransaction: "not-valid-hex",
      }),
      (error) => {
        assert.ok(error instanceof JsonRpcError);
        assert.equal(error.code, NativeRpcErrorCode.InvalidParams);
        assert.equal(error.method, "sendTransaction");
        assert.equal(typeof error.message, "string");
        return true;
      },
    );
  });
});

test(
  "fresh native-token funding covers the recipient balance-item deposit",
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
        signer: new Ed25519Signer(randomBytes(32)),
        nonce: 0n,
      }),
    });
    const funding = await funder.requestAirdrop({
      timeoutMs: airdropTimeoutMs,
    });
    assert.equal(funding.execution.result, "return");
    const freshAccount = () =>
      createPubkeyAccount({ signer: new Ed25519Signer(randomBytes(32)) });
    const sender = freshAccount();
    const smallRecipient = freshAccount();
    const fundedRecipient = freshAccount();
    const send = (wallet, receiver, amount) =>
      wallet.execute({
        invocation: ERC20.v0_1.transfer.invocation(
          NATIVE_TOKEN_ADDRESS,
          gasAmount(500_000n),
          { receiver, amount },
        ),
        gasLimit: gasAmount(1_000_000n),
      });
    const balance = (account) =>
      client.getBalance({ address: account.address });
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
    const beforeSmallTransfer = await client.getChainTip();
    const smallHash = await send(wallet, smallRecipient.address, 1_000n);
    const failure = await until(
      () => client.getTransactionStatus({ transactionHash: smallHash }),
      (status) => {
        if (status.status === "pending" || status.status === "unknown")
          return false;
        assert.equal(status.status, "retry");
        assert.deepEqual(status.error, {
          source: "executor",
          code: ExecResult.ExecResultTxNonDeterministicError,
        });
        // The best-effort indexer diagnostic can arrive after scheduler Retry.
        // Reconcile read-only while this isolated fixture retains the attempt.
        return status.recentFailure !== undefined;
      },
    );
    const { attemptBlockHeight, cause } = failure.recentFailure;
    assert.equal(typeof attemptBlockHeight, "bigint");
    assert.ok(attemptBlockHeight >= beforeSmallTransfer.blockHeight);
    assert.ok(attemptBlockHeight <= (await client.getChainTip()).blockHeight);
    assert.deepEqual(cause, {
      kind: "dbConflict",
      conflict: {
        address: smallRecipient.address,
        // XDR StorageKeyType.FreeNativeTokenBalance.
        key: new Uint8Array([0, 0, 0, 1]),
        code: "insufficientFunds",
      },
    });
    assert.equal((await balance(smallRecipient)).rawBalance, 0n);

    // A sufficient first credit can fund its own balance item: a prior faucet
    // airdrop is not a universal prerequisite for receiving native tokens.
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
