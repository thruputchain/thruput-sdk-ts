import { describe, expect, it } from "vitest";
import { verify } from "@noble/ed25519";
import {
  calldata,
  contractAddress,
  contractEntrypointID,
  gasAmount,
  blockHeight,
  AuthClaimType,
  bitMap,
  weight,
  serialize,
  deserialize,
  codec,
} from "@groundhogchain/protocol";
import { PrivateKeySigner } from "../signers/privateKey.js";
import { signTransaction } from "./sign.js";
import { createInvocation, createTransaction } from "./build.js";

function makeDummyTransaction() {
  const invocation = createInvocation({
    invoked_address: contractAddress(new Uint8Array(32)),
    entrypoint: contractEntrypointID(new Uint8Array(8)),
    gas_limit: gasAmount(1_000_000n),
    calldata: calldata(new Uint8Array([1, 2, 3, 4])),
  });

  return createTransaction({
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
}

describe("signTransaction", () => {
  it("produces a valid Ed25519 signature over the serialized transaction", async () => {
    const secretKey = new Uint8Array(32);
    secretKey[0] = 1;
    const signer = new PrivateKeySigner(secretKey);

    const tx = makeDummyTransaction();
    const signed = await signTransaction(tx, [{ signer, publicKeyId: 0n }]);

    expect(signed.tx).toEqual(tx);
    expect(signed.signatures).toHaveLength(1);
    expect(signed.signatures[0].public_key_id).toBe(0n);

    const txBytes = serialize(tx, codec.Transaction);
    const sig = signed.signatures[0].signature;
    expect(sig.scheme).toBe(0);
    const valid = verify(sig.ed25519, txBytes, signer.publicKey.ed25519);
    expect(valid).toBe(true);
  });

  it("round-trips through serialization", async () => {
    const secretKey = new Uint8Array(32);
    secretKey[0] = 2;
    const signer = new PrivateKeySigner(secretKey);

    const tx = makeDummyTransaction();
    const signed = await signTransaction(tx, [{ signer, publicKeyId: 0n }]);

    const bytes = serialize(signed, codec.SignedTransaction);
    const deserialized = deserialize(bytes, codec.SignedTransaction);

    expect(deserialized.tx).toEqual(signed.tx);
    expect(deserialized.signatures).toHaveLength(1);
    expect(deserialized.signatures[0].public_key_id).toBe(0n);
    expect(deserialized.signatures[0].signature.ed25519).toEqual(
      signed.signatures[0].signature.ed25519,
    );
  });
});
