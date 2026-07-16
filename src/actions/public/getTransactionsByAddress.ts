import type { Transport } from "../../transport/types.js";
import type {
  AddressTransactionQuery,
  TransactionRef,
  TransactionRefPage,
} from "../../types/rpc.js";
import { fromHex0x, hashFromHex, toHex0x } from "../hex.js";

interface RawTransactionRef {
  txHash: string;
  height: number | string;
}

interface RawTransactionRefPage {
  refs: unknown[];
  cursor: string;
  latestBlock: number | string;
  oldestBlock: number | string;
}

function serializeQuery(query: AddressTransactionQuery): unknown {
  const anchor =
    query.anchor === "beginning"
      ? { kind: "atBeginning" }
      : query.anchor === "end"
        ? { kind: "atEnd" }
        : query.anchor
          ? { kind: "atHeight", height: Number(query.anchor.height) }
          : { kind: "atBeginning" };

  return {
    address: toHex0x(query.address),
    order: query.order ?? "ascending",
    anchor,
    cursor: query.cursor ? toHex0x(query.cursor) : "0x",
    limit: query.limit ?? 50,
  };
}

function parseTransactionRef(value: unknown): TransactionRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid transaction refs response: expected ref");
  }
  const ref = value as RawTransactionRef;

  return {
    txHash: hashFromHex(ref.txHash),
    height: BigInt(ref.height),
  };
}

/**
 * Query transaction references whose root invocation targets one address.
 *
 * Use `cursor` from the returned page to request the next page with the same
 * address and ordering.
 */
export async function getTransactionsByAddress(
  transport: Transport,
  query: AddressTransactionQuery,
): Promise<TransactionRefPage> {
  const raw = await transport.request<unknown>(
    "groundhog_getTransactionsByAddress",
    [serializeQuery(query)],
  );
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid transaction refs response");
  }
  const result = raw as RawTransactionRefPage;

  if (!Array.isArray(result.refs)) {
    throw new Error("Invalid transaction refs response: expected refs");
  }

  return {
    refs: result.refs.map(parseTransactionRef),
    cursor: fromHex0x(result.cursor),
    latestBlock: BigInt(result.latestBlock),
    oldestBlock: BigInt(result.oldestBlock),
  };
}
