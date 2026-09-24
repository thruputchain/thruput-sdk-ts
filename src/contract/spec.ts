/** Contract spec types consumed by SDK calldata helpers and generated bindings. */
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
  ContractTypeKind,
  ContractTypeDefKind,
  ContractUnionCaseKind,
} from "@groundhogchain/contract-spec";
