# GH-266: Contract Deployment Workstream and PR Plan

## Goal

Give TypeScript consumers one complete, supported example that:

1. Packages a WASM artifact as a protocol `Contract`.

2. Computes its network contract hash.

3. Derives its address before deployment.

4. Deploys it through the local dev wallet.

5. Waits for a successful deployment receipt.

6. Calls the contract at the derived address and verifies the result.

The example must make clear that `contracts_to_deploy` only makes an artifact resolvable during execution. The wallet's deployment invocation performs the deployment. A placeholder address is never valid because `invoked_address` is the actual call target.

## Prerequisite: Correct GH-266

GH-266 currently says a WASM contract hash is `SHA256(wasm_blob)`. That conflicts with the node, Rust CLI, and Testkit, which hash the canonical encoded `Contract`, including the contract-type discriminant and blob encoding:

- `groundhog-hogd/hogd/hog_exec/runtime/syscall_handler.cc`
- `groundhog-rpc/crates/tools/cli/src/deploy.rs`
- `groundhog-rpc/crates/dev/testkit/src/artifact.rs`

Before implementation starts:

1. Update GH-266's description and acceptance criteria to require SHA-256 of the canonical encoded `Contract`, not the raw WASM bytes.

2. Create and link a protocol follow-up to correct `groundhog-protocol/contract.x`.

This client PR should follow implemented network behavior. It should not modify the protocol repository.

## Decisions

- Add a semantic `hashContract(contract)` helper instead of exporting generic SHA-256.
- Re-export the protocol's existing `deriveContractAddress`; do not wrap or reimplement it.
- Expose both helpers from the package root, which is all GH-266 requires.
- Keep deployment orchestration in the example. Do not add `client.deployContract()` yet.
- Include a small, instrumented Counter fixture and example-local binding in the repository, but not in the published npm package.
- Keep all deployment-specific helper code local to `examples/deploy-counter.ts` unless implementation shows a clear, existing reuse case.
- Require one successful end-to-end run against a compatible local node before merge. Unit tests alone cannot validate wallet selectors, gas, node verification, or receipt behavior.
- Do not wait for Testkit. It solves test orchestration, not the missing client-ts consumer path.

## Public API

### `hashContract`

Add `src/contract/hash.ts`:

```ts
import { sha256 } from "@noble/hashes/sha2.js";
import {
  codec,
  serialize,
  sha256Hash,
  type Contract,
  type SHA256Hash,
} from "@groundhogchain/protocol";

/** Return the network identity of a protocol contract. */
export function hashContract(contract: Contract): SHA256Hash {
  return sha256Hash(sha256(serialize(contract, codec.Contract)));
}
```

Export it from `src/contract/index.ts`; the existing root wildcard export will expose it from `@groundhogchain/client`.

The helper accepts the full `Contract` union so hashing remains correct for WASM, RV32, and other protocol variants. Do not add a WASM-only helper or export Noble's generic `sha256`; either would make hashing the wrong preimage easier.

### `deriveContractAddress`

Add an explicit root re-export in `src/index.ts`:

```ts
export { deriveContractAddress } from "@groundhogchain/protocol/utils";
```

Do not add a wrapper, duplicate implementation, or new package subpath.

## Counter Fixture

Add:

- `examples/fixtures/counter.wasm`
- `examples/fixtures/README.md`
- `examples/generated/counter.ts`

The measured instrumented artifact is about 8 KiB, so repository size is not a concern. The source repository and this repository are both Apache-2.0.

### Clean, reproducible build

The artifact measured during investigation was built while the local `groundhog-examples` checkout contained unrelated changes. Do not treat that file or its checksum as the final fixture.

Generate the committed fixture from clean, detached checkouts of:

- `groundhog-examples` at an explicitly recorded commit containing `contracts/counter`
- A compatible `groundhog-rpc` CLI commit

The fixture README must record:

- Both repository URLs and commits
- Rust toolchain and Counter SDK versions
- Working directory and complete build command
- Instrumented artifact size
- Raw file SHA-256 for provenance
- Canonical Groundhog contract hash for deployment
- Apache-2.0 source license

The build command should use paths such as `<groundhog-rpc-checkout>` rather than a developer-specific `~/Work` path. Copy `target/groundhog/counter.wasm`, not the uninstrumented Cargo output under `target/wasm32-unknown-unknown`.

The installed `groundhog 0.5.10` cannot build the current SDK `0.19.0` artifact because it rejects the `groundhogspecrawv1` custom section. Use a compatible released CLI if one is available when implementation starts; otherwise record the pinned CLI source commit used to build it.

### Example-local binding

Generate `examples/generated/counter.ts` from the same clean build. Keep it example-local rather than exporting Counter as a standard client contract.

The generated binding imports `@groundhogchain/client`, but repository examples must run before `dist` exists. Adapt only those imports to the local source entrypoint, mark the import adaptation in the header, and leave generated entrypoint IDs, contract spec, calldata encoding, and decoding logic unchanged.

## Deployment Example

Add `examples/deploy-counter.ts`.

### Configuration

Use the existing local defaults where applicable:

- `GROUNDHOG_RPC_URL`, default `http://127.0.0.1:9545`
- `GROUNDHOG_SENDER_ADDRESS`, matching `transfer-hog.ts`
- `GROUNDHOG_SENDER_PRIVATE_KEY`, matching `transfer-hog.ts`
- `GROUNDHOG_WALLET_DEPLOY_ENTRYPOINT`, with the compatible local-node default
- `GROUNDHOG_WALLET_ENTRYPOINT`, for the post-deploy `doAction` call
- Optional `GROUNDHOG_DEPLOYMENT_NONCE`, parsed as exactly 32 bytes

Wallet selectors are runtime/network metadata. The hard-coded defaults are only for the documented compatible local-node version. Allow overrides and state that hosted or rotated networks must provide their selectors. Selector discovery is outside this PR because client-ts does not expose network metadata today.

When no deployment nonce is provided, use Node's cryptographic random-byte API to generate 32 bytes. Call it `deploymentNonce` everywhere. Keep the transaction uniquifier's `bigint` nonce separately named `transactionNonce`.

### Derive the address

1. Read `examples/fixtures/counter.wasm` with `node:fs/promises`.

2. Construct the protocol contract:

```ts
const contract: Contract = {
  contract_type: ContractType.kWasmi,
  wasmi_contract: { data: wasm },
};
```

3. Compute `contractHash = hashContract(contract)`.

4. Compute `predictedAddress = deriveContractAddress(senderAddress, deploymentNonce, contractHash)`.

5. Encode wallet deploy calldata as CXS `(deploymentNonce, contractHash)` using the protocol writer or codec.

### Deploy and confirm

Build a transaction whose:

- Root invocation targets the sender wallet.
- Entrypoint is the wallet deployment entrypoint.
- Calldata contains the deployment nonce and canonical contract hash.
- `contracts_to_deploy` is `[contract]`.
- Auth claim uses the existing local source-address flow.
- Uniquifier uses its own expiry height and `transactionNonce`.

Sign and submit it, then poll `getTransactionReceipt` with a bounded interval and timeout.

On receipt:

- Require `ExecResult.ExecResultOK`.
- If `returnData` is present, require exactly 32 bytes and equality with `predictedAddress`.
- If successful return data is absent, use the predicted address and label its source as derived.
- Include execution status and abort data in deployment errors.

Do not report success when `sendTransaction` merely accepts the transaction.

### Call and verify Counter

After deployment commits:

1. Build `Counter.increment(predictedAddress, gasLimit, { amount: 5n })`.

2. Wrap it in the wallet's `doAction` invocation, following `examples/transfer-hog.ts`.

3. Build, sign, submit, poll, and require a successful call receipt.

4. Build `Counter.get(predictedAddress, gasLimit)`.

5. Pass its `invoked_address`, `entrypoint`, and `calldata` to `client.view`, with `caller: senderAddress`.

6. Require a return result, decode it with `CxsReader` and `Uint64Codec`, reject trailing bytes, and require `5n`.

7. Print the RPC URL, canonical contract hash, deployment nonce, derived address, deployment transaction hash, call transaction hash, and final value.

This is the smallest end-to-end proof that deployment occurred at the derived address and that the address is the subsequent call target.

Keep receipt polling, deploy calldata encoding, and wallet wrapping as small local functions in this example. Do not refactor `transfer-hog.ts` or add general wallet infrastructure in this PR.

## Documentation

Give each document one role.

### `docs/contract-deployment.md`: deployment model

Add a focused deployment guide that:

- Links to `examples/deploy-counter.ts`.
- Shows root imports for `hashContract` and `deriveContractAddress`.
- States that addresses are derived before deployment.
- Defines the deployment nonce as a caller-chosen 32-byte, CREATE2-style salt unrelated to `Transaction.uniquifier.nonce`.
- Defines the contract hash as SHA-256 of the canonical encoded `Contract`, not raw WASM.
- Explains that `contracts_to_deploy` makes artifacts resolvable but invokes nothing.
- Explains that the root invocation targets the wallet deployment entrypoint.
- States that a placeholder address is an actual, and therefore invalid, call target.
- Notes that repeating the same deployer, deployment nonce, and contract hash attempts the same address and fails after deployment.

### `README.md`: examples index

List all curated examples equally and link to `examples/README.md`. Do not single out deployment as the package's primary use case.

### `examples/README.md`: running the example

Document:

- `npm run example -- examples/deploy-counter.ts`
- The exact compatible local-node version or commit used for validation
- Local account assumptions and environment overrides
- That the fixture is stored in the repository but not shipped in the npm package
- A link to fixture provenance

### `examples/fixtures/README.md`: provenance

Document only the artifact source, clean reproduction steps, license, size, raw checksum, and canonical contract hash.

Add concise TSDoc and one usage example to `hashContract`. Do not require the external `deriveContractAddress` re-export to appear in TypeDoc; root import typechecking and package build are sufficient.

## Tests

Keep the automated coverage focused on behavior owned by this repository.

### 1. Contract hash and address vector

Add `src/contract/hash.test.ts` that:

- Loads the checked-in Counter fixture as a WASM `Contract`.
- Pins its canonical contract hash generated independently by the Rust implementation.
- Calls the root-re-exported `deriveContractAddress` with a fixed deployer and deployment nonce and pins the expected address.

This one vector tests `hashContract`, the root re-export, fixture integrity at the semantic level, and cross-implementation agreement. The fixture README's raw checksum is sufficient for provenance; do not add a second raw-checksum test.

### 2. Non-empty deployment serialization

Extend the existing signed transaction round-trip test to:

- Put one small WASM `Contract` in `contracts_to_deploy`.
- Sign, serialize, and deserialize the transaction through public client helpers.
- Assert the decoded contract type and exact bytes.

Do not add separate unsigned round-trip, deploy-calldata, nonce-independence, or package-export tests. The implementation is straightforward, the example is typechecked, and the existing build and smoke test already validate package entrypoints in ESM and CJS.

### Live verification

Do not run the live deployment in the normal unit suite unless CI provisions a compatible node. Before merge, however, require one recorded successful run against the documented compatible node. Record:

- Node and CLI version or commit
- Deployment transaction hash
- Derived and receipt addresses
- Counter call transaction hash
- Viewed final value of `5`

## Verification

Run the CI sequence:

```sh
npm run format:check
npm run typecheck
npm test
npm run build
```

Then run:

```sh
npm run docs:check
npm run test:smoke
npm run example -- examples/deploy-counter.ts
```

The live example run is a merge requirement for this PR. If no compatible node is available, the PR remains unverified rather than claiming the workstream is complete.

## Expected Changes

Add:

- `src/contract/hash.ts`
- `src/contract/hash.test.ts`
- `examples/deploy-counter.ts`
- `examples/fixtures/counter.wasm`
- `examples/fixtures/README.md`
- `examples/generated/counter.ts`
- `docs/contract-deployment.md`

Modify:

- `src/contract/index.ts`
- `src/index.ts`
- Existing signed transaction round-trip test
- `README.md`
- `examples/README.md`

Do not modify:

- `package.json` exports or published files
- `tsdown.config.ts`
- `src/client.ts`
- Existing standard generated bindings
- `transfer-hog.ts`
- `specs/openrpc.json`

## Out of Scope

- `GroundhogClient.deployContract`
- Runtime-manifest or network-descriptor discovery
- General wallet or receipt-polling abstractions
- Automatic artifact compilation
- Publishing examples or fixtures in the npm package
- Supporting arbitrary deployment initialization
- Testkit changes
- Protocol repository changes in this PR

## PR Shape

Use one focused PR for GH-266:

1. Add `hashContract`, the `deriveContractAddress` root re-export, and two focused tests.

2. Add the clean Counter fixture, example-local binding, and complete deployment example.

3. Add concise conceptual, execution, and provenance documentation.

4. Run all checks and record one successful end-to-end deployment and call.

Do not split the API and example into separate PRs; neither alone gives consumers the supported path requested by GH-266.

## Completion Criteria

The workstream is complete when:

- GH-266's incorrect hash criterion is corrected and the protocol-doc follow-up is linked.
- Consumers can import `hashContract` and `deriveContractAddress` from `@groundhogchain/client`.
- Hashing matches the node, CLI, and Testkit.
- A cleanly reproduced, licensed Counter fixture supports a self-contained example.
- The example deploys Counter, confirms its address, increments it, and reads back `5`.
- Documentation explains the hash, both nonces, wallet invocation, artifact availability, and invalid placeholder approach.
- A non-empty `contracts_to_deploy` survives signed transaction round-trip coverage.
- CI, docs, smoke, and the recorded live example all pass.
