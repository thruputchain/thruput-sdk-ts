import { expect, expectTypeOf, it, vi } from "vitest";
import * as codecs from "./codec.js";
import { contractSpecString } from "@thruputchain/contract-spec";
import { CxsWriter } from "@thruputchain/xdr";
import { ContractTypeKind } from "./spec.js";
import { calldata, contractAddress, gasAmount } from "@thruputchain/protocol";
import { DefaultWallet, spec } from "../contracts/default_wallet.js";
import { ERC20 } from "../contracts/erc20.js";
import { createContractCallDecoder } from "./specMethod.js";
import { decodeDefaultWalletRequests } from "../actions/public/decodeWalletRequests.js";

const address = contractAddress(new Uint8Array(32).fill(3));

it("resolves interface exceptions in linear work rather than once per method", () => {
  const copy = structuredClone(spec);
  const iface = copy.interfaces[0]!;
  iface.methods = Array.from({ length: 500 }, (_, i) => ({
    name: contractSpecString(`method${i}`),
    args: [],
    return_type: { v: ContractTypeKind.Void },
    effect: null,
  }));
  iface.throws = Array.from({ length: 500 }, (_, i) => ({
    selector: BigInt(i),
    ty: { v: ContractTypeKind.U32 },
  }));
  const spy = vi.spyOn(codecs, "resolveContextCodec");
  try {
    createContractCallDecoder(copy);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1500);
  } finally {
    spy.mockRestore();
  }
});
const child = ERC20.v0_1.transfer.call({
  address,
  gasLimit: gasAmount(10000n),
  args: { receiver: address, amount: 10n },
}).invocation;
const root = DefaultWallet.v0_1.execute.call({
  address,
  gasLimit: gasAmount(20000n),
  args: {
    calls: [
      {
        target: child.invoked_address,
        entrypoint: child.entrypoint,
        gas_limit: child.gas_limit,
        calldata: child.calldata,
      },
    ],
  },
}).invocation;

it("decodes wallet arguments with the same codecs as generated bindings", () => {
  const decoded = createContractCallDecoder(spec)(root);
  expect(decoded?.methodName).toBe("execute");
  expect(decoded?.args).toEqual(
    DefaultWallet.v0_1.execute.decodeArgs(root.calldata),
  );
  expect(decodeDefaultWalletRequests(root)?.requestedCalls).toEqual([child]);
});

it("keeps unknown selectors separate from malformed known input", () => {
  expect(createContractCallDecoder(spec)(child)).toBeNull();
  expect(decodeDefaultWalletRequests(child)).toBeNull();
  expect(() =>
    createContractCallDecoder(spec)({
      ...root,
      calldata: calldata(new Uint8Array()),
    }),
  ).toThrow();
  expect(() =>
    decodeDefaultWalletRequests({
      ...root,
      calldata: calldata(new Uint8Array()),
    }),
  ).toThrow();
});

it("rejects ambiguous selectors and does not depend on subsequent spec mutation", () => {
  const copy = structuredClone(spec);
  const decode = createContractCallDecoder(copy);
  copy.interfaces.push(copy.interfaces[0]!);
  expect(() => createContractCallDecoder(copy)).toThrow(
    "Duplicate method selector",
  );
  expect(decode(root)?.methodName).toBe("execute");
});

it("decodes only the root wallet output as its declared vector", () => {
  const decoded = createContractCallDecoder(spec)(root)!;
  expect(decoded.method.decodeReturn(new Uint8Array([1, 1, 7]))).toEqual([
    new Uint8Array([7]),
  ]);
});

it("exposes declared exception values and preserves unknown payload types", () => {
  const copy = structuredClone(spec);
  copy.interfaces[0]!.throws = [
    { selector: 7n, ty: { v: ContractTypeKind.U32 } },
  ];
  const method = createContractCallDecoder(copy)(root)!.method;
  const writer = new CxsWriter();
  writer.writeUint64(7n);
  writer.writeUint32(42n);
  const data = writer.finish();
  const exception = method.decodeException(data);
  expect(exception).toMatchObject({
    kind: "declared",
    selector: 7n,
    value: 42n,
  });
  if (exception.kind === "declared") {
    expectTypeOf(exception.value).toEqualTypeOf<unknown>();
    expect(exception.value).toBe(42n);
  }
  const outcome = method.decodeViewOutcome({
    output: { result: "abort", abortData: data },
    stateBlockHeight: 1n,
    gasUsed: 1n,
    events: [],
  });
  expect(outcome.kind).toBe("abort");
  if (outcome.kind === "abort" && outcome.exception.kind === "declared") {
    expectTypeOf(outcome.exception.value).toEqualTypeOf<unknown>();
    expect(outcome.exception.value).toBe(42n);
  }
  const unknownWriter = new CxsWriter();
  unknownWriter.writeUint64(99n);
  const unknownData = unknownWriter.finish();
  const unknown = method.decodeException(unknownData);
  expect(unknown.kind).toBe("unknown");
  if (unknown.kind === "unknown") {
    expectTypeOf(unknown.data).toEqualTypeOf<Uint8Array>();
    expect(unknown.data).toEqual(unknownData);
  }
});
