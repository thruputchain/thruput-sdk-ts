import { describe, expect, it, vi } from "vitest";
import { hashFromHex } from "./actions/hex.js";
import { networkHash } from "@thruputchain/protocol";
import {
  NetworkMismatchError,
  defineCluster,
  devnet,
  localnet,
  mainnet,
  LOCALNET_RPC_URL,
} from "./cluster.js";
import { createThruputClient } from "./client.js";
import type { Transport } from "./transport/types.js";

function protocolNetworkHash(byte: string) {
  return networkHash(hashFromHex("0x" + byte.repeat(32)));
}

function networkTransport(networkByte: string): Transport {
  return {
    async request<T>(method: string): Promise<T> {
      if (method === "groundhog_networkInfo") {
        return {
          networkHash: "0x" + networkByte.repeat(32),
        } as T;
      }
      if (method === "groundhog_chainTip") {
        return {
          height: "0",
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
      rpcUrl: "https://rpc.thruput.network",
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
    const expectedNetworkHash = protocolNetworkHash("22");

    expect(
      defineCluster({
        networkHash: expectedNetworkHash,
        rpcUrl: "https://rpc.company.example",
        capabilities: ["airdrop"],
      }),
    ).toEqual({
      networkHash: expectedNetworkHash,
      rpcUrl: "https://rpc.company.example",
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

  it("snapshots a pinned network hash", () => {
    const sourceNetworkHash = protocolNetworkHash("11");
    const cluster = mainnet({ networkHash: sourceNetworkHash });

    sourceNetworkHash.fill(0x22);

    expect(cluster.networkHash).toEqual(new Uint8Array(32).fill(0x11));
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

describe("createThruputClient", () => {
  it("returns a client carrying validated runtime identity", async () => {
    const cluster = localnet();
    const client = await createThruputClient({
      cluster,
      transport: networkTransport("00"),
    });

    expect(client.cluster).toEqual(cluster);
    expect(client.cluster).not.toBe(cluster);
    expect(client.network.networkHash).toEqual(new Uint8Array(32));
    expect(client.requestAirdrop).toBeTypeOf("function");
    await expect(client.getChainTip()).resolves.toMatchObject({ height: 0n });
  });

  it("omits unavailable capabilities at runtime", async () => {
    const client = await createThruputClient({
      cluster: mainnet(),
      transport: networkTransport("11"),
    });

    expect(client).not.toHaveProperty("requestAirdrop");
    expect(client).not.toHaveProperty("requestAirdropAttempt");
  });

  it("uses explicitly declared custom capabilities at runtime", async () => {
    const capable = await createThruputClient({
      cluster: {
        capabilities: ["airdrop"],
      },
      transport: networkTransport("11"),
    });
    const incapable = await createThruputClient({
      cluster: {
        capabilities: [],
      },
      transport: networkTransport("11"),
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
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const client = await createThruputClient({ cluster: localnet() });

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
    await expect(createThruputClient({ cluster: mainnet() })).rejects.toThrow(
      "Cluster mainnet has no default RPC URL; provide a transport or rpcUrl",
    );
  });

  it("accepts an unpinned resettable network", async () => {
    const client = await createThruputClient({
      cluster: devnet(),
      transport: networkTransport("77"),
    });

    expect(client.network.networkHash).toEqual(new Uint8Array(32).fill(0x77));
  });

  it("uses the identity snapshot captured before the handshake", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cluster = mainnet({ networkHash: protocolNetworkHash("11") });
    const connection = createThruputClient({
      cluster,
      transport: {
        async request<T>(): Promise<T> {
          await gate;
          return {
            networkHash: "0x" + "11".repeat(32),
          } as T;
        },
      },
    });

    cluster.networkHash!.fill(0x22);
    release();

    await expect(connection).resolves.toMatchObject({
      cluster: { networkHash: new Uint8Array(32).fill(0x11) },
    });
  });

  it("rejects a different pinned network", async () => {
    const connection = createThruputClient({
      cluster: mainnet({ networkHash: protocolNetworkHash("11") }),
      transport: networkTransport("44"),
    });

    await expect(connection).rejects.toBeInstanceOf(NetworkMismatchError);
    await expect(connection).rejects.toThrow(
      "Network mismatch for mainnet: expected network 0x" +
        "11".repeat(32) +
        ", received network 0x" +
        "44".repeat(32),
    );
  });

  it("constructs a diagnostic safely for an unpinned cluster", () => {
    const actual = { networkHash: protocolNetworkHash("44") };

    expect(new NetworkMismatchError(mainnet(), actual).message).toBe(
      "Network mismatch for mainnet: expected an unpinned network, received network 0x" +
        "44".repeat(32),
    );
  });
});
