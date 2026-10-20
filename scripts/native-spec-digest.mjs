import { createHash } from "node:crypto";

/** JSON semantic digest: formatting and object-key order are not owner changes. */
export function nativeSpecDigest(value) {
  function ordered(value) {
    if (Array.isArray(value)) return value.map(ordered);
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, ordered(value[key])]),
      );
    return value;
  }
  return createHash("sha256")
    .update(JSON.stringify(ordered(value)))
    .digest("hex");
}
