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
  ContractType,
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
    contracts_to_deploy: [
      {
        contract_type: ContractType.kWasmi,
        wasmi_contract: { data: new Uint8Array([0x00, 0x61, 0x73, 0x6d]) },
      },
    ],
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
    const [contract] = deserialized.tx.contracts_to_deploy;
    expect(contract?.contract_type).toBe(ContractType.kWasmi);
    if (contract?.contract_type !== ContractType.kWasmi) {
      throw new Error("Expected a WASM contract after serialization");
    }
    expect(contract.wasmi_contract.data).toEqual(
      new Uint8Array([0x00, 0x61, 0x73, 0x6d]),
    );
    expect(deserialized.signatures).toHaveLength(1);
    expect(deserialized.signatures[0].public_key_id).toBe(0n);
    expect(deserialized.signatures[0].signature.ed25519).toEqual(
      signed.signatures[0].signature.ed25519,
    );
  });

  it("supports multiple signers with distinct key IDs", async () => {
    const sk1 = new Uint8Array(32);
    sk1[0] = 10;
    const sk2 = new Uint8Array(32);
    sk2[0] = 20;
    const signer1 = new PrivateKeySigner(sk1);
    const signer2 = new PrivateKeySigner(sk2);

    const tx = makeDummyTransaction();
    const signed = await signTransaction(tx, [
      { signer: signer1, publicKeyId: 0n },
      { signer: signer2, publicKeyId: 1n },
    ]);

    expect(signed.signatures).toHaveLength(2);
    expect(signed.signatures[0].public_key_id).toBe(0n);
    expect(signed.signatures[1].public_key_id).toBe(1n);

    const txBytes = serialize(tx, codec.Transaction);
    const valid1 = verify(
      signed.signatures[0].signature.ed25519,
      txBytes,
      signer1.publicKey.ed25519,
    );
    const valid2 = verify(
      signed.signatures[1].signature.ed25519,
      txBytes,
      signer2.publicKey.ed25519,
    );
    expect(valid1).toBe(true);
    expect(valid2).toBe(true);

    expect(signed.signatures[0].signature.ed25519).not.toEqual(
      signed.signatures[1].signature.ed25519,
    );
  });
});
