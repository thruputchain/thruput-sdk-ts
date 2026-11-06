import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import {
  codec,
  ContractType,
  HogexecPrecompiledNativeContracts,
  serialize,
  type Contract,
} from "@thruputchain/protocol";
import { hashContract } from "../../contract/hash.js";
import { toBase58 } from "../../encoding.js";
import { testRpc } from "../../testing/nativeRpc.js";
import { toHex0x } from "../hex.js";
import { getEffectiveContractSpec } from "./getEffectiveContractSpec.js";

const address = new Uint8Array(32).fill(7);

it.each([false, true])(
  "snapshots a Buffer address during RPC (substituted: %s)",
  async (substituted) => {
    const input = Buffer.from(address);
    const request = vi.fn().mockImplementation(async () => {
      input.fill(8);
      return {
        address: toBase58(substituted ? input : address),
        context: "nested",
        stateBlockHeight: "42",
        selection: null,
      };
    });
    const result = getEffectiveContractSpec(await testRpc({ request }), {
      address: input,
      context: "nested",
    });
    if (substituted) await expect(result).rejects.toThrow("identity mismatch");
    else await expect(result).resolves.toMatchObject({ artifactSpec: null });
  },
);
const native: Contract = {
  contract_type: ContractType.kNative,
  native_contract_id:
    HogexecPrecompiledNativeContracts.kNativeContractDefaultWallet,
};
const rv32: Contract = {
  contract_type: ContractType.kRv32,
  rv32_contract: {
    data: new Uint8Array(
      readFileSync(
        new URL("../../../examples/fixtures/counter.rv32a", import.meta.url),
      ),
    ),
  },
};
function responses(contract: Contract, source = "networkDefault") {
  const hash = toBase58(hashContract(contract));
  return [
    {
      address: toBase58(address),
      context: "root",
      stateBlockHeight: "42",
      selection: {
        source,
        contract: {
          hash,
          size:
            contract.contract_type === ContractType.kRv32
              ? contract.rv32_contract.data.length
              : 0,
          contractType: contract.contract_type,
        },
      },
    },
    { hash, contractXdr: toHex0x(serialize(contract, codec.Contract)) },
  ] as const;
}

it("uses the shared built-in interface only for a verified native wallet identifier", async () => {
  const [selection, artifact] = responses(native);
  const request = vi
    .fn()
    .mockResolvedValueOnce(selection)
    .mockResolvedValueOnce(artifact);
  const result = await getEffectiveContractSpec(await testRpc({ request }), {
    address,
    context: "root",
  });
  expect(result.nativeInterface?.name).toBe("DefaultWallet");
  expect(
    result.nativeInterface?.spec.interfaces[0]?.methods.map((m) => m.name),
  ).toContain("execute");
  expect(result.artifactSpec?.kind).toBe("native");
});

it.each(["networkDefault", "explicitDeployment"])(
  "reads embedded RV32 metadata for %s without assigning native identity",
  async (source) => {
    const [selection, artifact] = responses(rv32, source);
    const request = vi
      .fn()
      .mockResolvedValueOnce(selection)
      .mockResolvedValueOnce(artifact);
    const result = await getEffectiveContractSpec(await testRpc({ request }), {
      address,
      context: "root",
    });
    expect(result.artifactSpec?.kind).toBe("spec");
    expect(result.nativeInterface).toBeNull();
    expect(result.selection).toHaveProperty("source", source);
  },
);

it("preserves nested absence without fetching an artifact", async () => {
  const request = vi.fn().mockResolvedValue({
    address: toBase58(address),
    context: "nested",
    stateBlockHeight: "42",
    selection: null,
  });
  const result = await getEffectiveContractSpec(await testRpc({ request }), {
    address,
    context: "nested",
  });
  expect(result.artifactSpec).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
});

it("rejects wrong addresses, contexts, nested fallback, and corrupted artifacts", async () => {
  const [selection, artifact] = responses(native);
  for (const [row, bytes, context] of [
    [{ ...selection, address: toBase58(new Uint8Array(32)) }, artifact, "root"],
    [{ ...selection, context: "nested" }, artifact, "root"],
    [{ ...selection, context: "nested" }, artifact, "nested"],
    [selection, { ...artifact, contractXdr: "0x00" }, "root"],
  ] as const) {
    const request = vi
      .fn()
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce(bytes);
    await expect(
      getEffectiveContractSpec(await testRpc({ request }), {
        address,
        context,
      }),
    ).rejects.toThrow();
  }
});

it("does not turn unavailable metadata into contract absence", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(responses(native)[0])
    .mockRejectedValueOnce(new Error("unavailable"));
  await expect(
    getEffectiveContractSpec(await testRpc({ request }), {
      address,
      context: "root",
    }),
  ).rejects.toThrow("unavailable");
});
