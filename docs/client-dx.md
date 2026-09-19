# Contract transactions

Generated method descriptors describe calls. Wallets wrap those calls in an
authorized root invocation. Receipt observation uses public RPC and works after
a wallet disconnects.

## Typed execution

```ts
const call = Counter.increment.call({
  contract: counterAddress,
  args: { amount: 5n },
  gasLimit: callGas,
});

const { values, receipt } = await wallet.executeCallsAndWait(
  { calls: [call] as const, gasLimit: rootGas },
  {
    // Required for provider wallets; signer wallets accept wait options directly.
    onSigned: async (pending) => savePendingTransaction(pending),
    wait: { timeoutMs: 60_000, signal },
  },
);
```

`values` follows call order and retains each method's result type. Multiple calls
execute atomically; an unsupported wallet never falls back to separate writes.
`receipt` remains the original root receipt. Use `decodeExecution(receipt, calls)`
to recover DefaultWallet results after reload without reconnecting the wallet.
Pass another adapter explicitly for other wallets. DevWallet does not preserve
child return values: typed decoding reports unavailable data even when execution
succeeded. Use `executeAndWait` when only commitment/success evidence is needed.

Provider helpers await `onSigned` before broadcasting approved bytes once. Save
the exact signed evidence and original account/network there. A callback failure
prevents broadcast. Submission errors can occur after broadcast; helpers observe
the signed hash rather than re-signing or resubmitting. Timeout and cancellation
stop observation, not the transaction. Retain evidence and resume public receipt
waiting. Direct prepare/sign/submit APIs remain available.

High-level submission helpers wrap observation failures in
`TransactionObservationError`: `txHash` supports recovery, `cause` contains the
waiter's timeout/rejection/cancellation, and `submissionCause` retains an ambiguous
submission error. Result-decoding errors also retain committed receipt evidence.

`client.waitForTransactionReceipt(hash, { signal, expectedNetworkHash })` returns
committed execution failures as receipts. `executeAndWait` requires execution
success. Timeout/rejection errors expose the transaction hash and status/reason;
execution errors retain the receipt. A successful swap enqueue transaction proves
that the request was queued, not that a later crank executed the swap.

## Gas and storage funding

Groundhog gas limits bound computation; gas has no token price and is not burned.
The inner call's limit covers its frame and nested work. The wallet root budget
covers the enclosing execution. HOG locked for storage is a separate requirement.

```ts
import { walletGasLimit } from "@groundhogchain/client/wallet";

const rootGas = walletGasLimit(
  calls.map((call) => call.invocation),
  calibratedWalletOverhead,
);
```

This sums explicit child budgets and a measured overhead, checks u64 overflow,
and does **not** estimate gas. Calibrate against the target runtime and workload.
There is no universally safe SDK overhead constant. A queue-processing contract
may intentionally use its gas budget to choose how much work to perform. Keep
that workload policy explicit. The current RPC cannot simulate full transactions
with measured gas consumption; a view is not a substitute.

## Deployment

```ts
import { prepareContractDeployment } from "@groundhogchain/client/wallet";

const deployment = prepareContractDeployment({
  deployer: accountAddress,
  contract: artifactBytes,
});
await fundAddress(deployment.address);
const transaction = await wallet.prepareDeployment(deployment, rootGas);
// Continue with sign -> persist -> submit, or use deployContractAndWait.
```

Preparation wraps RV32 bytes, hashes the canonical Contract encoding, generates
a deployment nonce once, and predicts the address. It creates no expiring
transaction. The wallet attaches code and uses its root deploy method; receipt
decoding checks the returned address. Deployment nonce and transaction nonce are
different values. The helper does not fund storage automatically.

Factory-created tokens remain typed factory calls with `contractsToDeploy`.
The factory owns its address derivation and initialization semantics.

## Bound reads

```ts
import { getContract } from "@groundhogchain/client/contract";

const counter = getContract({
  binding: Counter,
  address: counterAddress,
  client,
});
const { value, height } = await counter.get.view({});
```

Views preserve their snapshot height and events. Independent reads can observe
different heights, and views can lag a newly indexed receipt. Keep coherent
multi-read snapshot checks and minimum-receipt-height checks in your application.

## Migrating the example apps

Swap's `transactions/transaction-observation.ts` can map SDK waiting errors into
its existing `WriteResult`. Its provider boundary can call `executeAndWait` with
the existing persistence callback, gas policy, expiry and code attachments. Keep
the request-event observer and calibrated crank budget. Infrastructure provisioning
can use deployment preparation, prefunding and deploy-and-wait.

Launchpad can use `executeCallsAndWait` for funding/createToken batches, and
`decodeExecution` for recovery. Remove receipt.returnData replacement and direct
DefaultWallet result indexing. Keep workflow revision checks, token-created/mint
event verification, funding decisions and receipt-height freshness checks.

`createWalletClient` now returns an independent object. The original public client
is unchanged and can be shared by several account bindings.
