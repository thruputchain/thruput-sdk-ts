#!/usr/bin/env node
// Loads every subpath in the package `exports` map under the current Node
// runtime, in both ESM and CJS form.
//
// `npm test` runs src/ through vitest's transform pipeline, so it can pass on
// a runtime that cannot actually load the artifact we publish — a downlevel
// syntax gap, a builtin that is missing on an older major, a broken exports
// entry. This loads the real dist/ files, which is what the CI version matrix
// needs to exercise for the matrix to mean anything.
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));

const failures = [];
let checked = 0;
const requiredExports = {
  ".": [
    "ContractViewError",
    "HttpResponseError",
    "HttpTransport",
    "TransactionReceiptObservationError",
    "Ed25519Signer",
    "createThruputClient",
    "createRpcClient",
    "NativeRpcError",
    "FundingObservationError",
    "createPubkeyAccount",
    "createSourceAddressAccount",
    "createTransaction",
    "createWalletClient",
    "defaultWalletAdapter",
    "defineContractMethod",
    "defineWalletInvocationAdapter",
    "devWalletAdapter",
    "devnet",
  ],
  "./transaction": [
    "createInvocation",
    "createTransaction",
    "serializeTransaction",
    "signTransaction",
  ],
  "./transport": [
    "NativeRpcErrorCode",
    "txInvalidDetail",
    "HttpResponseError",
    "HttpTransport",
    "JsonRpcError",
    "MockTransport",
  ],
  "./contract": [
    "ContractDecodeError",
    "ContractViewError",
    "createContractCodecContext",
    "defineContractEvent",
    "defineContractMethod",
    "fixedArray",
    "fixedBytes",
  ],
  "./contracts": [
    "DefaultWallet",
    "DevWallet",
    "ERC20",
    "ERC20Metadata",
    "SignedOp",
    "decodeERC20Event",
    "default_wallet",
    "groundhog_erc20_if",
    "groundhog_signed_op_if",
  ],
  "./signers": ["Ed25519Signer", "MlDsa65Signer", "verifyMlDsa65"],
  "./actions": [
    "TransactionReceiptObservationError",
    "waitForCommitment",
    "iterateEventPages",
    "iterateTransactionsByRootAddress",
    "iterateTransactionsByBlock",
    "requestAirdrop",
    "requestAirdropAttempt",
    "sendTransaction",
    "readViews",
  ],
  "./provider": [
    "MAX_UNSIGNED_TRANSACTION_BYTES",
    "WalletProviderError",
    "parseWalletSession",
    "parseProviderRequest",
    "registerWalletProvider",
    "discoverWalletProviders",
    "verifySignTransactionResult",
  ],
  "./wallet": [
    "createWalletClient",
    "createPubkeyAccount",
    "defaultWalletAdapter",
    "createProviderWalletClient",
  ],
};

for (const [subpath, entry] of Object.entries(pkg.exports)) {
  const specifier =
    subpath === "." ? pkg.name : `${pkg.name}/${subpath.slice(2)}`;

  for (const condition of ["types", "import", "require"]) {
    const relative = entry[condition];
    if (typeof relative !== "string") {
      failures.push(`${subpath}: missing ${condition} export target`);
      continue;
    }
    const target = fileURLToPath(new URL(relative, root));
    if (!existsSync(target)) {
      failures.push(`${subpath} (${condition}): missing ${relative}`);
    }
  }

  for (const condition of ["import", "require"]) {
    checked++;
    try {
      const mod =
        condition === "import" ? await import(specifier) : require(specifier);
      const names = Object.keys(mod).filter(
        (k) => k !== "default" && k !== "__esModule",
      );
      if (names.length === 0) {
        failures.push(`${subpath} (${condition}): loaded but exported nothing`);
      }
      for (const name of requiredExports[subpath] ?? []) {
        if (!names.includes(name)) {
          failures.push(`${subpath} (${condition}): missing ${name}`);
        }
      }
      if (subpath === "./contracts") {
        if (typeof mod.ERC20?.v0_1?.transfer?.invocation !== "function") {
          failures.push(
            `${subpath} (${condition}): ERC20.v0_1.transfer is not a method descriptor`,
          );
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${subpath} (${condition}): ${message}`);
    }
  }
}

if (failures.length > 0) {
  console.error(
    `Smoke test FAILED on Node ${process.version} (${pkg.name}@${pkg.version}):`,
  );
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error("\nRun `npm run build` first if dist/ is stale.");
  process.exit(1);
}

console.log(
  `Smoke test passed on Node ${process.version}: ${checked} package export conditions loaded from dist/.`,
);
