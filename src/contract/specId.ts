import type { ContractSpecId } from "./spec.js";

/**
 * Stable index key for a spec id.
 *
 * Injective: two ids share a key only when all four segments are equal. The
 * segments are encoded rather than joined with a separator because `declared`
 * may itself contain `::`, so a joined key could collide -- module `A` plus
 * declared `B` against the crate root plus declared `"A::B"`.
 *
 * Internal only, and never shown to a caller: use {@link specIdText} for that.
 */
export function specIdKey(id: ContractSpecId): string {
  return JSON.stringify([id.crate_name, id.major, id.module_path, id.declared]);
}

/**
 * Human-readable rendering of a spec id, for error messages.
 *
 * Matches the Rust client's `spec_id_text` and the spec tool's
 * `spec_id_lossy`, so every tool names the same type the same way. Lossy by
 * design: it joins the segments and cannot be taken apart again, which is why
 * it must never be used as a key.
 */
export function specIdText(id: ContractSpecId): string {
  return `${id.module_path}::${id.declared} (${id.crate_name}@${id.major})`;
}
