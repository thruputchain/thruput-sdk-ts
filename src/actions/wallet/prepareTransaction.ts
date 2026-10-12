import {
  blockHeight,
  codec,
  deserialize,
  serialize,
  type BlockHeight,
  type Contract,
  type Invocation,
  type Transaction,
} from "@thruputchain/protocol";
import type { CoreThruputClient } from "../../client.js";
import type { WalletAccount } from "../../wallet/account.js";
import { createTransaction } from "../../transaction/build.js";

const int64Max = 0x7fff_ffff_ffff_ffffn;
const uint64Max = 0xffff_ffff_ffff_ffffn;
const defaultExpiryBlocks = 100n;

/** Inputs for preparing one wallet-authorized transaction. */
export interface PrepareTransactionRequest {
  /** Explicit root invocation. Smart-wallet wrapping is caller-controlled. */
  readonly invocation: Invocation;
  readonly contractsToDeploy?: readonly Contract[];
  readonly nonce?: bigint;
  readonly blockExpiryHeight?: BlockHeight;
  readonly expiryBlocks?: bigint;
}

/** Prepare an unsigned transaction for a wallet account. */
export async function prepareTransaction(
  client: Pick<CoreThruputClient, "getChainTip">,
  account: Pick<WalletAccount, "address" | "authClaim">,
  request: PrepareTransactionRequest,
): Promise<Transaction> {
  const invocation = deserialize(
    serialize(request.invocation, codec.Invocation),
    codec.Invocation,
  );
  const contractsToDeploy = (request.contractsToDeploy ?? []).map((contract) =>
    deserialize(serialize(contract, codec.Contract), codec.Contract),
  );
  const authClaim = deserialize(
    serialize(account.authClaim, codec.AuthClaim),
    codec.AuthClaim,
  );

  if (!bytesEqual(invocation.invoked_address, account.address)) {
    throw new Error("Root invocation address must match the wallet account");
  }
  if (
    request.blockExpiryHeight !== undefined &&
    request.expiryBlocks !== undefined
  ) {
    throw new Error(
      "blockExpiryHeight and expiryBlocks are mutually exclusive",
    );
  }

  const nonce = request.nonce ?? randomUint64();
  validateRange(nonce, 0n, uint64Max, "nonce");

  let expiry: bigint;
  if (request.blockExpiryHeight !== undefined) {
    expiry = request.blockExpiryHeight;
    validateRange(expiry, 0n, int64Max, "blockExpiryHeight");
  } else {
    const expiryBlocks = request.expiryBlocks ?? defaultExpiryBlocks;
    validateRange(expiryBlocks, 1n, int64Max, "expiryBlocks");
    const tip = await client.getChainTip();
    expiry = tip.height + expiryBlocks;
    validateRange(expiry, 0n, int64Max, "blockExpiryHeight");
  }

  return createTransaction({
    invocation,
    uniquifier: {
      block_expiry_height: blockHeight(expiry),
      nonce,
    },
    contracts_to_deploy: contractsToDeploy,
    auth_claim: authClaim,
  });
}

function randomUint64(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getBigUint64(0);
}

function validateRange(
  value: bigint,
  min: bigint,
  max: bigint,
  name: string,
): void {
  if (typeof value !== "bigint" || value < min || value > max) {
    throw new RangeError(`${name} must be between ${min} and ${max}`);
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  return left.every((byte, index) => byte === right[index]);
}
