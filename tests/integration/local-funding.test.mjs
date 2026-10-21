import assert from "node:assert/strict";
import versions from "../../scripts/integration-versions.json" with { type: "json" };
import { randomBytes } from "node:crypto";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  HttpTransport,
  Ed25519Signer,
  createPubkeyAccount,
  createThruputClient,
  createWalletClient,
  localnet,
  createRpcClient,
  addressFromBase58,
  toBase58,
  toHex0x,
} from "@thruputchain/client";
import { ERC20 } from "@thruputchain/client/contracts";
import { HOG_ADDRESS, gasAmount } from "@thruputchain/protocol";

test(
  "local funding preserves admitted bytes after a lost response",
  { timeout: 120_000 },
  async () => {
    const rpcUrl = process.env.THRUPUT_RPC_URL;
    assert.ok(rpcUrl, "Set THRUPUT_RPC_URL to a GH-462 local node");
    const transport = new HttpTransport(rpcUrl, { timeoutMs: 30_000 });
    const version = await transport.request("getVersionInfo", {});
    assert.equal(
      version.wireFormat,
      process.env.THRUPUT_EXPECTED_WIRE_FORMAT ?? versions.wireFormat,
    );
    const manifest = JSON.parse(
      await readFile(process.env.THRUPUT_RUNTIME_MANIFEST, "utf8"),
    );
    assert.equal(manifest.schemaVersion, 5);
    assert.equal(manifest.kind, "hogd-dev-runtime");
    assert.equal(manifest.bootstrapAccountDerivation, undefined);
    const faucets = manifest.bootstrapAccounts.filter(
      (a) => a.role === "faucet",
    );
    assert.equal(faucets.length, 1);
    const account = createPubkeyAccount({
      signer: new Ed25519Signer(randomBytes(32)),
    });
    const request = {
      recipient: account.address,
      rawAmount: 1_000_000_000n,
      clientNonce: randomBytes(16),
      faucet: addressFromBase58(faucets[0].walletAddress),
    };
    const work = await mkdtemp(
      join(tmpdir(), "groundhog-client-local-funding-"),
    );
    try {
      const intent = {
        networkHash: manifest.networkHash,
        recipient: toBase58(request.recipient),
        rawAmount: request.rawAmount.toString(),
        clientNonce: toHex0x(request.clientNonce),
        faucet: toBase58(request.faucet),
      };
      const file = await open(join(work, "request.json"), "wx", 0o600);
      await file.writeFile(JSON.stringify(intent));
      await file.sync();
      await file.close();
      const directory = await open(work, "r");
      await directory.sync();
      await directory.close();
      let admitted;
      const lostResponse = {
        async request(method, params, options) {
          const result = await transport.request(method, params, options);
          if (method !== "dev_fundAccount") return result;
          admitted = result;
          throw new Error("lost response after authoritative admission");
        },
      };
      const interrupted = await createRpcClient({ transport: lostResponse });
      await assert.rejects(
        interrupted.dev_fundAccount(request),
        /lost response/,
      );
      // Explicit recovery of a persisted local funding intent, not an SDK retry.
      const rpc = await createRpcClient({ transport });
      const recovered = await rpc.dev_fundAccount(request);
      assert.equal(
        toBase58(recovered.transactionHash),
        admitted.transactionHash,
      );
      assert.equal(
        toHex0x(recovered.signedTransaction),
        admitted.signedTransaction,
      );
      const client = await createThruputClient({
        cluster: localnet({ rpcUrl }),
        transport,
      });
      const receipt = await client.waitForTransactionReceipt(
        recovered.transactionHash,
        {
          timeoutMs: 30_000,
        },
      );
      assert.equal(receipt.execution.result, "return");
      assert.ok(
        (await client.getBalance({ address: account.address })).rawBalance >
          900_000_000n,
      );
      const wallet = createWalletClient({ client, account });
      const receiver = createPubkeyAccount({
        signer: new Ed25519Signer(randomBytes(32)),
      });
      const sent = await wallet.executeAndWait(
        {
          invocation: ERC20.v0_1.transfer.invocation(
            HOG_ADDRESS,
            gasAmount(500_000n),
            { receiver: receiver.address, amount: 1_000_000n },
          ),
          gasLimit: gasAmount(1_000_000n),
        },
        { timeoutMs: 30_000 },
      );
      assert.equal(sent.receipt.execution.result, "return");
      assert.ok(
        (await client.getBalance({ address: receiver.address })).rawBalance >
          0n,
      );
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  },
);
