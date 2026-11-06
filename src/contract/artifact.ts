import { sha256 } from "@noble/hashes/sha2.js";
import { XdrReader } from "@thruputchain/xdr";
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
 * Reads v5 as having no spec. In v6, validates all extension framing and skips
 * unknown kinds. Only the contract-spec extension body is interpreted.
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
  if (formatVersion !== 5 && formatVersion !== 6)
    return { kind: "unsupportedFormat", formatVersion };
  if (artifact.length < 128 || header.getUint32(12, true) !== 128) {
    throw new Error("Invalid RV32 header size");
  }
  const codeSize = header.getUint32(52, true);
  const memorySize = header.getUint32(56, true);
  const sectionsEnd = 128 + codeSize + memorySize;
  if (sectionsEnd > artifact.length) {
    throw new Error("Invalid RV32 section layout");
  }
  if (formatVersion === 5) {
    if (sectionsEnd !== artifact.length)
      throw new Error("Invalid RV32 v5 section layout");
    return { kind: "absent" };
  }
  const body = readSpecExtension(artifact.subarray(sectionsEnd));
  if (body === undefined) return { kind: "absent" };
  const reader = new XdrReader(body);
  const schemaVersion = Number(reader.readUint32());
  const specBytes = reader.readVarOpaque(reader.remaining);
  if (reader.remaining !== 0)
    throw new Error("Trailing bytes in contract spec extension");
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

// Rv32ArtifactExtensions in protocol #259. Use the shared strict XDR reader
// until the generated extension types are published. Do not decode unknown bodies.
function readSpecExtension(bytes: Uint8Array): Uint8Array | undefined {
  const reader = new XdrReader(bytes);
  const count = Number(reader.readUint32());
  if (count > Math.floor(reader.remaining / 8))
    throw new Error("Truncated RV32 extension list");
  let previousKind = 0;
  let spec: Uint8Array | undefined;
  for (let i = 0; i < count; i++) {
    const kind = Number(reader.readUint32());
    if (kind <= previousKind)
      throw new Error(
        "RV32 extension kinds must be nonzero and strictly ascending",
      );
    previousKind = kind;
    const body = reader.readVarOpaque(reader.remaining);
    if (kind === 1) spec = body;
  }
  if (reader.remaining !== 0)
    throw new Error("Trailing bytes in RV32 extension list");
  return spec;
}
