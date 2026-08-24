import { describe, expect, it } from "vitest";
import {
  contractAddress,
  gasAmount,
  blockHeight,
  AuthClaimType,
  bitMap,
  weight,
  sha256Hash,
  networkHash,
} from "@groundhogchain/protocol";
import { hashSignedTransaction } from "../derivation/transactionHash.js";
import { PrivateKeySigner } from "../signers/privateKey.js";
import { createTransaction } from "../transaction/build.js";
import { signTransaction } from "../transaction/sign.js";
import { decodeCalldata } from "../contract/encode.js";
import { buildNamedCodecs } from "../contract/codegen.js";
import { ERC20, ERC20Metadata, spec } from "./erc20.js";

const namedCodecs = buildNamedCodecs(spec.type_defs);

const testNetworkHash = networkHash(sha256Hash(new Uint8Array(32).fill(0x5a)));

describe("generated ERC20 contract bindings", () => {
  it("transfer() builds a valid invocation", () => {
    const token = contractAddress(new Uint8Array(32).fill(0x11));
    const recipient = contractAddress(new Uint8Array(32).fill(0x22));

    const invocation = ERC20.transfer.invocation(token, gasAmount(1_000_000n), {
      receiver: recipient,
      amount: 500n,
    });

    expect(invocation.invoked_address).toEqual(token);
    expect(invocation.gas_limit).toBe(1_000_000n);
    expect(invocation.entrypoint.length).toBe(8);

    const decoded = decodeCalldata(
      spec,
      "ERC20",
      "transfer",
      invocation.calldata,
      namedCodecs,
    );
    expect(decoded.receiver).toEqual(recipient);
    expect(decoded.amount).toBe(500n);
  });

  it("getBalance() builds a zero-arg invocation", () => {
    const token = contractAddress(new Uint8Array(32).fill(0x11));
    const invocation = ERC20.getBalance.invocation(token, gasAmount(500_000n));

    expect(invocation.invoked_address).toEqual(token);
    expect(invocation.calldata.length).toBe(0);
  });

  it("metadata symbol() builds a zero-arg invocation", () => {
    const token = contractAddress(new Uint8Array(32).fill(0x11));
    const invocation = ERC20Metadata.symbol.invocation(
      token,
      gasAmount(500_000n),
    );

    expect(invocation.invoked_address).toEqual(token);
    expect(invocation.calldata.length).toBe(0);
  });

  it("composes into a full signed transaction", async () => {
    const secretKey = new Uint8Array(32);
    secretKey[0] = 0xab;
    const signer = new PrivateKeySigner(secretKey);

    const token = contractAddress(new Uint8Array(32).fill(0x11));
    const recipient = contractAddress(new Uint8Array(32).fill(0x22));

    const invocation = ERC20.transfer.invocation(token, gasAmount(1_000_000n), {
      receiver: recipient,
      amount: 100n,
    });

    const tx = createTransaction({
      invocation,
      uniquifier: { block_expiry_height: blockHeight(500n), nonce: 1n },
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
    const hash = hashSignedTransaction(signed);
    expect(hash.length).toBe(32);
  });
});
