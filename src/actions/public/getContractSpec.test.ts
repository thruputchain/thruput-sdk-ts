import { expect, it, vi } from "vitest";
import { codec, ContractType, serialize } from "@thruputchain/protocol";
import { hashContract } from "../../contract/hash.js";
import { toBase58 } from "../../encoding.js";
import { testRpc } from "../../testing/nativeRpc.js";
import { toHex0x } from "../hex.js";
import { getContractSpec } from "./getContractSpec.js";

const address = new Uint8Array(32).fill(7);
const data = new Uint8Array(136);
data.set(new TextEncoder().encode("GHRV32A1"));
new DataView(data.buffer).setUint32(8, 6, true);
new DataView(data.buffer).setUint32(12, 128, true);
new DataView(data.buffer).setUint32(52, 4, true);
const contract = {
  contract_type: ContractType.kRv32,
  rv32_contract: { data },
} as const;
const hash = toBase58(hashContract(contract));
const deployment = {
  address: toBase58(address),
  stateBlockHeight: "42",
  deployment: { hash, size: data.length, contractType: 3 },
};
const artifact = {
  hash,
  contractXdr: toHex0x(serialize(contract, codec.Contract)),
};

it.each([false, true])(
  "snapshots a Buffer address during RPC (substituted: %s)",
  async (substituted) => {
    const input = Buffer.from(address);
    const request = vi.fn().mockImplementation(async () => {
      input.fill(8);
      return {
        ...deployment,
        deployment: null,
        address: toBase58(substituted ? input : address),
      };
    });
    const result = getContractSpec(await testRpc({ request }), {
      address: input,
    });
    if (substituted) await expect(result).rejects.toThrow("address mismatch");
    else await expect(result).resolves.toMatchObject({ artifactSpec: null });
  },
);

it("resolves one snapshot and verifies bytes by that deployment hash", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(deployment)
    .mockResolvedValueOnce(artifact);
  const client = await testRpc({ request });
  const result = await getContractSpec(client, { address });
  expect(result.stateBlockHeight).toBe(42n);
  expect(result.artifactSpec).toEqual({ kind: "absent" });
  expect(request.mock.calls[1]?.slice(0, 2)).toEqual([
    "getContractArtifact",
    { hash },
  ]);
});

it("does not request bytes when the snapshot has no deployment", async () => {
  const request = vi
    .fn()
    .mockResolvedValue({ ...deployment, deployment: null });
  const result = await getContractSpec(await testRpc({ request }), { address });
  expect(result.artifactSpec).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
});

it("rejects substituted content and inconsistent deployment sizes", async () => {
  for (const [row, content] of [
    [deployment, { ...artifact, contractXdr: "0x00" }],
    [
      { ...deployment, deployment: { ...deployment.deployment, size: 1 } },
      artifact,
    ],
  ]) {
    const request = vi
      .fn()
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce(content);
    await expect(
      getContractSpec(await testRpc({ request }), { address }),
    ).rejects.toThrow();
  }
});

it("preserves unavailable-content failures rather than reporting no deployment", async () => {
  const unavailable = new Error("artifact unavailable");
  const request = vi
    .fn()
    .mockResolvedValueOnce(deployment)
    .mockRejectedValueOnce(unavailable);
  await expect(
    getContractSpec(await testRpc({ request }), { address }),
  ).rejects.toBe(unavailable);
});
