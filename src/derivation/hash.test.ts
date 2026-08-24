import { describe, it, expect } from "vitest";
import {
  contractAddress,
  contractEntrypointID,
  gasAmount,
  calldata,
  blockHeight,
  ed25519Signature,
  sha256Hash,
  bitMap,
  weight,
  toHex,
  CryptographicScheme,
  AuthClaimType,
} from "@groundhogchain/protocol";
import type { SignedTransaction } from "@groundhogchain/protocol";
import { codec, serialize } from "@groundhogchain/protocol";
import { sha256 } from "@noble/hashes/sha2.js";
import { hashSignedTransaction } from "./transactionHash.js";
import { deriveContractAddress } from "./contractAddress.js";
import { deriveEntrypointID, majorVersionFromSemver } from "./entrypointId.js";

function makeTestTransaction(): SignedTransaction {
  return {
    tx: {
      invocation: {
        invoked_address: contractAddress(new Uint8Array(32).fill(0x01)),
        entrypoint: contractEntrypointID(new Uint8Array(8).fill(0xab)),
        gas_limit: gasAmount(1_000_000n),
        calldata: calldata(new Uint8Array([0xde, 0xad])),
      },
      uniquifier: {
        block_expiry_height: blockHeight(100n),
        nonce: 12345n,
      },
      contracts_to_deploy: [],
      auth_claim: {
        claim_type: AuthClaimType.kSourceAddressAuthData,
        source_address_claim: {
          allowed_keys: bitMap(1n),
          required_weight: weight(1n),
        },
      },
    },
    signatures: [
      {
        public_key_id: 0n,
        signature: {
          scheme: CryptographicScheme.Ed25519,
          ed25519: ed25519Signature(new Uint8Array(64).fill(0x55)),
        },
      },
    ],
  };
}

describe("hashSignedTransaction", () => {
  it("returns a 32-byte SHA256Hash", () => {
    const stx = makeTestTransaction();
    const hash = hashSignedTransaction(stx);
    expect(hash.length).toBe(32);
  });

  it("is deterministic", () => {
    const stx = makeTestTransaction();
    const hash1 = hashSignedTransaction(stx);
    const hash2 = hashSignedTransaction(stx);
    expect(toHex(hash1)).toBe(toHex(hash2));
  });

  // The guard on the bug this replaced: the hash used to cover the whole
  // SignedTransaction, which made the identifier malleable and disagree with
  // the chain.
  it("is unaffected by the signatures", () => {
    const stx = makeTestTransaction();
    const resigned = makeTestTransaction();
    resigned.signatures = [];
    expect(toHex(hashSignedTransaction(stx))).toBe(
      toHex(hashSignedTransaction(resigned)),
    );
  });

  it("matches sha256 of the encoded inner transaction", () => {
    const stx = makeTestTransaction();
    expect(toHex(hashSignedTransaction(stx))).toBe(
      toHex(sha256Hash(sha256(serialize(stx.tx, codec.Transaction)))),
    );
  });

  it("changes when transaction content changes", () => {
    const stx1 = makeTestTransaction();
    const stx2 = makeTestTransaction();
    stx2.tx.uniquifier.nonce = 99999n;
    const hash1 = hashSignedTransaction(stx1);
    const hash2 = hashSignedTransaction(stx2);
    expect(toHex(hash1)).not.toBe(toHex(hash2));
  });
});

describe("deriveContractAddress", () => {
  it("returns a 32-byte ContractAddress", () => {
    const deployer = contractAddress(new Uint8Array(32).fill(0x01));
    const nonce = sha256Hash(new Uint8Array(32).fill(0x02));
    const contractHash = sha256Hash(new Uint8Array(32).fill(0x03));
    const addr = deriveContractAddress(deployer, nonce, contractHash);
    expect(addr.length).toBe(32);
  });

  it("is deterministic", () => {
    const deployer = contractAddress(new Uint8Array(32).fill(0x01));
    const nonce = sha256Hash(new Uint8Array(32).fill(0x02));
    const contractHash = sha256Hash(new Uint8Array(32).fill(0x03));
    const addr1 = deriveContractAddress(deployer, nonce, contractHash);
    const addr2 = deriveContractAddress(deployer, nonce, contractHash);
    expect(toHex(addr1)).toBe(toHex(addr2));
  });

  it("changes when nonce changes", () => {
    const deployer = contractAddress(new Uint8Array(32).fill(0x01));
    const contractHash = sha256Hash(new Uint8Array(32).fill(0x03));
    const addr1 = deriveContractAddress(
      deployer,
      sha256Hash(new Uint8Array(32).fill(0x02)),
      contractHash,
    );
    const addr2 = deriveContractAddress(
      deployer,
      sha256Hash(new Uint8Array(32).fill(0xff)),
      contractHash,
    );
    expect(toHex(addr1)).not.toBe(toHex(addr2));
  });
});

describe("majorVersionFromSemver", () => {
  it("1.2.3 → '1'", () => expect(majorVersionFromSemver("1.2.3")).toBe("1"));
  it("3.2.1 → '3'", () => expect(majorVersionFromSemver("3.2.1")).toBe("3"));
  it("0.9.2 → '0.9'", () =>
    expect(majorVersionFromSemver("0.9.2")).toBe("0.9"));
  it("0.1.0 → '0.1'", () =>
    expect(majorVersionFromSemver("0.1.0")).toBe("0.1"));
  it("0.0.2 → '0.0.2'", () =>
    expect(majorVersionFromSemver("0.0.2")).toBe("0.0.2"));
  it("0.0.1 → '0.0.1'", () =>
    expect(majorVersionFromSemver("0.0.1")).toBe("0.0.1"));
  it("0.0.0 → '0.0.0'", () =>
    expect(majorVersionFromSemver("0.0.0")).toBe("0.0.0"));
});

describe("deriveEntrypointID", () => {
  it("returns an 8-byte ContractEntrypointID", () => {
    const id = deriveEntrypointID("ERC20", "1.0.0", "transfer");
    expect(id.length).toBe(8);
  });

  it("is deterministic", () => {
    const id1 = deriveEntrypointID("ERC20", "1.0.0", "transfer");
    const id2 = deriveEntrypointID("ERC20", "1.0.0", "transfer");
    expect(toHex(id1)).toBe(toHex(id2));
  });

  it("different method names produce different IDs", () => {
    const id1 = deriveEntrypointID("ERC20", "1.0.0", "transfer");
    const id2 = deriveEntrypointID("ERC20", "1.0.0", "approve");
    expect(toHex(id1)).not.toBe(toHex(id2));
  });

  it("different versions produce different IDs", () => {
    const id1 = deriveEntrypointID("ERC20", "1.0.0", "transfer");
    const id2 = deriveEntrypointID("ERC20", "2.0.0", "transfer");
    expect(toHex(id1)).not.toBe(toHex(id2));
  });

  it("different interface names produce different IDs", () => {
    const id1 = deriveEntrypointID("ERC20", "1.0.0", "transfer");
    const id2 = deriveEntrypointID("Governance", "1.0.0", "transfer");
    expect(toHex(id1)).not.toBe(toHex(id2));
  });

  it("null interface uses _unnamed_interface", () => {
    const id1 = deriveEntrypointID(null, "1.0.0", "transfer");
    const id2 = deriveEntrypointID("_unnamed_interface", "1.0.0", "transfer");
    expect(toHex(id1)).toBe(toHex(id2));
  });
});
