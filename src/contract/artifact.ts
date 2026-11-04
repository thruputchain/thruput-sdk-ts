import { sha256 } from "@noble/hashes/sha2.js";
import { validateArtifactSpec } from "./specValidation.js";
import {
  contractSpecCodecLimits,
  preflightContractSpec,
} from "./specPreflight.js";
import { ContractVerificationError } from "./errors.js";
import {
  codec,
  ContractType,
  deserialize,
  serialize,
  type SHA256Hash,
} from "@thruputchain/protocol";
import {
  codec as specCodec,
  type ContractSpec,
} from "@thruputchain/contract-spec";
import { bytesEqual } from "./event.js";

/** Authenticated metadata. Native identifiers do not authenticate runtime code. */
export type ContractArtifactSpec =
  | { kind: "native" }
  | { kind: "unsupportedContract"; contractType: number }
  | { kind: "unsupportedFormat"; formatVersion: number }
  | { kind: "absent" }
  | { kind: "unsupportedSchema"; schemaVersion: number; bytes: Uint8Array }
  | { kind: "spec"; schemaVersion: 1; spec: ContractSpec };

/**
 * Verify complete Contract XDR against the requested hash, then read its spec.
 * Rejects malformed known envelopes. Unknown versions remain explicit results.
 * This proves byte identity, not deployment, executable validity, or spec truth.
 */
export function readContractArtifactSpec(
  contractXdr: Uint8Array,
  expectedHash: SHA256Hash,
): ContractArtifactSpec {
  try {
    return readArtifact(contractXdr, expectedHash);
  } catch (cause) {
    throw new ContractVerificationError(
      cause instanceof Error ? cause.message : "Invalid contract artifact",
      { cause },
    );
  }
}

function readArtifact(
  contractXdr: Uint8Array,
  expectedHash: SHA256Hash,
): ContractArtifactSpec {
  const bytes = contractXdr.slice();
  if (!bytesEqual(sha256(bytes), expectedHash)) {
    throw new Error("Contract artifact hash mismatch");
  }
  const contract = deserialize(bytes, codec.Contract);
  if (!bytesEqual(serialize(contract, codec.Contract), bytes)) {
    throw new Error("Noncanonical Contract XDR");
  }
  if (contract.contract_type === ContractType.kNative)
    return { kind: "native" };
  if (contract.contract_type !== ContractType.kRv32)
    return {
      kind: "unsupportedContract",
      contractType: contract.contract_type,
    };
  const artifact = contract.rv32_contract.data;
  if (
    artifact.length < 12 ||
    !bytesEqual(artifact.subarray(0, 8), new TextEncoder().encode("GHRV32A1"))
  ) {
    throw new Error("Invalid RV32 artifact header");
  }
  const header = new DataView(
    artifact.buffer,
    artifact.byteOffset,
    artifact.byteLength,
  );
  const formatVersion = header.getUint32(8, true);
  if (formatVersion !== 6) return { kind: "unsupportedFormat", formatVersion };
  if (artifact.length < 136 || header.getUint32(12, true) !== 136) {
    throw new Error("Invalid RV32 v6 header size");
  }
  const codeSize = header.getUint32(52, true);
  const memorySize = header.getUint32(56, true);
  const schemaVersion = header.getUint32(128, true);
  const specSize = header.getUint32(132, true);
  const specStart = 136 + codeSize + memorySize;
  if (
    specStart + specSize !== artifact.length ||
    (schemaVersion === 0) !== (specSize === 0)
  ) {
    throw new Error("Invalid RV32 spec section layout");
  }
  if (schemaVersion === 0) return { kind: "absent" };
  const specBytes = artifact.slice(specStart);
  if (schemaVersion !== 1)
    return { kind: "unsupportedSchema", schemaVersion, bytes: specBytes };
  preflightContractSpec(specBytes);
  const spec = deserialize(
    specBytes,
    specCodec.ContractSpec,
    contractSpecCodecLimits,
  );
  validateArtifactSpec(spec);
  if (
    !bytesEqual(
      serialize(spec, specCodec.ContractSpec, contractSpecCodecLimits),
      specBytes,
    )
  ) {
    throw new Error("Noncanonical contract spec XDR");
  }
  return { kind: "spec", schemaVersion, spec };
}
