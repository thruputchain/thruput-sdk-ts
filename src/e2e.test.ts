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
  codec,
  ExecResult,
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
import { encodeCalldata, decodeCalldata } from "./contract/encode.js";
import { buildNamedCodecs } from "./contract/codegen.js";
import type { ContractSpec } from "./contract/spec.js";
import { MockTransport } from "./transport/mock.js";
import { createGroundhogClient } from "./client.js";
import { ERC20 } from "./contracts/erc20.js";

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
  events: [],
};

describe("end-to-end: build, sign, serialize an ERC20 transfer", () => {
  it("round-trips a complete signed transaction", async () => {
    const secretKey = new Uint8Array(32);
    secretKey[0] = 0xde;
    secretKey[1] = 0xad;
    const signer = new PrivateKeySigner(secretKey);

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

    const signed = await signTransaction(tx, [{ signer, publicKeyId: 0n }]);

    // Verify signature
    const txBytes = serialize(tx, codec.Transaction);
    const sig = signed.signatures[0].signature;
    expect(verify(sig.ed25519, txBytes, signer.publicKey.ed25519)).toBe(true);

    // Round-trip through serialization
    const wireBytes = serializeSignedTransaction(signed);
    const restored = deserializeSignedTransaction(wireBytes);

    expect(restored.tx.invocation.invoked_address).toEqual(tokenAddress);
    expect(restored.tx.invocation.entrypoint).toEqual(entrypoint);
    expect(restored.tx.invocation.gas_limit).toBe(1_000_000n);
    expect(restored.tx.uniquifier.block_expiry_height).toBe(1000n);
    expect(restored.tx.uniquifier.nonce).toBe(12345n);
    expect(restored.signatures).toHaveLength(1);
    expect(restored.signatures[0].signature.ed25519).toEqual(sig.ed25519);

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

    // Hash is deterministic
    const txHash = await hashSignedTransaction(signed);
    expect(txHash.length).toBe(32);
    const txHash2 = await hashSignedTransaction(restored);
    expect(txHash2).toEqual(txHash);
  });
});

describe("end-to-end: full pipeline via MockTransport client", () => {
  it("builds ERC20 transfer, sends, and retrieves receipt via client", async () => {
    const transport = new MockTransport();
    const client = createGroundhogClient(transport);

    // Initial chain tip should be at height 0
    const initialTip = await client.getChainTip();
    expect(initialTip.height).toBe(0n);

    // Build an ERC20 transfer invocation
    const tokenAddress = contractAddress(new Uint8Array(32).fill(0xaa));
    const recipient = contractAddress(new Uint8Array(32).fill(0xbb));
    const invocation = ERC20.transfer(tokenAddress, gasAmount(500_000n), {
      receiver: recipient,
      amount: 1000n,
    });

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
    const signer = new PrivateKeySigner(secretKey);
    const signedTx = await signTransaction(tx, [{ signer, publicKeyId: 0n }]);

    // Send via client
    const txHash = await client.sendTransaction(signedTx);
    expect(txHash).toBeInstanceOf(Uint8Array);
    expect(txHash.length).toBe(32);

    // Get receipt via client
    const receipt = await client.getTransactionReceipt(txHash);
    expect(receipt).not.toBeNull();
    expect(receipt!.txHash).toEqual(txHash);
    expect(receipt!.execResult).toBe(ExecResult.ExecResultOK);
    expect(receipt!.height).toBe(1n);

    // Chain tip should reflect the new block
    const newTip = await client.getChainTip();
    expect(newTip.height).toBe(1n);
  });
});
