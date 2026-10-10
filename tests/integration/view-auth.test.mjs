import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import {
  addressFromHex,
  createGroundhogClient,
  createPubkeyAccount,
  createWalletClient,
  defaultWalletAdapter,
  deriveEntrypointID,
  ExecResult,
  gasAmount,
  HttpTransport,
  prepareContractDeployment,
  PrivateKeySigner,
} from "@groundhogchain/client";
import { fundAccount } from "@groundhogchain/client/actions";
import { DefaultWallet, ERC20 } from "@groundhogchain/client/contracts";
import {
  GroundhogRpcErrorCode,
  JsonRpcError,
} from "@groundhogchain/client/transport";
import {
  AuthClaimType,
  bitMap,
  calldata,
  weight,
} from "@groundhogchain/protocol";

test(
  "optional authorization reaches ordinary contracts and real wallet roots",
  { timeout: 90_000 },
  async () => {
    const fixtures = process.env.GROUNDHOG_AUTH_FIXTURE_DIR;
    assert.ok(
      fixtures,
      "Set GROUNDHOG_AUTH_FIXTURE_DIR to hogd's built_contracts directory",
    );
    const manifest = JSON.parse(
      await readFile(process.env.GROUNDHOG_RUNTIME_MANIFEST, "utf8"),
    );
    const faucet = manifest.bootstrapAccounts.find(
      (account) => account.role === "faucet",
    );
    assert.ok(faucet);
    const fundingTransport = new HttpTransport(
      process.env.GROUNDHOG_FUNDING_RPC_URL ?? process.env.GROUNDHOG_RPC_URL,
    );
    const fundingClient = await createGroundhogClient({
      transport: fundingTransport,
    });
    const client = await createGroundhogClient({
      transport: new HttpTransport(process.env.GROUNDHOG_RPC_URL),
    });
    const sender = createPubkeyAccount({
      signer: new PrivateKeySigner(randomBytes(32)),
      nonce: 9007199254740993n,
    });
    const receiver = createPubkeyAccount({
      signer: new PrivateKeySigner(randomBytes(32)),
    });
    for (const account of [sender, receiver]) {
      const funded = await fundAccount(fundingTransport, {
        recipient: account.address,
        faucet: addressFromHex(faucet.walletAddress),
        rawAmount: 1_000_000_000n,
        clientNonce: randomBytes(16),
      });
      assert.equal(
        (
          await fundingClient.waitForTransactionReceipt(funded.txHash, {
            timeoutMs: 30_000,
          })
        ).execResult,
        ExecResult.ExecResultOK,
      );
    }
    const wallet = createWalletClient({
      client,
      account: sender,
      networkHash: (await client.getNetworkInfo()).networkHash,
    });
    const deployment = prepareContractDeployment({
      deployer: sender.address,
      contract: await readFile(join(fixtures, "authclaim_test.rv32a")),
    });
    const deployed = await wallet.deployContractAndWait(
      deployment,
      { gasLimit: gasAmount(10_000_000n), amount: 50_000_000n },
      { timeoutMs: 30_000 },
    );
    assert.equal(deployed.receipt.execResult, ExecResult.ExecResultOK);
    const spec = JSON.parse(
      await readFile(join(fixtures, "authclaim_test_spec.json"), "utf8"),
    );
    const iface = spec.interfaces.find(
      (entry) => entry.name === "AuthClaimTest",
    );
    assert.ok(iface);
    const ordinary = {
      contract: deployment.address,
      entrypoint: deriveEntrypointID(
        iface.name,
        iface.version,
        "test_get_auth_claim",
      ),
      calldata: calldata(new Uint8Array()),
      gasLimit: 1_000_000n,
    };
    const nonzero = {
      claim_type: AuthClaimType.kSourceAddressAuthData,
      source_address_claim: {
        allowed_keys: bitMap(5n),
        required_weight: weight(3n),
      },
    };
    const freshnessDeadline = AbortSignal.timeout(30_000);
    while (true) {
      let result;
      try {
        result = await client.view(
          { ...ordinary, minHeight: deployed.receipt.height },
          { signal: freshnessDeadline },
        );
      } catch (error) {
        if (
          !(error instanceof JsonRpcError) ||
          error.code !== GroundhogRpcErrorCode.ViewHeightUnavailable
        ) {
          throw error;
        }
        await sleep(100, undefined, { signal: freshnessDeadline });
        continue;
      }
      assert.equal(result.output.result, "return");
      break;
    }
    assert.equal(
      (await client.view({ ...ordinary, authClaim: nonzero })).output.result,
      "fault",
    );
    assert.equal(
      (await client.view({ ...ordinary, authClaim: sender.authClaim })).output
        .result,
      "fault",
    );

    const hog = addressFromHex(`0x${"0".repeat(63)}1`);
    const token = ERC20.v0_1;
    const reads = [sender, receiver].map(({ address }) =>
      token.getBalanceOf.viewRequest({
        contract: hog,
        args: { addr: address },
      }),
    );
    const before = await client.readViews({ calls: reads });
    assert.ok(before.results.every((result) => result.kind === "return"));
    const amount = 1000n;
    const invocation = defaultWalletAdapter.createBatchRootInvocation(
      sender.address,
      {
        gasLimit: gasAmount(10_000_000n),
        invocations: [
          token.transfer.invocation(hog, gasAmount(1_000_000n), {
            receiver: receiver.address,
            amount,
          }),
          ...reads.map(({ request }) => ({
            invoked_address: request.contract,
            entrypoint: request.entrypoint,
            calldata: request.calldata,
            gas_limit: gasAmount(1_000_000n),
          })),
        ],
      },
    );
    const root = {
      contract: sender.address,
      entrypoint: invocation.entrypoint,
      calldata: invocation.calldata,
      gasLimit: invocation.gas_limit,
    };
    assert.equal((await client.view(root)).output.result, "abort");
    const simulated = await client.view({
      ...root,
      authClaim: sender.authClaim,
    });
    assert.equal(simulated.output.result, "return");
    assert.equal(simulated.events.length, 1);
    const values = DefaultWallet.v0_1.execute.decodeView(simulated).value;
    assert.equal(
      token.getBalanceOf.decodeReturn(values[1]),
      before.results[0].value - amount,
    );
    assert.equal(
      token.getBalanceOf.decodeReturn(values[2]),
      before.results[1].value + amount,
    );
    const wrong = structuredClone(sender.authClaim);
    wrong.pubkey_preimage.nonce = 0n;
    const batch = await client.viewBatch({
      calls: [
        ordinary,
        { ...ordinary, authClaim: nonzero },
        { ...root, authClaim: sender.authClaim },
        { ...root, authClaim: wrong },
        ordinary,
      ],
    });
    assert.deepEqual(
      batch.results.map(({ output }) => output.result),
      ["return", "fault", "return", "abort", "return"],
    );
    assert.deepEqual(
      (await client.readViews({ calls: reads })).results.map(
        (result) => result.value,
      ),
      before.results.map((result) => result.value),
    );
    const hash = await wallet.sendInvocation({ invocation });
    const receipt = await client.waitForTransactionReceipt(hash, {
      timeoutMs: 30_000,
    });
    assert.equal(receipt.execResult, ExecResult.ExecResultOK);
    assert.deepEqual(receipt.returnData, simulated.output.returnData);
    assert.deepEqual(receipt.events, simulated.events);
  },
);
