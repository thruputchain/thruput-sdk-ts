import { describe, expect, it } from "vitest";
import { formatUnits, parseUnits, ParseUnitsError } from "./units.js";

describe("exact unit conversion", () => {
  it.each([
    ["0", 7, 0n, "0"],
    ["-0.00", 2, 0n, "0"],
    ["0012.050", 3, 12050n, "12.05"],
    ["-12.05", 2, -1205n, "-12.05"],
    ["0.0000001", 7, 1n, "0.0000001"],
    ["-0.001", 3, -1n, "-0.001"],
    ["9007199254740993", 0, 9007199254740993n, "9007199254740993"],
  ] as const)(
    "converts %s at %s decimals",
    (text, decimals, value, formatted) => {
      expect(parseUnits(text, decimals)).toBe(value);
      expect(formatUnits(value, decimals)).toBe(formatted);
    },
  );

  it.each([0, 7, 18, 255])(
    "round-trips arbitrary-size values at %s decimals",
    (decimals) => {
      for (const value of [0n, 1n, -1n, 2n ** 256n, -(2n ** 256n)]) {
        expect(parseUnits(formatUnits(value, decimals), decimals)).toBe(value);
      }
    },
  );

  it.each([
    "",
    " ",
    "1 ",
    " 1",
    "1\n",
    "1e3",
    "1,000",
    "+1",
    ".5",
    "1.",
    "--1",
    "NaN",
  ])("rejects malformed input %j", (text) => {
    expect(() => parseUnits(text, 7)).toThrow(ParseUnitsError);
    expect(() => parseUnits(text, 7)).toThrow(
      expect.objectContaining({ code: "malformed" }),
    );
  });

  it.each([
    ["1.001", 2],
    ["1.00", 1],
    ["1.0", 0],
  ] as const)("rejects excess precision in %s", (text, decimals) => {
    expect(() => parseUnits(text, decimals)).toThrow(
      expect.objectContaining({ code: "precision" }),
    );
  });

  it.each([-1, 256, 0.5, NaN, Infinity])(
    "rejects invalid decimals %s",
    (decimals) => {
      expect(() => parseUnits("1", decimals)).toThrow(RangeError);
      expect(() => formatUnits(1n, decimals)).toThrow(RangeError);
    },
  );

  it("rejects numbers passed at runtime rather than silently losing precision", () => {
    expect(() => parseUnits(1 as never, 7)).toThrow(ParseUnitsError);
    expect(() => formatUnits(1 as never, 7)).toThrow(TypeError);
  });
});
