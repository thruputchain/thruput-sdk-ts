import type { ContractSpec } from "./spec.js";
import { createContractCallDecoder } from "./specMethod.js";
import { createContractEventDecoder } from "./event.js";

/** Validate references after schema-1 wire preflight has bounded the structure. */
export function validateArtifactSpec(spec: ContractSpec): void {
  createContractCallDecoder(spec);
  createContractEventDecoder(spec);
}
