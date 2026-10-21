import { NativeRpcErrorCode } from "../rpc/errors.js";
import { NativeRpcError } from "../rpc/errorReader.js";
import { describe, expect, it } from "vitest";
import { JsonRpcError } from "./http.js";
import { txInvalidDetail } from "./txInvalidDetail.js";

function txInvalid(data: unknown): JsonRpcError {
  return new NativeRpcError(
    new JsonRpcError(
      NativeRpcErrorCode.TransactionInvalid,
      "Invalid transaction",
      { kind: "transactionInvalid", admission: "notAttempted", detail: data },
    ),
    "sendTransaction",
  );
}

describe("txInvalidDetail", () => {
  it.each([
    { reason: "tooManyContracts", attached: 5, max: 4 },
    {
      reason: "contractTooLarge",
      index: 1,
      sizeBytes: 70_000,
      maxBytes: 65_536,
    },
    { reason: "duplicateContract", index: 2, firstIndex: 0 },
    {
      reason: "rv32MemoryTooLarge",
      index: 0,
      memoryBytes: 1 << 20,
      maxBytes: 65_536,
    },
    {
      reason: "rv32CodeTooLarge",
      index: 0,
      codeBytes: 200_000,
      maxBytes: 131_072,
    },
  ])("reads the $reason bound", (detail) => {
    expect(txInvalidDetail(txInvalid(detail))).toEqual(detail);
  });

  it("preserves additive fields alongside validated known evidence", () => {
    expect(
      txInvalidDetail(
        txInvalid({
          reason: "duplicateContract",
          index: 2,
          firstIndex: 0,
          extra: 1,
        }),
      ),
    ).toEqual({
      reason: "duplicateContract",
      index: 2,
      firstIndex: 0,
      extra: 1,
    });
  });

  it.each([
    [
      "another error code",
      new JsonRpcError(NativeRpcErrorCode.TransactionRejected, "x", {
        reason: "tooManyContracts",
        attached: 5,
        max: 4,
      }),
    ],
    ["a non-RPC error", new Error("boom")],
    ["no data", txInvalid(undefined)],
    ["a string payload", txInvalid("malformed XDR")],
    ["an unknown reason", txInvalid({ reason: "somethingNew", index: 0 })],
    ["a missing field", txInvalid({ reason: "tooManyContracts", attached: 5 })],
    [
      "a negative field",
      txInvalid({ reason: "tooManyContracts", attached: -1, max: 4 }),
    ],
    [
      "a fractional field",
      txInvalid({ reason: "tooManyContracts", attached: 1.5, max: 4 }),
    ],
    ["an inherited reason", txInvalid({ reason: "toString" })],
  ])("returns null for %s", (_, error) => {
    expect(txInvalidDetail(error)).toBeNull();
  });
});
