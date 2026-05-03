import { describe, expect, it } from "vitest";
import { verify } from "@noble/ed25519";
import {
  contractAddress,
  gasAmount,
  blockHeight,
  AuthClaimType,
  bitMap,
  weight,
  serialize,
  deserialize,
  codec,
  CxsReader,
  Uint128Codec,
} from "@groundhogchain/protocol";
import {
  deriveEntrypointID,
  hashSignedTransaction,
} from "@groundhogchain/protocol/utils";
import {
  contractSpecString,
  ContractTypeKind,
  ContractTypeDefKind,
} from "@groundhogchain/contract-spec";
import { PrivateKeySigner } from "./signers/privateKey.js";
import { createInvocation, createTransaction } from "./transaction/build.js";
import { signTransaction } from "./transaction/sign.js";
import {
  serializeSignedTransaction,
  deserializeSignedTransaction,
} from "./transaction/serialize.js";
import { encodeCalldata } from "./contract/encode.js";
import { buildNamedCodecs } from "./contract/codegen.js";
import type { ContractSpec } from "./contract/spec.js";

const s = contractSpecString;

const erc20Spec: ContractSpec = {
  interfaces: [
    {
      name: s("ERC20"),
      vers: s("0.1.0"),
      throws: [
        {
          selector: 0xb19947acb2fa14ffn,
          ty: { v: ContractTypeKind.Named, named: s("ERC20Error") },
        },
      ],
      methods: [
        {
          name: s("transfer"),
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
        name: s("ERC20Error"),
        variants: [
          { name: s("AlreadyInitialized"), value: 1n },
          { name: s("MustBeContractOwner"), value: 2n },
          { name: s("TooLarge"), value: 3n },
          { name: s("Internal"), value: 100n },
        ],
      },
    },
  ],
};

describe("end-to-end: build, sign, serialize an ERC20 transfer", () => {
  it("round-trips a complete signed transaction", async () => {
    // 1. Set up signer
    const secretKey = new Uint8Array(32);
    secretKey[0] = 0xde;
    secretKey[1] = 0xad;
    const signer = new PrivateKeySigner(secretKey);

    // 2. Encode calldata from spec
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

    // 3. Derive entrypoint ID
    const entrypoint = await deriveEntrypointID("ERC20", "0.1.0", "transfer");

    // 4. Build invocation and transaction
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

    // 5. Sign
    const signed = await signTransaction(tx, [{ signer, publicKeyId: 0n }]);

    // 6. Verify signature independently
    const txBytes = serialize(tx, codec.Transaction);
    const sig = signed.signatures[0].signature;
    expect(verify(sig.ed25519, txBytes, signer.publicKey)).toBe(true);

    // 7. Serialize and deserialize the signed transaction
    const wireBytes = serializeSignedTransaction(signed);
    const restored = deserializeSignedTransaction(wireBytes);

    // 8. Verify the restored transaction matches
    expect(restored.tx.invocation.invoked_address).toEqual(tokenAddress);
    expect(restored.tx.invocation.entrypoint).toEqual(entrypoint);
    expect(restored.tx.invocation.gas_limit).toBe(1_000_000n);
    expect(restored.tx.uniquifier.block_expiry_height).toBe(1000n);
    expect(restored.tx.uniquifier.nonce).toBe(12345n);
    expect(restored.signatures).toHaveLength(1);
    expect(restored.signatures[0].signature.ed25519).toEqual(sig.ed25519);

    // 9. Decode the calldata back from the restored transaction
    const r = new CxsReader(restored.tx.invocation.calldata);
    const decodedRecipient = codec.ContractAddress.decode(r);
    const decodedAmount = Uint128Codec.decode(r);
    expect(decodedRecipient).toEqual(recipient);
    expect(decodedAmount).toBe(amount);

    // 10. Hash the signed transaction to get a canonical ID
    const txHash = await hashSignedTransaction(signed);
    expect(txHash.length).toBe(32);

    // Hashing is deterministic
    const txHash2 = await hashSignedTransaction(restored);
    expect(txHash2).toEqual(txHash);
  });
});
