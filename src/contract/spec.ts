/** Contract spec types consumed by SDK calldata helpers and generated bindings. */
import type { ContractSpecId } from "@groundhogchain/contract-spec";

export type {
  ContractSpec,
  ContractSpecInterface,
  ContractSpecMethod,
  ContractField,
  ContractType,
  ContractTypeDef,
  ContractStructDef,
  ContractEnumDef,
  ContractEnumVariant,
  ContractUnionDef,
  ContractUnionCase,
  ContractUnionCaseType,
  ContractArrayType,
  ContractVectorType,
  ContractExceptionType,
  ContractSpecString,
  ContractSpecId,
} from "@groundhogchain/contract-spec";

/** Contract spec enum discriminants used when inspecting parsed specs. */
export {
  ContractMethodEffect,
  ContractTypeKind,
  ContractTypeDefKind,
  ContractUnionCaseKind,
} from "@groundhogchain/contract-spec";

/**
 * Lookup key for a named type: every segment of its spec id.
 *
 * Two types with the same declared name in different crates or modules are
 * distinct, so named-codec maps from {@link buildNamedCodecs} are keyed by
 * this rather than by `declared` alone. The encoding is injective; use
 * {@link formatSpecId} for anything a person reads.
 */
export function specIdKey(id: ContractSpecId): string {
  return JSON.stringify([id.crate_name, id.major, id.module_path, id.declared]);
}

/**
 * Render a spec id for diagnostics as `module_path::declared (crate@major)`,
 * the shape the Groundhog CLI and spec tool print.
 */
export function formatSpecId(
  id: Readonly<Record<keyof ContractSpecId, string>>,
): string {
  return `${id.module_path}::${id.declared} (${id.crate_name}@${id.major})`;
}
