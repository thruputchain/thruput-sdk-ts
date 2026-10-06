// Contract tests: assert that the JSON each public action serializes to the
// transport actually matches the gateway's declared request schema in
// `specs/openrpc.json`.
//
// Mechanism: pass a spy transport to each action.  The spy records the
// `params` array that would have been sent over JSON-RPC.  We then compile a
// validator from the matching method's parameter schema (as published in the
// openrpc spec) and assert that the captured payload validates.
//
// This is the line of defense against the class of bug fixed in #14: the
// hand-written serializer (`serializeQuery` in getEvents.ts, etc.) silently
// drifting away from the published spec when the gateway's schema changes.
// Existing per-action tests pin the shape the *code* emits; these pin the
// shape the *spec* requires.

import { describe, expect, it } from "vitest";
import Ajv, { type AnySchema, type ValidateFunction } from "ajv";
import openrpcSpec from "../../specs/openrpc.json";
import {
  AuthClaimType,
  bitMap,
  blockHeight,
  calldata,
  contractAddress,
  contractEntrypointID,
  gasAmount,
  weight,
  sha256Hash,
  networkHash,
} from "@groundhogchain/protocol";
import { getChainTip } from "./public/getChainTip.js";
import { getBalance } from "./public/getBalance.js";
import { getBlockByNumber } from "./public/getBlockByNumber.js";
import { getEvents } from "./public/getEvents.js";
import { getPendingTransactionCount } from "./public/getPendingTransactionCount.js";
import { getNetworkInfo } from "./public/getNetworkInfo.js";
import { getServerLimits } from "./public/getServerLimits.js";
import { getChainConfig } from "./public/getChainConfig.js";
import { requestAirdropAttempt } from "./public/requestAirdrop.js";
import { getStorageAt } from "./public/getStorageAt.js";
import { getTransactionReceipt } from "./public/getTransactionReceipt.js";
import { getTransactionStatus } from "./public/getTransactionStatus.js";
import { getTransactionsByAddress } from "./public/getTransactionsByAddress.js";
import { getVersion } from "./public/getVersion.js";
import { view } from "./public/view.js";
import { sendTransaction } from "./wallet/sendTransaction.js";
import { PrivateKeySigner } from "../signers/privateKey.js";
import { createInvocation, createTransaction } from "../transaction/build.js";
import { signTransaction } from "../transaction/sign.js";
import type { Transport } from "../transport/types.js";
import type { SHA256Hash, SignedTransaction } from "@groundhogchain/protocol";

// ---- ajv setup ---------------------------------------------------------

// strict:false because the OpenRPC document carries OpenRPC-specific keywords
// (description on methods, error refs, etc.) that aren't standard JSON Schema.
// logger:false silences "unknown format int64/uint32/..." warnings — the spec
// uses Rust-flavored numeric format hints that aren't standard JSON Schema
// formats; ignoring them is the correct behavior, but ajv logs noisily.
// We only care about validating the request-payload subtree.
const ajv = new Ajv({ strict: false, allErrors: true, logger: false });
ajv.addSchema({ ...openrpcSpec, $id: "openrpc" });

/**
 * Compile a validator for the `i`th positional parameter of a JSON-RPC method
 * as declared in `specs/openrpc.json`.  Returns `null` if the method declares
 * no `i`th parameter — used to assert "no extra params" on no-arg methods.
 */
function paramValidator(
  methodName: string,
  paramIndex: number,
): ValidateFunction | null {
  const method = (
    openrpcSpec as {
      methods: Array<{
        name: string;
        params: Array<{ name: string; schema: unknown }>;
      }>;
    }
  ).methods.find((m) => m.name === methodName);
  if (!method) {
    throw new Error(`method ${methodName} not present in specs/openrpc.json`);
  }
  const param = method.params[paramIndex];
  if (!param) return null;
  return ajv.compile(rebaseRefs(param.schema));
}

/**
 * Rewrite `{$ref: "#/components/schemas/Foo"}` → `{$ref: "openrpc#/components/schemas/Foo"}`
 * so the compiled wrapper resolves into the registered spec doc.  Inline
 * schemas pass through unchanged.
 */
function rebaseRefs(schema: unknown): AnySchema {
  if (
    schema &&
    typeof schema === "object" &&
    "$ref" in (schema as object) &&
    typeof (schema as { $ref?: unknown }).$ref === "string" &&
    (schema as { $ref: string }).$ref.startsWith("#/")
  ) {
    return { $ref: `openrpc${(schema as { $ref: string }).$ref}` };
  }
  return schema as AnySchema;
}

/** Build a spy transport that captures every `request()` call and replies
 *  with a caller-supplied stub.  Only suitable for tests that don't care
 *  about response parsing — that's a separate concern. */
function spyTransport<R>(stub: R): {
  transport: Transport;
  calls: Array<{ method: string; params?: unknown[] }>;
} {
  const calls: Array<{ method: string; params?: unknown[] }> = [];
  const transport: Transport = {
    async request<T = unknown>(method: string, params?: unknown[]): Promise<T> {
      calls.push({ method, params });
      return stub as unknown as T;
    },
  };
  return { transport, calls };
}

/** Methods a test below has checked, for the coverage test at the end. */
const coveredMethods = new Set<string>();

function assertCapturedParamsMatchSpec(
  methodName: string,
  captured: { method: string; params?: unknown[] } | undefined,
): void {
  // Count a method as covered only when the action really sent it.
  expect(captured?.method).toBe(methodName);
  coveredMethods.add(methodName);
  const params = captured?.params ?? [];
  const method = (
    openrpcSpec as { methods: Array<{ name: string; params: Array<unknown> }> }
  ).methods.find((m) => m.name === methodName);
  if (!method) {
    throw new Error(`method ${methodName} not present in specs/openrpc.json`);
  }
  expect(params.length).toBe(method.params.length);
  for (let i = 0; i < method.params.length; i++) {
    const validate = paramValidator(methodName, i);
    if (!validate) continue;
    const ok = validate(params[i]);
    if (!ok) {
      throw new Error(
        `${methodName} param[${i}] failed schema validation: ${ajv.errorsText(validate.errors)}`,
      );
    }
  }
}

const testNetworkHash = networkHash(sha256Hash(new Uint8Array(32).fill(0x5a)));

async function makeDummySignedTx(): Promise<SignedTransaction> {
  const secretKey = new Uint8Array(32);
  secretKey[0] = 1;
  const signer = new PrivateKeySigner(secretKey);

  const invocation = createInvocation({
    invoked_address: contractAddress(new Uint8Array(32)),
    entrypoint: contractEntrypointID(new Uint8Array(8)),
    gas_limit: gasAmount(1_000_000n),
    calldata: calldata(new Uint8Array([1, 2, 3, 4])),
  });

  const tx = createTransaction({
    invocation,
    uniquifier: {
      block_expiry_height: blockHeight(100n),
      nonce: 42n,
    },
    contracts_to_deploy: [],
    auth_claim: {
      claim_type: AuthClaimType.kSourceAddressAuthData,
      source_address_claim: {
        allowed_keys: bitMap(0xffffffffn),
        required_weight: weight(1n),
      },
    },
  });

  return signTransaction(tx, [{ signer, publicKeyId: 0n }], testNetworkHash);
}

// ---- tests -------------------------------------------------------------

describe("contract tests against specs/openrpc.json", () => {
  it("groundhog_sendRawTransaction — sends a signed transaction as hex XDR", async () => {
    const { transport, calls } = spyTransport("0x" + "11".repeat(32));
    await sendTransaction(transport, await makeDummySignedTx());
    expect(calls).toHaveLength(1);
    assertCapturedParamsMatchSpec("groundhog_sendRawTransaction", calls[0]);
  });

  it("groundhog_chainTip — sends an empty params array", async () => {
    const { transport, calls } = spyTransport({
      height: "0",
      blockHash: "0x" + "00".repeat(32),
    });
    await getChainTip(transport);
    expect(calls).toHaveLength(1);
    assertCapturedParamsMatchSpec("groundhog_chainTip", calls[0]);
  });

  it("groundhog_version — sends an empty params array", async () => {
    const { transport, calls } = spyTransport({
      wireFormat: "2.0.0",
      implementation: "test",
      commitHash: null,
    });
    await getVersion(transport);
    expect(calls).toHaveLength(1);
    assertCapturedParamsMatchSpec("groundhog_version", calls[0]);
  });

  it("groundhog_networkInfo — sends an empty params array", async () => {
    const { transport, calls } = spyTransport({
      networkHash: "0x" + "11".repeat(32),
    });
    await getNetworkInfo(transport);
    expect(calls).toHaveLength(1);
    assertCapturedParamsMatchSpec("groundhog_networkInfo", calls[0]);
  });

  it("groundhog_requestAirdrop — sends an AirdropRequest", async () => {
    const recipient = contractAddress(new Uint8Array(32).fill(0xab));
    const { transport, calls } = spyTransport({
      attemptStatus: "pending",
      recipient: "0x" + "ab".repeat(32),
      rawAmount: "100000000",
      retryAfterSeconds: "1",
    });
    await requestAirdropAttempt(transport, {
      recipient,
      clientNonce: new Uint8Array([0x01, 0x02]),
    });
    expect(calls).toHaveLength(1);
    assertCapturedParamsMatchSpec("groundhog_requestAirdrop", calls[0]);
  });

  it("groundhog_getBalance — sends a Hex0x_ContractAddress", async () => {
    const address = contractAddress(new Uint8Array(32).fill(0xab));
    const { transport, calls } = spyTransport({
      address: "0x" + "ab".repeat(32),
      rawBalance: "0",
      height: "0",
    });

    await getBalance(transport, address);

    expect(calls).toHaveLength(1);
    assertCapturedParamsMatchSpec("groundhog_getBalance", calls[0]);
  });

  it("groundhog_getBlockByNumber — sends a BlockHeight", async () => {
    const { transport, calls } = spyTransport(null);
    await getBlockByNumber(transport, 42n);
    expect(calls).toHaveLength(1);
    assertCapturedParamsMatchSpec("groundhog_getBlockByNumber", calls[0]);
  });

  it("groundhog_pendingTransactionCount — sends an empty params array", async () => {
    const { transport, calls } = spyTransport("0");
    await getPendingTransactionCount(transport);
    expect(calls).toHaveLength(1);
    assertCapturedParamsMatchSpec(
      "groundhog_pendingTransactionCount",
      calls[0],
    );
  });

  it("groundhog_getTransactionReceipt — sends a TxHash", async () => {
    const { transport, calls } = spyTransport(null);
    const hash = new Uint8Array(32).fill(0xab) as unknown as SHA256Hash;
    await getTransactionReceipt(transport, hash);
    expect(calls).toHaveLength(1);
    assertCapturedParamsMatchSpec("groundhog_getTransactionReceipt", calls[0]);
  });

  it("groundhog_getTransactionStatus — sends a TxHash", async () => {
    const { transport, calls } = spyTransport({ status: "unknown" });
    const hash = new Uint8Array(32).fill(0xab) as unknown as SHA256Hash;
    await getTransactionStatus(transport, hash);
    expect(calls).toHaveLength(1);
    assertCapturedParamsMatchSpec("groundhog_getTransactionStatus", calls[0]);
  });

  it("groundhog_getTransactionsByAddress — sends an AddressTransactionQuery", async () => {
    const { transport, calls } = spyTransport({
      refs: [],
      cursor: "0x",
      latestBlock: "0",
      oldestBlock: "0",
    });
    const address = contractAddress(new Uint8Array(32).fill(0xab));

    await getTransactionsByAddress(transport, {
      address,
      order: "descending",
      anchor: { height: 42n },
      cursor: new Uint8Array([0x01, 0x02]),
      limit: 10,
    });

    expect(calls).toHaveLength(1);
    assertCapturedParamsMatchSpec(
      "groundhog_getTransactionsByAddress",
      calls[0],
    );
  });

  it("groundhog_getStorageAt — sends (Hex0x_ContractAddress, HexBytes)", async () => {
    const { transport, calls } = spyTransport({ blockHeight: "0", item: null });
    const addr = contractAddress(new Uint8Array(32).fill(0xab));
    const key = new Uint8Array(32).fill(0xcd);
    await getStorageAt(transport, addr, key);
    expect(calls).toHaveLength(1);
    assertCapturedParamsMatchSpec("groundhog_getStorageAt", calls[0]);
  });

  it("groundhog_getEvents — sends an EventQuery and accepts a spec-shaped response", async () => {
    // Response stubs match the EventPage schema: cursor is the
    // `^0x[0-9a-f]*$` PaginationCursor (the bare `0x` is the server
    // sentinel for "no more pages"), and event fields carry `0x`
    // prefixes per Hex0x_ContractAddress / Hex0x.  Using `""` here
    // hid a response-side parser bug — see getEvents.ts cursor parse.
    const { transport, calls } = spyTransport({
      events: [],
      cursor: "0x",
      latestBlock: "0",
      oldestBlock: "0",
    });
    const addr = contractAddress(new Uint8Array(32).fill(0xab));
    const topic = new Uint8Array(32).fill(0xcd);
    const page = await getEvents(transport, {
      filters: [{ contractAddresses: [addr], topics: { topic0: [topic] } }],
      order: "descending",
      anchor: { height: 42n },
      limit: 10,
    });
    expect(calls).toHaveLength(1);
    assertCapturedParamsMatchSpec("groundhog_getEvents", calls[0]);
    // Empty-cursor sentinel should parse to an empty Uint8Array.
    expect(page.cursor).toBeInstanceOf(Uint8Array);
    expect(page.cursor.length).toBe(0);
  });

  it.each([1n, 9007199254740991n, 9007199254740993n, 18446744073709551615n])(
    "groundhog_view — serializes a lossless gasLimit %s",
    async (gasLimit) => {
      const { transport, calls } = spyTransport({
        output: { result: "return", returnData: "0x" },
        gasUsed: "42",
        events: [],
        height: "0",
      });
      const addr = contractAddress(new Uint8Array(32).fill(0xab));
      const entrypoint = contractEntrypointID(new Uint8Array(8).fill(0xcd));
      const input = calldata(new Uint8Array([0x01, 0x02]));

      await view(transport, {
        contract: addr,
        entrypoint,
        calldata: input,
        gasLimit,
      });

      expect(calls).toHaveLength(1);
      assertCapturedParamsMatchSpec("groundhog_view", calls[0]);
      expect(calls[0]?.params?.[0]).toMatchObject({
        gasLimit: gasLimit.toString(),
      });
    },
  );

  it("groundhog_chainConfig — sends an empty params array and reads stated parameters", async () => {
    const { transport, calls } = spyTransport({
      maxNewContractsPerTx: 4,
      maxRv32CodeBytes: 65_536,
    });
    const config = await getChainConfig(transport);
    expect(calls).toHaveLength(1);
    assertCapturedParamsMatchSpec("groundhog_chainConfig", calls[0]);
    expect(config.maxNewContractsPerTx).toBe(4);
    expect(config.maxRv32CodeBytes).toBe(65_536);
    expect(config.maxContractSizeBytes).toBeNull();
  });

  it("groundhog_serverLimits — sends an empty params array", async () => {
    const limits = {
      maxViewGas: "100000000",
      maxViewCalldataBytes: "65536",
      maxEventsPerPage: 200,
      maxTransactionsPerPage: 200,
      maxCursorBytes: "1024",
    };
    const { transport, calls } = spyTransport(limits);
    await expect(getServerLimits(transport)).resolves.toEqual({
      ...limits,
      maxViewGas: 100_000_000n,
      maxViewCalldataBytes: 65_536n,
      maxCursorBytes: 1024n,
    });
    expect(calls).toHaveLength(1);
    assertCapturedParamsMatchSpec("groundhog_serverLimits", calls[0]);
  });

  it("covers every method in specs/openrpc.json", () => {
    const specMethods = (
      openrpcSpec as { methods: Array<{ name: string }> }
    ).methods
      .map((m) => m.name)
      .sort();
    expect([...coveredMethods].sort()).toEqual(specMethods);
  });
});
