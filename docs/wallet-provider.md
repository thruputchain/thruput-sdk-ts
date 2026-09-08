# Groundhog Wallet Provider 1.0.0

This is the normative, framework-neutral contract for GH-157 and GH-158.
MUST, MUST NOT, and SHOULD describe requirements on conforming implementations.
Import wire types, validation, and discovery from `@groundhogchain/client/provider`;
import SDK wallet builders and the external adapter from `@groundhogchain/client/wallet`.
No React, extension runtime, Ethereum compatibility, or global singleton is required.

## Wire Contract

```ts
interface WalletAccount {
  address: string;
  publicKey: string;
  nonce: string;
}
interface WalletSession {
  networkHash: string;
  accounts: readonly WalletAccount[];
}
interface WalletProvider {
  info: { id: string; name: string; version: "1.0.0" };
  request(request: ProviderRequest): Promise<unknown>;
  on(event: "change", listener: (session: WalletSession) => void): () => void;
}
type ProviderRequest =
  | { method: "connect" }
  | { method: "getSession" }
  | { method: "disconnect" }
  | {
      method: "signTransaction";
      params: { account: string; networkHash: string; transaction: string };
    }
  | {
      method: "submitTransaction";
      params: {
        account: string;
        networkHash: string;
        signedTransaction: string;
      };
    };
```

All addresses, public keys, receipt hashes, and transaction hex MUST be lowercase,
even-length, `0x`-prefixed hex. Addresses, public keys, and hashes are exactly 32
bytes. `networkHash` is exactly 64 lowercase hex characters **without `0x`**,
matching application environment configuration. `nonce` is the account-derivation
nonce, NOT a transaction nonce: canonical decimal u64 (`0` or a nonzero digit
followed by digits, at most 18446744073709551615).

Only protocol pubkey accounts with a valid, non-small-order, prime-order Ed25519
public key are supported. The address MUST equal the protocol derivation of that
key and nonce. Sessions contain at most 32 accounts, with unique addresses.
Parsers reject malformed values rather than normalizing them and return snapshots.

Unsigned `transaction` and `signedTransaction` encode canonical classic XDR
`Transaction` and `SignedTransaction`, respectively. Unsigned XDR is at most
1,048,500 decoded bytes; signed XDR is at most 1,048,576 decoded bytes (1 MiB).
The unsigned limit reserves 76 bytes for the required single Ed25519 signature:
4-byte vector count, 4-byte public-key ID, 4-byte scheme, and 64-byte signature.
Providers MUST enforce the unsigned limit before requesting user approval.
Decoding MUST consume the entire input and re-encoding MUST match
the supplied bytes. Requests MUST have exactly the fields shown above. There is
no arbitrary-byte/message signing, network-addition, or implicit network switch.

## Methods And Events

| Method              | Result                                        | Semantics                                                              |
| ------------------- | --------------------------------------------- | ---------------------------------------------------------------------- |
| `connect`           | `WalletSession`                               | Request origin-scoped permission through wallet UI; reject on refusal. |
| `getSession`        | `WalletSession`                               | Non-interactive snapshot; never prompt or grant access.                |
| `disconnect`        | `null`                                        | Revoke this origin's permission and pending approvals; idempotent.     |
| `signTransaction`   | `{ signedTransaction: string; hash: string }` | Approve and sign the exact unsigned transaction; NEVER broadcast.      |
| `submitTransaction` | `{ hash: string }`                            | Broadcast only exact previously approved signed bytes.                 |

A disconnected or unauthorized origin sees `accounts: []`, retaining the wallet's
current network hash. `connect` success includes at least one authorized account.
Providers MUST emit `change` with a full session snapshot when accounts,
authorization, account metadata, or network changes, including disconnect. `on`
returns an idempotent unsubscribe function; it does not itself emit a snapshot.
Pending operations MUST check authorization again before signing or broadcasting.

Signing MUST verify the requested account and network against the origin's current
session. The transaction root address and pubkey auth claim MUST match the selected
account. The result MUST preserve the entire unsigned transaction byte-for-byte
and contain exactly one Ed25519 signature with public-key ID zero. Verify strictly
(not ZIP-215) over the SDK's `transactionSignaturePreimage(networkHash, tx)`.
Both the public key and signature point R MUST be non-small-order, prime-order
points; a cofactored verification equation alone is insufficient.
`hash` MUST be `0x` plus lowercase SHA-256 of the unsigned transaction XDR, matching
the RPC transaction/receipt identifier; signatures and network are not hashed.

The provider MUST retain approved signed bytes bound to the trusted caller origin,
account, and network. Submission MUST reject bytes not in this approval set,
including alternative signatures with the same transaction hash. Do not derive
origin from page-supplied parameters. Clear approvals on disconnect and session
changes. Bound retained approvals (recommended: one, replacing the previous
approval); fail closed on eviction, restart, or lost state. Approval is not a
general authorization to sign or send other transactions. Discovery and page-side
validation are NOT a security boundary: an extension must enforce these rules in
its trusted background process, using authenticated browser sender metadata.

## Errors And Bounds

`WalletProviderError(code, message)` extends `Error`. Across serialization boundaries,
preserve the numeric `code` and a human-readable `message`; `instanceof` is not a
cross-realm guarantee. `parseWalletProviderError` validates and reconstructs it.

| Code   | Meaning                                                              |
| ------ | -------------------------------------------------------------------- |
| 4001   | User rejected the request.                                           |
| 4100   | Origin/account unauthorized, stale session, or no matching approval. |
| 4200   | Unsupported method.                                                  |
| 4900   | Provider disconnected or transport unavailable.                      |
| 4901   | Requested network does not match.                                    |
| -32602 | Invalid parameters, noncanonical encoding, or exceeded input limits. |
| -32603 | Internal error or invalid provider result.                           |
| -32002 | Another operation is pending.                                        |

Provider IDs contain 1-64 ASCII letters, digits, dots, underscores, or hyphens;
names contain 1-80 characters, no control characters or surrounding whitespace.
Version MUST be `1.0.0`. Error messages are bounded to 1,024 characters. Treat names
as text, never HTML. Unknown methods return 4200; malformed known requests return
-32602. Bridges MUST bound raw messages before JSON parsing (transaction hex is at
most 2,097,002 unsigned or 2,097,154 signed characters, including `0x`) and bound
pending UI requests. The SDK adapter permits
one in-flight operation and retains one signed approval, without automatic retries.

## Discovery

`registerWalletProvider(provider, target = window)` validates the provider, listens
for `groundhog:requestProvider`, and immediately dispatches
`CustomEvent("groundhog:announceProvider", { detail: provider })` on that target.
It repeats that announcement for requests. Its cleanup removes the listener.

`discoverWalletProviders(listener, target = window)` installs the announcement
listener before dispatching `groundhog:requestProvider`. It validates each provider,
ignores malformed announcements, and reports each ID once, accepting at most 32
IDs per discovery subscription. The first valid announcement for an ID wins.
Cleanup removes the listener and releases retained IDs. Multiple IDs and either
load order work; there is no polling or `window.groundhog` assignment. Importing
either subpath is safe without a browser; pass an `EventTarget` outside a browser.
Discovery is not identity attestation: IDs/names can be spoofed by page scripts.

## Validation Helpers

The `/provider` entrypoint exports these helpers for wallets and bridges:

- `parseWalletAccount`, `parseWalletSession`, `parseWalletProviderInfo`, and
  `parseWalletProvider` validate their named boundaries.
- `parseWalletHex32` and `parseWalletNetworkHash` validate the two hex formats.
- `parseProviderRequest` validates the exact request union and canonical XDR.
- `parseTransactionHex` and `parseSignedTransactionHex` return protocol objects
  after bounded, canonical XDR decoding; they do not verify signatures.
- `parseSignTransactionResult` and `parseSubmitTransactionResult` validate result
  structure and encoding, not prior approval or hash correctness.
- `assertWalletTransaction(tx, account)` checks root address and pubkey claim.
- `verifySignTransactionResult(value, transaction, account, networkHash)` returns
  `Promise<SignTransactionResult>` after verifying exact unsigned hex, signature,
  and canonical hash. Signature verification requires Web Crypto (HTTPS or
  localhost in browsers). It does not establish origin authorization.
- `parseWalletProviderError` reconstructs a bounded, recognized error.

The exported bounds are `MAX_TRANSACTION_BYTES = 1_048_576`,
`MAX_UNSIGNED_TRANSACTION_BYTES = MAX_TRANSACTION_BYTES - 76` (1,048,500),
`MAX_WALLET_ACCOUNTS = 32`, and `MAX_DISCOVERED_PROVIDERS = 32`.
Event names are exported as `REQUEST_PROVIDER_EVENT` and `ANNOUNCE_PROVIDER_EVENT`.

## SDK Adapter

```ts
import { parseWalletSession } from "@groundhogchain/client/provider";
import { createProviderWalletClient } from "@groundhogchain/client/wallet";

const session = parseWalletSession(
  await provider.request({ method: "connect" }),
);
const account = session.accounts[0];
if (!account) throw new Error("No authorized account");
const wallet = createProviderWalletClient({
  client,
  provider,
  account,
  networkHash: session.networkHash,
});
try {
  const tx = await wallet.prepareExecution({ invocation, gasLimit });
  const signed = await wallet.signTransaction(tx);
  // This write MUST finish successfully before asking to broadcast.
  await persistPending({
    ...signed,
    account,
    networkHash: session.networkHash,
  });
  const { hash } = await wallet.submitTransaction(signed);
  // Query the receipt using this hash on the same network.
} finally {
  wallet.dispose();
}
```

The factory is synchronous and does not connect or mutate/decorate `client`.
`account` is a wire `WalletAccount`. `prepareExecution(PrepareExecutionRequest)`
returns `Promise<Transaction>` using the existing default-wallet wrapper, random
transaction nonce, and expiry handling. `signTransaction(Transaction)` returns
`Promise<SignTransactionResult>` (the wire result above).
`submitTransaction(SignTransactionResult)` returns `Promise<SubmitTransactionResult>`.
`dispose(): void` unsubscribes and irreversibly invalidates this adapter, but does
not revoke provider permission. No raw signer, `execute`, or implicit submit exists.
The existing local-signer `WalletAccount` type remains in `/wallet`; the wire
`WalletAccount` type is in `/provider` to avoid a breaking name collision.

The adapter snapshots configuration, validates account derivation and any validated
client network identity, and checks `getSession` before preparation, signing, and
submission. It invalidates on every `change`, failed session read, or mismatched
session. Recreate it after reconnect or a change. It also checks for changes while
operations are pending. It verifies exact transaction bytes, authorization claim,
strict signature, and both returned hashes. Submission only accepts the latest
successfully verified result from this adapter. Inputs are snapshotted before any
asynchronous work. Invalid provider results fail closed.
The adapter does not impose a UI timeout or cancel provider requests on disposal;
providers and bridges own request deadlines. A late result cannot reactivate a
disposed adapter or cause it to submit.

## Submission Ambiguity

A submit response is a broadcast acknowledgement, NOT a successful execution
receipt. A timeout, disconnect, network change, or invalid hash after submit may
occur **after broadcast**. Once submit starts, all failures must be treated as
potentially submitted. Preserve the previously persisted canonical hash and query
status/receipt on the original network. Never automatically prepare/sign a new
transaction, change its nonce, or retry execution. Re-sending identical bytes may
be considered only through an explicit recovery policy and a still-valid provider
approval. The adapter consumes its approval when submission starts, even on error.
Persistence failure before submit means no broadcast was requested by the adapter.

Full simulation, arbitrary networks, message signing, WalletConnect, hardware
wallets, and source-address/legacy account support are outside version 1.0.0.
