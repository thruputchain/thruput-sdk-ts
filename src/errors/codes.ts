import type { KnownCommitment } from "../actions/public/waitForTransactionReceipt.js";
import type { Cluster } from "../cluster.js";
import type {
  ContractReceiptFailure,
  ContractViewFailure,
} from "../contract/method.js";
import type { WalletProviderErrorCode } from "../provider/types.js";
import type { UnsupportedRpcValue } from "../rpc/codec.js";
import type {
  RpcErrorData,
  RpcSendTransactionResult,
} from "../rpc/generated.js";
import type {
  AirdropResponse,
  EventPage,
  NetworkInfo,
  TransactionRefPage,
  TransactionStatus,
} from "../types/rpc.js";

/** Fields shared by JSON-RPC error contexts. */
export interface RpcErrorFields {
  /** JSON-RPC numeric error code. */
  readonly code: number;
  /** The `message` field of the JSON-RPC error object. */
  readonly rpcMessage: string;
  /** The `data` field of the JSON-RPC error object, when present. */
  readonly data?: unknown;
  /** JSON-RPC method of the failed request, when known. */
  readonly method?: string;
  /** Complete original JSON-RPC error object, including additive fields. */
  readonly raw: unknown;
}

/**
 * A native RPC error. Narrow on `kind` to read typed `data`. The kind
 * `unrecognized` means the error was unknown, malformed, or contradicted the
 * request; `raw` keeps the complete original error.
 */
export type NativeRpcErrorContext = Omit<RpcErrorFields, "data"> & {
  readonly method: string;
} & (
    | (RpcErrorData extends infer TData
        ? TData extends { kind: infer TKind }
          ? { readonly kind: TKind; readonly data: TData }
          : never
        : never)
    | { readonly kind: "unrecognized"; readonly data?: undefined }
  );

/** The app-layer context of a wallet provider error. */
export interface WalletErrorContext {
  /** The EIP-1193-style numeric code from the wallet provider wire contract. */
  readonly providerCode: WalletProviderErrorCode;
}

/** Context for errors that stop observation of a transaction. */
export interface TransactionOutcomeUnknownContext {
  /** Commitment that the client proved before it stopped, when known. */
  readonly knownCommitment?: KnownCommitment;
  /** The last status the node reported, when known. */
  readonly lastStatus?: TransactionStatus;
  /** The submission failure, when observation continued after it. */
  readonly submissionError?: unknown;
}

/** Context for {@link ThruputErrorContext.fundingStopped}. */
export interface FundingStoppedContext {
  readonly request: {
    readonly recipient: Uint8Array;
    /** Use the same nonce to reconcile this attempt. A new nonce can fund twice. */
    readonly clientNonce: Uint8Array;
    readonly networkHash: Uint8Array;
  };
  /** The last faucet response, when the faucet answered. */
  readonly lastResponse?: AirdropResponse;
  /** Commitment that the client proved before it stopped, when known. */
  readonly knownCommitment?: KnownCommitment;
}

/**
 * The context type for each error code. Each property name is a code.
 *
 * Codes are stable. The client never renames or reuses a code, and never removes
 * a context field. It can add codes and optional fields.
 *
 * Codes use camelCase, like the native RPC error kinds. Node.js and ethers use
 * UPPER_SNAKE; this client keeps one style for all of its string unions.
 *
 * Other packages can add codes through declaration merging:
 *
 * @example
 * ```ts
 * declare module "@thruputchain/client" {
 *   interface ThruputErrorContext {
 *     testkitRunFailed: { readonly step: string };
 *   }
 * }
 * ```
 */
export interface ThruputErrorContext {
  // Transactions. These errors always have `transaction` facts.

  /** The receipt shows failed execution. Outcome `failed`. */
  transactionFailed: Record<string, never>;
  /** The receipt has an execution value this client does not support. Outcome `unknown`. */
  transactionOutcomeUnsupported: Record<string, never>;
  /** Execution succeeded, but its return data did not decode. Outcome `succeeded`. */
  transactionResultUndecodable: Record<string, never>;
  /** Execution succeeded, but the wallet does not keep child return data. Outcome `succeeded`. */
  transactionResultUnavailable: Record<string, never>;
  /** The client did not dispatch the signed transaction. Outcome `notSubmitted`. */
  transactionNotSubmitted: Record<string, never>;
  /**
   * Submission or observation stopped before the client knew the outcome.
   * Outcome `unknown`. Never resend; observe `transaction.hash`.
   */
  transactionOutcomeUnknown: TransactionOutcomeUnknownContext;
  /** Submission returned an admission value this client does not support. Outcome `unknown`. */
  transactionAdmissionUnsupported: {
    readonly response: RpcSendTransactionResult;
  };
  /**
   * A faucet request stopped. `transaction` is present when the faucet
   * identified a transaction. Never call the faucet with a new nonce
   * automatically; reconcile with `context.request.clientNonce`.
   */
  fundingStopped: FundingStoppedContext;

  // JSON-RPC and transport.

  /** The endpoint returned a JSON-RPC error object. */
  rpcError: RpcErrorFields;
  /** A native RPC method returned an error. Narrow on `context.kind`. */
  nativeRpcError: NativeRpcErrorContext;
  /** The HTTP response had a status that is not successful. */
  httpResponseError: {
    readonly status: number;
    readonly statusText: string;
    readonly endpoint?: string;
    readonly method?: string;
  };
  /** The HTTP request failed in the network layer. The endpoint is the URL origin only. */
  httpRequestFailed: {
    readonly endpoint: string;
    readonly method: string;
  };
  /** The JSON-RPC reply was malformed. The write outcome of the request is unknown. */
  rpcResponseInvalid: { readonly raw: unknown };
  /** A known RPC result value was malformed. */
  rpcValueInvalid: { readonly path: string; readonly raw: unknown };
  /** A local RPC request value was invalid. The transport was not called. */
  rpcRequestInvalid: { readonly path: string };
  /** The endpoint, network, or method set does not match what the client requires. */
  rpcIncompatible: Record<string, never>;
  /** The endpoint returned a value this client does not support. */
  rpcValueUnsupported: { readonly value: UnsupportedRpcValue };
  /** The endpoint network does not match the cluster descriptor. */
  networkMismatch: {
    readonly cluster: Cluster;
    readonly actual: NetworkInfo;
  };

  // Contracts.

  /** A contract view aborted, faulted, or returned an unsupported outcome. */
  contractViewFailed: {
    /** Qualified method name. */
    readonly method: string;
    readonly entrypoint: Uint8Array;
    readonly outcome: ContractViewFailure<unknown>;
  };
  /**
   * A root contract receipt did not produce a typed return. Has
   * `transaction` facts. Use the method's `decodeError` for the typed exception.
   * When the receipt shows success but the return is unsupported, the facts are
   * outcome `succeeded` with reason `resultUndecodable`.
   */
  contractCallFailed: {
    /** Qualified method name. */
    readonly method: string;
    readonly entrypoint: Uint8Array;
    readonly outcome: ContractReceiptFailure<unknown>;
  };
  /** Contract bytes do not match their declared type. */
  contractDecodeFailed: Record<string, never>;
  /** Retrieved bytes or response metadata failed identity or canonical checks. */
  contractVerificationFailed: Record<string, never>;

  // Wallet providers. Each code maps one wire code from the wallet provider contract.

  /** Provider code 4001: the user rejected the request. */
  userRejected: WalletErrorContext;
  /** Provider code 4100: unauthorized origin or account, stale session, or no matching approval. */
  walletUnauthorized: WalletErrorContext;
  /** Provider code 4200: the provider does not support the method. */
  walletMethodUnsupported: WalletErrorContext;
  /** Provider code 4900: the provider is disconnected or its transport is unavailable. */
  walletDisconnected: WalletErrorContext;
  /** Provider code 4901: the wallet network does not match. */
  walletNetworkMismatch: WalletErrorContext;
  /** Provider code -32602: invalid parameters, noncanonical encoding, or exceeded limits. */
  walletInvalidParams: WalletErrorContext;
  /** Provider code -32603: internal error or invalid provider result. */
  walletInternalError: WalletErrorContext;
  /** Provider code -32002: another operation is pending. */
  walletRequestPending: WalletErrorContext;

  // Other.

  /** `parseUnits` received a malformed amount or too many decimal places. */
  amountInvalid: {
    readonly kind: "malformed" | "precision";
    readonly decimals: number;
  };
  /** History pages broke ordering, cursor, or identity rules across pages. */
  historyWalkFailed: { readonly page: EventPage | TransactionRefPage };
}

/** A stable error code. */
export type ThruputErrorCode = keyof ThruputErrorContext & string;
