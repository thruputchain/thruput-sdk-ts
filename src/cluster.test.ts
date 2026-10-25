import { toBase58 } from "./encoding.js";
import { describe, expect, it, vi } from "vitest";
import { hashFromHex } from "./actions/hex.js";
import { networkHash } from "@thruputchain/protocol";
import {
  NetworkMismatchError,
  defineCluster,
  devnet,
  futurenet,
  FUTURENET_RPC_URL,
  DEVNET_RPC_URL,
  localnet,
  mainnet,
  LOCALNET_RPC_URL,
} from "./cluster.js";
import { withNativeDiscovery } from "./testing/nativeRpc.js";
import { MockTransport } from "./transport/mock.js";
import { RpcCompatibilityError } from "./rpc/client.js";
import { createThruputClient } from "./client.js";
import type { Transport } from "./transport/types.js";

function protocolNetworkHash(byte: string) {
  return networkHash(hashFromHex("0x" + byte.repeat(32)));
}

function networkTransport(networkByte: string): Transport {
  return withNativeDiscovery({
    async request<T>(method: string): Promise<T> {
      if (method === "getNetworkInfo") {
        return {
          networkHash: toBase58(
            new Uint8Array(32).fill(Number.parseInt(networkByte, 16)),
          ),
        } as T;
      }
      if (method === "getChainTip") {
        return {
          blockHeight: "0",
          blockHash: toBase58(new Uint8Array(32).fill(0x00)),
        } as T;
      }
      throw new Error(`Unexpected method: ${method}`);
    },
  });
}

describe("cluster descriptors", () => {
  it("defines the canonical cluster taxonomy", () => {
    expect(mainnet()).toEqual({
      name: "mainnet",
      capabilities: [],
    });
    expect(futurenet()).toEqual({
      name: "futurenet",
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

  it("preserves the deprecated devnet descriptor and endpoint", () => {
    expect(devnet()).toEqual({ ...futurenet(), name: "devnet" });
    expect(DEVNET_RPC_URL).toBe(FUTURENET_RPC_URL);
  });

  it.each([futurenet, devnet])(
    "preserves hosted overrides and snapshots the identity",
    (cluster) => {
      const pin = protocolNetworkHash("11");
      const descriptor = cluster({
        rpcUrl: "https://rpc.example.com",
        networkHash: pin,
      });
      pin.fill(0x22);
      expect(descriptor.rpcUrl).toBe("https://rpc.example.com");
      expect(descriptor.networkHash).toEqual(new Uint8Array(32).fill(0x11));
      expect(Object.isFrozen(descriptor)).toBe(true);
      expect(() => cluster({ rpcUrl: "not-a-url" })).toThrow();
    },
  );

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
    await expect(client.getChainTip()).resolves.toMatchObject({
      blockHeight: 0n,
    });
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
    const mock = new MockTransport();
    const fetchMock = vi.fn<typeof fetch>(async (_, init) => {
      const request = JSON.parse(String(init?.body));
      return Response.json({
        jsonrpc: "2.0",
        id: request.id,
        result: await mock.request(request.method, request.params),
      });
    });
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
      "Cluster has no default RPC URL; provide a transport or rpcUrl",
    );
  });

  it.each([futurenet, devnet])(
    "accepts an unpinned resettable network",
    async (cluster) => {
      const client = await createThruputClient({
        cluster: cluster(),
        transport: networkTransport("77"),
      });

      expect(client.network.networkHash).toEqual(new Uint8Array(32).fill(0x77));
      expect(client.requestAirdrop).toBeTypeOf("function");
    },
  );

  it("uses the identity snapshot captured before the handshake", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cluster = mainnet({ networkHash: protocolNetworkHash("11") });
    const connection = createThruputClient({
      cluster,
      transport: withNativeDiscovery({
        async request<T>(): Promise<T> {
          await gate;
          return {
            networkHash: toBase58(new Uint8Array(32).fill(0x11)),
          } as T;
        },
      }),
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

    await expect(connection).rejects.toBeInstanceOf(RpcCompatibilityError);
    await expect(connection).rejects.toThrow(
      "RPC network identity does not match",
    );
  });

  it("constructs a diagnostic safely for an unpinned cluster", () => {
    const actual = { networkHash: protocolNetworkHash("44") };

    expect(new NetworkMismatchError(mainnet(), actual).message).toBe(
      "Network mismatch for mainnet: expected an unpinned network, received network 5bV6jUfhDHCQVA1WfKBUnXUsboJgoKgkzkKcxr3joew5",
    );
  });
});
