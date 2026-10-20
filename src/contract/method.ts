import { UnsupportedRpcValue } from "../rpc/codec.js";
import type {
  AuthClaim,
  ContractAddress,
  ContractEntrypointID,
  GasAmount,
  Invocation,
  SHA256Hash,
} from "@thruputchain/protocol";
import {
  calldata,
  contractAddress,
  contractEntrypointID,
} from "@thruputchain/protocol";
import {
  ContractMethodEffect,
  ContractTypeKind,
} from "@thruputchain/contract-spec";
import { CxsReader, CxsWriter, type XdrCodec } from "@thruputchain/xdr";
import type { ThruputClient } from "../client.js";
import type {
  EmittedEvent,
  TransactionReceipt,
  ViewResponse,
  ViewCall,
} from "../types/rpc.js";
import type { ContractCodecContext } from "./codec.js";
import {
  decodeComplete,
  resolveContextCodec,
  contextEnumVariant,
} from "./codec.js";
import { ContractDecodeError } from "./errors.js";
import { toHex0x } from "../actions/hex.js";
import { toBase58 } from "../encoding.js";
import { serializeHeight } from "../actions/decimal.js";
import { assertViewFreshness } from "../actions/viewFreshness.js";
import { toAssumedAuth } from "../actions/viewAuthClaim.js";
import type { ContractType } from "./spec.js";

/** Omit the argument position entirely for methods without arguments. */
export type MethodArgs<TArgs> = [TArgs] extends [void] ? [] : [args: TArgs];

/** Successfully decoded contract view result and its snapshot metadata. */
export interface ContractView<T> {
  value: T;
  stateBlockHeight: bigint;
  gasUsed: bigint;
  events: EmittedEvent[];
}

/** Contract exception selector not declared by the generated interface. */
export interface UnknownContractException {
  kind: "unknown";
  selector: bigint;
  data: Uint8Array;
}

/** Declared exceptions plus a lossless fallback for unknown selectors. */
export type ContractException<TDeclared> =
  | (TDeclared & {
      /** Symbolic enum case when available in the contract spec. */ variant?: string;
    })
  | UnknownContractException;

/** Non-successful contract view outcome. */
export type ContractViewFailure<TException> =
  | {
      kind: "unsupported";
      raw: ViewResponse;
      stateBlockHeight: bigint;
      gasUsed: bigint;
      events: EmittedEvent[];
    }
  | {
      kind: "abort";
      exception: TException;
      abortData: Uint8Array;
      stateBlockHeight: bigint;
      gasUsed: bigint;
      events: EmittedEvent[];
    }
  | {
      kind: "fault";
      stateBlockHeight: bigint;
      gasUsed: bigint;
      events: EmittedEvent[];
    };

/** Typed return, abort, or fault from a contract view. */
export type ContractViewOutcome<TResult, TException> =
  | ({ kind: "return" } & ContractView<TResult>)
  | ContractViewFailure<TException>;

/** Successfully decoded root return and its commitment metadata. */
export interface ContractReceipt<TResult> {
  value: TResult;
  transactionHash: Uint8Array;
  blockHeight: bigint;
  events: EmittedEvent[];
}
export type ContractReceiptFailure<TException> = {
  transactionHash: Uint8Array;
  blockHeight: bigint;
  events: EmittedEvent[];
} & (
  | { kind: "abort"; exception: TException; abortData: Uint8Array }
  | { kind: "failure"; execution: TransactionReceipt["execution"] }
  | { kind: "unsupported"; raw: TransactionReceipt }
);
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
        ? `Contract view aborted with ${formatException(outcome.exception, selector)}`
        : outcome.kind === "unsupported"
          ? "Unsupported contract simulation outcome"
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
        ? `Contract transaction ${toBase58(outcome.transactionHash)} aborted with ${formatException(outcome.exception, selector)}`
        : `Contract transaction ${toBase58(outcome.transactionHash)} did not return a supported successful result`,
    );
    this.name = "ContractReceiptError";
    this.outcome = outcome;
  }
}

function formatException(exception: unknown, selector?: bigint): string {
  if (
    exception &&
    typeof exception === "object" &&
    "name" in exception &&
    typeof exception.name === "string" &&
    "value" in exception
  ) {
    const value =
      typeof exception.value === "bigint"
        ? `${exception.value}n`
        : JSON.stringify(exception.value, (_, v: unknown) =>
            typeof v === "bigint" ? `${v}n` : v,
          );
    const variant =
      "variant" in exception && typeof exception.variant === "string"
        ? `.${exception.variant}`
        : "";
    return `${exception.name}${variant} (${value})`;
  }
  return `unknown selector ${selector === undefined ? "unknown" : `0x${selector.toString(16)}`}`;
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
  /** Author-declared whole-invocation effects; null or omission means unannotated. */
  effect?: ContractMethodEffect | null;
  /** Canonical interface name for diagnostics. */
  interfaceName?: string;
  /** Interface ABI version, not a deployed-code verification. */
  interfaceVersion?: string;
  /** Method name in the contract ABI. */
  abiName?: string;
  /** Method name in the TypeScript binding. */
  publicName?: string;
  entrypoint: ContractEntrypointID;
  args: readonly ContractArgumentMetadata[];
  returnType: ContractType;
  throws: readonly ContractExceptionMetadata[];
  codecs: ContractCodecContext;
}

/** Contract address and arguments shared by reads and transaction calls. */
export type ContractMethodInputs<TArgs> = {
  address: ContractAddress;
} & ([TArgs] extends [void] ? { args?: never } : { args: TArgs });

/** View options with an argument object only when the method requires one. */
export type ContractViewOptions<TArgs> = ContractMethodInputs<TArgs> & {
  /** Optional authorization assumed by the simulator, without signatures. */
  assumedAuth?: AuthClaim;
  client: Pick<ThruputClient, "simulateInvocation">;
  caller?: ContractAddress;
  /** Minimum committed snapshot height. No waiting or request-driven refresh. */
  minStateBlockHeight?: bigint;
  /** Cancel this read without affecting other requests on the same client. */
  signal?: AbortSignal;
};

/** Inputs to a typed, unsubmitted contract call. */
export type ContractCallOptions<TArgs> = ContractMethodInputs<TArgs> & {
  gasLimit: GasAmount;
  minStateBlockHeight?: never;
};

/** Inputs for an unsubmitted view, with arguments checked by the generated method. */
export type ContractViewRequestOptions<TArgs> = ContractMethodInputs<TArgs> & {
  assumedAuth?: AuthClaim;
  caller?: ContractAddress;
  minStateBlockHeight?: never;
};

/** Encoded view request retaining its generated outcome decoder. */
export interface ContractViewRequest<TResult = unknown, TException = unknown> {
  readonly minStateBlockHeight?: never;
  readonly request: ViewCall & { minStateBlockHeight?: never };
  readonly method: Pick<
    ContractMethod<never, TResult, TException>,
    "name" | "decodeViewOutcome"
  >;
}

/** An invocation retaining its return and exception decoders. */
export interface ContractCall<TResult = unknown, TException = unknown> {
  readonly invocation: Invocation;
  readonly method: Pick<
    ContractMethod<never, TResult, TException>,
    "decodeReturn" | "decodeException" | "decodeReceiptOutcome" | "name"
  >;
}

/** Complete generated method API. */
export interface ContractMethod<TArgs, TResult, TDeclaredException> {
  /**
   * Author-declared effects, including nested calls. Pure excludes state/context
   * reads; read-only excludes application effects (including events); state-changing
   * means effects may occur. Null means unannotated and gives no read-only assurance.
   * These declarations are not compiler/runtime enforced and never restrict
   * invocation or view APIs.
   */
  readonly effect: ContractMethodEffect | null;
  /** Qualified method name, or entrypoint when generated identity is absent. */
  readonly name: string;
  /** Prepare an independent read for readViews without performing I/O. */
  viewRequest(
    options: ContractViewRequestOptions<TArgs>,
  ): ContractViewRequest<TResult, TDeclaredException>;
  /** Build an unsubmitted call retaining typed decoding context. */
  call(
    options: ContractCallOptions<TArgs>,
  ): ContractCall<TResult, TDeclaredException>;
  readonly entrypoint: ContractEntrypointID;

  invocation(
    contract: ContractAddress,
    gasLimit: GasAmount,
    ...args: MethodArgs<TArgs>
  ): Invocation;

  /**
   * Decode complete calldata using the generated public argument names.
   * Returns undefined for no-argument methods; rejects incomplete or trailing bytes.
   * Select the descriptor after checking the invocation's entrypoint. ABI decoding
   * does not verify the target contract's behavior.
   *
   * @example
   * ```ts
   * const { receiver, amount } = ERC20.v0_1.transfer.decodeArgs(invocation.calldata);
   * ```
   */
  decodeArgs(data: Uint8Array): TArgs;
  /** Decode complete return data. The runtime enforces network-specific buffer limits. */
  decodeReturn(data: Uint8Array): TResult;
  /** Decode abort data, preserving an unknown selector and its complete payload. */
  decodeException(data: Uint8Array): ContractException<TDeclaredException>;
  /** Decode a view response with the same semantics as view(). */
  decodeView(response: ViewResponse): ContractView<TResult>;
  /** Decode return, abort, or fault without throwing for a contract failure. */
  decodeViewOutcome(
    response: ViewResponse,
  ): ContractViewOutcome<TResult, ContractException<TDeclaredException>>;

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
  variant: (value: unknown) => string | undefined;
}

/** Build one generated method descriptor from direct ABI metadata. */
export function defineContractMethod<TArgs, TResult, TDeclaredException>(
  definition: ContractMethodDefinition,
): ContractMethod<TArgs, TResult, TDeclaredException> {
  const entrypoint = copyEntrypoint(definition.entrypoint);
  const effect = definition.effect ?? null;
  if (
    effect !== null &&
    ![
      ContractMethodEffect.EffectPure,
      ContractMethodEffect.EffectReadOnly,
      ContractMethodEffect.EffectStateChanging,
    ].includes(effect)
  ) {
    throw new TypeError(`Unsupported contract method effect ${effect}`);
  }
  const name =
    definition.interfaceName && definition.publicName
      ? `${definition.interfaceName}.${definition.publicName}`
      : toHex0x(entrypoint);
  const encode = (args: unknown) => {
    try {
      return encodeArguments(argumentCodecs, args);
    } catch (cause) {
      throw new TypeError(
        `${name}: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      );
    }
  };
  const argumentCodecs = definition.args.map((argument) => ({
    publicName: argument.publicName,
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
      name: metadata.name,
      codec: resolveContextCodec(definition.codecs, metadata.type),
      variant: (value) =>
        contextEnumVariant(definition.codecs, metadata.type, value),
    });
  }

  const method: ContractMethod<TArgs, TResult, TDeclaredException> = {
    name,
    effect,
    viewRequest(options) {
      if ("minStateBlockHeight" in options) {
        throw new TypeError(
          "Set minStateBlockHeight on readViews, not on a prepared call",
        );
      }
      return {
        request: {
          address: contractAddress(new Uint8Array(options.address)),
          entrypoint: copyEntrypoint(entrypoint),
          calldata: encode("args" in options ? options.args : undefined),
          ...(options.assumedAuth === undefined
            ? {}
            : { assumedAuth: toAssumedAuth(options.assumedAuth) }),
          ...(options.caller
            ? { caller: contractAddress(new Uint8Array(options.caller)) }
            : {}),
        },
        method,
      };
    },
    call(options) {
      if ("minStateBlockHeight" in options) {
        throw new TypeError(
          "minStateBlockHeight is a read constraint, not a transaction option",
        );
      }
      return {
        invocation: {
          invoked_address: contractAddress(new Uint8Array(options.address)),
          entrypoint: copyEntrypoint(entrypoint),
          gas_limit: options.gasLimit,
          calldata: encode("args" in options ? options.args : undefined),
        },
        method,
      };
    },
    get entrypoint() {
      return copyEntrypoint(entrypoint);
    },

    invocation(contract, gasLimit, ...args) {
      return {
        invoked_address: contract,
        entrypoint: copyEntrypoint(entrypoint),
        gas_limit: gasLimit,
        calldata: encode(args[0]),
      };
    },

    decodeArgs(data) {
      const reader = new CxsReader(data);
      const args = Object.fromEntries(
        argumentCodecs.map((argument) => {
          try {
            return [argument.publicName, argument.codec.decode(reader)];
          } catch (cause) {
            const detail = cause instanceof Error ? `: ${cause.message}` : "";
            throw new ContractDecodeError(
              `${name}: argument "${argument.publicName}"${detail}`,
              { cause },
            );
          }
        }),
      );
      if (reader.remaining !== 0) {
        throw new ContractDecodeError(
          `${name}: ${reader.remaining} trailing calldata bytes`,
        );
      }
      return (argumentCodecs.length === 0 ? undefined : args) as TArgs;
    },

    decodeReturn(data) {
      return decodeComplete<TResult>(
        returnCodec,
        data,
        `${name} contract return value`,
      );
    },

    decodeException(data) {
      return decodeException<TDeclaredException>(data, exceptionBySelector);
    },

    decodeReceiptOutcome(receipt) {
      const metadata = {
        transactionHash: receipt.transactionHash,
        blockHeight: receipt.blockHeight,
        events: receipt.events,
      };
      const execution = receipt.execution;
      if (execution instanceof UnsupportedRpcValue)
        return { kind: "unsupported", raw: receipt, ...metadata };
      if (execution.result === "return")
        return {
          kind: "return",
          value: method.decodeReturn(execution.returnData),
          ...metadata,
        };
      if (execution.result === "abort")
        return {
          kind: "abort",
          exception: method.decodeException(execution.abortData),
          abortData: execution.abortData,
          ...metadata,
        };
      return { kind: "failure", execution, ...metadata };
    },
    decodeReceipt(receipt) {
      const outcome = method.decodeReceiptOutcome(receipt);
      if (outcome.kind === "return")
        return {
          value: outcome.value,
          transactionHash: outcome.transactionHash,
          blockHeight: outcome.blockHeight,
          events: outcome.events,
        };
      throw new ContractReceiptError(outcome);
    },

    decodeView(response) {
      const outcome = method.decodeViewOutcome(response);
      if (outcome.kind !== "return") throw new ContractViewError(outcome);
      return {
        value: outcome.value,
        stateBlockHeight: outcome.stateBlockHeight,
        gasUsed: outcome.gasUsed,
        events: outcome.events,
      };
    },

    async viewOutcome(options) {
      options.signal?.throwIfAborted();
      const minStateBlockHeight = options.minStateBlockHeight;
      if (minStateBlockHeight !== undefined)
        serializeHeight(minStateBlockHeight);
      const request = {
        ...(options.assumedAuth === undefined
          ? {}
          : { assumedAuth: toAssumedAuth(options.assumedAuth) }),
        address: options.address,
        entrypoint: copyEntrypoint(entrypoint),
        calldata: encode("args" in options ? options.args : undefined),
        ...(options.caller ? { caller: options.caller } : {}),
        ...(minStateBlockHeight === undefined ? {} : { minStateBlockHeight }),
      };
      const response = await (options.signal
        ? options.client.simulateInvocation(request, { signal: options.signal })
        : options.client.simulateInvocation(request));

      assertViewFreshness(response.stateBlockHeight, minStateBlockHeight);
      return method.decodeViewOutcome(response);
    },

    decodeViewOutcome(response) {
      if (response.output instanceof UnsupportedRpcValue)
        return {
          kind: "unsupported",
          raw: response,
          stateBlockHeight: response.stateBlockHeight,
          gasUsed: response.gasUsed,
          events: response.events,
        };
      switch (response.output.result) {
        case "return":
          return {
            kind: "return",
            value: method.decodeReturn(response.output.returnData),
            stateBlockHeight: response.stateBlockHeight,
            gasUsed: response.gasUsed,
            events: response.events,
          };
        case "abort":
          return {
            kind: "abort",
            exception: method.decodeException(response.output.abortData),
            abortData: response.output.abortData,
            stateBlockHeight: response.stateBlockHeight,
            gasUsed: response.gasUsed,
            events: response.events,
          };
        case "fault":
          return {
            kind: "fault",
            stateBlockHeight: response.stateBlockHeight,
            gasUsed: response.gasUsed,
            events: response.events,
          };
      }
    },

    async view(options) {
      const outcome = await method.viewOutcome(options);
      if (outcome.kind === "return") {
        return {
          value: outcome.value,
          stateBlockHeight: outcome.stateBlockHeight,
          gasUsed: outcome.gasUsed,
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
    try {
      argument.codec.encode(writer, values[argument.publicName]);
    } catch (cause) {
      throw new TypeError(
        `argument "${argument.publicName}": ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      );
    }
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
    const variant = declared.variant(value);
    if (reader.remaining !== 0) {
      throw new Error(`${reader.remaining} trailing bytes`);
    }
    return {
      kind: "declared",
      selector,
      name: declared.name,
      value,
      ...(variant === undefined ? {} : { variant }),
    } as unknown as ContractException<TDeclaredException>;
  } catch (cause) {
    const detail = cause instanceof Error ? `: ${cause.message}` : "";
    throw new ContractDecodeError(
      `Failed to decode contract exception${detail}`,
      { cause },
    );
  }
}
