import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  HttpTransport,
  PrivateKeySigner,
  createGroundhogClient,
  createPubkeyAccount,
  createWalletClient,
  localnet,
  prepareContractDeployment,
} from "@groundhogchain/client";
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
      const transfer = ERC20TransferEvent.singleFromReceipt(receipt, {
        contractAddress: HOG_ADDRESS,
      });
      assert.deepEqual(transfer.topics, {
        from: sender.address,
        to: recipient.address,
      });
      assert.equal(transfer.fields.amount, amount);
      assert.ok(
        receipt.events.some(
          (event) => decodeERC20Event(event)?.name === "TransferEvent",
        ),
      );
      const after = await balance();
      assert.ok(after.height >= receipt.height);
      assert.equal(after.value - before.value, amount);
    },
  );

  await t.test(
    "prefunds a predicted address and deploys through the wallet helper",
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
