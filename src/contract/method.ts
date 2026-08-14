import type {
  ContractAddress,
  ContractEntrypointID,
  GasAmount,
  Invocation,
} from "@groundhogchain/protocol";
import { calldata, kMaxReturnBufferLen } from "@groundhogchain/protocol";
import { CxsReader, CxsWriter, type XdrCodec } from "@groundhogchain/xdr";
import type { GroundhogClient } from "../client.js";
import type { EmittedEvent } from "../types/rpc.js";
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

/** Abort selector not declared by the generated contract interface. */
export interface UnknownContractAbort {
  kind: "unknown";
  selector: bigint;
  data: Uint8Array;
}

/** Declared aborts plus a lossless fallback for unknown selectors. */
export type ContractAbort<TDeclared> = TDeclared | UnknownContractAbort;

/** Non-successful contract view outcome. */
export type ContractViewFailure<TAbort> =
  | {
      kind: "abort";
      abort: TAbort;
      data: Uint8Array;
      height: bigint;
      events: EmittedEvent[];
    }
  | {
      kind: "fault";
      height: bigint;
      events: EmittedEvent[];
    };

/** Typed return, abort, or fault from a contract view. */
export type ContractViewOutcome<TResult, TAbort> =
  | ({ kind: "return" } & ContractView<TResult>)
  | ContractViewFailure<TAbort>;

/** Error thrown by the ergonomic view API for contract aborts and faults. */
export class ContractViewError<TAbort> extends Error {
  readonly outcome: ContractViewFailure<TAbort>;

  constructor(outcome: ContractViewFailure<TAbort>) {
    const selector =
      outcome.kind === "abort" ? abortSelector(outcome.abort) : undefined;
    super(
      outcome.kind === "abort"
        ? `Contract view aborted with selector ${selector ?? "unknown"}`
        : "Contract view faulted",
    );
    this.name = "ContractViewError";
    this.outcome = outcome;
  }
}

function abortSelector(abort: unknown): bigint | undefined {
  if (!abort || typeof abort !== "object" || !("selector" in abort)) {
    return undefined;
  }
  return typeof abort.selector === "bigint" ? abort.selector : undefined;
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
  exception: string | null;
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
export interface ContractMethod<TArgs, TResult, TDeclaredAbort> {
  readonly entrypoint: ContractEntrypointID;

  invocation(
    contract: ContractAddress,
    gasLimit: GasAmount,
    ...args: MethodArgs<TArgs>
  ): Invocation;

  decodeReturn(data: Uint8Array): TResult;
  decodeAbort(data: Uint8Array): ContractAbort<TDeclaredAbort>;
  view(options: ContractViewOptions<TArgs>): Promise<ContractView<TResult>>;
  viewOutcome(
    options: ContractViewOptions<TArgs>,
  ): Promise<ContractViewOutcome<TResult, ContractAbort<TDeclaredAbort>>>;
}

interface ResolvedException {
  metadata: ContractExceptionMetadata;
  codec: XdrCodec<unknown>;
}

/** Build one generated method descriptor from direct ABI metadata. */
export function defineContractMethod<TArgs, TResult, TDeclaredAbort>(
  definition: ContractMethodDefinition,
): ContractMethod<TArgs, TResult, TDeclaredAbort> {
  const argumentCodecs = definition.args.map((argument) => ({
    metadata: argument,
    codec: resolveContextCodec(definition.codecs, argument.type),
  }));
  const returnCodec = resolveContextCodec(
    definition.codecs,
    definition.returnType,
  );
  const exceptionBySelector = new Map<bigint, ResolvedException>();
  for (const metadata of definition.throws) {
    if (exceptionBySelector.has(metadata.selector)) {
      throw new Error(
        `Duplicate contract exception selector ${metadata.selector}`,
      );
    }
    exceptionBySelector.set(metadata.selector, {
      metadata,
      codec: resolveContextCodec(definition.codecs, metadata.type),
    });
  }

  const method: ContractMethod<TArgs, TResult, TDeclaredAbort> = {
    entrypoint: definition.entrypoint,

    invocation(contract, gasLimit, ...args) {
      return {
        invoked_address: contract,
        entrypoint: definition.entrypoint,
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

    decodeAbort(data) {
      assertReturnBufferLimit(data, "abort");
      return decodeAbort<TDeclaredAbort>(data, exceptionBySelector);
    },

    async viewOutcome(options) {
      const response = await options.client.view({
        contract: options.contract,
        entrypoint: definition.entrypoint,
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
            abort: method.decodeAbort(response.output.abortData),
            data: response.output.abortData,
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
      if (outcome.kind === "return") return outcome;
      throw new ContractViewError(outcome);
    },
  };

  return method;
}

function encodeArguments(
  argumentsAndCodecs: readonly {
    metadata: ContractArgumentMetadata;
    codec: XdrCodec<unknown>;
  }[],
  args: unknown,
) {
  if (argumentsAndCodecs.length > 0 && (!args || typeof args !== "object")) {
    throw new TypeError("Contract method arguments must be an object");
  }
  const values = args as Record<string, unknown> | undefined;
  const writer = new CxsWriter();
  for (const argument of argumentsAndCodecs) {
    argument.codec.encode(writer, values?.[argument.metadata.publicName]);
  }
  return calldata(writer.finish());
}

function decodeAbort<TDeclaredAbort>(
  data: Uint8Array,
  exceptionBySelector: ReadonlyMap<bigint, ResolvedException>,
): ContractAbort<TDeclaredAbort> {
  try {
    const reader = new CxsReader(data);
    const selector = reader.readUint64();
    const declared = exceptionBySelector.get(selector);
    if (!declared) {
      return {
        kind: "unknown",
        selector,
        data,
      } as ContractAbort<TDeclaredAbort>;
    }
    const value = declared.codec.decode(reader);
    if (reader.remaining !== 0) {
      throw new Error(`${reader.remaining} trailing bytes`);
    }
    return {
      kind: "declared",
      selector,
      exception: declared.metadata.exception,
      value,
    } as ContractAbort<TDeclaredAbort>;
  } catch (cause) {
    const detail = cause instanceof Error ? `: ${cause.message}` : "";
    throw new ContractDecodeError(`Failed to decode contract abort${detail}`, {
      cause,
    });
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
