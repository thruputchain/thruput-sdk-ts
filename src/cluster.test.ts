import { describe, expect, it, vi } from "vitest";
import { hashFromHex } from "./actions/hex.js";
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
      rpcUrl: DEVNET_RPC_URL,
      capabilities: ["airdrop"],
    });
    expect(localnet()).toEqual({
      name: "localnet",
      networkId: "localnet",
      rpcUrl: LOCALNET_RPC_URL,
      capabilities: ["airdrop"],
    });
  });

  it("preserves custom network identity and capabilities", () => {
    const genesisHash = hashFromHex("0x" + "11".repeat(32));

    expect(
      defineCluster({
        networkId: "company-devnet",
        rpcUrl: "https://rpc.company.example",
        genesisHash,
        capabilities: ["airdrop"],
      }),
    ).toEqual({
      networkId: "company-devnet",
      rpcUrl: "https://rpc.company.example",
      genesisHash,
      capabilities: ["airdrop"],
    });
  });

  it("snapshots and freezes declared capabilities", () => {
    const capabilities: ["airdrop"] = ["airdrop"];
    const cluster = defineCluster({
      networkId: "immutable",
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
        networkId: "transport-only",
        capabilities: [],
      }),
    ).toEqual({
      networkId: "transport-only",
      capabilities: [],
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
      transport: networkTransport("localnet", "22"),
    });

    expect(client.cluster).toEqual(cluster);
    expect(client.cluster).not.toBe(cluster);
    expect(client.network.networkId).toBe("localnet");
    expect(client.requestAirdrop).toBeTypeOf("function");
    await expect(client.getChainTip()).resolves.toMatchObject({ height: 0n });
  });

  it("omits unavailable capabilities at runtime", async () => {
    const client = await createGroundhogClient({
      cluster: mainnet(),
      transport: networkTransport("mainnet", "22"),
    });

    expect(client).not.toHaveProperty("requestAirdrop");
    expect(client).not.toHaveProperty("requestAirdropAttempt");
  });

  it("uses explicitly declared custom capabilities at runtime", async () => {
    const capable = await createGroundhogClient({
      cluster: {
        networkId: "capable",
        capabilities: ["airdrop"],
      },
      transport: networkTransport("capable", "22"),
    });
    const incapable = await createGroundhogClient({
      cluster: {
        networkId: "incapable",
        capabilities: [],
      },
      transport: networkTransport("incapable", "22"),
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
          networkId: "localnet",
          genesisHash: "0x" + "00".repeat(32),
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const client = await createGroundhogClient({ cluster: localnet() });

      expect(client.network.networkId).toBe("localnet");
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
      transport: networkTransport("devnet-preview", "33"),
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
            networkId: "localnet",
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

  it("rejects a different logical network", async () => {
    const connection = createGroundhogClient({
      cluster: mainnet(),
      transport: networkTransport("devnet-preview", "44"),
    });

    await expect(connection).rejects.toBeInstanceOf(NetworkMismatchError);
    await expect(connection).rejects.toThrow(
      "Network mismatch: expected mainnet, received devnet-preview at 0x" +
        "44".repeat(32),
    );
  });

  it("rejects a different pinned genesis", async () => {
    const cluster = localnet({
      genesisHash: hashFromHex("0x" + "55".repeat(32)),
    });

    const connection = createGroundhogClient({
      cluster,
      transport: networkTransport("localnet", "66"),
    });

    await expect(connection).rejects.toBeInstanceOf(NetworkMismatchError);
    await expect(connection).rejects.toThrow(
      "Network mismatch: expected localnet at 0x" +
        "55".repeat(32) +
        ", received localnet at 0x" +
        "66".repeat(32),
    );
  });
});
