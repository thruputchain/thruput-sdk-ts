import { expect, it, vi } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { codec, deserialize, serialize } from "@thruputchain/protocol";
import vectors from "../../../specs/test-vectors/pubkey_auth.json";
import { testRpc } from "../../testing/nativeRpc.js";
import { fromHex0x, toHex0x } from "../hex.js";
import { toBase58 } from "../../encoding.js";
import { readTransactionInput } from "./readTransactionInput.js";

const signed = deserialize(
  fromHex0x(`0x${vectors.signing[0]!.signed_transaction_xdr}`),
  codec.SignedTransaction,
);
const bytes = serialize(signed.tx, codec.Transaction);
const hash = sha256(bytes);
const available = {
  status: "available",
  transactionHash: toBase58(hash),
  blockHeight: "42",
  transactionXdr: toHex0x(bytes),
};

it("verifies the Transaction hash preimage and exposes the retained root invocation", async () => {
  const request = vi.fn().mockResolvedValue(available);
  const result = await readTransactionInput(await testRpc({ request }), {
    transactionHash: hash,
  });
  expect(result).toMatchObject({
    status: "available",
    blockHeight: 42n,
    transaction: signed.tx,
  });
});

it("rejects the signed wrapper even when it contains the requested body", async () => {
  const request = vi.fn().mockResolvedValue({
    ...available,
    transactionXdr: `0x${vectors.signing[0]!.signed_transaction_xdr}`,
  });
  await expect(
    readTransactionInput(await testRpc({ request }), { transactionHash: hash }),
  ).rejects.toThrow("hash mismatch");
});

it("rejects noncanonical bytes even if their digest matches", async () => {
  const trailing = new Uint8Array(bytes.length + 4);
  trailing.set(bytes);
  const wanted = sha256(trailing);
  const request = vi.fn().mockResolvedValue({
    ...available,
    transactionHash: toBase58(wanted),
    transactionXdr: toHex0x(trailing),
  });
  await expect(
    readTransactionInput(await testRpc({ request }), {
      transactionHash: wanted,
    }),
  ).rejects.toThrow();
});

it("retains unavailable without inferring transaction status", async () => {
  const request = vi.fn().mockResolvedValue({ status: "unavailable" });
  expect(
    await readTransactionInput(await testRpc({ request }), {
      transactionHash: hash,
    }),
  ).toEqual({ status: "unavailable" });
});
