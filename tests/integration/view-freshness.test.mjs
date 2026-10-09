import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import {
  HttpTransport,
  JsonRpcError,
  GroundhogRpcErrorCode,
  PrivateKeySigner,
  addressFromHex,
  createGroundhogClient,
  createPubkeyAccount,
  createWalletClient,
  fundAccount,
  getContract,
  localnet,
} from "@groundhogchain/client";
import { ERC20 } from "@groundhogchain/client/contracts";
import { ExecResult, HOG_ADDRESS, gasAmount } from "@groundhogchain/protocol";

test(
  "single-view freshness after confirmation",
  { timeout: 60_000 },
  async () => {
    const rpcUrl = process.env.GROUNDHOG_RPC_URL;
    const fundingUrl = process.env.GROUNDHOG_FUNDING_RPC_URL ?? rpcUrl;
    const manifestPath = process.env.GROUNDHOG_RUNTIME_MANIFEST;
    assert.ok(
      rpcUrl && fundingUrl && manifestPath,
      "Set the RPC URL and local runtime manifest",
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const faucet = manifest.bootstrapAccounts.find(
      (account) => account.role === "faucet",
    );
    assert.ok(faucet);
    const transport = new HttpTransport(rpcUrl);
    const client = await createGroundhogClient({
      transport,
      cluster: localnet({ rpcUrl }),
    });
    const fundingTransport = new HttpTransport(fundingUrl);
    const fundingClient = await createGroundhogClient({
      transport: fundingTransport,
    });
    const sender = createPubkeyAccount({
      signer: new PrivateKeySigner(randomBytes(32)),
    });
    const recipient = createPubkeyAccount({
      signer: new PrivateKeySigner(randomBytes(32)),
    });
    for (const account of [sender, recipient]) {
      const funded = await fundAccount(fundingTransport, {
        recipient: account.address,
        faucet: addressFromHex(faucet.walletAddress),
        rawAmount: 1_000_000_000n,
        clientNonce: randomBytes(16),
      });
      const receipt = await fundingClient.waitForTransactionReceipt(
        funded.txHash,
        { timeoutMs: 30_000 },
      );
      assert.equal(receipt.execResult, ExecResult.ExecResultOK);
    }
    const wallet = createWalletClient({ client, account: sender });
    const token = getContract({
      binding: ERC20.v0_1,
      address: HOG_ADDRESS,
      client,
    });
    const before = await token.getBalanceOf.view({
      args: { addr: recipient.address },
    });
    const amount = 1_000n;
    const { receipt } = await wallet.executeAndWait(
      {
        invocation: ERC20.v0_1.transfer.invocation(
          HOG_ADDRESS,
          gasAmount(500_000n),
          { receiver: recipient.address, amount },
        ),
        gasLimit: gasAmount(1_000_000n),
      },
      { timeoutMs: 30_000 },
    );
    assert.equal(receipt.execResult, ExecResult.ExecResultOK);
    const options = {
      args: { addr: recipient.address },
      minHeight: receipt.height,
    };
    try {
      const immediate = await token.getBalanceOf.view(options);
      assert.ok(immediate.height >= receipt.height);
      assert.equal(immediate.value, before.value + amount);
    } catch (error) {
      assert.ok(error instanceof JsonRpcError);
      assert.equal(error.code, GroundhogRpcErrorCode.ViewHeightUnavailable);
      assert.equal(BigInt(error.data.requested), receipt.height);
      assert.ok(BigInt(error.data.observed) < receipt.height);
    }

    // Give shared snapshot maintenance time to advance. This is a second caller
    // request, not a retry or wait performed by the SDK.
    await sleep(1_000);
    const after = await token.getBalanceOf.view(options);
    assert.ok(after.height >= receipt.height);
    assert.equal(after.value, before.value + amount);
    assert.ok(after.gasUsed > 0n);
    const outcome = await ERC20.v0_1.getBalanceOf.viewOutcome({
      client,
      contract: HOG_ADDRESS,
      ...options,
    });
    assert.equal(outcome.kind, "return");
    assert.equal(outcome.value, after.value);
    const prepared = ERC20.v0_1.getBalanceOf.viewRequest({
      contract: HOG_ADDRESS,
      args: options.args,
    });
    assert.ok(
      (await client.view({ ...prepared.request, minHeight: receipt.height }))
        .height >= receipt.height,
    );

    await assert.rejects(
      token.getBalanceOf.view({ ...options, minHeight: 9007199254740993n }),
      (error) => {
        assert.ok(error instanceof JsonRpcError);
        assert.equal(error.code, GroundhogRpcErrorCode.ViewHeightUnavailable);
        assert.equal(error.data.requested, "9007199254740993");
        assert.ok(BigInt(error.data.observed) < 9007199254740993n);
        return true;
      },
    );
    assert.equal(receipt.execResult, ExecResult.ExecResultOK);
  },
);
