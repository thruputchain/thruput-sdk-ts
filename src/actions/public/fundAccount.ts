import type { ContractAddress } from "@thruputchain/protocol";
import type {
  FundAccountRequest,
  FundAccountResponse,
} from "../../types/rpc.js";
import type {
  Transport,
  TransportRequestOptions,
} from "../../transport/types.js";
import { addressFromHex, fromHex0x, hashFromHex, toHex0x } from "../hex.js";
import { deserializeSignedTransaction } from "../../transaction/serialize.js";
import { hashSignedTransaction } from "../../derivation/transactionHash.js";

/**
 * Perform one local-only funding attempt and return its admitted signed bytes.
 *
 * Persist the request, network identity and public faucet address before calling.
 * Retry that same request after a lost response. Admission does not prove execution;
 * retain it until an authoritative receipt arrives. This action never creates a
 * nonce, retries, polls, or signs. Hosted faucets use `requestAirdrop` instead.
 */
export async function fundAccount(
  transport: Transport,
  request: FundAccountRequest,
  options: TransportRequestOptions = {},
): Promise<FundAccountResponse> {
  const recipient = copyAddress(request.recipient, "recipient");
  const faucet = copyAddress(request.faucet, "faucet");
  if (
    typeof request.rawAmount !== "bigint" ||
    request.rawAmount <= 0n ||
    request.rawAmount >= 1n << 128n
  ) {
    throw new RangeError("rawAmount must be a positive u128");
  }
  const rawAmount = request.rawAmount;
  const clientNonce = new Uint8Array(request.clientNonce);
  if (clientNonce.length < 1 || clientNonce.length > 32) {
    throw new RangeError("clientNonce must contain between 1 and 32 bytes");
  }
  const result = await transport.request<unknown>(
    "groundhog_fundAccount",
    [
      {
        recipient: toHex0x(recipient),
        faucet: toHex0x(faucet),
        rawAmount: rawAmount.toString(),
        clientNonce: toHex0x(clientNonce),
      },
    ],
    options,
  );
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Invalid local funding response");
  }
  const raw = result as Record<string, unknown>;
  if (
    raw.recipient !== toHex0x(recipient) ||
    raw.rawAmount !== rawAmount.toString()
  ) {
    throw new Error(
      "Local funding response does not match recipient and amount",
    );
  }
  if (
    typeof raw.txHash !== "string" ||
    !/^0x[0-9a-f]{64}$/.test(raw.txHash) ||
    typeof raw.signedTransaction !== "string" ||
    !/^0x(?:[0-9a-f]{2})+$/.test(raw.signedTransaction)
  ) {
    throw new Error("Invalid local funding transaction encoding");
  }
  const signedTransaction = fromHex0x(raw.signedTransaction);
  if (
    toHex0x(
      hashSignedTransaction(deserializeSignedTransaction(signedTransaction)),
    ) !== raw.txHash
  ) {
    throw new Error(
      "Local funding transaction hash does not match signed bytes",
    );
  }
  return {
    recipient: addressFromHex(raw.recipient as string),
    rawAmount,
    txHash: hashFromHex(raw.txHash),
    signedTransaction,
  };
}

function copyAddress(value: ContractAddress, label: string): ContractAddress {
  if (value.length !== 32) throw new RangeError(`${label} must be 32 bytes`);
  return new Uint8Array(value) as ContractAddress;
}
