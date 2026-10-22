import { assert, describe, expect, it } from "vitest";
import { verify } from "@noble/ed25519";
import {
  contractAddress,
  gasAmount,
  blockHeight,
  AuthClaimType,
  bitMap,
  weight,
  serialize,
  codec,
  ExecResult,
  toHex,
  sha256Hash,
  networkHash,
} from "@thruputchain/protocol";
import { deriveEntrypointID } from "./derivation/entrypointId.js";
import { hashSignedTransaction } from "./derivation/transactionHash.js";
import {
  contractSpecString,
  ContractTypeKind,
  ContractTypeDefKind,
  type ContractSpecId,
} from "@thruputchain/contract-spec";
import { Ed25519Signer } from "./signers/ed25519.js";
import { createInvocation, createTransaction } from "./transaction/build.js";
import { signTransaction } from "./transaction/sign.js";
import { transactionSignaturePreimage } from "./transaction/preimage.js";
import {
  serializeSignedTransaction,
  deserializeSignedTransaction,
} from "./transaction/serialize.js";
import { encodeCalldata, decodeCalldata } from "./contract/encode.js";
import { buildNamedCodecs } from "./contract/codegen.js";
import type { ContractSpec } from "./contract/spec.js";
import { MockTransport } from "./transport/mock.js";
import { createThruputClient } from "./client.js";
import { ERC20 } from "./contracts/erc20.js";
import { ed25519Of } from "./testing/signatures.js";

/** A spec id for a type declared at the root of a `fixture` crate. */
function specId(declared: string): ContractSpecId {
  return {
    crate_name: contractSpecString("fixture"),
    major: contractSpecString("0.1"),
    module_path: contractSpecString("fixture"),
    declared: contractSpecString(declared),
  };
}

const s = contractSpecString;

const erc20Spec: ContractSpec = {
  interfaces: [
    {
      name: s("ERC20"),
      vers: s("0.1.0"),
      throws: [
        {
          selector: 0xb19947acb2fa14ffn,
          ty: { v: ContractTypeKind.Named, named: specId("ERC20Error") },
        },
      ],
      methods: [
        {
          name: s("transfer"),
          effect: null,
          args: [
            { name: s("to"), ty: { v: ContractTypeKind.Address } },
            { name: s("amount"), ty: { v: ContractTypeKind.U128 } },
          ],
          return_type: { v: ContractTypeKind.Void },
        },
      ],
    },
  ],
  type_defs: [
    {
      v: ContractTypeDefKind.TypeDefEnum,
      enum_def: {
        name: specId("ERC20Error"),
        variants: [
          { name: s("AlreadyInitialized"), value: 1n },
          { name: s("MustBeContractOwner"), value: 2n },
          { name: s("TooLarge"), value: 3n },
          { name: s("Internal"), value: 100n },
        ],
      },
    },
  ],
  events: [],
};

const testNetworkHash = networkHash(sha256Hash(new Uint8Array(32).fill(0x5a)));

describe("end-to-end: build, sign, serialize an ERC20 transfer", () => {
  it("round-trips a complete signed transaction", async () => {
    const secretKey = new Uint8Array(32);
    secretKey[0] = 0xde;
    secretKey[1] = 0xad;
    const signer = new Ed25519Signer(secretKey);

    const tokenAddress = contractAddress(new Uint8Array(32).fill(0x11));
    const recipient = contractAddress(new Uint8Array(32).fill(0x22));
    const amount = 500n;
    const namedCodecs = buildNamedCodecs(erc20Spec.type_defs);

    const data = encodeCalldata(
      erc20Spec,
      "ERC20",
      "transfer",
      [recipient, amount],
      namedCodecs,
    );
    const entrypoint = await deriveEntrypointID("ERC20", "0.1.0", "transfer");

    const invocation = createInvocation({
      invoked_address: tokenAddress,
      entrypoint,
      gas_limit: gasAmount(1_000_000n),
      calldata: data,
    });

    const tx = createTransaction({
      invocation,
      uniquifier: {
        block_expiry_height: blockHeight(1000n),
        nonce: 12345n,
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

    const signed = await signTransaction(
      tx,
      [{ signer, publicKeyId: 0n }],
      testNetworkHash,
    );

    // Verify signature over the canonical preimage, not the bare transaction
    const preimage = transactionSignaturePreimage(testNetworkHash, tx);
    expect(signed.signatures).toHaveLength(1);
    const signature = signed.signatures[0];
    assert.isDefined(signature);
    const sig = ed25519Of(signature.signature);
    expect(verify(sig, preimage, signer.publicKey.ed25519)).toBe(true);

    // Round-trip through serialization
    const wireBytes = serializeSignedTransaction(signed);
    const restored = deserializeSignedTransaction(wireBytes);

    expect(restored.tx.invocation.invoked_address).toEqual(tokenAddress);
    expect(restored.tx.invocation.entrypoint).toEqual(entrypoint);
    expect(restored.tx.invocation.gas_limit).toBe(1_000_000n);
    expect(restored.tx.uniquifier.block_expiry_height).toBe(1000n);
    expect(restored.tx.uniquifier.nonce).toBe(12345n);
    expect(restored.signatures).toHaveLength(1);
    const restoredSignature = restored.signatures[0];
    assert.isDefined(restoredSignature);
    expect(ed25519Of(restoredSignature.signature)).toEqual(sig);

    // Decode calldata from the restored transaction
    const decoded = decodeCalldata(
      erc20Spec,
      "ERC20",
      "transfer",
      restored.tx.invocation.calldata,
      namedCodecs,
    );
    expect(decoded.to).toEqual(recipient);
    expect(decoded.amount).toBe(amount);

    // Hash is deterministic, and now covers the inner transaction only, so it
    // no longer moves when the signature bytes do.
    const txHash = hashSignedTransaction(signed);
    expect(toHex(txHash)).toBe(
      "b7c97dc9323aa4015e0e6068a0f518cbbb94bf82b9794a06adb65761e845aaa1",
    );
    const txHash2 = hashSignedTransaction(restored);
    expect(txHash2).toEqual(txHash);
  });
});

describe("end-to-end: full pipeline via MockTransport client", () => {
  it("builds ERC20 transfer, sends, and retrieves receipt via client", async () => {
    const transport = new MockTransport();
    const client = await createThruputClient({ transport });

    // Initial chain tip should be at height 0
    const initialTip = await client.getChainTip();
    expect(initialTip.blockHeight).toBe(0n);

    // Build an ERC20 transfer invocation
    const tokenAddress = contractAddress(new Uint8Array(32).fill(0xaa));
    const recipient = contractAddress(new Uint8Array(32).fill(0xbb));
    const invocation = ERC20.v0_1.transfer.invocation(
      tokenAddress,
      gasAmount(500_000n),
      {
        receiver: recipient,
        amount: 1000n,
      },
    );

    // Wrap in a transaction
    const tx = createTransaction({
      invocation,
      uniquifier: {
        block_expiry_height: blockHeight(500n),
        nonce: 99n,
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

    // Sign the transaction
    const secretKey = new Uint8Array(32);
    secretKey[0] = 0xfe;
    const signer = new Ed25519Signer(secretKey);
    const signedTx = await signTransaction(
      tx,
      [{ signer, publicKeyId: 0n }],
      testNetworkHash,
    );

    // Send via client
    const { transactionHash: txHash } = await client.sendTransaction({
      signedTransaction: serializeSignedTransaction(signedTx),
    });
    expect(txHash).toBeInstanceOf(Uint8Array);
    expect(txHash.length).toBe(32);

    // Get receipt via client
    const receipt = await client.getTransactionReceipt({
      transactionHash: txHash,
    });
    expect(receipt).not.toBeNull();
    expect(receipt!.transactionHash).toEqual(txHash);
    expect(receipt!.execution).toMatchObject({ result: "return" });
    expect(receipt!.blockHeight).toBe(1n);

    // Chain tip should reflect the new block
    const newTip = await client.getChainTip();
    expect(newTip.blockHeight).toBe(1n);
  });
});
