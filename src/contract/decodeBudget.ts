import type { XdrCodec } from "@thruputchain/xdr";

type Reader = Parameters<XdrCodec<unknown>["decode"]>[0];
const budgets = new WeakMap<Reader, { remaining: number; depth: number }>();
type Writer = Parameters<XdrCodec<unknown>["encode"]>[0];
const encodeDepth = new WeakMap<Writer, number>();

// Charge value codecs, not aliases: named definitions own one wrapper, and
// resolveCodec does not wrap their references again. Options and containers
// each count as a value level. Opaque byte buffers remain a single value.
// Allow small zero-width values and ordinary container overhead, but cap total
// work even for large inputs. Each new reader gets its own budget.
function budgetFor(reader: Reader) {
  let budget = budgets.get(reader);
  if (!budget) {
    budget = {
      remaining: Math.min(100_000, 1024 + 16 * reader.remaining),
      depth: 0,
    };
    budgets.set(reader, budget);
  }
  return budget;
}

export function checkDecodeCapacity(reader: Reader, count: number): void {
  if (count > budgetFor(reader).remaining) {
    throw new Error("Contract decode work budget exceeded");
  }
}

export function withDecodeBudget<T>(codec: XdrCodec<T>): XdrCodec<T> {
  return {
    encode(writer, value) {
      const depth = encodeDepth.get(writer) ?? 0;
      if (depth >= 128) throw new Error("Contract encode depth limit exceeded");
      encodeDepth.set(writer, depth + 1);
      try {
        codec.encode(writer, value);
      } finally {
        encodeDepth.set(writer, depth);
      }
    },
    decode(reader) {
      const budget = budgetFor(reader);
      checkDecodeCapacity(reader, 1);
      if (budget.depth >= 128) {
        throw new Error("Contract decode depth limit exceeded");
      }
      budget.remaining--;
      budget.depth++;
      try {
        return codec.decode(reader);
      } finally {
        budget.depth--;
      }
    },
  };
}
