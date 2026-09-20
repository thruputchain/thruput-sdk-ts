import {
  AuthClaimType,
  bitMap,
  blockHeight,
  calldata,
  contractAddress,
  contractEntrypointID,
  gasAmount,
  networkHash,
  sha256Hash,
  ContractType,
  weight,
  type Invocation,
} from "@groundhogchain/protocol";
import { verify } from "@noble/ed25519";
import { describe, expect, it, vi } from "vitest";
import { createGroundhogClient } from "../client.js";
import { localnet, mainnet } from "../cluster.js";
import { MockTransport } from "../transport/mock.js";
import { PrivateKeySigner } from "../signers/privateKey.js";
import type { Transport } from "../transport/types.js";
import { createPubkeyAccount, createSourceAddressAccount } from "./account.js";
import { createWalletClient } from "./client.js";
import { transactionSignaturePreimage } from "../transaction/preimage.js";
import {
  defineWalletInvocationAdapter,
  devWalletAdapter,
  type WalletExecutionRequest,
} from "./invocationAdapter.js";

const address = contractAddress(new Uint8Array(32).fill(0x11));
const testNetworkHash = networkHash(sha256Hash(new Uint8Array(32)));

function signer(): PrivateKeySigner {
  const secret = new Uint8Array(32);
  secret[0] = 1;
  return new PrivateKeySigner(secret);
}

function account() {
  return createSourceAddressAccount({
    address,
    signers: [{ signer: signer(), publicKeyId: 0n }],
    allowedKeys: bitMap(1n),
    requiredWeight: weight(1n),
  });
}

function invocation(invokedAddress = address): Invocation {
  return {
    invoked_address: invokedAddress,
    entrypoint: contractEntrypointID(new Uint8Array(8)),
    gas_limit: gasAmount(1_000_000n),
    calldata: calldata(new Uint8Array([1, 2, 3])),
  };
}

describe("wallet account defaults", () => {
  it("binds independent wallets without consuming the public client", async () => {
    const client = await createGroundhogClient({
      transport: new MockTransport(),
    });
    const first = createWalletClient({
      client,
      account: account(),
      networkHash: testNetworkHash,
    });

    const second = createWalletClient({
      client,
      account: createPubkeyAccount({ signer: signer() }),
      networkHash: testNetworkHash,
    });
    expect(first).not.toBe(second);
    expect(client).not.toHaveProperty("account");
    expect(first.account.address).toEqual(address);
    expect(second.account.kind).toBe("pubkey");
  });

  it.each([
    "account",
    "prepareTransaction",
    "signTransaction",
    "sendInvocation",
    "prepareExecution",
    "execute",
  ] as const)(
    "rejects clients with a reserved %s property",
    async (property) => {
      const client = Object.assign(
        await createGroundhogClient({ transport: new MockTransport() }),
        { [property]: () => "unrelated" },
      );

      expect(() =>
        createWalletClient({
          client,
          account: account(),
          networkHash: testNetworkHash,
        }),
      ).toThrow(
        `Client property ${property} conflicts with a wallet client property`,
      );
    },
  );

  it("defaults balance and airdrop recipients to the account address", async () => {
    const calls: Array<{ method: string; params?: unknown[] }> = [];
    const transport: Transport = {
      async request<T>(method: string, params?: unknown[]): Promise<T> {
        calls.push({ method, params });
        if (method === "groundhog_getBalance") {
          return { address: params![0], rawBalance: "7", height: 1 } as T;
        }
        if (method === "groundhog_requestAirdrop") {
          const request = params![0] as { recipient: string };
          return {
            attemptStatus: "succeeded",
            recipient: request.recipient,
            rawAmount: "100",
            txHash: "0x" + "22".repeat(32),
            height: 2,
            status: { result: "ok" },
          } as T;
        }
        throw new Error(`Unexpected method: ${method}`);
      },
    };
    const wallet = createWalletClient({
      client: await createGroundhogClient({ transport }),
      account: account(),
      networkHash: testNetworkHash,
    });

    await wallet.getBalance();
    await wallet.requestAirdrop();

    expect(calls[0]!.params).toEqual(["0x" + "11".repeat(32)]);
    expect(calls[1]!.params![0]).toMatchObject({
      recipient: "0x" + "11".repeat(32),
    });
  });

  it("forwards funding overrides", async () => {
    const calls: Array<{ params?: unknown[] }> = [];
    const transport: Transport = {
      async request<T>(_method: string, params?: unknown[]): Promise<T> {
        calls.push({ params });
        const request = params![0] as { recipient: string };
        return {
          attemptStatus: "succeeded",
          recipient: request.recipient,
          rawAmount: "100",
          txHash: "0x" + "22".repeat(32),
          height: 2,
          status: { result: "ok" },
        } as T;
      },
    };
    const client = await createGroundhogClient({ transport });
    const wallet = createWalletClient({
      client,
      account: account(),
      networkHash: testNetworkHash,
    });
    const other = contractAddress(new Uint8Array(32).fill(0x44));
    const nonce = new Uint8Array([1, 2, 3]);

    await wallet.requestAirdrop({
      recipient: other,
      clientNonce: nonce,
      timeoutMs: 100,
    });

    expect(wallet).not.toBe(client);
    expect(calls[0]!.params).toEqual([
      {
        recipient: "0x" + "44".repeat(32),
        clientNonce: "0x010203",
      },
    ]);
  });

  it("forwards funding cancellation and timeout options", async () => {
    const request = vi.fn();
    const abort = new AbortController();
    abort.abort(new Error("cancelled"));

    const cancelledWallet = createWalletClient({
      client: await createGroundhogClient({ transport: { request } }),
      account: account(),
      networkHash: testNetworkHash,
    });
    await expect(
      cancelledWallet.requestAirdrop({ signal: abort.signal }),
    ).rejects.toThrow("cancelled");

    const timedOutWallet = createWalletClient({
      client: await createGroundhogClient({ transport: { request } }),
      account: account(),
      networkHash: testNetworkHash,
    });
    await expect(
      timedOutWallet.requestAirdrop({ timeoutMs: 0 }),
    ).rejects.toThrow("Timed out waiting for airdrop");
    expect(request).not.toHaveBeenCalled();
  });

  it("accepts explicit balance and airdrop recipients", async () => {
    const wallet = createWalletClient({
      client: await createGroundhogClient({ transport: new MockTransport() }),
      account: account(),
      networkHash: testNetworkHash,
    });
    const other = contractAddress(new Uint8Array(32).fill(0x44));

    await expect(wallet.getBalance(other)).resolves.toMatchObject({
      address: other,
    });
    await expect(
      wallet.requestAirdrop({ recipient: other }),
    ).resolves.toMatchObject({ recipient: other });
  });

  it("preserves connected metadata and omits unavailable funding", async () => {
    const transport = new MockTransport();
    const local = await createGroundhogClient({
      cluster: localnet(),
      transport,
    });
    const localWallet = createWalletClient({
      client: local,
      account: account(),
    });
    expect(localWallet.cluster).toBe(local.cluster);
    expect(localWallet.requestAirdrop).toBeTypeOf("function");
    expect(localWallet).not.toHaveProperty("execute");

    const mainnetClient = await createGroundhogClient({
      cluster: mainnet(),
      transport: {
        async request<T>(method: string): Promise<T> {
          if (method === "groundhog_networkInfo") {
            return {
              networkHash: "0x" + "11".repeat(32),
            } as T;
          }
          throw new Error(`Unexpected method: ${method}`);
        },
      },
    });
    const mainnetWallet = createWalletClient({
      client: mainnetClient,
      account: account(),
    });
    expect(mainnetWallet).not.toHaveProperty("requestAirdrop");
  });
});

describe("wallet transactions", () => {
  it("signs with a snapshot of the connected network identity", async () => {
    const client = await createGroundhogClient({
      cluster: localnet(),
      transport: new MockTransport(),
    });
    const walletAccount = account();
    const wallet = createWalletClient({ client, account: walletAccount });
    const transaction = await wallet.prepareTransaction({
      invocation: invocation(),
      nonce: 42n,
      blockExpiryHeight: blockHeight(500n),
    });

    client.network.networkHash.fill(0xff);
    const signed = await wallet.signTransaction(transaction);

    expect(
      verify(
        signed.signatures[0]!.signature.ed25519,
        transactionSignaturePreimage(testNetworkHash, signed.tx),
        walletAccount.signers[0]!.signer.publicKey.ed25519,
      ),
    ).toBe(true);
  });

  it("prepares with tip-based defaults", async () => {
    const wallet = createWalletClient({
      client: await createGroundhogClient({ transport: new MockTransport() }),
      account: account(),
      networkHash: testNetworkHash,
    });

    const transaction = await wallet.prepareTransaction({
      invocation: invocation(),
    });

    expect(transaction.uniquifier.block_expiry_height).toBe(100n);
    expect(transaction.uniquifier.nonce).toBeGreaterThanOrEqual(0n);
    expect(transaction.uniquifier.nonce).toBeLessThanOrEqual(
      0xffff_ffff_ffff_ffffn,
    );
    expect(transaction.contracts_to_deploy).toEqual([]);
    expect(transaction.auth_claim.claim_type).toBe(
      AuthClaimType.kSourceAddressAuthData,
    );
  });

  it("preserves explicit preparation values without querying the tip", async () => {
    const getChainTip = async () => {
      throw new Error("tip should not be queried");
    };
    const wallet = createWalletClient({
      client: {
        ...(await createGroundhogClient({ transport: new MockTransport() })),
        getChainTip,
      },
      account: account(),
      networkHash: testNetworkHash,
    });

    const transaction = await wallet.prepareTransaction({
      invocation: invocation(),
      nonce: 42n,
      blockExpiryHeight: blockHeight(500n),
    });

    expect(transaction.uniquifier).toEqual({
      block_expiry_height: 500n,
      nonce: 42n,
    });
  });

  it("snapshots mutable inputs before awaiting the chain tip", async () => {
    let releaseTip!: () => void;
    const tipGate = new Promise<void>((resolve) => {
      releaseTip = resolve;
    });
    const root = invocation();
    const contract = {
      contract_type: ContractType.kRv32,
      rv32_contract: { data: new Uint8Array([1, 2, 3]) },
    } as const;
    const client = {
      ...(await createGroundhogClient({ transport: new MockTransport() })),
      async getChainTip() {
        await tipGate;
        return {
          height: 10n,
          blockHash: new Uint8Array(32) as never,
        };
      },
    };
    const wallet = createWalletClient({
      client,
      account: account(),
      networkHash: testNetworkHash,
    });
    const pending = wallet.prepareTransaction({
      invocation: root,
      contractsToDeploy: [contract],
    });

    root.calldata.fill(0xff);
    contract.rv32_contract.data.fill(0xff);
    releaseTip();
    const transaction = await pending;

    expect(transaction.invocation.calldata).toEqual(new Uint8Array([1, 2, 3]));
    expect(transaction.contracts_to_deploy[0]).toMatchObject({
      rv32_contract: { data: new Uint8Array([1, 2, 3]) },
    });
  });

  it("uses an explicit expiry offset and deployment contracts", async () => {
    const wallet = createWalletClient({
      client: await createGroundhogClient({ transport: new MockTransport() }),
      account: account(),
      networkHash: testNetworkHash,
    });
    const contract = {
      contract_type: ContractType.kRv32,
      rv32_contract: { data: new Uint8Array([1]) },
    } as const;

    const transaction = await wallet.prepareTransaction({
      invocation: invocation(),
      nonce: 9n,
      expiryBlocks: 25n,
      contractsToDeploy: [contract],
    });

    expect(transaction.uniquifier.block_expiry_height).toBe(25n);
    expect(transaction.contracts_to_deploy).toEqual([contract]);
  });

  it("signs and submits an invocation", async () => {
    const wallet = createWalletClient({
      client: await createGroundhogClient({ transport: new MockTransport() }),
      account: account(),
      networkHash: testNetworkHash,
    });

    const txHash = await wallet.sendInvocation({
      invocation: invocation(),
      nonce: 42n,
      blockExpiryHeight: blockHeight(500n),
    });

    expect(txHash).toHaveLength(32);
  });

  it("snapshots signer entries before awaiting transaction preparation", async () => {
    let releaseTip!: () => void;
    const tipGate = new Promise<void>((resolve) => {
      releaseTip = resolve;
    });
    let submitted: { signatures: Array<{ public_key_id: bigint }> } | undefined;
    const mutableAccount = account();
    const mutableSigners = mutableAccount.signers.map((entry) => ({
      ...entry,
    }));
    const client = {
      ...(await createGroundhogClient({ transport: new MockTransport() })),
      async getChainTip() {
        await tipGate;
        return { height: 10n, blockHash: new Uint8Array(32) as never };
      },
      async sendTransaction(signed: typeof submitted) {
        submitted = signed;
        return new Uint8Array(32) as never;
      },
    };
    const wallet = createWalletClient({
      client,
      account: { ...mutableAccount, signers: mutableSigners },
      networkHash: testNetworkHash,
    });
    const pending = wallet.sendInvocation({ invocation: invocation() });

    mutableSigners[0]!.publicKeyId = 1n;
    releaseTip();
    await pending;

    expect(submitted?.signatures[0]?.public_key_id).toBe(0n);
  });

  it("rejects mismatched roots and conflicting expiry options", async () => {
    const wallet = createWalletClient({
      client: await createGroundhogClient({ transport: new MockTransport() }),
      account: account(),
      networkHash: testNetworkHash,
    });

    await expect(
      wallet.prepareTransaction({
        invocation: invocation(contractAddress(new Uint8Array(32).fill(0x55))),
      }),
    ).rejects.toThrow("Root invocation address must match");
    await expect(
      wallet.prepareTransaction({
        invocation: invocation(),
        blockExpiryHeight: blockHeight(10n),
        expiryBlocks: 10n,
      }),
    ).rejects.toThrow("mutually exclusive");
  });
});

describe("wallet execution adapters", () => {
  it("uses DefaultWallet automatically for pubkey accounts", async () => {
    const pubkeyAccount = createPubkeyAccount({ signer: signer() });
    const wallet = createWalletClient({
      client: await createGroundhogClient({ transport: new MockTransport() }),
      account: pubkeyAccount,
      networkHash: testNetworkHash,
    });

    const transaction = await wallet.prepareExecution({
      invocation: invocation(contractAddress(new Uint8Array(32).fill(0x55))),
      gasLimit: gasAmount(2_000_000n),
      nonce: 42n,
      blockExpiryHeight: blockHeight(500n),
    });

    expect(transaction.invocation.invoked_address).toEqual(
      pubkeyAccount.address,
    );
    expect(transaction.invocation.gas_limit).toBe(2_000_000n);
    expect(transaction.uniquifier.nonce).toBe(42n);
  });

  it("executes through an explicit source-address adapter", async () => {
    const wallet = createWalletClient({
      client: await createGroundhogClient({ transport: new MockTransport() }),
      account: account(),
      networkHash: testNetworkHash,
      invocationAdapter: devWalletAdapter,
    });

    await expect(
      wallet.execute({
        invocation: invocation(contractAddress(new Uint8Array(32).fill(0x55))),
        gasLimit: gasAmount(2_000_000n),
        nonce: 42n,
        blockExpiryHeight: blockHeight(500n),
      }),
    ).resolves.toHaveLength(32);
  });

  it("passes custom request fields to an explicit adapter", async () => {
    interface CustomRequest extends WalletExecutionRequest {
      readonly marker: number;
    }
    let receivedMarker: number | undefined;
    const customAdapter = defineWalletInvocationAdapter({
      createRootInvocation(accountAddress, request: CustomRequest) {
        receivedMarker = request.marker;
        return invocation(accountAddress);
      },
    });
    const wallet = createWalletClient({
      client: await createGroundhogClient({ transport: new MockTransport() }),
      account: createPubkeyAccount({ signer: signer() }),
      networkHash: testNetworkHash,
      invocationAdapter: customAdapter,
    });

    await wallet.prepareExecution({
      invocation: invocation(),
      gasLimit: gasAmount(1n),
      marker: 7,
      blockExpiryHeight: blockHeight(500n),
    });

    expect(receivedMarker).toBe(7);
  });
});
