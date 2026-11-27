import { expect, expectTypeOf, it, vi } from "vitest";
import * as codecs from "./codec.js";
import { contractSpecString } from "@thruputchain/contract-spec";
import { CxsWriter } from "@thruputchain/xdr";
import { ContractTypeKind } from "./spec.js";
import {
  authTokenPayload,
  calldata,
  codec,
  contractAddress,
  gasAmount,
  serialize,
  sha256Hash,
  type AuthTokenNode,
} from "@thruputchain/protocol";
import { DefaultWallet, spec } from "../contracts/default_wallet.js";
import { ERC20 } from "../contracts/erc20.js";
import { createContractCallDecoder } from "./specMethod.js";
import {
  decodeDefaultWalletRequests,
  describeDefaultWalletRequests,
} from "../actions/public/decodeWalletRequests.js";
import { deriveContractAddress } from "../derivation/contractAddress.js";

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
    mints: [],
    calls: [
      {
        target: child.invoked_address,
        entrypoint: child.entrypoint,
        gas_limit: child.gas_limit,
        calldata: child.calldata,
        tokens: [],
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
  expect(describeDefaultWalletRequests(root)).toEqual({
    wrapper: "DefaultWallet.execute",
    mints: [],
    calls: [{ invocation: child, tokens: [] }],
  });
});

it("keeps unknown selectors separate from malformed known input", () => {
  expect(createContractCallDecoder(spec)(child)).toBeNull();
  expect(decodeDefaultWalletRequests(child)).toBeNull();
  expect(describeDefaultWalletRequests(child)).toBeNull();
  expect(() =>
    describeDefaultWalletRequests({
      ...root,
      calldata: calldata(new Uint8Array()),
    }),
  ).toThrow();
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

it("refuses to report a wallet root that mints or forwards auth tokens", () => {
  const call = {
    target: child.invoked_address,
    entrypoint: child.entrypoint,
    gas_limit: child.gas_limit,
    calldata: child.calldata,
  };
  const minting = DefaultWallet.v0_1.execute.call({
    address,
    gasLimit: gasAmount(20000n),
    args: {
      mints: [new Uint8Array([1])],
      calls: [{ ...call, tokens: [] }],
    },
  }).invocation;
  const forwarding = DefaultWallet.v0_1.execute.call({
    address,
    gasLimit: gasAmount(20000n),
    args: {
      mints: [],
      calls: [{ ...call, tokens: [{ case: "Minted", value: [0n] }] }],
    },
  }).invocation;
  expect(() => decodeDefaultWalletRequests(minting)).toThrow("auth tokens");
  expect(() => decodeDefaultWalletRequests(forwarding)).toThrow("auth tokens");
});

it("preserves unreadable mints and ordered references alongside decoded grants", () => {
  const leaf = {
    consumer_address: address,
    payload: authTokenPayload(Uint8Array.of(42)),
    child_nodes: [],
  };
  const node: AuthTokenNode = { ...leaf, child_nodes: [leaf] };
  const encoded = serialize(node, codec.AuthTokenNode);
  const unreadable = Uint8Array.of(...encoded, 0);
  const call = DefaultWallet.v0_1.execute.decodeArgs(root.calldata).calls[0]!;
  const tokens: typeof call.tokens = [
    { case: "Returned", value: { call: 0n, index: 2n } },
    { case: "Minted", value: [1n] },
  ];
  const batch = DefaultWallet.v0_1.execute.call({
    address,
    gasLimit: root.gas_limit,
    args: { mints: [unreadable, encoded], calls: [call, { ...call, tokens }] },
  }).invocation;
  expect(describeDefaultWalletRequests(batch)).toEqual({
    wrapper: "DefaultWallet.execute",
    mints: [
      { kind: "unreadable", bytes: unreadable },
      { kind: "decoded", node },
    ],
    calls: [
      { invocation: child, tokens: [] },
      { invocation: child, tokens },
    ],
  });
});

it("includes only the requested deployment initializer and no grants", () => {
  const hash = sha256Hash(new Uint8Array(32).fill(8));
  const nonce = sha256Hash(new Uint8Array(32).fill(9));
  const init = {
    entrypoint: child.entrypoint,
    gas_limit: child.gas_limit,
    calldata: child.calldata,
  };
  for (const initializer of [null, init]) {
    const deploy = DefaultWallet.v0_1.deploy.call({
      address,
      gasLimit: root.gas_limit,
      args: { contractHash: hash, nonce, amount: 0n, initializer },
    }).invocation;
    const calls = initializer
      ? [
          {
            invocation: {
              ...child,
              invoked_address: deriveContractAddress(address, nonce, hash),
            },
            tokens: [],
          },
        ]
      : [];
    expect(describeDefaultWalletRequests(deploy)).toEqual({
      wrapper: "DefaultWallet.deploy",
      mints: [],
      calls,
    });
    expect(decodeDefaultWalletRequests(deploy)?.requestedCalls).toEqual(
      calls.map((call) => call.invocation),
    );
  }
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
