import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  HttpTransport,
  PrivateKeySigner,
  createPubkeyAccount,
  createThruputClient,
  createWalletClient,
  localnet,
  fundAccount,
  addressFromHex,
  toHex0x,
} from "@thruputchain/client";
import { ERC20 } from "@thruputchain/client/contracts";
import { HOG_ADDRESS, gasAmount, ExecResult } from "@thruputchain/protocol";

test(
  "local funding preserves admitted bytes after a lost response",
  { timeout: 120_000 },
  async (t) => {
    const rpcUrl = process.env.THRUPUT_RPC_URL;
    assert.ok(rpcUrl, "Set THRUPUT_RPC_URL to a GH-462 local node");
    const transport = new HttpTransport(rpcUrl, { timeoutMs: 30_000 });
    const version = await transport.request("groundhog_version", []);
    if (version.wireFormat === "11.1.0") {
      t.skip("Published CLI 0.27.0 predates wire-11.2 local funding");
      return;
    }
    const manifest = JSON.parse(
      await readFile(process.env.THRUPUT_RUNTIME_MANIFEST, "utf8"),
    );
    if (manifest.schemaVersion === 3 && manifest.kind === "hogd-dev-runtime") {
      t.skip("Published runtime predates schema-4 local funding");
      return;
    }
    assert.ok([4, 5].includes(manifest.schemaVersion));
    assert.equal(manifest.kind, "hogd-dev-runtime");
    assert.equal(manifest.bootstrapAccountDerivation, undefined);
    const faucets = manifest.bootstrapAccounts.filter(
      (a) => a.role === "faucet",
    );
    assert.equal(faucets.length, 1);
    const account = createPubkeyAccount({
      signer: new PrivateKeySigner(randomBytes(32)),
    });
    const request = {
      recipient: account.address,
      rawAmount: 1_000_000_000n,
      clientNonce: randomBytes(16),
      faucet: addressFromHex(faucets[0].walletAddress),
    };
    const work = await mkdtemp(
      join(tmpdir(), "groundhog-client-local-funding-"),
    );
    try {
      const intent = {
        networkHash: manifest.networkHash,
        recipient: toHex0x(request.recipient),
        rawAmount: request.rawAmount.toString(),
        clientNonce: toHex0x(request.clientNonce),
        faucet: toHex0x(request.faucet),
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
          admitted = await transport.request(method, params, options);
          throw new Error("lost response after authoritative admission");
        },
      };
      await assert.rejects(fundAccount(lostResponse, request), /lost response/);
      const recovered = await fundAccount(transport, request);
      assert.equal(toHex0x(recovered.txHash), admitted.txHash);
      assert.equal(
        toHex0x(recovered.signedTransaction),
        admitted.signedTransaction,
      );
      const client = await createThruputClient({
        cluster: localnet({ rpcUrl }),
        transport,
      });
      const receipt = await client.waitForTransactionReceipt(recovered.txHash, {
        timeoutMs: 30_000,
      });
      assert.equal(receipt.execResult, ExecResult.ExecResultOK);
      assert.ok(
        (await client.getBalance(account.address)).rawBalance > 900_000_000n,
      );
      const wallet = createWalletClient({ client, account });
      const receiver = createPubkeyAccount({
        signer: new PrivateKeySigner(randomBytes(32)),
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
      assert.equal(sent.receipt.execResult, ExecResult.ExecResultOK);
      assert.ok((await client.getBalance(receiver.address)).rawBalance > 0n);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  },
);
