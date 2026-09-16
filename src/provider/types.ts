/** Public identity advertised by a version 1 provider. Not an attestation. */
export interface WalletProviderInfo {
  /** Stable discovery ID: 1–64 ASCII letters, digits, dots, underscores, or hyphens. */
  id: string;
  /** Display text: 1–80 characters, without controls or surrounding whitespace. */
  name: string;
  /** Supported wire contract version. */
  version: "1.0.0";
}

/** Wire pubkey account: canonical 0x hex and a decimal u64 derivation nonce. */
export interface WalletAccount {
  /** Derived pubkey account address: 32 bytes of lowercase, 0x-prefixed hex. */
  address: string;
  /** Non-small-order, prime-order Ed25519 key in the same 32-byte hex format. */
  publicKey: string;
  /** Canonical decimal u64 account-derivation nonce, not a transaction nonce. */
  nonce: string;
}

/** Origin-authorized accounts on a network (64 lowercase hex, no 0x). */
export interface WalletSession {
  /** Current network identity, retained even when the origin has no permission. */
  networkHash: string;
  /** At most 32 unique addresses; empty for a disconnected or unauthorized origin. */
  accounts: readonly WalletAccount[];
}

/** Non-interactive execution capabilities for one authorized account and network. */
export interface WalletCapabilities {
  /** Canonical account address used in the capability request. */
  account: string;
  /** Network identity: 64 lowercase hex characters, without 0x. */
  networkHash: string;
  /** Ordered, all-or-nothing DefaultWallet calls; null means unsupported. */
  atomicBatch: { maxCalls: number } | null;
}

/**
 * The complete provider request surface. Requests accept exactly the fields shown.
 * See {@link WalletProvider.request} for each method's result and permission rules.
 *
 * Signing parameters select an authorized account address and the current session's
 * network hash (64 lowercase hex characters without 0x). Transaction payloads are
 * lowercase, even-length, 0x-prefixed canonical classic XDR, with no trailing bytes.
 * Providers must enforce {@link MAX_UNSIGNED_TRANSACTION_BYTES} before user approval;
 * signed payloads are bounded by {@link MAX_TRANSACTION_BYTES}.
 *
 * Signing never broadcasts. Submission requires the exact signed bytes previously
 * approved for the trusted caller origin, account, and network. Providers must clear
 * approvals on session changes or disconnect and recheck authorization before signing
 * or broadcasting. Page-supplied parameters cannot establish the caller's origin.
 *
 * @see https://docs.groundhog.dev/tools/wallet-provider/
 */
export type ProviderRequest =
  | { method: "connect" }
  | { method: "getSession" }
  | { method: "disconnect" }
  | {
      method: "getCapabilities";
      params: { account: string; networkHash: string };
    }
  | {
      method: "signTransaction";
      params: { account: string; networkHash: string; transaction: string };
    }
  | {
      method: "submitTransaction";
      params: {
        account: string;
        networkHash: string;
        signedTransaction: string;
      };
    };

/** Approved signed XDR and the canonical RPC transaction/receipt hash. */
export interface SignTransactionResult {
  /** Canonical signed XDR preserving the approved unsigned bytes, with one signature. */
  signedTransaction: string;
  /** 0x-prefixed lowercase SHA-256 of unsigned transaction XDR; excludes signatures and network. */
  hash: string;
}

/** Broadcast acknowledgement, not an execution receipt. */
export interface SubmitTransactionResult {
  /** The previously approved transaction hash; query its receipt on the original network. */
  hash: string;
}

/**
 * Framework- and transport-neutral, origin-scoped wallet interface.
 * Validate unknown results with the matching parser before using them.
 *
 * @see https://docs.groundhog.dev/tools/wallet-provider/
 * @see https://docs.groundhog.dev/tools/wallet-integration/
 */
export interface WalletProvider {
  info: WalletProviderInfo;
  /** Optional request extensions. Absence means legacy single-call behavior. */
  supportedMethods?: readonly string[];
  /**
   * Send a request across the wallet boundary. The result is unknown until validated.
   *
   * | Method | Result | Permission and behavior |
   * | --- | --- | --- |
   * | `connect` | {@link WalletSession} | Request origin-scoped permission through wallet UI; reject on refusal. Success has at least one authorized account. |
   * | `getSession` | {@link WalletSession} | Non-interactive snapshot; never prompt or grant access. Unauthorized origins see empty accounts and the current network hash. |
   * | `disconnect` | `null` | Idempotently revoke this origin's permission and pending approvals. |
   * | `getCapabilities` | {@link WalletCapabilities} | Non-interactive; requires an authorized account on the requested network. Older providers return 4200. |
   * | `signTransaction` | {@link SignTransactionResult} | Approve and sign the exact unsigned transaction; never broadcast. |
   * | `submitTransaction` | {@link SubmitTransactionResult} | Broadcast only exact previously approved signed bytes; acknowledgement is not an execution receipt. |
   *
   * Changes caused by connect/disconnect must reach page-facing listeners before the
   * request resolves, including across bridges with separate response/event paths.
   */
  request(request: ProviderRequest): Promise<unknown>;
  /**
   * Subscribe to full session snapshots for changes to accounts, authorization,
   * account metadata, or network, including disconnect. Subscription itself emits
   * no snapshot; use `getSession` to read one. See {@link request} for event ordering.
   *
   * @returns An idempotent unsubscribe function.
   */
  on(event: "change", listener: (session: WalletSession) => void): () => void;
}

/**
 * Stable provider error codes, including JSON-RPC-style request failures.
 *
 * | Code | Meaning |
 * | --- | --- |
 * | 4001 | User rejected the request. |
 * | 4100 | Origin/account unauthorized, stale session, or no matching approval. |
 * | 4200 | Unsupported method. |
 * | 4900 | Provider disconnected or transport unavailable. |
 * | 4901 | Requested network does not match. |
 * | -32602 | Invalid parameters, noncanonical encoding, or exceeded input limits. |
 * | -32603 | Internal error or invalid provider result. |
 * | -32002 | Another operation is pending. |
 */
export type WalletProviderErrorCode =
  | 4001
  | 4100
  | 4200
  | 4900
  | 4901
  | -32602
  | -32603
  | -32002;

/**
 * A provider failure with a {@link WalletProviderErrorCode | stable numeric code}.
 * Preserve `code` and a human-readable `message` across bridges; `instanceof` does
 * not work across all realms. {@link parseWalletProviderError} reconstructs errors
 * with recognized codes and messages of at most 1,024 characters.
 *
 * After submit starts, even failure may mean broadcast. Keep the previously saved
 * hash and query its status on the original network instead of automatically
 * preparing or signing a replacement transaction.
 */
export class WalletProviderError extends Error {
  constructor(
    readonly code: WalletProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WalletProviderError";
  }
}
