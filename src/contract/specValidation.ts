import type { ContractSpec } from "./spec.js";
import { createContractCallDecoder } from "./specMethod.js";
import { createContractEventDecoder } from "./event.js";

/** Bound traversal before resolving recursive named codecs and validate references. */
export function validateArtifactSpec(spec: ContractSpec): void {
  const pending: [unknown, number][] = [[spec, 0]];
  let nodes = 0;
  while (pending.length) {
    const [value, depth] = pending.pop()!;
    if (++nodes > 100_000 || depth > 128)
      throw new Error("Contract spec exceeds structural limits");
    if (value && typeof value === "object" && !(value instanceof Uint8Array)) {
      for (const child of Object.values(value))
        pending.push([child, depth + 1]);
    }
  }
  createContractCallDecoder(spec);
  createContractEventDecoder(spec);
}
