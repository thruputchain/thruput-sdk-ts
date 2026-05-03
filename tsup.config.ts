import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    transaction: "src/transaction/index.ts",
    contract: "src/contract/index.ts",
    signers: "src/signers/index.ts",
    transport: "src/transport/index.ts",
    actions: "src/actions/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
});
