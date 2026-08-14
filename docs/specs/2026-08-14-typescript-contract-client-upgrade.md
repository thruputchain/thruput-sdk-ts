# TypeScript Contract Client Upgrade

**Date:** 2026-08-14 **Status:** Ready for implementation

## Goal

Provide the shared runtime required by generated bindings to preserve method types and identity through invocation, typed views, declared aborts, and strict event decoding.

This release targets integration code demonstrated by the swap app: runtime spec traversal, method-name strings, handwritten return and abort decoding, fixed-length repair, positional event filters, and receipt event scanning.

## Scope

Add contract-agnostic runtime primitives under `src/contract/**` and export them from `@groundhogchain/client/contract` and the root entrypoint.

Directory ownership remains:

- `src/contract/**`: generic runtime used by bundled and application-generated bindings;
- `src/contracts/**`: curated generated bindings shipped by this SDK, including ERC20;
- application-specific bindings: generated into and owned by the consuming application or package.

The first release includes:

- corrected, symmetric codecs for supported contract values;
- fixed-byte and fixed-array public types with runtime length validation;
- typed method descriptors for invocations, views, returns, and aborts;
- strict generated event decoding;
- named event filters for directly represented topics;
- generic receipt event extraction with optional emitter scoping and explicit cardinality;
- one strict RPC emitted-event parser;
- focused runtime, type, fixture, and package-export tests.

## Deferred Work

The following features are useful but are not required to remove the swap app's primary integration work:

- bound contract clients and generated `bind<Interface>` wrappers;
- typed root-receipt method outcomes;
- event encoders for mocks and fixtures;
- typed filters for hashed topic preimages;
- full camelCase migration for struct, union, and event fields;
- generic decode depth, allocation, and materialization budgets beyond protocol byte limits;
- a public reader-aware codec composition framework;
- exhaustive ABI semantic validation;
- automatic self-import resolution for bindings bundled inside this package;
- a plugin architecture for a larger curated binding catalog.

Raw APIs remain available for these workflows.

## Non-goals

This work does not:

- change JSON-RPC methods, OpenRPC schemas, transaction submission, polling, or pagination;
- add pinned-height views, because `groundhog_view` does not accept a height;
- infer method mutability, gas limits, event-to-method relationships, or application policy;
- decode nested invocation results from root receipts;
- recover hashed event topic preimages;
- add `SignedToken` support before its protocol codec exists;
- normalize unrelated block-height, not-found, or transaction-status behavior;
- preserve incorrect enum, union, or byte-container representations through compatibility overloads.

## Decisions

| #   | Decision                                                                                                 | Rationale                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| D1  | Keep raw RPC request, response, receipt, event, and query types unchanged.                               | Typed bindings are additive and raw data remains authoritative.                                 |
| D2  | Keep contract interpretation in generic `src/contract/**` modules.                                       | Bundled and custom bindings must use the same runtime without contract-specific logic.          |
| D3  | Keep `GroundhogClient` thin; descriptors compose its existing `view` method.                             | RPC behavior remains in standalone actions.                                                     |
| D4  | Preserve ABI field names for structs, union struct arms, event topics, and event fields in this release. | A full naming migration requires generated projection codecs and is independent of typed views. |
| D5  | Preserve existing camelCase method names and method argument objects.                                    | This is already the generated public convention.                                                |
| D6  | Represent enums as declared bigint values and unions as `{ case, value? }`.                              | Public types and runtime values must agree.                                                     |
| D7  | Decode U8 containers as `Uint8Array` and enforce fixed lengths at runtime.                               | Type assertions cannot validate decoded or untyped data.                                        |
| D8  | Expose both typed view outcomes and ergonomic throwing views.                                            | TypeScript cannot carry a typed abort through `catch`; callers need a non-throwing option.      |
| D9  | Generate named filters only for topics represented directly on the wire.                                 | Address and fixed-32 topics cover the swap use case without introducing generic topic hashing.  |
| D10 | Release representation and descriptor changes with the matching generator.                               | Either side alone would retain type/runtime mismatches.                                         |

## Fixed Values

Export:

```ts
declare const fixedBytesLength: unique symbol;

export type FixedBytes<N extends number> = Uint8Array & {
  readonly [fixedBytesLength]: N;
};

export type FixedArray<T, N extends number> = readonly T[] & {
  readonly length: N;
};

export function fixedBytes<N extends number>(
  value: Uint8Array,
  length: N,
): FixedBytes<N>;

export function fixedArray<T, N extends number>(
  value: readonly T[],
  length: N,
): FixedArray<T, N>;
```

Constructors validate runtime length. `fixedArray` returns an immutable copy so mutation through the source array cannot invalidate the length. Decode paths use the same checks. A `FixedBytes<N>` remains assignable to `Uint8Array`, while an unchecked `Uint8Array` is not assignable to `FixedBytes<N>`.

`FixedArray<T, N>` avoids recursively expanding arbitrary ABI lengths in declarations. Generated bindings may use concrete readonly tuples for small arrays.

## Contract Codecs

### Public boundary

Export only the top-level abstraction needed by generated descriptors:

```ts
export interface ContractCodec<T> {
  encode(value: T): Uint8Array;
  decode(data: Uint8Array): T;
}
```

`decode` consumes the complete input and throws `ContractDecodeError` for malformed CXS, unsupported values, undeclared enum or union discriminants, fixed-length violations, and trailing bytes. Preserve the original cause when available.

Reader-aware codec composition remains internal. Generated files pass direct generated metadata to public descriptor and event factories; they do not import reader/writer internals or construct a public codec DSL.

Export an opaque `ContractCodecContext` and `createContractCodecContext(typeDefs)` factory. Generated files create one context per binding module and share it across method and event descriptors. The context owns named codec resolution without exposing reader-aware combinators.

Enforce protocol-defined top-level return, abort, and serialized-event byte limits before contract decoding. General resource-budgeted decoding is deferred until the XDR package exposes suitable reader and codec support.

### Dynamic codec corrections

Keep `resolveCodec`, `buildNamedCodecs`, `encodeCalldata`, and `decodeCalldata` for spec-driven tooling. Struct and union-struct keys remain exact ABI names.

Correct their value semantics:

- enum codecs use signed `i32`, accept and return bigint, and reject undeclared values on encode and decode;
- union codecs accept and return case-name objects and use signed `i32` discriminants;
- `Vector<U8>` and `Array<U8, N>` accept and return `Uint8Array`;
- fixed arrays reject incorrect lengths on encode and decode;
- bare `U8` accepts bigint from `0n` through `255n` and rejects all other values.

Do not retain `{ discriminant }` unions or number enum overloads. `decodeCalldata` remains strict and returns ABI-named argument keys.

Add `@groundhogchain/xdr` as a direct dependency. U8 encoding must use a supported CXS byte primitive or one isolated, tested adapter rather than unchecked casts throughout the codebase.

## Method Descriptors

### Public types

Export:

```ts
export type MethodArgs<TArgs> = [TArgs] extends [void] ? [] : [args: TArgs];

export interface ContractView<T> {
  value: T;
  height: bigint;
  events: EmittedEvent[];
}

export interface UnknownContractAbort {
  kind: "unknown";
  selector: bigint;
  data: Uint8Array;
}

export type ContractAbort<TDeclared> = TDeclared | UnknownContractAbort;

export type ContractViewFailure<TAbort> =
  | {
      kind: "abort";
      abort: TAbort;
      data: Uint8Array;
      height: bigint;
      events: EmittedEvent[];
    }
  | {
      kind: "fault";
      height: bigint;
      events: EmittedEvent[];
    };

export type ContractViewOutcome<TResult, TAbort> =
  | ({ kind: "return" } & ContractView<TResult>)
  | ContractViewFailure<TAbort>;

export class ContractViewError<TAbort> extends Error {
  readonly outcome: ContractViewFailure<TAbort>;
}
```

Generated declared aborts carry `kind: "declared"`, selector, exception label, and typed value. Unknown aborts preserve the complete raw abort bytes. Decode selectors as canonical CXS `u64` values and locate payloads from the reader position. Invalid selector encoding throws `ContractDecodeError`.

Descriptor metadata uses these public shapes:

```ts
export interface ContractArgumentMetadata {
  abiName: string;
  publicName: string;
  type: ContractType;
}

export interface ContractExceptionMetadata {
  selector: bigint;
  exception: string | null;
  type: ContractType;
}

export interface ContractMethodDefinition {
  entrypoint: ContractEntrypointID;
  args: readonly ContractArgumentMetadata[];
  returnType: ContractType;
  throws: readonly ContractExceptionMetadata[];
  codecs: ContractCodecContext;
}
```

`publicName` is the generated camelCase method-argument key; `abiName` is the spec name. A named exception uses its type name as `exception`; a supported non-named exception uses `null`. The generator rejects duplicate selectors.

### Descriptor

Export `ContractMethod<TArgs, TResult, TDeclaredAbort>`:

```ts
interface ContractMethod<TArgs, TResult, TDeclaredAbort> {
  readonly entrypoint: ContractEntrypointID;

  invocation(
    contract: ContractAddress,
    gasLimit: GasAmount,
    ...args: MethodArgs<TArgs>
  ): Invocation;

  decodeReturn(data: Uint8Array): TResult;
  decodeAbort(data: Uint8Array): ContractAbort<TDeclaredAbort>;

  view(options: ContractViewOptions<TArgs>): Promise<ContractView<TResult>>;

  viewOutcome(
    options: ContractViewOptions<TArgs>,
  ): Promise<ContractViewOutcome<TResult, ContractAbort<TDeclaredAbort>>>;
}
```

`ContractViewOptions<TArgs>` contains `client: Pick<GroundhogClient, "view">`, contract, optional caller, and a required `args` only for non-void methods. View execution encodes arguments directly and does not invent a gas limit.

`defineContractMethod<TArgs, TResult, TDeclaredAbort>(definition)` consumes `ContractMethodDefinition`. The third generic contains declared aborts only; descriptor return types add `UnknownContractAbort` through `ContractAbort<TDeclaredAbort>`. It resolves argument, return, and exception codecs once during construction. `invocation` reads generated public argument keys and encodes values in metadata order. Descriptor operations must not search a `ContractSpec` by interface or method name.

### View behavior

`viewOutcome` calls the raw client view once:

- return: strictly decode and return value, height, and raw events;
- abort: return the typed declared-or-unknown abort, raw data, height, and events;
- fault: return a fault outcome with height and events;
- malformed return or abort bytes: throw `ContractDecodeError`;
- transport or RPC failure: propagate unchanged.

`view` calls `viewOutcome`, returns `ContractView<TResult>` for a return, and throws `ContractViewError<TAbort>` for abort or fault. Callers that need statically typed abort handling use `viewOutcome`.

Raw `view(ViewRequest): Promise<ViewResponse>` remains unchanged.

## Event Runtime

### Strict decoding

Expose a generic event descriptor primitive used by generated event values. It supports:

- signature-first `decode(event)`, returning `null` for another signature;
- exact topic-count validation for a matching signature;
- typed projection of direct `Address` and `Array<U8, 32>` topics;
- raw `Uint8Array` projection for non-recoverable topics;
- complete payload decoding with fixed-length, enum, union, and trailing-byte validation.

Event field names remain exact ABI names in this release.

The event factory receives signature, ordered topic metadata, ordered payload metadata, and the shared `ContractCodecContext`. Topic metadata marks each topic as direct address, direct fixed-32 bytes, or raw non-recoverable hash. Payload metadata retains its ABI property name and `ContractType`.

```ts
export interface ContractEventTopicMetadata {
  name: string;
  type: ContractType;
  representation: "address" | "fixedBytes32" | "hash";
}

export interface ContractEventFieldMetadata {
  name: string;
  type: ContractType;
}

export interface ContractEventDefinition {
  name: string;
  signature: Uint8Array;
  topics: readonly ContractEventTopicMetadata[];
  fields: readonly ContractEventFieldMetadata[];
  codecs: ContractCodecContext;
}

export type ContractEventFilterValue<T> = T | { oneOf: readonly [T, ...T[]] };

export interface ContractEventFilterInput<TFilter> {
  contractAddresses: readonly ContractAddress[];
  topics?: TFilter;
}

export interface ContractEventReceiptOptions {
  contractAddress?: ContractAddress;
}

export interface DecodedContractEvent<TName extends string, TTopics, TFields> {
  name: TName;
  topics: TTopics;
  fields: TFields;
}

export type ContractReceiptEvent<
  TName extends string,
  TTopics,
  TFields,
> = DecodedContractEvent<TName, TTopics, TFields> & {
  contractAddress: ContractAddress;
};

export interface ContractEvent<
  TName extends string,
  TTopics,
  TFields,
  TFilter,
> {
  readonly signature: Uint8Array;
  decode(
    event: Pick<EmittedEvent, "topics" | "data">,
  ): DecodedContractEvent<TName, TTopics, TFields> | null;
  filter(input: ContractEventFilterInput<TFilter>): EventFilter;
  allFromReceipt(
    receipt: Pick<TransactionReceipt, "events">,
    options?: ContractEventReceiptOptions,
  ): ContractReceiptEvent<TName, TTopics, TFields>[];
  singleFromReceipt(
    receipt: Pick<TransactionReceipt, "events">,
    options?: ContractEventReceiptOptions,
  ): ContractReceiptEvent<TName, TTopics, TFields>;
}
```

`defineContractEvent<TName, TTopics, TFields, TFilter>(definition)` returns the canonical decoded shape and event operations. Generated wrappers supply the literal event name, topic and field object types, and a filter type containing only directly represented named topics. Runtime code follows ordered metadata.

### Direct-topic filters

Every generated event wrapper exposes `.filter(...)` and returns the existing public `EventFilter`. It always supports contract addresses plus the event signature. Its optional `topics` object exposes named constraints for `Address` and `Array<U8, 32>` topic fields without colliding with filter option names. The runtime:

- requires at least one contract address;
- inserts the signature at topic 0;
- maps named direct topics to their declared positions;
- accepts one value or `{ oneOf: readonly [T, ...T[]] }` for OR;
- validates non-empty `oneOf` and 32-byte values;
- leaves omitted topics unconstrained.

For hashed topic types, consumers continue to use raw `EventQuery` values. Generic `SHA-256(CXS(value))` topic encoding is deferred.

### Receipt extraction

Expose generic helpers used by generated event wrappers:

```ts
Event.allFromReceipt(receipt, { contractAddress? });
Event.singleFromReceipt(receipt, { contractAddress? });
```

`ContractReceiptEvent` adds the emitting `contractAddress` to the canonical decoded event. `allFromReceipt` scans in receipt order, optionally scopes by emitter, ignores other signatures, and throws for a malformed matching event. `singleFromReceipt` uses the same scan and requires exactly one match, reporting the actual count.

Export ordinary `bytesEqual(left, right)` for public identifiers and addresses. It is not constant-time or suitable for secrets.

### RPC event parsing

Create one internal emitted-event parser under `src/actions/**` and reuse it for views, receipts, and event queries. Require all OpenRPC fields; view parsing must not default topics or data. Enforce:

- at most three topics;
- exactly 32 bytes per contract address and topic;
- at most 1,024 bytes across serialized topics and data.

The parser only converts RPC hex to raw `EmittedEvent`. Contract interpretation remains in `src/contract/**`.

## Exports and Package Structure

Re-export the public contract runtime from `src/contract/index.ts` and the root entrypoint. Keep all existing package subpaths.

Generated external bindings import published package entrypoints. Add a client-owned `scripts/regenerate-contract-bindings.sh` that invokes the CLI generator for curated bindings, rewrites only known client self-import module specifiers to repository-relative imports, formats the result, and fails on unexpected generated changes. This replaces manual import edits without coupling the release to build-tool self-aliasing.

Build output must continue to include ESM, CJS, source maps, and declarations for every existing entrypoint.

## Compatibility and Release

Preserve:

- raw view, receipt, event, and event-query APIs;
- standalone actions and the thin `GroundhogClient`;
- ABI field names for structs, union struct arms, and events.

Deliberately change:

- enum codecs and generated enums to declared signed bigint values;
- unions to the case-name representation;
- decoded U8 containers to `Uint8Array`;
- fixed arrays and bytes to length-aware types;
- regenerated methods from invocation-builder functions to top-level descriptors with `invocation`, decode, and view operations;
- directly represented event topics to semantic types.

Do not preserve old generated method builders or add compatibility overloads for incorrect representations. Release the runtime and generator together. Regenerate curated bindings in this repository and application-owned swap bindings with the coordinated versions.

## Testing

### Runtime tests

Cover:

- supported scalar and composite codec round trips;
- U8 boundaries and signed enum/union discriminants;
- unknown enum values, union cases, and discriminants;
- `Uint8Array` vectors, fixed bytes, and fixed arrays;
- recursive values and trailing-byte rejection;
- zero- and multi-argument descriptors;
- non-void and void return codecs;
- view return, declared abort, unknown abort, malformed abort, fault, and transport failure;
- preservation of view height and events;
- strict event parsing and event decoding;
- direct-topic filters, omitted positions, and `oneOf`;
- receipt extraction with emitter scope and zero, one, or many matches.

### Type and package tests

Compile generated ERC20, recursive, and swap-shaped fixtures. Assert that:

- incorrect fixed lengths fail;
- unchecked `Uint8Array` does not satisfy `FixedBytes<N>`;
- enum numbers and `{ discriminant }` unions fail;
- named args and results infer through descriptors;
- zero-argument methods require no argument value;
- view outcomes narrow exhaustively;
- public APIs export from `./contract` and the root.

Run:

```bash
npm run format:check
npm run typecheck
npm test
npm run build
```

The coordinated generator must pass its Rust checks and reproduce its generated fixtures. The swap application must regenerate its bindings and pass its relevant contract integration tests.

Release order:

1. implement and test the client runtime against checked-in generated-shape fixtures;
2. implement codegen against the same metadata contract;
3. regenerate curated client bindings and run the complete client pipeline;
4. regenerate swap bindings and migrate the swap integration code;
5. publish the coordinated client package before releasing the CLI generator that imports it.

## Acceptance Criteria

The release is ready when:

1. generated and dynamic codecs accept and return their documented representations symmetrically;
2. generated methods invoke, decode, and execute typed views without runtime spec traversal or method-name strings;
3. typed view outcomes preserve returns, declared or unknown aborts, faults, height, events, and raw abort data;
4. fixed arrays, fixed bytes, enums, unions, and U8 containers require no handwritten repair;
5. generated events strictly decode direct topics and payloads, build direct-topic filters, and extract receipt events with explicit cardinality;
6. raw RPC APIs remain available and use one strict emitted-event parser;
7. regenerated curated and swap-shaped fixtures compile and pass runtime round trips through package declarations and builds;
8. the swap app no longer uses runtime method-name lookup or handwritten return/abort decoding, fixed-length event repair, positional direct-topic filters, or handwritten receipt event scanning;
9. deferred binders, method receipt outcomes, event encoders, hashed-topic filters, naming migration, and decode budgets are not implementation prerequisites.
