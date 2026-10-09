import { describe, expect, it } from "vitest";
import { contractAddress } from "@groundhogchain/protocol";
import { getAddressAuthData } from "./getAddressAuthData.js";
import type { Transport } from "../../transport/types.js";
import { toHex0x } from "../hex.js";
import { createGroundhogClient } from "../../client.js";
import { MockTransport } from "../../transport/mock.js";

const address = contractAddress(new Uint8Array(32).fill(7));
const key = `0x${"11".repeat(32)}`;
function transport(authData: unknown, height: unknown = "42"): Transport {
  return {
    async request<T>() {
      return { address: toHex0x(address), height, authData } as T;
    },
  };
}

describe("getAddressAuthData", () => {
  it("is available through the bound client and mock transport", async () => {
    const client = await createGroundhogClient({
      transport: new MockTransport(),
    });
    await expect(client.getAddressAuthData(address)).resolves.toMatchObject({
      address,
      authData: null,
    });
  });
  it("decodes noncontiguous slots and preserves unknown schemes", async () => {
    const authData = {
      requiredWeight: 3,
      signers: [
        { keyId: 1, maxWeight: 2, publicKey: { scheme: "ed25519", key } },
        {
          keyId: 5,
          maxWeight: 1,
          publicKey: { scheme: "unknown", schemeId: 99 },
        },
      ],
    };
    const result = await getAddressAuthData(
      transport(authData, "9007199254740993"),
      address,
    );
    expect(result.height).toBe(9007199254740993n);
    expect(result.authData).toEqual({
      ...authData,
      signers: [
        {
          keyId: 1,
          maxWeight: 2,
          publicKey: { scheme: "ed25519", key: new Uint8Array(32).fill(0x11) },
        },
        authData.signers[1],
      ],
    });
  });

  it("rejects malformed data instead of treating it as an unregistered address", async () => {
    for (const authData of [
      undefined,
      [],
      {},
      { requiredWeight: 1, signers: null },
      { requiredWeight: -1, signers: [] },
      {
        requiredWeight: 1,
        signers: [
          {
            keyId: 0,
            maxWeight: 1,
            publicKey: { scheme: "ed25519", key: "0x11" },
          },
        ],
      },
      {
        requiredWeight: 1,
        signers: [
          {
            keyId: 0,
            maxWeight: 1,
            publicKey: { scheme: "unknown", schemeId: 2 ** 31 },
          },
        ],
      },
    ]) {
      await expect(
        getAddressAuthData(transport(authData), address),
      ).rejects.toThrow();
    }
    await expect(
      getAddressAuthData(transport(null, 42), address),
    ).rejects.toThrow();
  });

  it("forwards request options and preserves read failures", async () => {
    const error = new Error("DB unavailable");
    const options = { signal: new AbortController().signal };
    const failing: Transport = {
      async request(_method, params, received) {
        expect(params).toEqual([toHex0x(address)]);
        expect(received).toBe(options);
        throw error;
      },
    };
    await expect(getAddressAuthData(failing, address, options)).rejects.toBe(
      error,
    );
  });
});
