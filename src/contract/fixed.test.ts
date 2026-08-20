import { describe, expect, it } from "vitest";
import { fixedArray, fixedBytes } from "./fixed.js";

describe("fixedBytes", () => {
  it("returns the original bytes when the length matches", () => {
    const value = Uint8Array.of(1, 2, 3);

    expect(fixedBytes(value, 3)).toBe(value);
  });

  it("rejects a mismatched length", () => {
    expect(() => fixedBytes(Uint8Array.of(1, 2), 3)).toThrow(
      "FixedBytes expected length 3, got 2",
    );
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid expected length %s",
    (length) => {
      expect(() => fixedBytes(new Uint8Array(), length)).toThrow(
        "FixedBytes length must be a non-negative safe integer",
      );
    },
  );
});

describe("fixedArray", () => {
  it("returns an immutable copy when the length matches", () => {
    const value = ["a", "b"];
    const fixed = fixedArray(value, 2);

    expect(fixed).toEqual(value);
    expect(fixed).not.toBe(value);
    value.push("c");
    expect(fixed).toHaveLength(2);
    expect(Object.isFrozen(fixed)).toBe(true);
  });

  it("accepts an empty array with zero length", () => {
    expect(fixedArray([], 0)).toEqual([]);
  });

  it("rejects a mismatched length", () => {
    expect(() => fixedArray([1], 2)).toThrow(
      "FixedArray expected length 2, got 1",
    );
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid expected length %s",
    (length) => {
      expect(() => fixedArray([], length)).toThrow(
        "FixedArray length must be a non-negative safe integer",
      );
    },
  );
});
