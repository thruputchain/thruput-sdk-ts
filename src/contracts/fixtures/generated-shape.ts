import {
  createContractCodecContext,
  defineContractEvent,
  defineContractMethod,
  fixedBytes,
  type ContractException,
  type DecodedContractEvent,
  type ContractEventFilterValue,
  type FixedBytes,
} from "../../contract/index.js";
import {
  contractEntrypointID,
  type ContractAddress,
  type GasAmount,
} from "@groundhogchain/protocol";
import { ContractTypeKind } from "@groundhogchain/contract-spec";

export interface ExampleSetIdArgs {
  id: FixedBytes<32>;
}

export type ExampleSetIdResult = void;

export type ExampleGetValueArgs = void;
export type ExampleGetValueResult = bigint;

export type ExampleDeclaredException = {
  kind: "declared";
  name: null;
  selector: 7n;
  value: bigint;
};

export type ExampleException = ContractException<ExampleDeclaredException>;

export type ValueChanged = DecodedContractEvent<
  "ValueChanged",
  { owner: ContractAddress; id: FixedBytes<32> },
  { value: bigint }
>;

export interface ValueChangedFilter {
  owner?: ContractEventFilterValue<ContractAddress>;
  id?: ContractEventFilterValue<FixedBytes<32>>;
}

const codecs = createContractCodecContext([]);

export const Example = {
  setId: defineContractMethod<
    ExampleSetIdArgs,
    ExampleSetIdResult,
    ExampleDeclaredException
  >({
    entrypoint: contractEntrypointID(new Uint8Array(8).fill(1)),
    args: [
      {
        abiName: "id",
        publicName: "id",
        type: {
          v: ContractTypeKind.Array,
          array: { element: { v: ContractTypeKind.U8 }, len: 32n },
        },
      },
    ],
    returnType: { v: ContractTypeKind.Void },
    throws: [
      {
        selector: 7n,
        name: null,
        type: { v: ContractTypeKind.U32 },
      },
    ],
    codecs,
  }),

  getValue: defineContractMethod<
    ExampleGetValueArgs,
    ExampleGetValueResult,
    ExampleDeclaredException
  >({
    entrypoint: contractEntrypointID(new Uint8Array(8).fill(2)),
    args: [],
    returnType: { v: ContractTypeKind.U64 },
    throws: [
      {
        selector: 7n,
        name: null,
        type: { v: ContractTypeKind.U32 },
      },
    ],
    codecs,
  }),
} as const;

export const ValueChanged = defineContractEvent<
  "ValueChanged",
  ValueChanged["topics"],
  ValueChanged["fields"],
  ValueChangedFilter
>({
  name: "ValueChanged",
  signature: new Uint8Array(32).fill(3),
  topics: [
    {
      name: "owner",
      type: { v: ContractTypeKind.Address },
      representation: "address",
    },
    {
      name: "id",
      type: {
        v: ContractTypeKind.Array,
        array: { element: { v: ContractTypeKind.U8 }, len: 32n },
      },
      representation: "fixedBytes32",
    },
  ],
  fields: [{ name: "value", type: { v: ContractTypeKind.U64 } }],
  codecs,
});

function generatedShapeTypeTests(
  rawBytes: Uint8Array,
  contract: ContractAddress,
  gasLimit: GasAmount,
): void {
  const id = fixedBytes(rawBytes, 32);
  const fixed: FixedBytes<32> = id;

  Example.setId.invocation(contract, gasLimit, { id: fixed });
  Example.getValue.invocation(contract, gasLimit);

  // @ts-expect-error Unchecked bytes do not satisfy a fixed-byte argument.
  Example.setId.invocation(contract, gasLimit, { id: rawBytes });
  // @ts-expect-error A non-void method argument object is required.
  Example.setId.invocation(contract, gasLimit);
  // @ts-expect-error A void method does not accept an argument object.
  Example.getValue.invocation(contract, gasLimit, {});

  ValueChanged.filter({
    contractAddresses: [contract],
    topics: { owner: contract, id: { oneOf: [fixed] } },
  });
  ValueChanged.filter({
    contractAddresses: [contract],
    // @ts-expect-error oneOf must contain at least one topic value.
    topics: { id: { oneOf: [] } },
  });
}

void generatedShapeTypeTests;
