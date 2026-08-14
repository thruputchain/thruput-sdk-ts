# TypeScript Bindings Before and After

**Date:** 2026-08-14  
**Related specs:**

- `docs/specs/2026-08-14-typescript-contract-client-upgrade.md`
- `groundhog-rpc/docs/cli/specs/2026-08-14-typescript-binding-codegen-upgrade.md`

## Purpose

This document illustrates the intended application and generated-code changes from the coordinated `groundhog-client-ts` runtime and CLI TypeScript codegen upgrades. Use it as a migration reference, validation guide, and source for the eventual pull request description.

The after examples describe the target API. They are not current behavior until both upgrades land and bindings are regenerated.

## 1. Contract Type Projection

### Before

Generated types lose ABI details that applications must restore themselves:

```ts
export enum ERC20Error {
  AlreadyInitialized = 1,
  MustBeContractOwner = 2,
  TooLarge = 3,
  Internal = 100,
}

export interface U256 {
  _0: bigint[];
}

export interface SwapEvent {
  name: "SwapEvent";
  topics: {
    sender: Uint8Array;
    recipient: Uint8Array;
  };
  fields: {
    amounts_in: bigint[];
    amounts_out: bigint[];
    request_id: Uint8Array | null;
  };
}
```

This permits number-valued enums, arbitrary array lengths, untyped addresses, and arbitrary byte lengths where the ABI requires fixed values.

### After

Generated types agree with the runtime values accepted and returned by contract codecs:

```ts
export const ERC20Error = {
  AlreadyInitialized: 1n,
  MustBeContractOwner: 2n,
  TooLarge: 3n,
  Internal: 100n,
} as const;

export type ERC20Error = (typeof ERC20Error)[keyof typeof ERC20Error];

export interface U256 {
  _0: FixedArray<bigint, 4>;
}

export interface SwapEvent {
  name: "SwapEvent";
  topics: {
    sender: ContractAddress;
    recipient: ContractAddress;
  };
  fields: {
    amounts_in: readonly [bigint, bigint];
    amounts_out: readonly [bigint, bigint];
    request_id: FixedBytes<32> | null;
  };
}
```

Generated unions use case names rather than exposing wire discriminants:

```ts
export type SwapOp =
  | { case: "AddLiquidity"; value: readonly [AddLiquidityRequest] }
  | { case: "SwapExactIn"; value: readonly [SwapExactInRequest] }
  | { case: "Idle" };
```

## 2. Fixed-Value Construction

### Before

Applications accept raw values and repeat length checks:

```ts
function requestId(value: Uint8Array): Uint8Array {
  if (value.length !== 32) {
    throw new Error("Request ID must be 32 bytes");
  }
  return value;
}

function amounts(values: bigint[]): readonly [bigint, bigint] {
  if (values.length !== 2) {
    throw new Error("Expected two amounts");
  }
  return [values[0]!, values[1]!];
}
```

### After

The client exports validating constructors for external or dynamically assembled values:

```ts
const requestId = fixedBytes(rawRequestId, 32);
const amounts = fixedArray(rawAmounts, 2);
```

Decoded values pass through the same validation automatically. Small fixed-array literals can use tuples without a helper:

```ts
const amounts = [100n, 200n] as const;
```

An unchecked `Uint8Array` does not satisfy `FixedBytes<32>`. This catches invalid values before invocation encoding rather than only at the encoder boundary.

## 3. Generated Method API

### Before

Arguments are anonymous types and generated functions only construct invocations:

```ts
export const SwapPair = {
  swap(
    contract: ContractAddress,
    gasLimit: GasAmount,
    args: {
      amount0Out: bigint;
      amount1Out: bigint;
      to: ContractAddress;
      requestId: Uint8Array | null;
    },
  ): Invocation {
    return createInvocation({
      invoked_address: contract,
      entrypoint: entrypoints.SwapPair.swap,
      gas_limit: gasLimit,
      calldata: encodeCalldata(
        spec,
        "SwapPair",
        "swap",
        [args.amount0Out, args.amount1Out, args.to, args.requestId],
        namedCodecs,
      ),
    });
  },
} as const;
```

### After

Codegen emits reusable method types and one canonical descriptor per top-level method:

```ts
export interface SwapPairSwapArgs {
  amount0Out: bigint;
  amount1Out: bigint;
  to: ContractAddress;
  requestId: FixedBytes<32> | null;
}

export type SwapPairSwapResult = void;

const codecs = createContractCodecContext(spec.type_defs);

export const SwapPair = {
  swap: defineContractMethod<
    SwapPairSwapArgs,
    SwapPairSwapResult,
    SwapPairAbort
  >({
    entrypoint: entrypoints.SwapPair.swap,
    args: swapArgumentMetadata,
    returnType: spec.interfaces[0].methods[7].return_type,
    throws: swapPairExceptionMetadata,
    codecs,
  }),
} as const;
```

The descriptor is the only generated method API. There is no callable alias, nested `methods` namespace, or second encoding path.

Applications construct transaction invocations through the descriptor:

```ts
const invocation = SwapPair.swap.invocation(pairAddress, gasLimit, {
  amount0Out: 0n,
  amount1Out: quotedAmount,
  to: recipient,
  requestId,
});
```

## 4. Typed Contract Views

### Before

The swap application constructs an invocation with an arbitrary view gas limit, identifies a method by strings, dynamically resolves its codec, decodes `unknown`, and validates the result:

```ts
const VIEW_GAS = gasAmount(10_000_000n);

return viewMethod({
  client,
  invocation: SwapPair.getReserves(pairAddress, VIEW_GAS),
  caller,
  spec,
  interfaceName: "SwapPair",
  methodName: "get_reserves",
  validate: expectReserves,
});

function expectReserves(value: unknown): PairReserves {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some((item) => typeof item !== "bigint")
  ) {
    throw new TypeError("SwapPair.get_reserves returned an invalid tuple");
  }

  return {
    reserve0: value[0] as bigint,
    reserve1: value[1] as bigint,
    blockTimestamp: value[2] as bigint,
  };
}
```

### After

Codegen exports the result type:

```ts
export type SwapPairGetReservesArgs = void;
export type SwapPairGetReservesResult = readonly [bigint, bigint, bigint];
```

The application executes the typed view directly without a gas limit, method-name strings, runtime spec traversal, `unknown`, or handwritten tuple validation:

```ts
const result = await SwapPair.getReserves.view({
  client,
  contract: pairAddress,
  caller,
});

const [reserve0, reserve1, blockTimestamp] = result.value;

result.height;
result.events;
```

An application-specific projection remains straightforward when domain naming is useful:

```ts
async function getReserves(): Promise<PairReserves> {
  const { value } = await SwapPair.getReserves.view({
    client,
    contract: pairAddress,
    caller,
  });

  const [reserve0, reserve1, blockTimestamp] = value;
  return { reserve0, reserve1, blockTimestamp };
}
```

## 5. Typed Abort Handling

### Before

The application searches the interface spec and returns an untyped exception value:

```ts
export type DecodedContractAbort =
  | {
      kind: "declared";
      selector: bigint;
      exceptionName: string | null;
      value: unknown;
    }
  | {
      kind: "unknown";
      selector: bigint;
    };
```

### After

Codegen emits the interface's declared abort union:

```ts
export type ERC20DeclaredAbort = {
  kind: "declared";
  exception: "ERC20Error";
  selector: 0xb19947acb2fa14ffn;
  value: ERC20Error;
};

export type ERC20Abort = ContractAbort<ERC20DeclaredAbort>;
```

Applications that handle aborts as normal control flow use the non-throwing outcome API:

```ts
const outcome = await ERC20.getBalanceOf.viewOutcome({
  client,
  contract: tokenAddress,
  caller,
  args: { addr: accountAddress },
});

switch (outcome.kind) {
  case "return":
    console.log("Balance:", outcome.value);
    break;

  case "abort":
    if (outcome.abort.kind === "declared") {
      switch (outcome.abort.value) {
        case ERC20Error.TooLarge:
          console.log("The requested value was too large");
          break;
        case ERC20Error.AlreadyInitialized:
          console.log("The token was already initialized");
          break;
      }
    } else {
      console.log("Unknown abort selector:", outcome.abort.selector);
    }
    break;

  case "fault":
    console.log("Contract execution faulted");
    break;
}
```

Applications that only need the successful result use the ergonomic throwing API:

```ts
const { value: balance } = await ERC20.getBalanceOf.view({
  client,
  contract: tokenAddress,
  caller,
  args: { addr: accountAddress },
});
```

## 6. Strict Event Decoding

### Before

The generated decoder returns open arrays and raw topic bytes. The application repairs every value:

```ts
export function decodeSwapEvent(event): SwapEvent | null {
  const decoded = GeneratedSwapEvent.decode(event);
  if (decoded === null) return null;

  return {
    sender: address(decoded.topics.sender, "sender"),
    recipient: address(decoded.topics.recipient, "recipient"),
    amountsIn: amounts(decoded.fields.amounts_in, "amounts_in"),
    amountsOut: amounts(decoded.fields.amounts_out, "amounts_out"),
    requestId:
      decoded.fields.request_id === null
        ? null
        : requestId(decoded.fields.request_id),
  };
}
```

### After

The generated event descriptor strictly validates and projects the declared event shape:

```ts
const swap = SwapEvent.decode(event);

if (swap !== null) {
  swap.topics.sender; // ContractAddress
  swap.topics.recipient; // ContractAddress
  swap.fields.amounts_in; // readonly [bigint, bigint]
  swap.fields.amounts_out; // readonly [bigint, bigint]
  swap.fields.request_id; // FixedBytes<32> | null
}
```

For a matching signature, the decoder validates exact topic count, direct topic representations, fixed lengths, enum and union values, payload completeness, and trailing bytes. Another signature returns `null` without trying to interpret the event.

## 7. Named Event Filters

### Before

Applications construct positional filters and must know which topic index corresponds to each event field:

```ts
const filters = [
  {
    contractAddresses: [pairAddress],
    topics: {
      topic0: [SWAP_EVENT_SIGNATURE],
      topic1: [handlerAddress],
      topic2: [accountAddress],
    },
  },
  {
    contractAddresses: [driverAddress],
    topics: {
      topic0: [REQUEST_FAILED_SIGNATURE],
      topic1: requestIds,
    },
  },
];
```

### After

Generated event descriptors expose named filters for topics represented directly on the wire:

```ts
const filters = [
  SwapEvent.filter({
    contractAddresses: [pairAddress],
    topics: {
      sender: handlerAddress,
      recipient: accountAddress,
    },
  }),
  RequestFailed.filter({
    contractAddresses: [driverAddress],
    topics: {
      request_id: { oneOf: requestIds },
    },
  }),
];
```

The descriptor inserts the event signature, maps names to declared positions, validates fixed values, and returns the client's existing `EventFilter`. Hashed topic preimages remain available only through raw event queries until generic topic hashing is implemented.

## 8. Receipt Event Extraction

### Before

Applications repeat emitter matching, decoding, payload validation, and cardinality checks:

```ts
export function extractAcceptedRequestId(
  receipt: TransactionReceipt,
  driverAddress: ContractAddress,
): Uint8Array {
  const matches = receipt.events.flatMap((event) => {
    if (!bytesEqual(event.contractAddress, driverAddress)) return [];

    const decoded = RequestAccepted.decode(event);
    if (decoded === null) return [];
    if (event.data.length !== 0) {
      throw new Error("RequestAccepted payload must be empty");
    }

    return [requestId(decoded.topics.request_id)];
  });

  if (matches.length !== 1) {
    throw new Error(
      `Expected one RequestAccepted event, received ${matches.length}`,
    );
  }

  return matches[0]!;
}
```

### After

The generated event descriptor provides emitter-scoped extraction and explicit cardinality:

```ts
const accepted = RequestAccepted.singleFromReceipt(receipt, {
  contractAddress: driverAddress,
});

const requestId = accepted.topics.request_id;
```

For events that may occur more than once:

```ts
const swaps = SwapEvent.allFromReceipt(receipt, {
  contractAddress: pairAddress,
});

for (const swap of swaps) {
  console.log(swap.fields.amounts_out);
}
```

`allFromReceipt` preserves receipt order. `singleFromReceipt` requires exactly one result and reports the actual count otherwise.

## 9. Runtime and Codegen Boundary

### Before

Generated files contain repeated encoding and event-decoding implementation:

```ts
const namedCodecs = buildNamedCodecs(spec.type_defs);

export const SwapEvent = {
  signature,
  decode(event) {
    // Generated signature checks, reader management, codec resolution,
    // type assertions, and trailing-byte checks.
  },
};
```

### After

Codegen emits static types and ordered metadata. The client runtime owns behavior:

```ts
const codecs = createContractCodecContext(spec.type_defs);

export const SwapEvent = defineContractEvent<SwapEvent, SwapEventFilter>({
  signature: spec.events[2].signature,
  topics: [
    {
      name: "sender",
      type: spec.events[2].topics[0].ty,
      representation: "address",
    },
    {
      name: "recipient",
      type: spec.events[2].topics[1].ty,
      representation: "address",
    },
  ],
  fields: [
    {
      name: "amounts_in",
      type: spec.events[2].fields[0].ty,
    },
    {
      name: "amounts_out",
      type: spec.events[2].fields[1].ty,
    },
    {
      name: "request_id",
      type: spec.events[2].fields[2].ty,
    },
  ],
  codecs,
});
```

Responsibilities become explicit:

- Codegen owns generated static types, entrypoints, and direct metadata.
- `groundhog-client-ts` owns codecs, validation, invocation construction, views, aborts, event decoding, filters, and receipt extraction.
- Applications consume typed operations instead of rebuilding contract runtime behavior.

## Validation Checklist

Use these observable changes when validating the implementation and preparing the pull request:

- Generated enums use declared bigint values and reject undeclared values.
- Generated unions use `{ case, value? }` and reject invalid case/payload combinations.
- U8 containers decode to `Uint8Array`.
- Fixed bytes and arrays retain their ABI lengths in types and runtime validation.
- Each generated method is one top-level descriptor with `invocation`, decode, and view operations.
- Generated method arguments and results have deterministic exported names.
- Typed views require no gas limit, spec traversal, method-name string, or result validator.
- `viewOutcome` distinguishes return, declared or unknown abort, and fault.
- Event decoding validates matching events strictly and returns semantic direct-topic types.
- Event filters use named direct topics instead of positional topic indexes.
- Receipt helpers provide emitter scoping and explicit all-or-single cardinality.
- Generated files delegate behavior to shared client runtime factories.
- The swap application removes its handwritten view runtime, abort decoder, fixed-length event repair, positional filters, and receipt scanning.
- Raw RPC APIs remain available as intentional low-level escape hatches, not generated compatibility aliases.
