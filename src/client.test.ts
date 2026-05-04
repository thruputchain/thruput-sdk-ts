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
} from "@groundhogchain/protocol";
import { PrivateKeySigner } from "./signers/privateKey.js";
import { createInvocation, createTransaction } from "./transaction/build.js";
import { signTransaction } from "./transaction/sign.js";
import { MockTransport } from "./transport/mock.js";
import { createGroundhogClient } from "./client.js";

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

describe("createGroundhogClient", () => {
  it("getChainTip returns height 0n on fresh mock", async () => {
    const client = createGroundhogClient(new MockTransport());
    const tip = await client.getChainTip();
    expect(tip.height).toBe(0n);
    expect(tip.blockHash.length).toBe(32);
  });

  it("send tx and get receipt", async () => {
    const client = createGroundhogClient(new MockTransport());
    const signedTx = await makeDummySignedTx();
    const txHash = await client.sendTransaction(signedTx);
    expect(txHash).toBeInstanceOf(Uint8Array);
    expect(txHash.length).toBe(32);

    const receipt = await client.getTransactionReceipt(txHash);
    expect(receipt).not.toBeNull();
    expect(receipt!.txHash).toEqual(txHash);
    expect(receipt!.status.result).toBe("ok");
  });

  it("dev.getAccounts returns accounts", async () => {
    const client = createGroundhogClient(new MockTransport());
    const accounts = await client.dev.getAccounts();
    expect(accounts.length).toBeGreaterThan(0);
    for (const account of accounts) {
      expect(account.address.length).toBe(32);
      expect(account.publicKey.length).toBeGreaterThan(0);
    }
  });
});
