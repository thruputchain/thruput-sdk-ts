# Contract Deployment

Contract addresses are derived before deployment from the deploying contract, a caller-chosen 32-byte deployment nonce, and the contract hash:

```ts
import { deriveContractAddress, hashContract } from "@groundhogchain/client";

const contractHash = hashContract(contract);
const address = deriveContractAddress(wallet, deploymentNonce, contractHash);
```

`hashContract` hashes the canonical encoded protocol `Contract`, including its contract type and payload framing. Hashing only the raw WASM bytes produces the wrong contract hash and therefore the wrong address.

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

A placeholder address is an actual call target, not a temporary stand-in. Calling it invokes whichever contract exists there or fails if none does.

See [`examples/deploy-counter.ts`](../examples/deploy-counter.ts) for a complete deployment, call, and read-back flow. See [`examples/fixtures/README.md`](../examples/fixtures/README.md) for the included Counter artifact's provenance.
