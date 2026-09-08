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
  type Transaction,
  type SignedTransaction,
} from "@groundhogchain/protocol";
import { Point, verifyAsync } from "@noble/ed25519";
import { toHex0x } from "../actions/hex.js";
import { derivePubkeyAccountAddress } from "../derivation/pubkeyAccount.js";
import { hashSignedTransaction } from "../derivation/transactionHash.js";
import { transactionSignaturePreimage } from "../transaction/preimage.js";
import {
  WalletProviderError,
  type WalletProviderErrorCode,
  type WalletAccount,
  type WalletSession,
  type WalletProvider,
  type WalletProviderInfo,
  type ProviderRequest,
  type SignTransactionResult,
  type SubmitTransactionResult,
} from "./types.js";

/** Maximum decoded signed XDR size. */
export const MAX_TRANSACTION_BYTES = 1_048_576;
/** Reserve the signature vector count, key ID, scheme, and 64-byte Ed25519 signature. */
export const MAX_UNSIGNED_TRANSACTION_BYTES = MAX_TRANSACTION_BYTES - 76;
/** Maximum accounts in one session. */
export const MAX_WALLET_ACCOUNTS = 32;

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

/** Validate and snapshot an account, including Ed25519 key and address derivation. */
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
  const derived = derivePubkeyAccountAddress({
    pubkey: { scheme: CryptographicScheme.Ed25519, ed25519: key },
    nonce: BigInt(nonce),
  });
  if (toHex0x(derived) !== address)
    invalid("Account address derivation mismatch");
  return Object.freeze({ address, publicKey, nonce });
}

/** Strictly validate an origin session and return an immutable snapshot. */
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

/** Validate a provider's structural boundary, preserving its method receiver. */
export function parseWalletProvider(value: unknown): WalletProvider {
  const data = record(value);
  parseWalletProviderInfo(data.info);
  if (typeof data.request !== "function" || typeof data.on !== "function") {
    invalid("Invalid wallet provider methods");
  }
  return value as WalletProvider;
}

/** Validate a serialized provider error, without relying on instanceof. */
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

/** Decode bounded canonical unsigned XDR, rejecting trailing or altered encodings. */
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

/** Parse the exact request union; unknown methods fail with 4200. */
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

/** Validate a signing response's wire structure, not its signature or approval. */
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

/** Validate a submission response's canonical receipt hash. */
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
    claim.pubkey_preimage.pubkey.scheme !== CryptographicScheme.Ed25519 ||
    toHex0x(claim.pubkey_preimage.pubkey.ed25519) !== expected.publicKey ||
    claim.pubkey_preimage.nonce !== BigInt(expected.nonce)
  ) {
    throw new WalletProviderError(
      4100,
      "Transaction does not authorize the selected wallet account",
    );
  }
}

/** Verify unchanged XDR, a single strict network-bound signature, and receipt hash. */
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
