import {
  AuthClaimType,
  CryptographicScheme,
  codec,
  deserialize,
  ed25519PublicKey,
  fromHex,
  networkHash as toNetworkHash,
  serialize,
  sha256Hash,
  type PublicKey,
  type Transaction,
  type SignedTransaction,
} from "@thruputchain/protocol";
import { Point, verifyAsync } from "@noble/ed25519";
import { toHex0x } from "../actions/hex.js";
import {
  derivePubkeyAccountAddress,
  pubkeyAccountPreimage,
} from "../derivation/pubkeyAccount.js";
import { derivePublicKeyHash } from "../derivation/publicKeyHash.js";
import { hashSignedTransaction } from "../derivation/transactionHash.js";
import { transactionSignaturePreimage } from "../transaction/preimage.js";
import { pubkeySignatureEnvelopeBytes } from "../transaction/size.js";
import {
  WalletProviderError,
  type WalletProviderErrorCode,
  type WalletAccount,
  type WalletSession,
  type WalletCapabilities,
  type WalletProvider,
  type WalletProviderInfo,
  type ProviderRequest,
  type SignTransactionResult,
  type SubmitTransactionResult,
} from "./types.js";

/** Maximum decoded signed XDR size: 1,048,576 bytes (1 MiB). */
export const MAX_TRANSACTION_BYTES = 1_048_576;
/**
 * Maximum unsigned XDR size: 1,048,460 bytes. Providers must enforce this before
 * requesting user approval. Reserves 116 bytes within {@link MAX_TRANSACTION_BYTES}
 * for the Ed25519 pubkey envelope: the signature vector count, key ID, scheme,
 * and 64-byte signature, plus the present `pubkey_claim_key` option holding the
 * scheme-tagged 32-byte key.
 */
export const MAX_UNSIGNED_TRANSACTION_BYTES =
  MAX_TRANSACTION_BYTES -
  pubkeySignatureEnvelopeBytes(CryptographicScheme.Ed25519);
/** Maximum accounts in one session. */
export const MAX_WALLET_ACCOUNTS = 32;
/** Current native DefaultWallet execute call limit. */
export const MAX_DEFAULT_WALLET_CALLS = 16;

/** Validate scoped DefaultWallet capabilities. Does not establish authorization. */
export function parseWalletCapabilities(value: unknown): WalletCapabilities {
  const data = record(value);
  fields(data, ["account", "networkHash", "atomicBatch"]);
  const account = parseWalletHex32(data.account);
  const networkHash = parseWalletNetworkHash(data.networkHash);
  if (data.atomicBatch === null)
    return { account, networkHash, atomicBatch: null };
  const batch = record(data.atomicBatch);
  fields(batch, ["maxCalls"]);
  const maxCalls = batch.maxCalls;
  if (
    typeof maxCalls !== "number" ||
    !Number.isSafeInteger(maxCalls) ||
    maxCalls < 1 ||
    maxCalls > MAX_DEFAULT_WALLET_CALLS
  )
    invalid("Invalid DefaultWallet batch call limit");
  return { account, networkHash, atomicBatch: { maxCalls } };
}

function invalid(message: string): never {
  throw new WalletProviderError(-32602, message);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid("Expected an object");
  }
  return value as Record<string, unknown>;
}

function fields(
  value: Record<string, unknown>,
  names: readonly string[],
): void {
  const keys = Object.keys(value);
  if (
    keys.length !== names.length ||
    !keys.every((key) => names.includes(key))
  ) {
    invalid("Unexpected or missing fields");
  }
}

/** Validate a canonical 32-byte 0x-prefixed address, key, or hash. */
export function parseWalletHex32(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length !== 66 ||
    !/^0x[0-9a-f]{64}$/.test(value)
  ) {
    invalid("Expected 32-byte lowercase 0x hex");
  }
  return value;
}

/** Validate the environment-compatible network hash (no 0x prefix). */
export function parseWalletNetworkHash(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length !== 64 ||
    !/^[0-9a-f]{64}$/.test(value)
  ) {
    invalid("Expected 64 lowercase network hash hex characters without 0x");
  }
  return value;
}

/**
 * Validate and freeze an account snapshot, including a non-small-order, prime-order
 * Ed25519 key and its derived address. The nonce is canonical decimal u64 account
 * derivation data, not a transaction nonce. Rejects extra fields and noncanonical
 * values rather than normalizing them; malformed input throws code -32602.
 */
export function parseWalletAccount(value: unknown): WalletAccount {
  const data = record(value);
  fields(data, ["address", "publicKey", "nonce"]);
  const address = parseWalletHex32(data.address);
  const publicKey = parseWalletHex32(data.publicKey);
  const nonce = data.nonce;
  if (
    typeof nonce !== "string" ||
    nonce.length > 20 ||
    nonce.trim() !== nonce ||
    !/^(0|[1-9][0-9]*)$/.test(nonce) ||
    BigInt(nonce) > 0xffff_ffff_ffff_ffffn
  ) {
    invalid("Expected a canonical decimal u64 account nonce");
  }
  const key = ed25519PublicKey(fromHex(publicKey.slice(2)));
  try {
    const point = Point.fromBytes(key, false);
    if (point.isSmallOrder() || !point.isTorsionFree()) {
      invalid("Invalid Ed25519 public key");
    }
  } catch {
    invalid("Invalid Ed25519 public key");
  }
  const derived = derivePubkeyAccountAddress(
    pubkeyAccountPreimage(
      { scheme: CryptographicScheme.Ed25519, ed25519: key },
      BigInt(nonce),
    ),
  );
  if (toHex0x(derived) !== address)
    invalid("Account address derivation mismatch");
  return Object.freeze({ address, publicKey, nonce });
}

/**
 * Strictly validate a session and return a frozen snapshot with frozen accounts.
 * Requires a canonical network hash and at most {@link MAX_WALLET_ACCOUNTS} unique
 * account addresses. Empty accounts are valid for an unauthorized origin; this
 * parser does not enforce the nonempty result required by a successful `connect`.
 */
export function parseWalletSession(value: unknown): WalletSession {
  const data = record(value);
  fields(data, ["networkHash", "accounts"]);
  const networkHash = parseWalletNetworkHash(data.networkHash);
  const inputAccounts = data.accounts;
  if (
    !Array.isArray(inputAccounts) ||
    inputAccounts.length > MAX_WALLET_ACCOUNTS
  ) {
    invalid("Expected at most 32 wallet accounts");
  }
  const accounts = Array.from(inputAccounts, parseWalletAccount);
  if (
    new Set(accounts.map((account) => account.address)).size !== accounts.length
  ) {
    invalid("Duplicate wallet account");
  }
  return Object.freeze({ networkHash, accounts: Object.freeze(accounts) });
}

/** Validate bounded display metadata; never render provider names as HTML. */
export function parseWalletProviderInfo(value: unknown): WalletProviderInfo {
  const data = record(value);
  fields(data, ["id", "name", "version"]);
  const { id, name, version } = data;
  if (
    typeof id !== "string" ||
    id.trim() !== id ||
    !/^[a-zA-Z0-9._-]{1,64}$/.test(id)
  ) {
    invalid("Invalid provider ID");
  }
  if (
    typeof name !== "string" ||
    name.length < 1 ||
    name.length > 80 ||
    name.trim() !== name ||
    /[\u0000-\u001f\u007f-\u009f]/.test(name)
  ) {
    invalid("Invalid provider name");
  }
  if (version !== "1.0.0") invalid("Unsupported provider version");
  return Object.freeze({ id, name, version });
}

/**
 * Validate a provider's structural boundary and return the original live object.
 * Preserves identity and method receivers; metadata is validated, not snapshotted.
 * Unlike {@link parseWalletAccount} and {@link parseWalletSession}, this does not
 * freeze the input. Checks versioned metadata and callable `request`/`on` members,
 * not their behavior, permissions, returned values, or the provider's trustworthiness.
 */
export function parseWalletProvider(value: unknown): WalletProvider {
  const data = record(value);
  parseWalletProviderInfo(data.info);
  if (
    data.supportedMethods !== undefined &&
    (!Array.isArray(data.supportedMethods) ||
      data.supportedMethods.length > 32 ||
      Array.from(data.supportedMethods).some(
        (method) => typeof method !== "string",
      ))
  )
    invalid("Invalid optional provider methods");
  if (typeof data.request !== "function" || typeof data.on !== "function") {
    invalid("Invalid wallet provider methods");
  }
  return value as WalletProvider;
}

/**
 * Reconstruct a serialized provider error, without relying on `instanceof`.
 * Requires a recognized {@link WalletProviderErrorCode} and a message of at most
 * 1,024 characters. Invalid errors throw a new error with code -32602.
 */
export function parseWalletProviderError(value: unknown): WalletProviderError {
  const { code, message } = record(value);
  const codes: readonly unknown[] = [
    4001, 4100, 4200, 4900, 4901, -32602, -32603, -32002,
  ];
  if (
    !codes.includes(code) ||
    typeof message !== "string" ||
    message.length > 1024
  ) {
    invalid("Invalid provider error");
  }
  return new WalletProviderError(code as WalletProviderErrorCode, message);
}

function transactionBytes(value: unknown, maxBytes: number): Uint8Array {
  if (
    typeof value !== "string" ||
    value.length > 2 + maxBytes * 2 ||
    value.length <= 2 ||
    value.length % 2 !== 0 ||
    value.trim() !== value ||
    !/^0x[0-9a-f]+$/.test(value)
  ) {
    invalid(`Expected canonical transaction hex of at most ${maxBytes} bytes`);
  }
  return fromHex(value.slice(2));
}

/**
 * Decode bounded canonical unsigned XDR, rejecting trailing or altered encodings.
 * Accepts lowercase, even-length, 0x-prefixed hex within
 * {@link MAX_UNSIGNED_TRANSACTION_BYTES}; providers must check this before approval.
 * Does not establish account authorization; use {@link assertWalletTransaction}
 * to check the transaction's account claim and enforce origin permission separately.
 */
export function parseTransactionHex(value: unknown): Transaction {
  const bytes = transactionBytes(value, MAX_UNSIGNED_TRANSACTION_BYTES);
  try {
    const tx = deserialize(bytes, codec.Transaction);
    if (toHex0x(serialize(tx, codec.Transaction)) !== value)
      invalid("Noncanonical XDR");
    return tx;
  } catch {
    invalid("Invalid canonical unsigned transaction XDR");
  }
}

/** Decode bounded canonical signed XDR; signature verification is separate. */
export function parseSignedTransactionHex(value: unknown): SignedTransaction {
  const bytes = transactionBytes(value, MAX_TRANSACTION_BYTES);
  try {
    const signed = deserialize(bytes, codec.SignedTransaction);
    if (toHex0x(serialize(signed, codec.SignedTransaction)) !== value)
      invalid("Noncanonical XDR");
    return signed;
  } catch {
    invalid("Invalid canonical signed transaction XDR");
  }
}

/**
 * Parse the exact request union into a new request object, including bounded,
 * canonical XDR. Unknown methods fail with 4200; malformed known requests fail
 * with -32602. This validates input, not origin permission or prior approval.
 * Bridges must bound raw messages before JSON parsing: at most 2,096,922 unsigned
 * or 2,097,154 signed transaction-hex characters, including 0x.
 */
export function parseProviderRequest(value: unknown): ProviderRequest {
  const data = record(value);
  const method = data.method;
  if (typeof method !== "string") invalid("Expected a request method");
  switch (method) {
    case "connect":
    case "getSession":
    case "disconnect":
      fields(data, ["method"]);
      return { method };
    case "getCapabilities": {
      fields(data, ["method", "params"]);
      const params = record(data.params);
      fields(params, ["account", "networkHash"]);
      return {
        method,
        params: {
          account: parseWalletHex32(params.account),
          networkHash: parseWalletNetworkHash(params.networkHash),
        },
      };
    }
    case "signTransaction":
    case "submitTransaction": {
      fields(data, ["method", "params"]);
      const params = record(data.params);
      const payload =
        method === "signTransaction" ? "transaction" : "signedTransaction";
      fields(params, ["account", "networkHash", payload]);
      const account = parseWalletHex32(params.account);
      const networkHash = parseWalletNetworkHash(params.networkHash);
      if (method === "signTransaction") {
        const transaction = params.transaction;
        parseTransactionHex(transaction);
        return {
          method,
          params: {
            account,
            networkHash,
            transaction: transaction as string,
          },
        };
      }
      const signedTransaction = params.signedTransaction;
      parseSignedTransactionHex(signedTransaction);
      return {
        method,
        params: {
          account,
          networkHash,
          signedTransaction: signedTransaction as string,
        },
      };
    }
    default:
      throw new WalletProviderError(4200, "Unsupported wallet provider method");
  }
}

/**
 * Validate a signing response's wire structure and return a new result object.
 * Checks canonical signed XDR and hash encoding, not signature, hash correctness,
 * or approval. Use {@link verifySignTransactionResult} for cryptographic validation.
 */
export function parseSignTransactionResult(
  value: unknown,
): SignTransactionResult {
  const data = record(value);
  fields(data, ["signedTransaction", "hash"]);
  const { signedTransaction, hash } = data;
  parseSignedTransactionHex(signedTransaction);
  return {
    signedTransaction: signedTransaction as string,
    hash: parseWalletHex32(hash),
  };
}

/**
 * Validate a submission response's hash encoding and return a new result object.
 * Does not compare the hash to approved bytes or confirm broadcast or execution.
 */
export function parseSubmitTransactionResult(
  value: unknown,
): SubmitTransactionResult {
  const data = record(value);
  fields(data, ["hash"]);
  return { hash: parseWalletHex32(data.hash) };
}

/** Require the root address and complete pubkey claim to match a wire account. */
export function assertWalletTransaction(
  tx: Transaction,
  account: WalletAccount,
): void {
  const expected = parseWalletAccount(account);
  const claim = tx.auth_claim;
  if (
    toHex0x(tx.invocation.invoked_address) !== expected.address ||
    claim.claim_type !== AuthClaimType.kPubkeySignature ||
    toHex0x(claim.pubkey_preimage.pubkey_hash) !==
      toHex0x(derivePublicKeyHash(walletPublicKey(expected))) ||
    claim.pubkey_preimage.nonce !== BigInt(expected.nonce)
  ) {
    throw new WalletProviderError(
      4100,
      "Transaction does not authorize the selected wallet account",
    );
  }
}

function walletPublicKey(account: WalletAccount): PublicKey {
  return {
    scheme: CryptographicScheme.Ed25519,
    ed25519: ed25519PublicKey(fromHex(account.publicKey.slice(2))),
  };
}

/**
 * Verify unchanged XDR, a single strict network-bound signature, and receipt hash.
 * Requires the exact unsigned transaction bytes and matching root address/pubkey
 * claim, and an attached `pubkey_claim_key` equal to the account's Ed25519 key.
 * The signature must be Ed25519 with public-key ID zero, verified over
 * `transactionSignaturePreimage(networkHash, tx)` with ZIP-215 disabled and both
 * key and signature point R non-small-order and prime-order. The hash is SHA-256
 * of unsigned XDR, excluding signatures and network.
 *
 * @param networkHash - 64 lowercase hex characters without 0x, from the authorized session.
 * @returns A frozen verified result. This does not establish origin permission
 * or a retained approval to submit; the provider must enforce both separately.
 *
 * @remarks
 * Requires Web Crypto (HTTPS or localhost in browsers). Invalid signing results
 * throw code -32603; invalid expected inputs fail their boundary validation first.
 *
 * @see https://docs.thruput.network/tools/wallet-provider/
 */
export async function verifySignTransactionResult(
  value: unknown,
  transaction: string,
  account: WalletAccount,
  networkHash: string,
): Promise<SignTransactionResult> {
  const expected = parseWalletAccount(account);
  const network = toNetworkHash(
    sha256Hash(fromHex(parseWalletNetworkHash(networkHash))),
  );
  const tx = parseTransactionHex(transaction);
  assertWalletTransaction(tx, expected);
  try {
    const result = parseSignTransactionResult(value);
    const signed = parseSignedTransactionHex(result.signedTransaction);
    if (toHex0x(serialize(signed.tx, codec.Transaction)) !== transaction) {
      throw new Error("Provider altered unsigned transaction bytes");
    }
    const signature = signed.signatures[0];
    if (
      signed.signatures.length !== 1 ||
      !signature ||
      signature.public_key_id !== 0n ||
      signature.signature.scheme !== CryptographicScheme.Ed25519
    ) {
      throw new Error("Expected one Ed25519 signature with public-key ID zero");
    }
    const claimKey = signed.pubkey_claim_key;
    if (
      !claimKey ||
      claimKey.scheme !== CryptographicScheme.Ed25519 ||
      toHex0x(claimKey.ed25519) !== expected.publicKey
    ) {
      throw new Error("Expected the account's Ed25519 key as pubkey_claim_key");
    }
    // Noble's strict mode still uses a cofactored equation; reject torsion in R.
    const r = Point.fromBytes(
      signature.signature.ed25519.subarray(0, 32),
      false,
    );
    if (
      r.isSmallOrder() ||
      !r.isTorsionFree() ||
      !(await verifyAsync(
        signature.signature.ed25519,
        transactionSignaturePreimage(network, tx),
        fromHex(expected.publicKey.slice(2)),
        { zip215: false },
      ))
    ) {
      throw new Error("Invalid provider transaction signature");
    }
    if (result.hash !== toHex0x(hashSignedTransaction(signed))) {
      throw new Error("Provider transaction hash mismatch");
    }
    return Object.freeze(result);
  } catch {
    throw new WalletProviderError(
      -32603,
      "Invalid provider signing result: bytes, signature, or hash mismatch",
    );
  }
}
