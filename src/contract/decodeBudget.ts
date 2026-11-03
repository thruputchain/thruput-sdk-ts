import type { XdrCodec } from "@thruputchain/xdr";

type Reader = Parameters<XdrCodec<unknown>["decode"]>[0];
const budgets = new WeakMap<Reader, { remaining: number; depth: number }>();

// Charge codec visits, not bytes: opaque byte buffers remain a single value.
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
    encode: codec.encode,
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
