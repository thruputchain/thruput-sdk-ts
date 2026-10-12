import { describe, expect, it, vi } from "vitest";
import {
  AuthClaimType,
  CryptographicScheme,
  bitMap,
  weight,
  ed25519PublicKey,
  contractAddress,
  contractEntrypointID,
  calldata,
  type AuthClaim,
} from "@thruputchain/protocol";
import type { Transport } from "../../transport/types.js";
import { toHex0x } from "../hex.js";
import { view } from "./view.js";
import { viewBatch } from "./viewBatch.js";

const address = contractAddress(new Uint8Array(32).fill(1));
const call = {
  contract: address,
  entrypoint: contractEntrypointID(new Uint8Array(8)),
  calldata: calldata(new Uint8Array()),
};
const source: AuthClaim = {
  claim_type: AuthClaimType.kSourceAddressAuthData,
  source_address_claim: {
    allowed_keys: bitMap(5n),
    required_weight: weight(3n),
  },
};
function pubkey(nonce = 9007199254740993n): AuthClaim {
  return {
    claim_type: AuthClaimType.kPubkeySignature,
    pubkey_preimage: {
      pubkey: {
        scheme: CryptographicScheme.Ed25519,
        ed25519: ed25519PublicKey(new Uint8Array(32).fill(7)),
      },
      nonce,
    },
  };
}
const returned = {
  output: { result: "return", returnData: "0x" },
  events: [],
  gasUsed: "12",
};
function stub() {
  const request = vi.fn(async (method: string, params?: unknown[]) =>
    method === "groundhog_viewBatch"
      ? {
          height: "42",
          results: (params as [{ calls: unknown[] }])[0].calls.map(
            () => returned,
          ),
        }
      : { height: "42", ...returned },
  );
  return { request, transport: { request } as Transport };
}

describe("optional view authorization", () => {
  it.each([
    [source, { kind: "sourceAddress", allowedKeys: 5, requiredWeight: 3 }],
    [
      pubkey(),
      {
        kind: "pubkeySignature",
        publicKey: `0x${"07".repeat(32)}`,
        nonce: "9007199254740993",
      },
    ],
  ] as const)(
    "uses the same wire claim for single and batch views",
    async (authClaim, expected) => {
      const { transport, request } = stub();
      await view(transport, { ...call, authClaim });
      await viewBatch(transport, { calls: [{ ...call, authClaim }, call] });
      expect(request.mock.calls[0]![1]).toEqual([
        expect.objectContaining({ authClaim: expected }),
      ]);
      const entries = (
        request.mock.calls[1]![1] as [{ calls: Record<string, unknown>[] }]
      )[0].calls;
      expect(entries[0]!.authClaim).toEqual(expected);
      expect(entries[1]).not.toHaveProperty("authClaim");
    },
  );

  it("leaves omitted claims and per-call callers unchanged", async () => {
    const { transport, request } = stub();
    await view(transport, call);
    await viewBatch(transport, {
      calls: [
        { ...call, caller: address, authClaim: source },
        { ...call, authClaim: pubkey() },
        call,
      ],
    });
    expect((request.mock.calls[0]![1] as object[])[0]).not.toHaveProperty(
      "authClaim",
    );
    const entries = (
      request.mock.calls[1]![1] as [{ calls: Record<string, unknown>[] }]
    )[0].calls;
    expect(entries[0]!.caller).toBe(toHex0x(address));
    expect(entries[1]!.authClaim).not.toEqual(entries[0]!.authClaim);
    expect(entries[2]).not.toHaveProperty("authClaim");
  });

  it.each([
    { claim_type: 99 },
    {
      ...source,
      source_address_claim: { allowed_keys: -1n, required_weight: 0n },
    },
    {
      ...source,
      source_address_claim: { allowed_keys: 1n << 32n, required_weight: 0n },
    },
    {
      ...source,
      source_address_claim: { allowed_keys: 0n, required_weight: 1 },
    },
    {
      claim_type: AuthClaimType.kPubkeySignature,
      pubkey_preimage: { pubkey: { scheme: 99 }, nonce: 0n },
    },
    {
      claim_type: AuthClaimType.kPubkeySignature,
      pubkey_preimage: {
        pubkey: {
          scheme: CryptographicScheme.Ed25519,
          ed25519: new Uint8Array(31),
        },
        nonce: 0n,
      },
    },
    pubkey(1n << 64n),
  ])("rejects malformed claim %# before sending", async (invalid) => {
    const { transport, request } = stub();
    const authClaim = invalid as AuthClaim;
    await expect(view(transport, { ...call, authClaim })).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
