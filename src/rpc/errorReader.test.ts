import { describe, expect, it } from "vitest";
import { codec, deserialize } from "@thruputchain/protocol";
import vectors from "../../specs/test-vectors/pubkey_auth.json";
import { fromHex0x, toHex0x } from "../actions/hex.js";
import { toBase58 } from "../encoding.js";
import { hashSignedTransaction } from "../derivation/transactionHash.js";
import { decodeRpcError } from "./errorReader.js";
import { UnsupportedRpcValue } from "./codec.js";

const bytes = fromHex0x("0x" + vectors.signing[0]!.signed_transaction_xdr);
const hash = hashSignedTransaction(deserialize(bytes, codec.SignedTransaction));
const transactionHash = toBase58(hash);
const otherHash = toBase58(new Uint8Array(32).fill(2));
const receipt = {
  transactionHash,
  blockHeight: "5",
  execution: { result: "return", returnData: "0x" },
  events: [],
  gasUsed: "7",
};
const cases = [
  [
    "getVersionInfo",
    -32602,
    { kind: "invalidParams", reason: "futureReason", path: "/~0a~1b" },
  ],
  ["getEvents", -32602, { kind: "invalidCursor", reason: "queryMismatch" }],
  [
    "sendTransaction",
    -32000,
    {
      kind: "transactionInvalid",
      admission: "notAttempted",
      transactionHash,
      detail: { reason: "futureBound", n: 8 },
    },
  ],
  [
    "sendTransaction",
    -32001,
    {
      kind: "transactionRejected",
      admission: "rejected",
      error: { source: "futureSubsystem", code: 12 },
    },
  ],
  [
    "simulateInvocation",
    -32012,
    {
      kind: "stateHeightUnavailable",
      requestedStateBlockHeight: "8",
      observedStateBlockHeight: "4",
    },
  ],
  [
    "getEvents",
    -32013,
    {
      kind: "historyUnavailable",
      oldestIndexedBlockHeight: "4",
      reason: "outsideRetention",
    },
  ],
  [
    "faucet_requestAirdrop",
    -32030,
    {
      kind: "fundingAttemptStopped",
      transactionHash,
      signedTransaction: toHex0x(bytes),
      receipt,
      serviceCode: "🦔".repeat(128),
    },
  ],
  [
    "dev_fundAccount",
    -32031,
    {
      kind: "localFundingUnresolved",
      transactionHash,
      signedTransaction: toHex0x(bytes),
      cause: {
        kind: "fundingAttemptStopped",
        transactionHash,
        receipt,
        serviceCode: "stopped",
      },
    },
  ],
  [
    "getChainTip",
    -32050,
    { kind: "backendUnavailable", retryAfterMs: "18446744073709551615" },
  ],
  [
    "sendTransaction",
    -32051,
    { kind: "backendTimeout", admission: "unknown", transactionHash },
  ],
  [
    "sendTransaction",
    -32053,
    {
      kind: "overloaded",
      admission: "notAttempted",
      error: { source: "scheduler", code: 4 },
    },
  ],
  [
    "getTransactionReceipt",
    -32054,
    {
      kind: "backendDataInvalid",
      reason: "inconsistentResult",
      observation: { transactionHash, blockHeight: "5" },
    },
  ],
] as const;

describe("native error interpretation", () => {
  it.each(cases)(
    "decodes %s error %i while retaining its entire raw object",
    (method, code, data) => {
      const raw = { code, message: "failure", data, future: { keep: true } };
      const decoded = decodeRpcError(method, raw, hash);
      expect(decoded.classification).toBe("known");
      expect(decoded.raw).toBe(raw);
      if (decoded.classification === "known") {
        if (decoded.data.kind === "invalidParams")
          expect(decoded.data.reason).toBe("futureReason");
        if (decoded.data.kind === "transactionInvalid")
          expect(decoded.data.detail).toBeInstanceOf(UnsupportedRpcValue);
        if (decoded.data.kind === "transactionRejected")
          expect(decoded.data.error?.source).toBeInstanceOf(
            UnsupportedRpcValue,
          );
        if (decoded.data.kind === "backendUnavailable")
          expect(decoded.data.retryAfterMs).toBe(18446744073709551615n);
      }
    },
  );
  it.each([
    ["sendTransaction", -32051, { kind: "backendTimeout" }],
    [
      "sendTransaction",
      -32051,
      { kind: "backendTimeout", admission: "accepted" },
    ],
    [
      "sendTransaction",
      -32051,
      {
        kind: "backendTimeout",
        admission: "notAttempted",
        transactionHash: otherHash,
      },
    ],
    [
      "sendTransaction",
      -32000,
      { kind: "transactionInvalid", admission: "rejected" },
    ],
    [
      "sendTransaction",
      -32001,
      { kind: "transactionRejected", admission: "unknown" },
    ],
    [
      "sendTransaction",
      -32000,
      {
        kind: "transactionInvalid",
        admission: "notAttempted",
        detail: { reason: "tooManyContracts", attached: 1 },
      },
    ],
    ["getChainTip", -32051, { kind: "backendTimeout", admission: null }],
    ["getChainTip", -32051, { kind: "backendUnavailable" }],
    ["getChainTip", -32051, { kind: "backendTimeout", retryAfterMs: 5 }],
    ["getChainTip", -32051, { kind: "backendTimeout", retryAfterMs: "01" }],
    [
      "getChainTip",
      -32051,
      { kind: "backendTimeout", retryAfterMs: "18446744073709551616" },
    ],
    ["getBlockByHeight", -32602, { kind: "invalidCursor" }],
    ["getEvents", -32602, { kind: "invalidCursor", reason: null }],
    ["getEvents", -32602, { kind: "invalidCursor", path: "/bad~2escape" }],
    [
      "getTransactionStatus",
      -32054,
      {
        kind: "backendDataInvalid",
        observation: { transactionHash, blockHeight: "5" },
      },
    ],
    [
      "getTransactionReceipt",
      -32054,
      {
        kind: "backendDataInvalid",
        observation: { transactionHash: otherHash, blockHeight: "5" },
      },
    ],
    [
      "getTransactionReceipt",
      -32054,
      {
        kind: "backendDataInvalid",
        observation: { transactionHash, blockHeight: "-1" },
      },
    ],
    [
      "faucet_requestAirdrop",
      -32031,
      {
        kind: "localFundingUnresolved",
        transactionHash,
        signedTransaction: toHex0x(bytes),
      },
    ],
    [
      "faucet_requestAirdrop",
      -32030,
      { kind: "fundingAttemptStopped", signedTransaction: toHex0x(bytes) },
    ],
    [
      "faucet_requestAirdrop",
      -32030,
      {
        kind: "fundingAttemptStopped",
        transactionHash,
        receipt: { ...receipt, transactionHash: otherHash },
      },
    ],
    [
      "faucet_requestAirdrop",
      -32030,
      {
        kind: "fundingAttemptStopped",
        transactionHash,
        signedTransaction: "0x01",
      },
    ],
    [
      "faucet_requestAirdrop",
      -32030,
      {
        kind: "fundingAttemptStopped",
        transactionHash: otherHash,
        signedTransaction: toHex0x(bytes),
      },
    ],
    [
      "faucet_requestAirdrop",
      -32030,
      { kind: "fundingAttemptStopped", serviceCode: "x".repeat(129) },
    ],
    [
      "dev_fundAccount",
      -32031,
      {
        kind: "localFundingUnresolved",
        transactionHash,
        signedTransaction: toHex0x(bytes),
        cause: { kind: "fundingAttemptStopped", transactionHash: otherHash },
      },
    ],
    [
      "dev_fundAccount",
      -32031,
      {
        kind: "localFundingUnresolved",
        transactionHash,
        signedTransaction: toHex0x(bytes),
        cause: { kind: "fundingAttemptStopped", admission: "unknown" },
      },
    ],
  ] as const)(
    "keeps contradictory %s error %i unclassified",
    (method, code, data) => {
      const raw = { code, message: "failure", data };
      expect(decodeRpcError(method, raw, hash)).toEqual({
        classification: "unclassified",
        raw,
      });
    },
  );
  it("preserves framework and unknown objects without interpreting them", () => {
    for (const raw of [
      { code: -32601, message: "missing" },
      { code: -31999, message: "future", data: { kind: "future" } },
      null,
    ])
      expect(decodeRpcError("sendTransaction", raw)).toEqual({
        classification: "unclassified",
        raw,
      });
  });
});
