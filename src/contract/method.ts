import type {
  ContractAddress,
  ContractEntrypointID,
  GasAmount,
  Invocation,
  SHA256Hash,
} from "@groundhogchain/protocol";
import {
  ExecResult,
  calldata,
  contractEntrypointID,
  kMaxReturnBufferLen,
} from "@groundhogchain/protocol";
import { ContractTypeKind } from "@groundhogchain/contract-spec";
import { CxsReader, CxsWriter, type XdrCodec } from "@groundhogchain/xdr";
import type { GroundhogClient } from "../client.js";
import type { EmittedEvent, TransactionReceipt } from "../types/rpc.js";
import type { ContractCodecContext } from "./codec.js";
import { decodeComplete, resolveContextCodec } from "./codec.js";
import { ContractDecodeError } from "./errors.js";
import type { ContractType } from "./spec.js";

/** Omit the argument position entirely for methods without arguments. */
export type MethodArgs<TArgs> = [TArgs] extends [void] ? [] : [args: TArgs];

/** Successfully decoded contract view result and its snapshot metadata. */
export interface ContractView<T> {
  value: T;
  height: bigint;
  events: EmittedEvent[];
}

/** Contract exception selector not declared by the generated interface. */
export interface UnknownContractException {
  kind: "unknown";
  selector: bigint;
  data: Uint8Array;
}

/** Declared exceptions plus a lossless fallback for unknown selectors. */
export type ContractException<TDeclared> = TDeclared | UnknownContractException;

/** Non-successful contract view outcome. */
export type ContractViewFailure<TException> =
  | {
      kind: "abort";
      exception: TException;
      abortData: Uint8Array;
      height: bigint;
      events: EmittedEvent[];
    }
  | {
      kind: "fault";
      height: bigint;
      events: EmittedEvent[];
    };

/** Typed return, abort, or fault from a contract view. */
export type ContractViewOutcome<TResult, TException> =
  | ({ kind: "return" } & ContractView<TResult>)
  | ContractViewFailure<TException>;

/** Successfully decoded root contract receipt and its commit metadata. */
export interface ContractReceipt<TResult> {
  value: TResult;
  txHash: SHA256Hash;
  height: bigint;
  events: EmittedEvent[];
}

/** Non-successful root contract receipt outcome. */
export type ContractReceiptFailure<TException> =
  | {
      kind: "abort";
      exception: TException;
      abortData: Uint8Array;
      txHash: SHA256Hash;
      height: bigint;
      events: EmittedEvent[];
    }
  | {
      kind: "failure";
      execResult: ExecResult;
      returnData: Uint8Array | null;
      abortData: Uint8Array | null;
      txHash: SHA256Hash;
      height: bigint;
      events: EmittedEvent[];
    };

/** Typed return, abort, or execution failure from a root contract receipt. */
export type ContractReceiptOutcome<TResult, TException> =
  | ({ kind: "return" } & ContractReceipt<TResult>)
  | ContractReceiptFailure<TException>;

/** Error thrown by the ergonomic view API for contract aborts and faults. */
export class ContractViewError<TException> extends Error {
  readonly outcome: ContractViewFailure<TException>;

  constructor(outcome: ContractViewFailure<TException>) {
    const selector =
      outcome.kind === "abort"
        ? exceptionSelector(outcome.exception)
        : undefined;
    super(
      outcome.kind === "abort"
        ? `Contract view aborted with selector ${selector ?? "unknown"}`
        : "Contract view faulted",
    );
    this.name = "ContractViewError";
    this.outcome = outcome;
  }
}

/** Error thrown when a root contract receipt does not produce a typed return. */
export class ContractReceiptError<TException> extends Error {
  readonly outcome: ContractReceiptFailure<TException>;

  constructor(outcome: ContractReceiptFailure<TException>) {
    const selector =
      outcome.kind === "abort"
        ? exceptionSelector(outcome.exception)
        : undefined;
    super(
      outcome.kind === "abort"
        ? `Contract transaction aborted with selector ${selector ?? "unknown"}`
        : outcome.execResult === ExecResult.ExecResultOK
          ? "Contract transaction did not include return data"
          : `Contract transaction failed with ${ExecResult[outcome.execResult] ?? outcome.execResult}`,
    );
    this.name = "ContractReceiptError";
    this.outcome = outcome;
  }
}

function exceptionSelector(exception: unknown): bigint | undefined {
  if (
    !exception ||
    typeof exception !== "object" ||
    !("selector" in exception)
  ) {
    return undefined;
  }
  return typeof exception.selector === "bigint"
    ? exception.selector
    : undefined;
}

/** Generated method argument metadata in ABI order. */
export interface ContractArgumentMetadata {
  abiName: string;
  publicName: string;
  type: ContractType;
}

/** Generated declared exception metadata. */
export interface ContractExceptionMetadata {
  selector: bigint;
  name: string | null;
  type: ContractType;
}

/** Runtime definition consumed by a generated method descriptor. */
export interface ContractMethodDefinition {
  entrypoint: ContractEntrypointID;
  args: readonly ContractArgumentMetadata[];
  returnType: ContractType;
  throws: readonly ContractExceptionMetadata[];
  codecs: ContractCodecContext;
}

/** View options with an argument object only when the method requires one. */
export type ContractViewOptions<TArgs> = {
  client: Pick<GroundhogClient, "view">;
  contract: ContractAddress;
  caller?: ContractAddress;
} & ([TArgs] extends [void] ? { args?: never } : { args: TArgs });

/** Complete generated method API. */
export interface ContractMethod<TArgs, TResult, TDeclaredException> {
  readonly entrypoint: ContractEntrypointID;

  invocation(
    contract: ContractAddress,
    gasLimit: GasAmount,
    ...args: MethodArgs<TArgs>
  ): Invocation;

  decodeReturn(data: Uint8Array): TResult;
  decodeException(data: Uint8Array): ContractException<TDeclaredException>;

  /** Decode a receipt whose root invocation called this method; nested invocation results are not inspected. */
  decodeReceipt(receipt: TransactionReceipt): ContractReceipt<TResult>;

  /** Decode the outcome of a root invocation of this method; nested invocation results are not inspected. */
  decodeReceiptOutcome(
    receipt: TransactionReceipt,
  ): ContractReceiptOutcome<TResult, ContractException<TDeclaredException>>;
  view(options: ContractViewOptions<TArgs>): Promise<ContractView<TResult>>;
  viewOutcome(
    options: ContractViewOptions<TArgs>,
  ): Promise<
    ContractViewOutcome<TResult, ContractException<TDeclaredException>>
  >;
}

interface ResolvedArgument {
  publicName: string;
  codec: XdrCodec<unknown>;
}

interface ResolvedException {
  name: string | null;
  codec: XdrCodec<unknown>;
}

/** Build one generated method descriptor from direct ABI metadata. */
export function defineContractMethod<TArgs, TResult, TDeclaredException>(
  definition: ContractMethodDefinition,
): ContractMethod<TArgs, TResult, TDeclaredException> {
  const entrypoint = copyEntrypoint(definition.entrypoint);
  const argumentCodecs = definition.args.map((argument) => ({
    publicName: argument.publicName,
    codec: resolveContextCodec(definition.codecs, argument.type),
  }));
  const returnCodec = resolveContextCodec(
    definition.codecs,
    definition.returnType,
  );
  const returnsVoid = definition.returnType.v === ContractTypeKind.Void;
  const exceptionBySelector = new Map<bigint, ResolvedException>();
  for (const metadata of definition.throws) {
    if (exceptionBySelector.has(metadata.selector)) {
      throw new Error(
        `Duplicate contract exception selector ${metadata.selector}`,
      );
    }
    exceptionBySelector.set(metadata.selector, {
      name: metadata.name,
      codec: resolveContextCodec(definition.codecs, metadata.type),
    });
  }

  const method: ContractMethod<TArgs, TResult, TDeclaredException> = {
    get entrypoint() {
      return copyEntrypoint(entrypoint);
    },

    invocation(contract, gasLimit, ...args) {
      return {
        invoked_address: contract,
        entrypoint: copyEntrypoint(entrypoint),
        gas_limit: gasLimit,
        calldata: encodeArguments(argumentCodecs, args[0]),
      };
    },

    decodeReturn(data) {
      assertReturnBufferLimit(data, "return");
      return decodeComplete<TResult>(
        returnCodec,
        data,
        "contract return value",
      );
    },

    decodeException(data) {
      assertReturnBufferLimit(data, "abort");
      return decodeException<TDeclaredException>(data, exceptionBySelector);
    },

    decodeReceiptOutcome(receipt) {
      const metadata = {
        txHash: receipt.txHash,
        height: receipt.height,
        events: receipt.events,
      };
      if (receipt.execResult === ExecResult.ExecResultOK) {
        if (receipt.returnData === null && !returnsVoid) {
          return {
            kind: "failure",
            execResult: receipt.execResult,
            returnData: receipt.returnData,
            abortData: receipt.abortData,
            ...metadata,
          };
        }
        return {
          kind: "return",
          value: method.decodeReturn(receipt.returnData ?? new Uint8Array()),
          ...metadata,
        };
      }
      if (
        receipt.execResult === ExecResult.ExecResultTxRootFrameReverted &&
        receipt.abortData !== null
      ) {
        return {
          kind: "abort",
          exception: method.decodeException(receipt.abortData),
          abortData: receipt.abortData,
          ...metadata,
        };
      }
      return {
        kind: "failure",
        execResult: receipt.execResult,
        returnData: receipt.returnData,
        abortData: receipt.abortData,
        ...metadata,
      };
    },

    decodeReceipt(receipt) {
      const outcome = method.decodeReceiptOutcome(receipt);
      if (outcome.kind === "return") {
        return {
          value: outcome.value,
          txHash: outcome.txHash,
          height: outcome.height,
          events: outcome.events,
        };
      }
      throw new ContractReceiptError(outcome);
    },

    async viewOutcome(options) {
      const response = await options.client.view({
        contract: options.contract,
        entrypoint: copyEntrypoint(entrypoint),
        calldata: encodeArguments(
          argumentCodecs,
          "args" in options ? options.args : undefined,
        ),
        ...(options.caller ? { caller: options.caller } : {}),
      });

      switch (response.output.result) {
        case "return":
          return {
            kind: "return",
            value: method.decodeReturn(response.output.returnData),
            height: response.height,
            events: response.events,
          };
        case "abort":
          return {
            kind: "abort",
            exception: method.decodeException(response.output.abortData),
            abortData: response.output.abortData,
            height: response.height,
            events: response.events,
          };
        case "fault":
          return {
            kind: "fault",
            height: response.height,
            events: response.events,
          };
      }
    },

    async view(options) {
      const outcome = await method.viewOutcome(options);
      if (outcome.kind === "return") {
        return {
          value: outcome.value,
          height: outcome.height,
          events: outcome.events,
        };
      }
      throw new ContractViewError(outcome);
    },
  };

  return method;
}

function copyEntrypoint(value: ContractEntrypointID): ContractEntrypointID {
  return contractEntrypointID(Uint8Array.from(value));
}

function encodeArguments(
  argumentsAndCodecs: readonly ResolvedArgument[],
  args: unknown,
) {
  if (argumentsAndCodecs.length > 0 && (!args || typeof args !== "object")) {
    throw new TypeError("Contract method arguments must be an object");
  }
  const values = args as Record<string, unknown> | undefined;
  const writer = new CxsWriter();
  for (const argument of argumentsAndCodecs) {
    if (!values || !Object.hasOwn(values, argument.publicName)) {
      throw new TypeError(
        `Contract method arguments require own property "${argument.publicName}"`,
      );
    }
    argument.codec.encode(writer, values[argument.publicName]);
  }
  return calldata(writer.finish());
}

function decodeException<TDeclaredException>(
  data: Uint8Array,
  exceptionBySelector: ReadonlyMap<bigint, ResolvedException>,
): ContractException<TDeclaredException> {
  try {
    const reader = new CxsReader(data);
    const selector = reader.readUint64();
    const declared = exceptionBySelector.get(selector);
    if (!declared) {
      return {
        kind: "unknown",
        selector,
        data,
      } as ContractException<TDeclaredException>;
    }
    const value = declared.codec.decode(reader);
    if (reader.remaining !== 0) {
      throw new Error(`${reader.remaining} trailing bytes`);
    }
    return {
      kind: "declared",
      selector,
      name: declared.name,
      value,
    } as ContractException<TDeclaredException>;
  } catch (cause) {
    const detail = cause instanceof Error ? `: ${cause.message}` : "";
    throw new ContractDecodeError(
      `Failed to decode contract exception${detail}`,
      { cause },
    );
  }
}

function assertReturnBufferLimit(
  data: Uint8Array,
  kind: "return" | "abort",
): void {
  const limit = Number(kMaxReturnBufferLen);
  if (data.length > limit) {
    throw new ContractDecodeError(
      `Contract ${kind} data exceeds ${limit} bytes: ${data.length}`,
    );
  }
}
