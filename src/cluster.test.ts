import { describe, expect, it } from "vitest";
import { hashFromHex } from "./actions/hex.js";
import {
  NetworkMismatchError,
  customCluster,
  defineCluster,
  devnet,
  localnet,
  mainnet,
} from "./cluster.js";
import { connectGroundhogClient } from "./client.js";
import type { Transport } from "./transport/types.js";

function networkTransport(networkId: string, byte: string): Transport {
  return {
    async request<T>(method: string): Promise<T> {
      if (method === "groundhog_networkInfo") {
        return {
          networkId,
          genesisHash: "0x" + byte.repeat(32),
        } as T;
      }
      if (method === "groundhog_chainTip") {
        return {
          height: 0,
          blockHash: "0x" + "00".repeat(32),
        } as T;
      }
      throw new Error(`Unexpected method: ${method}`);
    },
  };
}

describe("cluster descriptors", () => {
  it("defines the canonical cluster taxonomy", () => {
    expect(mainnet()).toEqual({
      name: "mainnet",
      networkId: "mainnet",
      capabilities: [],
    });
    expect(devnet()).toEqual({
      name: "devnet",
      networkId: "devnet-preview",
      capabilities: ["airdrop"],
    });
    expect(localnet()).toEqual({
      name: "localnet",
      networkId: "localnet",
      capabilities: ["airdrop"],
    });
  });

  it("preserves custom network identity and capabilities", () => {
    const genesisHash = hashFromHex("0x" + "11".repeat(32));

    expect(
      customCluster({
        networkId: "company-devnet",
        genesisHash,
        capabilities: ["airdrop"],
      }),
    ).toEqual({
      name: "custom",
      networkId: "company-devnet",
      genesisHash,
      capabilities: ["airdrop"],
    });
  });

  it("rejects an empty network identifier", () => {
    expect(() =>
      defineCluster({
        name: "custom",
        networkId: "  ",
        capabilities: [],
      }),
    ).toThrow("Cluster networkId must not be empty");
  });
});

describe("connectGroundhogClient", () => {
  it("returns a client carrying validated runtime identity", async () => {
    const cluster = localnet();
    const client = await connectGroundhogClient({
      cluster,
      transport: networkTransport("localnet", "22"),
    });

    expect(client.cluster).toBe(cluster);
    expect(client.network.networkId).toBe("localnet");
    await expect(client.getChainTip()).resolves.toMatchObject({ height: 0n });
  });

  it("accepts an unpinned resettable network genesis", async () => {
    const client = await connectGroundhogClient({
      cluster: devnet(),
      transport: networkTransport("devnet-preview", "33"),
    });

    expect(client.network.genesisHash).toEqual(new Uint8Array(32).fill(0x33));
  });

  it("rejects a different logical network", async () => {
    await expect(
      connectGroundhogClient({
        cluster: mainnet(),
        transport: networkTransport("devnet-preview", "44"),
      }),
    ).rejects.toBeInstanceOf(NetworkMismatchError);
  });

  it("rejects a different pinned genesis", async () => {
    const cluster = localnet({
      genesisHash: hashFromHex("0x" + "55".repeat(32)),
    });

    await expect(
      connectGroundhogClient({
        cluster,
        transport: networkTransport("localnet", "66"),
      }),
    ).rejects.toThrow(/Network mismatch/);
  });
});
