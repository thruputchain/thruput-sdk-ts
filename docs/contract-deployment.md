# Contract Deployment

Contract addresses are derived before deployment from the deploying contract, a caller-chosen 32-byte deployment nonce, and the contract hash:

```ts
import { deriveContractAddress, hashContract } from "@groundhogchain/client";

const contractHash = hashContract(contract);
const address = deriveContractAddress(wallet, deploymentNonce, contractHash);
```

`hashContract` hashes the canonical encoded protocol `Contract`, including its contract type and payload framing. Hashing only the raw RV32 artifact bytes produces the wrong contract hash and therefore the wrong address.

The deployment nonce is a CREATE2-style salt chosen by the deployer. It is unrelated to `Transaction.uniquifier.nonce`, which prevents transaction replay. Deploying the same contract hash with the same wallet and deployment nonce derives the same address and fails after that address has been deployed.

## Dev-Wallet Flow

Adding a contract to `contracts_to_deploy` makes the artifact resolvable during that transaction. It does not invoke or deploy the contract by itself.

For the local dev wallet:

1. Put the protocol `Contract` in `contracts_to_deploy`.
2. Target the wallet's deployment entrypoint with the root invocation.
3. Encode the deployment nonce and canonical contract hash in the invocation calldata.
4. Sign and submit the transaction.
5. Wait for a successful receipt and confirm its returned address matches the derived address.
6. Use the derived address as the target for subsequent contract calls.

The local DevWallet transfers 100,000,000 base units (10 HOG) from the wallet to
the derived address before deploying it so that address can pay the storage
charge. This is DevWallet policy, not part of the protocol-level
`contracts_to_deploy` mechanism.

`sendTransaction` returns after submission. Use `waitForTransactionReceipt`
before invoking the deployed address, and inspect the returned receipt's
`execResult` to confirm execution succeeded.

A timeout only stops the local wait. The transaction may still commit, so query
the same transaction hash again before constructing or submitting a replacement.

A placeholder address is an actual call target, not a temporary stand-in. Calling it invokes whichever contract exists there or fails if none does.

See [`examples/deploy-counter.ts`](../examples/deploy-counter.ts) for a complete deployment, call, and read-back flow.
