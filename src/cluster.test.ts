import { describe, expect, it, vi } from "vitest";
import { hashFromHex } from "./actions/hex.js";
import { networkHash } from "@groundhogchain/protocol";
import {
  NetworkMismatchError,
  defineCluster,
  devnet,
  localnet,
  mainnet,
  DEVNET_RPC_URL,
  LOCALNET_RPC_URL,
} from "./cluster.js";
import { createGroundhogClient } from "./client.js";
import type { Transport } from "./transport/types.js";

function protocolNetworkHash(byte: string) {
  return networkHash(hashFromHex("0x" + byte.repeat(32)));
}

function networkTransport(networkByte: string, genesisByte: string): Transport {
  return {
    async request<T>(method: string): Promise<T> {
      if (method === "groundhog_networkInfo") {
        return {
          networkHash: "0x" + networkByte.repeat(32),
          genesisHash: "0x" + genesisByte.repeat(32),
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
      capabilities: [],
    });
    expect(devnet()).toEqual({
      name: "devnet",
      rpcUrl: DEVNET_RPC_URL,
      capabilities: ["airdrop"],
    });
    expect(localnet()).toEqual({
      name: "localnet",
      networkHash: new Uint8Array(32),
      rpcUrl: LOCALNET_RPC_URL,
      capabilities: ["airdrop"],
    });
  });

  it("preserves custom network identity and capabilities", () => {
    const genesisHash = hashFromHex("0x" + "11".repeat(32));
    const expectedNetworkHash = protocolNetworkHash("22");

    expect(
      defineCluster({
        networkHash: expectedNetworkHash,
        rpcUrl: "https://rpc.company.example",
        genesisHash,
        capabilities: ["airdrop"],
      }),
    ).toEqual({
      networkHash: expectedNetworkHash,
      rpcUrl: "https://rpc.company.example",
      genesisHash,
      capabilities: ["airdrop"],
    });
  });

  it("snapshots and freezes declared capabilities", () => {
    const capabilities: ["airdrop"] = ["airdrop"];
    const cluster = defineCluster({
      capabilities,
    });

    capabilities.pop();

    expect(cluster.capabilities).toEqual(["airdrop"]);
    expect(Object.isFrozen(cluster)).toBe(true);
    expect(Object.isFrozen(cluster.capabilities)).toBe(true);
  });

  it("snapshots a pinned genesis hash", () => {
    const genesisHash = hashFromHex("0x" + "11".repeat(32));
    const cluster = localnet({ genesisHash });

    genesisHash.fill(0x22);

    expect(cluster.genesisHash).toEqual(new Uint8Array(32).fill(0x11));
  });

  it("allows transport-only custom clusters without a default URL", () => {
    expect(
      defineCluster({
        capabilities: [],
      }),
    ).toEqual({
      capabilities: [],
    });
  });

  it("supports endpoint overrides and rejects invalid URLs", () => {
    expect(devnet({ rpcUrl: "https://rpc.devnet.example" }).rpcUrl).toBe(
      "https://rpc.devnet.example",
    );
    expect(() => localnet({ rpcUrl: "not-a-url" })).toThrow(
      "Cluster rpcUrl must be an absolute HTTP URL",
    );
  });
});

describe("createGroundhogClient", () => {
  it("returns a client carrying validated runtime identity", async () => {
    const cluster = localnet();
    const client = await createGroundhogClient({
      cluster,
      transport: networkTransport("00", "22"),
    });

    expect(client.cluster).toEqual(cluster);
    expect(client.cluster).not.toBe(cluster);
    expect(client.network.networkHash).toEqual(new Uint8Array(32));
    expect(client.requestAirdrop).toBeTypeOf("function");
    await expect(client.getChainTip()).resolves.toMatchObject({ height: 0n });
  });

  it("omits unavailable capabilities at runtime", async () => {
    const client = await createGroundhogClient({
      cluster: mainnet(),
      transport: networkTransport("11", "22"),
    });

    expect(client).not.toHaveProperty("requestAirdrop");
    expect(client).not.toHaveProperty("requestAirdropAttempt");
  });

  it("uses explicitly declared custom capabilities at runtime", async () => {
    const capable = await createGroundhogClient({
      cluster: {
        capabilities: ["airdrop"],
      },
      transport: networkTransport("11", "22"),
    });
    const incapable = await createGroundhogClient({
      cluster: {
        capabilities: [],
      },
      transport: networkTransport("11", "22"),
    });

    expect(capable.requestAirdrop).toBeTypeOf("function");
    expect(incapable).not.toHaveProperty("requestAirdrop");
  });

  it("uses the cluster's default HTTP endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          networkHash: "0x" + "00".repeat(32),
          genesisHash: "0x" + "00".repeat(32),
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const client = await createGroundhogClient({ cluster: localnet() });

      expect(client.network.networkHash).toEqual(new Uint8Array(32));
      expect(fetchMock).toHaveBeenCalledWith(
        LOCALNET_RPC_URL,
        expect.objectContaining({ method: "POST" }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("requires an explicit endpoint for mainnet", async () => {
    await expect(createGroundhogClient({ cluster: mainnet() })).rejects.toThrow(
      "Cluster mainnet has no default RPC URL; provide a transport or rpcUrl",
    );
  });

  it("accepts an unpinned resettable network genesis", async () => {
    const client = await createGroundhogClient({
      cluster: devnet(),
      transport: networkTransport("77", "33"),
    });

    expect(client.network.genesisHash).toEqual(new Uint8Array(32).fill(0x33));
  });

  it("uses the identity snapshot captured before the handshake", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cluster = localnet({
      genesisHash: hashFromHex("0x" + "11".repeat(32)),
    });
    const connection = createGroundhogClient({
      cluster,
      transport: {
        async request<T>(): Promise<T> {
          await gate;
          return {
            networkHash: "0x" + "00".repeat(32),
            genesisHash: "0x" + "11".repeat(32),
          } as T;
        },
      },
    });

    cluster.genesisHash!.fill(0x22);
    release();

    await expect(connection).resolves.toMatchObject({
      cluster: { genesisHash: new Uint8Array(32).fill(0x11) },
    });
  });

  it("rejects a different pinned network", async () => {
    const connection = createGroundhogClient({
      cluster: mainnet({ networkHash: protocolNetworkHash("11") }),
      transport: networkTransport("44", "55"),
    });

    await expect(connection).rejects.toBeInstanceOf(NetworkMismatchError);
    await expect(connection).rejects.toThrow(
      "Network mismatch: expected network 0x" +
        "11".repeat(32) +
        ", received network 0x" +
        "44".repeat(32) +
        ", genesis 0x" +
        "55".repeat(32),
    );
  });

  it("rejects a different pinned genesis", async () => {
    const cluster = localnet({
      genesisHash: hashFromHex("0x" + "55".repeat(32)),
    });

    const connection = createGroundhogClient({
      cluster,
      transport: networkTransport("00", "66"),
    });

    await expect(connection).rejects.toBeInstanceOf(NetworkMismatchError);
    await expect(connection).rejects.toThrow(
      "Network mismatch: expected network 0x" +
        "00".repeat(32) +
        ", genesis 0x" +
        "55".repeat(32) +
        ", received network 0x" +
        "00".repeat(32) +
        ", genesis 0x" +
        "66".repeat(32),
    );
  });
});
