// Public deterministic payloads only; do not benchmark with wallet data.
import { base58 } from "@scure/base";
import assert from "node:assert/strict";

for (const size of [32, 64, 1024, 16384, 65536, 262144]) {
  const bytes = Uint8Array.from({ length: size }, (_, i) => i % 251);
  const start = performance.now();
  const text = base58.encode(bytes);
  const encoded = performance.now();
  const decoded = base58.decode(text);
  const end = performance.now();
  assert.deepEqual(decoded, bytes);
  console.log(
    `${size} bytes: encode=${(encoded - start).toFixed(3)}ms, decode=${(end - encoded).toFixed(3)}ms`,
  );
}
