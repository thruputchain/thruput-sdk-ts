import { describe, expect, it } from "vitest";
import {
  contractAddress,
  gasAmount,
  blockHeight,
  calldata,
  contractEntrypointID,
  AuthClaimType,
  bitMap,
  weight,
  ExecResult,
} from "@groundhogchain/protocol";
import { PrivateKeySigner } from "../signers/privateKey.js";
import { createInvocation, createTransaction } from "../transaction/build.js";
import { signTransaction } from "../transaction/sign.js";
import { MockTransport } from "../transport/mock.js";
import { sendTransaction } from "./wallet/sendTransaction.js";
import { getChainTip } from "./public/getChainTip.js";
import { getTransactionReceipt } from "./public/getTransactionReceipt.js";
import { getTransactionStatus } from "./public/getTransactionStatus.js";
import { devReset, devGetAccounts } from "./dev/index.js";

function makeDummySignedTx() {
  const secretKey = new Uint8Array(32);
  secretKey[0] = 1;
  const signer = new PrivateKeySigner(secretKey);

  const invocation = createInvocation({
    invoked_address: contractAddress(new Uint8Array(32)),
    entrypoint: contractEntrypointID(new Uint8Array(8)),
    gas_limit: gasAmount(1_000_000n),
    calldata: calldata(new Uint8Array([1, 2, 3, 4])),
  });

  const tx = createTransaction({
    invocation,
    uniquifier: {
      block_expiry_height: blockHeight(100n),
      nonce: 42n,
    },
    contracts_to_deploy: [],
    auth_claim: {
      claim_type: AuthClaimType.kSourceAddressAuthData,
      source_address_claim: {
        allowed_keys: bitMap(0xffffffffn),
        required_weight: weight(1n),
      },
    },
  });

  return signTransaction(tx, [{ signer, publicKeyId: 0n }]);
}

describe("sendTransaction", () => {
  it("sends a signed tx and returns a 32-byte hash", async () => {
    const transport = new MockTransport();
    const signedTx = await makeDummySignedTx();
    const hash = await sendTransaction(transport, signedTx);
    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBe(32);
  });
});

describe("getChainTip", () => {
  it("returns height 0n and 32-byte blockHash on empty mock", async () => {
    const transport = new MockTransport();
    const tip = await getChainTip(transport);
    expect(tip.height).toBe(0n);
    expect(tip.blockHash).toBeInstanceOf(Uint8Array);
    expect(tip.blockHash.length).toBe(32);
  });

  it("reflects height 1n after sending a transaction", async () => {
    const transport = new MockTransport();
    const signedTx = await makeDummySignedTx();
    await sendTransaction(transport, signedTx);
    const tip = await getChainTip(transport);
    expect(tip.height).toBe(1n);
  });
});

describe("getTransactionReceipt", () => {
  it("returns receipt for submitted tx", async () => {
    const transport = new MockTransport();
    const signedTx = await makeDummySignedTx();
    const txHash = await sendTransaction(transport, signedTx);
    const receipt = await getTransactionReceipt(transport, txHash);
    expect(receipt).not.toBeNull();
    expect(receipt!.txHash).toEqual(txHash);
    expect(receipt!.execResult).toBe(ExecResult.ExecResultOK);
    expect(receipt!.events).toEqual([]);
  });

  it("returns null for unknown tx", async () => {
    const transport = new MockTransport();
    const fakeHash = new Uint8Array(32) as any;
    const receipt = await getTransactionReceipt(transport, fakeHash);
    expect(receipt).toBeNull();
  });
});

describe("getTransactionStatus", () => {
  it("returns committed for submitted tx", async () => {
    const transport = new MockTransport();
    const signedTx = await makeDummySignedTx();
    const txHash = await sendTransaction(transport, signedTx);
    const status = await getTransactionStatus(transport, txHash);
    expect(status.status).toBe("committed");
  });

  it("returns unknown for missing tx", async () => {
    const transport = new MockTransport();
    const fakeHash = new Uint8Array(32) as any;
    const status = await getTransactionStatus(transport, fakeHash);
    expect(status.status).toBe("unknown");
  });
});

describe("devReset", () => {
  it("clears state so chainTip height returns to 0n", async () => {
    const transport = new MockTransport();
    const signedTx = await makeDummySignedTx();
    await sendTransaction(transport, signedTx);
    const tipBefore = await getChainTip(transport);
    expect(tipBefore.height).toBe(1n);

    await devReset(transport);
    const tipAfter = await getChainTip(transport);
    expect(tipAfter.height).toBe(0n);
  });
});

describe("devGetAccounts", () => {
  it("returns typed accounts with correct field lengths", async () => {
    const transport = new MockTransport();
    const accounts = await devGetAccounts(transport);
    expect(accounts.length).toBeGreaterThan(0);
    for (const account of accounts) {
      expect(account.address.length).toBe(32);
      expect(account.publicKey.length).toBeGreaterThan(0);
    }
  });
});
