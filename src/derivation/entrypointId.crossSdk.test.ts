/**
 * Cross-SDK entrypoint ID derivation.
 *
 * Replays the vectors emitted by the Rust `thruput-test-vectors entrypoint-id`
 * so the two implementations cannot drift apart silently.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { toHex } from "@thruputchain/protocol";
import { deriveEntrypointID } from "./entrypointId.js";

interface Vector {
  interface: string | null;
  version_str: string;
  derived_major_version: string;
  method: string;
  expected_id: string;
}

interface VectorFile {
  version: number;
  category: string;
  vectors: Vector[];
}

// Generated, not committed: CI regenerates from the published
// thruput-test-vectors crate; run scripts/regen-test-vectors.sh locally.
const vectorsPath = fileURLToPath(
  new URL("../../specs/test-vectors/entrypoint-id.json", import.meta.url),
);
const haveVectors = existsSync(vectorsPath);
const vectorFile: VectorFile = haveVectors
  ? (JSON.parse(readFileSync(vectorsPath, "utf-8")) as VectorFile)
  : { version: 0, category: "", vectors: [] };
const vectors: Vector[] = vectorFile.vectors;

describe("cross-SDK: entrypoint ID derivation", () => {
  it.runIf(!haveVectors)(
    "skipped: no vectors file (run scripts/regen-test-vectors.sh)",
    () => {
      expect(haveVectors).toBe(false);
    },
  );

  it.runIf(haveVectors)("replays every vector", () => {
    expect(vectors.length).toBeGreaterThan(0);
    for (const vec of vectors) {
      const id = deriveEntrypointID(vec.interface, vec.version_str, vec.method);
      // The Rust side emits uppercase hex, 16 chars for the big-endian u64.
      const observed = toHex(id).toUpperCase().padStart(16, "0");
      expect(
        observed,
        `${vec.interface ?? "null"}/${vec.version_str}/${vec.method}`,
      ).toBe(vec.expected_id);
    }
  });
});
