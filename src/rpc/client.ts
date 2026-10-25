import { codec, deserialize } from "@thruputchain/protocol";
import { hashSignedTransaction } from "../derivation/transactionHash.js";
import { JsonRpcError } from "../transport/http.js";
import { NativeRpcError } from "./errorReader.js";
import { toHex0x } from "../actions/hex.js";
import type { Transport, TransportRequestOptions } from "../transport/types.js";
import {
  decodeResult,
  encodeRequest,
  RpcDecodingError,
  rpcMethodNames,
  rpcPageMethods,
  RpcRequestValidationError,
} from "./codec.js";
import type {
  RpcRequests,
  RpcResults,
  RpcVersionInfo,
  RpcNetworkInfo,
  RpcServerLimits,
  RpcTransactionRefPage,
  RpcEventPage,
  RpcHistoryStart,
  RpcEventFilter,
} from "./generated.js";

export type RpcMethod = keyof RpcRequests;
/**
 * Exact low-level operations. Each accepts one named object; empty requests default to {}.
 * Cancellation options are always the second argument, including for empty requests:
 * `client.getChainTip({}, { signal })`.
 */
export type RpcMethods = {
  [M in RpcMethod]: keyof RpcRequests[M] extends never
    ? (
        request?: RpcRequests[M],
        options?: TransportRequestOptions,
      ) => Promise<RpcResults[M]>
    : (
        request: RpcRequests[M],
        options?: TransportRequestOptions,
      ) => Promise<RpcResults[M]>;
};
export interface RpcDiscovery {
  version: RpcVersionInfo;
  network: RpcNetworkInfo;
  limits?: RpcServerLimits;
}
export type RpcClient = RpcMethods & {
  /** Copy of the last explicitly refreshed, validated discovery snapshot. */
  readonly discovery: RpcDiscovery;
  /** Reads discovery again. Never repeats a failed write. */
  refreshDiscovery(options?: TransportRequestOptions): Promise<RpcDiscovery>;
  /** Check the configured methods before composing a multi-call workflow. */
  requireMethods(methods: readonly RpcMethod[]): void;
};
export interface RpcClientOptions {
  transport: Transport;
  /** Required signing network, compared by bytes before the client is returned. */
  expectedNetworkHash?: Uint8Array;
  /** Methods needed by a composed workflow; partial development endpoints are supported. */
  requiredMethods?: readonly RpcMethod[];
  signal?: AbortSignal;
}

export class RpcCompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcCompatibilityError";
  }
}

const equal = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Connect a native wire-14 client. This layer reads once or sends once; it does
 * not sign, poll, retry, refresh discovery on failure, or switch wire formats.
 * Unknown response variants are UnsupportedRpcValue objects retaining raw data.
 */
export async function createRpcClient(
  options: RpcClientOptions,
): Promise<RpcClient> {
  const transport = options.transport;
  const expected = options.expectedNetworkHash
    ? new Uint8Array(options.expectedNetworkHash)
    : undefined;
  if (expected && expected.length !== 32)
    throw new RangeError("expectedNetworkHash must have 32 bytes");
  const required = [...(options.requiredMethods ?? [])];
  let discovery: RpcDiscovery;
  let configured = new Set<string>();
  const requireMethods = (methods: readonly RpcMethod[]) => {
    for (const method of methods)
      if (!configured.has(method))
        throw new RpcCompatibilityError(
          `Endpoint does not advertise ${method}`,
        );
  };
  const requestOnce = async (
    method: RpcMethod,
    params: Record<string, unknown>,
    control?: TransportRequestOptions,
    hash?: Uint8Array,
  ) => {
    try {
      return await transport.request(method, params, control);
    } catch (error) {
      if (error instanceof JsonRpcError)
        throw new NativeRpcError(error, method, hash);
      throw error;
    }
  };
  const read = async <M extends RpcMethod>(
    method: M,
    control?: TransportRequestOptions,
  ): Promise<RpcResults[M]> =>
    decodeResult(
      method,
      await requestOnce(method, {}, control),
    ) as RpcResults[M];
  const refreshDiscovery = async (
    control?: TransportRequestOptions,
  ): Promise<RpcDiscovery> => {
    const version = await read("getVersionInfo", control);
    // Only the wire identity selects codecs. Release and build versions are diagnostics.
    if (!/^14\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version.wireFormat))
      throw new RpcCompatibilityError(
        `Unsupported RPC wire format ${version.wireFormat}`,
      );
    const methods = new Set(version.supportedMethods);
    for (const method of ["getVersionInfo", "getNetworkInfo", ...required])
      if (!methods.has(method))
        throw new RpcCompatibilityError(
          `Endpoint does not advertise ${method}`,
        );
    const network = await read("getNetworkInfo", control);
    const wanted = expected ?? discovery?.network.networkHash;
    if (wanted && !equal(wanted, network.networkHash))
      throw new RpcCompatibilityError("RPC network identity does not match");
    const limits = methods.has("getServerLimits")
      ? await read("getServerLimits", control)
      : undefined;
    discovery = { version, network, ...(limits ? { limits } : {}) };
    configured = methods;
    return structuredClone(discovery);
  };
  await refreshDiscovery({ signal: options.signal });
  const methods = Object.fromEntries(
    rpcMethodNames.map((name) => [
      name,
      async (request: unknown = {}, control?: TransportRequestOptions) => {
        const method = name as RpcMethod;
        control?.signal?.throwIfAborted();
        requireMethods([method]);
        // Serialize before awaiting: callers cannot mutate predicates or signed bytes in flight.
        const params = encodeRequest(method, request);
        const input = structuredClone(request) as Record<string, unknown>;
        const limits = discovery.limits;
        checkLimits(method, input, limits);
        let submittedHash: Uint8Array | undefined;
        if (method === "sendTransaction") {
          try {
            submittedHash = hashSignedTransaction(
              deserialize(
                input.signedTransaction as Uint8Array,
                codec.SignedTransaction,
              ),
            );
          } catch {
            throw new RpcRequestValidationError(
              "/params/signedTransaction",
              "Invalid signed transaction XDR",
            );
          }
        }
        const raw = await requestOnce(
          method,
          params,
          control,
          submittedHash ??
            (method === "getTransactionReceipt"
              ? (input.transactionHash as Uint8Array)
              : undefined),
        );
        const result = decodeResult(method, raw) as RpcResults[RpcMethod];
        checkResult(
          method,
          input,
          result,
          raw,
          submittedHash,
          limits,
          discovery.network.networkHash,
        );
        return result;
      },
    ]),
  ) as RpcMethods;
  return Object.defineProperty(
    Object.assign(methods, { refreshDiscovery, requireMethods }),
    "discovery",
    { get: () => structuredClone(discovery), enumerable: true },
  ) as RpcClient;
}

function checkLimits(
  method: RpcMethod,
  input: Record<string, unknown>,
  limits: RpcServerLimits | undefined,
) {
  if (rpcPageMethods.has(method)) {
    if (!limits)
      throw new RpcCompatibilityError(
        "History calls require advertised server limits",
      );
    const cap =
      method === "getEvents"
        ? limits.maxEventsPerPage
        : limits.maxTransactionsPerPage;
    if (input.limit !== undefined && (input.limit as number) > cap)
      throw new RpcRequestValidationError(
        "/params/limit",
        `limit exceeds endpoint cap ${cap}`,
      );
    if (
      typeof input.cursor === "string" &&
      BigInt((input.cursor.length - 2) / 2) > limits.maxCursorBytes
    )
      throw new RpcRequestValidationError(
        "/params/cursor",
        "cursor exceeds endpoint cap",
      );
  }
  if (method === "simulateInvocation" || method === "simulateInvocations") {
    if (!limits)
      throw new RpcCompatibilityError(
        "Simulation calls require advertised server limits",
      );
    const calls =
      method === "simulateInvocation"
        ? [input]
        : (input.invocations as Record<string, unknown>[]);
    let gas = 0n,
      bytes = 0;
    for (const call of calls) {
      const callGas = call.gasLimit as bigint | undefined;
      if (callGas !== undefined && callGas > limits.maxSimulationGas)
        throw new RpcRequestValidationError(
          "/params/gasLimit",
          "gasLimit exceeds endpoint cap",
        );
      const size = (call.calldata as Uint8Array).length;
      if (BigInt(size) > limits.maxSimulationCalldataBytes)
        throw new RpcRequestValidationError(
          "/params/calldata",
          "calldata exceeds endpoint cap",
        );
      gas += callGas ?? limits.maxSimulationGas;
      bytes += size;
    }
    if (method === "simulateInvocations") {
      const batch = limits.simulationBatch;
      if (!batch)
        throw new RpcCompatibilityError(
          "Batch simulation limits are unavailable",
        );
      if (
        calls.length > batch.maxInvocations ||
        bytes > batch.maxCalldataBytes ||
        gas > batch.maxGas
      )
        throw new RpcRequestValidationError(
          "/params/invocations",
          "simulation batch exceeds endpoint cap",
        );
    }
  }
}

function checkResult(
  method: RpcMethod,
  input: Record<string, unknown>,
  value: unknown,
  raw: unknown,
  submittedHash: Uint8Array | undefined,
  limits: RpcServerLimits | undefined,
  networkHash: Uint8Array,
) {
  const invalid = (): never => {
    throw new RpcDecodingError("/result", raw);
  };
  if (value === null) return;
  const result = value as Record<string, unknown>;
  if (
    (method === "getTransactionReceipt" &&
      !equal(
        result.transactionHash as Uint8Array,
        input.transactionHash as Uint8Array,
      )) ||
    (submittedHash &&
      !equal(result.transactionHash as Uint8Array, submittedHash))
  )
    invalid();
  if (
    method === "getBlockByHeight" &&
    ((result.blockHeight as bigint) <= 0n ||
      result.blockHeight !== input.blockHeight ||
      !equal(result.networkHash as Uint8Array, networkHash))
  )
    invalid();
  if (
    (method === "getBalance" || method === "getRegisteredAuth") &&
    !equal(result.address as Uint8Array, input.address as Uint8Array)
  )
    invalid();
  if (
    method === "simulateInvocations" &&
    (result.results as unknown[]).length !==
      (input.invocations as unknown[]).length
  )
    invalid();
  if (
    (method === "simulateInvocation" || method === "simulateInvocations") &&
    input.minStateBlockHeight !== undefined &&
    (result.stateBlockHeight as bigint) < (input.minStateBlockHeight as bigint)
  )
    invalid();
  if (method === "dev_fundAccount") {
    const funding = value as RpcResults["dev_fundAccount"];
    try {
      if (
        !equal(funding.recipient, input.recipient as Uint8Array) ||
        funding.rawAmount !== input.rawAmount ||
        !equal(
          funding.transactionHash,
          hashSignedTransaction(
            deserialize(funding.signedTransaction, codec.SignedTransaction),
          ),
        )
      )
        invalid();
    } catch {
      invalid();
    }
  }
  if (
    method === "faucet_requestAirdrop" &&
    "recipient" in result &&
    !equal(result.recipient as Uint8Array, input.recipient as Uint8Array)
  )
    invalid();
  if (!rpcPageMethods.has(method)) return;
  const page = value as RpcTransactionRefPage | RpcEventPage;
  const entries =
    method === "getEvents"
      ? (page as RpcEventPage).events
      : (page as RpcTransactionRefPage).transactions;
  const cap =
    method === "getEvents"
      ? limits!.maxEventsPerPage
      : limits!.maxTransactionsPerPage;
  if (
    page.oldestIndexedBlockHeight > page.latestIndexedBlockHeight ||
    entries.length >
      ((input.limit as number | undefined) ?? Math.min(50, cap)) ||
    (page.nextCursor !== null &&
      (page.nextCursor === input.cursor ||
        BigInt((page.nextCursor.length - 2) / 2) > limits!.maxCursorBytes))
  )
    invalid();
  if (
    entries.some(
      (entry) =>
        entry.blockHeight < page.oldestIndexedBlockHeight ||
        entry.blockHeight > page.latestIndexedBlockHeight,
    )
  )
    invalid();
  const start = input.start as RpcHistoryStart | undefined;
  if (method === "getTransactionsByBlock") {
    if (
      page.oldestIndexedBlockHeight < 1n ||
      (!entries.length && page.nextCursor !== null) ||
      (input.cursor !== undefined &&
        ((input.blockHeight as bigint) < page.oldestIndexedBlockHeight ||
          (input.blockHeight as bigint) > page.latestIndexedBlockHeight)) ||
      entries.some((entry) => entry.blockHeight !== input.blockHeight)
    )
      invalid();
  } else if (start?.anchor.kind === "atHeight") {
    const anchor = start.anchor.blockHeight;
    if (
      anchor < page.oldestIndexedBlockHeight ||
      entries.some((entry) =>
        start.order === "ascending"
          ? entry.blockHeight < anchor
          : entry.blockHeight > anchor,
      )
    )
      invalid();
  }
  const identities = new Set<string>();
  const keys: [bigint, string, number][] = [];
  for (const [index, entry] of entries.entries()) {
    const event =
      method === "getEvents" ? (page as RpcEventPage).events[index] : undefined;
    const hash = toHex0x(entry.transactionHash);
    const sequence = event?.sequenceNumber ?? 0;
    const identity = method === "getEvents" ? `${hash}/${sequence}` : hash;
    if (identities.has(identity)) invalid();
    identities.add(identity);
    keys.push([entry.blockHeight, hash, sequence]);
    if (
      event &&
      !(input.filters as RpcEventFilter[]).some(
        (filter) =>
          filter.addresses.some((address) =>
            equal(address, event.event.address),
          ) &&
          ["topic0", "topic1", "topic2"].every((key, i) => {
            const values =
              filter.topics?.[key as "topic0" | "topic1" | "topic2"];
            return (
              !values?.length ||
              (!!event.event.topics[i] &&
                values.some((topic) => equal(topic, event.event.topics[i]!)))
            );
          }),
      )
    )
      invalid();
  }
  const compare = (
    left: (typeof keys)[number],
    right: (typeof keys)[number],
  ) => {
    for (let i = 0; i < 3; i++) {
      if (left[i]! < right[i]!) return -1;
      if (left[i]! > right[i]!) return 1;
    }
    return 0;
  };
  const asc = keys.every((key, i) => i === 0 || compare(keys[i - 1]!, key) < 0);
  const desc = keys.every(
    (key, i) => i === 0 || compare(keys[i - 1]!, key) > 0,
  );
  if (!(start ? (start.order === "ascending" ? asc : desc) : asc || desc))
    invalid();
}
