import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    transaction: "src/transaction/index.ts",
    contract: "src/contract/index.ts",
    contracts: "src/contracts/index.ts",
    signers: "src/signers/index.ts",
    transport: "src/transport/index.ts",
    actions: "src/actions/index.ts",
    "signed-op": "src/signedOp/index.ts",
    provider: "src/provider/index.ts",
    wallet: "src/wallet/index.ts",
  },
  format: ["esm", "cjs"],
  // Match the extensions tsup produced (.js/.d.ts for ESM, .cjs/.d.cts for CJS)
  // so the package.json exports map stays valid.
  fixedExtension: false,
  dts: true,
  sourcemap: true,
});
