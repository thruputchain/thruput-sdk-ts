import {
  AuthClaimType,
  blockHeight,
  calldata,
  codec,
  contractAddress,
  contractEntrypointID,
  gasAmount,
  networkHash as toNetworkHash,
  serialize,
  sha256Hash,
  toHex,
  type SignedTransaction,
} from "@groundhogchain/protocol";
import { describe, expect, it, vi } from "vitest";
import { Point, utils, verifyAsync } from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { createGroundhogClient } from "../client.js";
import { hashFromHex, toHex0x } from "../actions/hex.js";
import { hashSignedTransaction } from "../derivation/transactionHash.js";
import { PrivateKeySigner } from "../signers/privateKey.js";
import { signTransaction } from "../transaction/sign.js";
import { transactionSignaturePreimage } from "../transaction/preimage.js";
import { MockTransport } from "../transport/mock.js";
import {
  MAX_TRANSACTION_BYTES,
  MAX_UNSIGNED_TRANSACTION_BYTES,
  WalletProviderError,
  parseProviderRequest,
  parseSignedTransactionHex,
  parseTransactionHex,
  parseWalletSession,
  type ProviderRequest,
  type SignTransactionResult,
  type WalletProvider,
  type WalletSession,
} from "../provider/index.js";
import { createPubkeyAccount } from "./account.js";
import { createProviderWalletClient } from "./providerClient.js";
import { defaultWalletAdapter } from "./invocationAdapter.js";

const networkHash = "ab".repeat(32);
const signingNetwork = toNetworkHash(sha256Hash(new Uint8Array(32).fill(0xab)));
const signer = new PrivateKeySigner(new Uint8Array(32).fill(1));
const localAccount = createPubkeyAccount({ signer, nonce: 7n });
const account = {
  address: toHex0x(localAccount.address),
  publicKey: toHex0x(signer.publicKey.ed25519),
  nonce: "7",
};
const execution = {
  invocation: {
    invoked_address: contractAddress(new Uint8Array(32).fill(4)),
    entrypoint: contractEntrypointID(new Uint8Array(8)),
    gas_limit: gasAmount(1000n),
    calldata: calldata(new Uint8Array([1, 2, 3])),
  },
  gasLimit: gasAmount(5000n),
  nonce: 42n,
  blockExpiryHeight: blockHeight(100n),
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function setup(
  initialSession: WalletSession = { networkHash, accounts: [account] },
) {
  const transport = new MockTransport();
  const client = await createGroundhogClient({ transport });
  const listeners = new Set<(session: WalletSession) => void>();
  let session = initialSession;
  let signedResult: SignTransactionResult | undefined;
  const request = vi.fn(async (input: ProviderRequest): Promise<unknown> => {
    const request = parseProviderRequest(input);
    switch (request.method) {
      case "connect":
        if (session.accounts.length === 0)
          change({ networkHash, accounts: [account] });
        return session;
      case "getSession":
        return session;
      case "getCapabilities":
        return {
          account: account.address,
          networkHash,
          atomicBatch: { maxCalls: 16 },
        };
      case "disconnect":
        change({ networkHash, accounts: [] });
        return null;
      case "signTransaction": {
        const signed = await signTransaction(
          parseTransactionHex(request.params.transaction),
          localAccount.signers,
          signingNetwork,
        );
        signedResult = wireResult(signed);
        return signedResult;
      }
      case "submitTransaction":
        if (
          request.params.signedTransaction !== signedResult?.signedTransaction
        )
          throw new WalletProviderError(4100, "No approval");
        return { hash: signedResult.hash };
    }
  });
  const unsubscribe = vi.fn();
  const provider: WalletProvider = {
    info: { id: "test", name: "Test Wallet", version: "1.0.0" },
    supportedMethods: ["getCapabilities"],
    request,
    on(event, listener) {
      expect(event).toBe("change");
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        unsubscribe();
      };
    },
  };
  function change(next: WalletSession, emit = true) {
    session = next;
    if (emit) listeners.forEach((listener) => listener(session));
  }
  const wallet = createProviderWalletClient({
    client,
    provider,
    account,
    networkHash,
  });
  return {
    client,
    transport,
    provider,
    wallet,
    request,
    change,
    unsubscribe,
    listeners,
  };
}

function wireResult(signed: SignedTransaction): SignTransactionResult {
  return {
    signedTransaction: toHex0x(serialize(signed, codec.SignedTransaction)),
    hash: toHex0x(hashSignedTransaction(signed)),
  };
}

describe("provider atomic batches", () => {
  it("does not probe legacy bridges that do not advertise the capability method", async () => {
    const { client, provider, request } = await setup();
    const legacy = createProviderWalletClient({
      client,
      account,
      networkHash,
      provider: {
        info: provider.info,
        request: provider.request,
        on: provider.on,
      },
    });
    await expect(legacy.getCapabilities()).resolves.toEqual({
      account: account.address,
      networkHash,
      atomicBatch: null,
    });
    expect(methodCalls(request, "getCapabilities")).toHaveLength(0);
    await expect(legacy.prepareExecution(execution)).resolves.toBeDefined();
    legacy.dispose();
  });
  it("prepares, signs, and submits one root for several calls", async () => {
    const { wallet, request } = await setup();
    expect((await wallet.getCapabilities()).atomicBatch?.maxCalls).toBe(16);
    const tx = await wallet.prepareBatchExecution({
      ...execution,
      invocations: [execution.invocation, execution.invocation],
    });
    const signed = await wallet.signTransaction(tx);
    await expect(wallet.submitTransaction(signed)).resolves.toEqual({
      hash: signed.hash,
    });
    expect(methodCalls(request, "signTransaction")).toHaveLength(1);
    expect(methodCalls(request, "submitTransaction")).toHaveLength(1);
  });

  it.each([4200, 4900, -32603] as const)(
    "only treats unsupported capability methods as legacy (%s)",
    async (code) => {
      const { wallet, request } = await setup();
      const original = request.getMockImplementation()!;
      request.mockImplementation((input) =>
        input.method === "getCapabilities"
          ? Promise.reject(
              new WalletProviderError(code, "Capability request failed"),
            )
          : original(input),
      );
      if (code === 4200) {
        await expect(wallet.getCapabilities()).resolves.toEqual({
          account: account.address,
          networkHash,
          atomicBatch: null,
        });
        await expect(wallet.prepareExecution(execution)).resolves.toBeDefined();
        await expect(
          wallet.prepareBatchExecution({
            ...execution,
            invocations: [execution.invocation],
          }),
        ).rejects.toMatchObject({ code: 4200 });
      } else
        await expect(wallet.getCapabilities()).rejects.toMatchObject({ code });
      expect(methodCalls(request, "signTransaction")).toHaveLength(0);
    },
  );

  it.each([
    { account: account.address, networkHash, atomicBatch: { maxCalls: 17 } },
    { account: account.address, networkHash, atomicBatch: { maxCalls: 0 } },
    {
      account: account.address,
      networkHash: "cd".repeat(32),
      atomicBatch: null,
    },
    { account: "0x" + "cd".repeat(32), networkHash, atomicBatch: null },
    { account: account.address, networkHash, atomicBatch: true },
  ])("rejects malformed or stale capability scope", async (response) => {
    const { wallet, request } = await setup();
    const original = request.getMockImplementation()!;
    request.mockImplementation((input) =>
      input.method === "getCapabilities"
        ? Promise.resolve(response)
        : original(input),
    );
    await expect(wallet.getCapabilities()).rejects.toMatchObject({
      code: -32603,
    });
    await expect(wallet.prepareExecution(execution)).rejects.toMatchObject({
      code: 4100,
    });
  });

  it("rejects batches over the negotiated call limit", async () => {
    const { wallet, request } = await setup();
    const original = request.getMockImplementation()!;
    request.mockImplementation((input) =>
      input.method === "getCapabilities"
        ? Promise.resolve({
            account: account.address,
            networkHash,
            atomicBatch: { maxCalls: 1 },
          })
        : original(input),
    );
    await expect(
      wallet.prepareBatchExecution({
        ...execution,
        invocations: [execution.invocation, execution.invocation],
      }),
    ).rejects.toMatchObject({ code: 4200 });
  });

  it("invalidates capabilities on a concurrent session change", async () => {
    const { wallet, request, change } = await setup();
    const original = request.getMockImplementation()!;
    request.mockImplementation((input) => {
      if (input.method === "getCapabilities")
        change({ networkHash, accounts: [] });
      return original(input);
    });
    await expect(wallet.getCapabilities()).rejects.toMatchObject({
      code: 4100,
    });
  });
});

function methodCalls(
  request: Awaited<ReturnType<typeof setup>>["request"],
  method: ProviderRequest["method"],
) {
  return request.mock.calls.filter(([input]) => input.method === method);
}

describe("external provider wallet", () => {
  it("delivers connect/disconnect changes before responses and prepares immediately after connect", async () => {
    const {
      client,
      provider,
      wallet: initial,
    } = await setup({
      networkHash,
      accounts: [],
    });
    initial.dispose();
    expect(
      parseWalletSession(await provider.request({ method: "getSession" }))
        .accounts,
    ).toEqual([]);
    const order: string[] = [];
    const stop = provider.on("change", (session) => {
      order.push(session.accounts.length ? "authorized" : "disconnected");
    });
    const session = parseWalletSession(
      await provider.request({ method: "connect" }).then((result) => {
        order.push("connect response");
        return result;
      }),
    );
    const wallet = createProviderWalletClient({
      client,
      provider,
      account: session.accounts[0]!,
      networkHash: session.networkHash,
    });
    try {
      expect((await wallet.prepareExecution(execution)).auth_claim).toEqual(
        localAccount.authClaim,
      );
      expect(await provider.request({ method: "disconnect" })).toBeNull();
      order.push("disconnect response");
      expect(order).toEqual([
        "authorized",
        "connect response",
        "disconnected",
        "disconnect response",
      ]);
      await expect(wallet.prepareExecution(execution)).rejects.toMatchObject({
        code: 4100,
      });
    } finally {
      wallet.dispose();
      stop();
    }
  });

  it("fails closed when a nonconforming provider delivers the connect change after its response", async () => {
    const {
      client,
      provider,
      request,
      change,
      wallet: initial,
    } = await setup({
      networkHash,
      accounts: [],
    });
    initial.dispose();
    request.mockImplementationOnce(async () => {
      const session = { networkHash, accounts: [account] };
      change(session, false);
      return session;
    });
    const session = parseWalletSession(
      await provider.request({ method: "connect" }),
    );
    const wallet = createProviderWalletClient({
      client,
      provider,
      account: session.accounts[0]!,
      networkHash: session.networkHash,
    });
    try {
      // Delayed delivery violates the ordering contract, even for matching data.
      change(session);
      await expect(wallet.prepareExecution(execution)).rejects.toMatchObject({
        code: 4100,
      });
    } finally {
      wallet.dispose();
    }
  });

  it("reserves the single signature envelope before approval and accepts exact size limits", async () => {
    const { wallet, request } = await setup();
    const input = {
      ...execution,
      invocation: {
        ...execution.invocation,
        calldata: calldata(new Uint8Array(1_000_000)),
      },
    };
    const baseline = await wallet.prepareExecution(input);
    input.invocation.calldata = calldata(
      new Uint8Array(
        input.invocation.calldata.length +
          MAX_UNSIGNED_TRANSACTION_BYTES -
          serialize(baseline, codec.Transaction).length,
      ),
    );
    const tx = await wallet.prepareExecution(input);
    const unsigned = toHex0x(serialize(tx, codec.Transaction));
    expect((unsigned.length - 2) / 2).toBe(MAX_UNSIGNED_TRANSACTION_BYTES);
    expect(MAX_UNSIGNED_TRANSACTION_BYTES).toBe(1_048_500);
    expect(
      serialize(parseTransactionHex(unsigned), codec.Transaction).length,
    ).toBe(MAX_UNSIGNED_TRANSACTION_BYTES);
    expect(() =>
      parseProviderRequest({
        method: "signTransaction",
        params: {
          account: account.address,
          networkHash,
          transaction: unsigned,
        },
      }),
    ).not.toThrow();

    const signed = await wallet.signTransaction(tx);
    expect((signed.signedTransaction.length - 2) / 2).toBe(
      MAX_TRANSACTION_BYTES,
    );
    expect(
      parseSignedTransactionHex(signed.signedTransaction).signatures,
    ).toHaveLength(1);
    expect(await wallet.submitTransaction(signed)).toEqual({
      hash: signed.hash,
    });

    // One extra raw byte must fail the size check, not merely XDR decoding.
    for (const [parse, hex, limit] of [
      [parseTransactionHex, unsigned, MAX_UNSIGNED_TRANSACTION_BYTES],
      [
        parseSignedTransactionHex,
        signed.signedTransaction,
        MAX_TRANSACTION_BYTES,
      ],
    ] as const) {
      expect(() => parse(hex + "00")).toThrow(
        expect.objectContaining({
          code: -32602,
          message: `Expected canonical transaction hex of at most ${limit} bytes`,
        }),
      );
    }
    expect(() =>
      parseProviderRequest({
        method: "signTransaction",
        params: {
          account: account.address,
          networkHash,
          transaction: unsigned + "00",
        },
      }),
    ).toThrow(expect.objectContaining({ code: -32602 }));
    expect(() =>
      parseProviderRequest({
        method: "submitTransaction",
        params: {
          account: account.address,
          networkHash,
          signedTransaction: signed.signedTransaction + "00",
        },
      }),
    ).toThrow(expect.objectContaining({ code: -32602 }));

    // Canonical XDR grows in four-byte increments. Reject before prompting.
    request.mockClear();
    input.invocation.calldata = calldata(
      new Uint8Array(input.invocation.calldata.length + 4),
    );
    await expect(wallet.prepareExecution(input)).rejects.toMatchObject({
      code: -32602,
    });
    tx.invocation.calldata = calldata(
      new Uint8Array(tx.invocation.calldata.length + 4),
    );
    expect(serialize(tx, codec.Transaction).length).toBe(
      MAX_UNSIGNED_TRANSACTION_BYTES + 4,
    );
    await expect(wallet.signTransaction(tx)).rejects.toMatchObject({
      code: -32602,
    });
    expect(methodCalls(request, "signTransaction")).toHaveLength(0);
    expect(methodCalls(request, "submitTransaction")).toHaveLength(0);
    const oversizedSigned = await signTransaction(
      tx,
      localAccount.signers,
      signingNetwork,
    );
    expect(serialize(oversizedSigned, codec.SignedTransaction).length).toBe(
      MAX_TRANSACTION_BYTES + 4,
    );
    expect(() =>
      parseSignedTransactionHex(wireResult(oversizedSigned).signedTransaction),
    ).toThrow(expect.objectContaining({ code: -32602 }));
    wallet.dispose();
  });

  it("reuses default-wallet preparation and constructs the claim without a raw signer", async () => {
    const { client, wallet } = await setup();
    const tx = await wallet.prepareExecution(execution);
    expect(tx.invocation).toEqual(
      defaultWalletAdapter.createRootInvocation(
        localAccount.address,
        execution,
      ),
    );
    expect(tx.auth_claim).toEqual(localAccount.authClaim);
    expect(tx.uniquifier).toEqual({ block_expiry_height: 100n, nonce: 42n });
    expect(client).not.toHaveProperty("account");
    expect(client).not.toHaveProperty("prepareExecution");
    expect(Object.keys(wallet)).toEqual([
      "getCapabilities",
      "prepareBatchExecution",
      "prepareExecution",
      "signTransaction",
      "submitTransaction",
      "dispose",
    ]);
    wallet.dispose();
  });

  it("signs without broadcast, waits for persistence, then submits the exact bytes and receipt hash", async () => {
    const { client, transport, wallet, request } = await setup();
    const send = vi.spyOn(client, "sendTransaction");
    const signed = await wallet.signTransaction(
      await wallet.prepareExecution(execution),
    );
    expect(methodCalls(request, "submitTransaction")).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
    const barrier = deferred<void>();
    const persistence = vi.fn(() => barrier.promise);
    const flow = (async () => {
      await persistence();
      return wallet.submitTransaction(signed);
    })();
    await Promise.resolve();
    expect(methodCalls(request, "submitTransaction")).toHaveLength(0);
    barrier.resolve();
    expect(await flow).toEqual({ hash: signed.hash });
    expect(methodCalls(request, "submitTransaction")[0]![0]).toEqual({
      method: "submitTransaction",
      params: {
        account: account.address,
        networkHash,
        signedTransaction: signed.signedTransaction,
      },
    });
    expect(
      toHex0x(
        hashSignedTransaction(
          parseSignedTransactionHex(signed.signedTransaction),
        ),
      ),
    ).toBe(signed.hash);
    // The returned identifier is directly usable with existing RPC receipt actions.
    const receiptRequest = vi
      .spyOn(transport, "request")
      .mockResolvedValueOnce({
        txHash: signed.hash,
        height: 1,
        status: { result: "ok" },
        events: [],
      });
    const receipt = await client.getTransactionReceipt(
      hashFromHex(signed.hash),
    );
    expect(receiptRequest).toHaveBeenCalledWith(
      "groundhog_getTransactionReceipt",
      [signed.hash],
    );
    expect(toHex0x(receipt!.txHash)).toBe(signed.hash);
    expect(send).not.toHaveBeenCalled();
    await expect(wallet.submitTransaction(signed)).rejects.toMatchObject({
      code: 4100,
    });
    wallet.dispose();
  });

  it("does not broadcast when persistence fails", async () => {
    const { wallet, request } = await setup();
    const signed = await wallet.signTransaction(
      await wallet.prepareExecution(execution),
    );
    const flow = async () => {
      await Promise.reject(new Error("Storage full"));
      await wallet.submitTransaction(signed);
    };
    await expect(flow()).rejects.toThrow("Storage full");
    expect(methodCalls(request, "submitTransaction")).toHaveLength(0);
    wallet.dispose();
  });

  it.each([
    "changed transaction",
    "wrong key",
    "wrong network",
    "wrong public key ID",
    "missing signature",
    "extra signature",
    "corrupt signature",
    "wrong hash",
    "uppercase hash",
    "trailing bytes",
  ])("rejects signing results with %s", async (fault) => {
    const { wallet, request } = await setup();
    const tx = await wallet.prepareExecution(execution);
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (input) => {
      if (input.method !== "signTransaction") return original(input);
      let signed = await signTransaction(
        parseTransactionHex(input.params.transaction),
        localAccount.signers,
        signingNetwork,
      );
      if (fault === "changed transaction") {
        signed.tx.uniquifier.nonce++;
        signed = await signTransaction(
          signed.tx,
          localAccount.signers,
          signingNetwork,
        );
      }
      if (fault === "wrong key")
        signed = await signTransaction(
          tx,
          [
            {
              signer: new PrivateKeySigner(new Uint8Array(32).fill(2)),
              publicKeyId: 0n,
            },
          ],
          signingNetwork,
        );
      if (fault === "wrong network")
        signed = await signTransaction(
          tx,
          localAccount.signers,
          toNetworkHash(sha256Hash(new Uint8Array(32))),
        );
      if (fault === "wrong public key ID")
        signed.signatures[0]!.public_key_id = 1n;
      if (fault === "missing signature") signed.signatures = [];
      if (fault === "extra signature")
        signed.signatures.push(signed.signatures[0]!);
      if (fault === "corrupt signature")
        signed.signatures[0]!.signature.ed25519.fill(0);
      const result = wireResult(signed);
      if (fault === "wrong hash") result.hash = "0x" + "00".repeat(32);
      if (fault === "uppercase hash") result.hash = result.hash.toUpperCase();
      if (fault === "trailing bytes") result.signedTransaction += "00000000";
      return result;
    });
    await expect(wallet.signTransaction(tx)).rejects.toMatchObject({
      code: -32603,
    });
    expect(methodCalls(request, "submitTransaction")).toHaveLength(0);
    await expect(wallet.signTransaction(tx)).rejects.toMatchObject({
      code: 4100,
    });
    wallet.dispose();
  });

  it("rejects a root address or claim for a different account before asking to sign", async () => {
    const { wallet, request } = await setup();
    const tx = await wallet.prepareExecution(execution);
    tx.invocation.invoked_address = execution.invocation.invoked_address;
    await expect(wallet.signTransaction(tx)).rejects.toMatchObject({
      code: 4100,
    });
    tx.invocation.invoked_address = localAccount.address;
    if (tx.auth_claim.claim_type === AuthClaimType.kPubkeySignature)
      tx.auth_claim.pubkey_preimage.nonce++;
    await expect(wallet.signTransaction(tx)).rejects.toMatchObject({
      code: 4100,
    });
    expect(methodCalls(request, "signTransaction")).toHaveLength(0);
    wallet.dispose();
  });

  it.each(["small-order", "mixed-order"])(
    "rejects a %s R even when cofactored verification accepts it",
    async (kind) => {
      const { wallet, request } = await setup();
      const tx = await wallet.prepareExecution(execution);
      const signed = await signTransaction(
        tx,
        localAccount.signers,
        signingNetwork,
      );
      const message = transactionSignaturePreimage(signingNetwork, tx);
      const rScalar = kind === "small-order" ? 0n : 1n;
      const r =
        kind === "small-order"
          ? Point.ZERO
          : Point.BASE.add(Point.fromHex("00".repeat(32)));
      const rBytes = r.toBytes();
      const challenge = new Uint8Array([
        ...rBytes,
        ...signer.publicKey.ed25519,
        ...message,
      ]);
      const k =
        BigInt("0x" + toHex(sha512(challenge).reverse())) % Point.CURVE().n;
      const secretScalar = utils.getExtendedPublicKey(
        new Uint8Array(32).fill(1),
      ).scalar;
      let s = (rScalar + k * secretScalar) % Point.CURVE().n;
      const signature = signed.signatures[0]!.signature.ed25519;
      signature.set(rBytes);
      for (let i = 32; i < 64; i++) {
        signature[i] = Number(s & 255n);
        s >>= 8n;
      }
      expect(
        await verifyAsync(signature, message, signer.publicKey.ed25519, {
          zip215: false,
        }),
      ).toBe(true);
      const original = request.getMockImplementation()!;
      request.mockImplementation((input) =>
        input.method === "signTransaction"
          ? Promise.resolve(wireResult(signed))
          : original(input),
      );
      await expect(wallet.signTransaction(tx)).rejects.toMatchObject({
        code: -32603,
      });
      expect(methodCalls(request, "submitTransaction")).toHaveLength(0);
      wallet.dispose();
    },
  );

  it.each([true, false])(
    "rejects account/network changes with emitted event: %s",
    async (emit) => {
      for (const session of [
        { networkHash: "cd".repeat(32), accounts: [account] },
        { networkHash, accounts: [] },
      ]) {
        const { wallet, request, change } = await setup();
        const signed = await wallet.signTransaction(
          await wallet.prepareExecution(execution),
        );
        change(session, emit);
        await expect(wallet.submitTransaction(signed)).rejects.toBeInstanceOf(
          WalletProviderError,
        );
        expect(methodCalls(request, "submitTransaction")).toHaveLength(0);
        change({ networkHash, accounts: [account] }, false);
        await expect(wallet.submitTransaction(signed)).rejects.toMatchObject({
          code: 4100,
        });
        wallet.dispose();
      }
    },
  );

  it("invalidates on disconnect and duplicate change snapshots", async () => {
    for (const disconnect of [false, true]) {
      const { wallet, provider, change } = await setup();
      const tx = await wallet.prepareExecution(execution);
      if (disconnect) await provider.request({ method: "disconnect" });
      else change({ networkHash, accounts: [account] });
      await expect(wallet.signTransaction(tx)).rejects.toMatchObject({
        code: 4100,
      });
      wallet.dispose();
    }
  });

  it.each([true, false])(
    "rejects session changes during signing (event: %s)",
    async (emit) => {
      const { wallet, request, change } = await setup();
      const tx = await wallet.prepareExecution(execution);
      const original = request.getMockImplementation()!;
      request.mockImplementation(async (input) => {
        const result = await original(input);
        if (input.method === "signTransaction")
          change({ networkHash, accounts: [] }, emit);
        return result;
      });
      await expect(wallet.signTransaction(tx)).rejects.toMatchObject({
        code: 4100,
      });
      expect(methodCalls(request, "submitTransaction")).toHaveLength(0);
      wallet.dispose();
    },
  );

  it("snapshots transaction and account inputs before asynchronous work", async () => {
    const { client, provider, request, wallet: initial } = await setup();
    initial.dispose();
    const mutable = { ...account };
    const wallet = createProviderWalletClient({
      client,
      provider,
      account: mutable,
      networkHash,
    });
    mutable.nonce = "8";
    const tx = await wallet.prepareExecution(execution);
    const expectedBytes = toHex0x(serialize(tx, codec.Transaction));
    const signing = wallet.signTransaction(tx);
    tx.uniquifier.nonce++;
    const signed = await signing;
    expect(methodCalls(request, "signTransaction")[0]![0]).toMatchObject({
      params: { transaction: expectedBytes },
    });
    expect(
      toHex0x(
        serialize(
          parseSignedTransactionHex(signed.signedTransaction).tx,
          codec.Transaction,
        ),
      ),
    ).toBe(expectedBytes);
    wallet.dispose();
  });

  it("rejects simultaneous operations and disposal while a request is pending", async () => {
    const { wallet, request, unsubscribe, listeners } = await setup();
    const tx = await wallet.prepareExecution(execution);
    const barrier = deferred<unknown>();
    request.mockReturnValueOnce(barrier.promise);
    const signing = wallet.signTransaction(tx);
    await expect(wallet.signTransaction(tx)).rejects.toMatchObject({
      code: -32002,
    });
    wallet.dispose();
    wallet.dispose();
    barrier.resolve({ networkHash, accounts: [account] });
    await expect(signing).rejects.toMatchObject({ code: 4100 });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
    expect(methodCalls(request, "signTransaction")).toHaveLength(0);
  });

  it.each([4001, 4100, 4200, 4900, 4901, -32602, -32603, -32002] as const)(
    "preserves provider failure %s without submission",
    async (code) => {
      const { wallet, request } = await setup();
      const tx = await wallet.prepareExecution(execution);
      const original = request.getMockImplementation()!;
      request.mockImplementation((input) =>
        input.method === "signTransaction"
          ? Promise.reject({ code, message: "Failure" })
          : original(input),
      );
      await expect(wallet.signTransaction(tx)).rejects.toMatchObject({ code });
      expect(methodCalls(request, "submitTransaction")).toHaveLength(0);
      wallet.dispose();
    },
  );

  it.each(["bad hash", "timeout", "change"])(
    "does not retry ambiguous submit failure: %s",
    async (fault) => {
      const { wallet, request, change } = await setup();
      const signed = await wallet.signTransaction(
        await wallet.prepareExecution(execution),
      );
      const original = request.getMockImplementation()!;
      request.mockImplementation(async (input) => {
        if (input.method !== "submitTransaction") return original(input);
        if (fault === "timeout") throw new Error("Timeout after broadcast");
        if (fault === "change") change({ networkHash, accounts: [] });
        return {
          hash: fault === "bad hash" ? "0x" + "00".repeat(32) : signed.hash,
        };
      });
      await expect(wallet.submitTransaction(signed)).rejects.toBeInstanceOf(
        WalletProviderError,
      );
      await expect(wallet.submitTransaction(signed)).rejects.toMatchObject({
        code: 4100,
      });
      expect(methodCalls(request, "submitTransaction")).toHaveLength(1);
      wallet.dispose();
    },
  );

  it("requires exact locally approved bytes, not merely a matching hash", async () => {
    const { wallet, request } = await setup();
    const signed = await wallet.signTransaction(
      await wallet.prepareExecution(execution),
    );
    const changed = parseSignedTransactionHex(signed.signedTransaction);
    changed.signatures[0]!.signature.ed25519[0] ^= 1;
    await expect(
      wallet.submitTransaction(wireResult(changed)),
    ).rejects.toMatchObject({ code: 4100 });
    expect(methodCalls(request, "submitTransaction")).toHaveLength(0);
    const newer = await wallet.signTransaction(
      await wallet.prepareExecution({ ...execution, nonce: 43n }),
    );
    await expect(wallet.submitTransaction(signed)).rejects.toMatchObject({
      code: 4100,
    });
    expect(await wallet.submitTransaction(newer)).toEqual({ hash: newer.hash });
    wallet.dispose();
  });

  it("rejects invalid session responses and transport failures permanently", async () => {
    for (const failure of [false, true]) {
      const { wallet, request } = await setup();
      if (failure)
        request.mockRejectedValueOnce(new Error("Transport unavailable"));
      else
        request.mockResolvedValueOnce({
          networkHash,
          accounts: [{ ...account, nonce: "8" }],
        });
      await expect(wallet.prepareExecution(execution)).rejects.toMatchObject({
        code: failure ? 4900 : -32603,
      });
      await expect(wallet.prepareExecution(execution)).rejects.toMatchObject({
        code: 4100,
      });
      wallet.dispose();
    }
  });

  it("checks a validated client's network and rejects noncanonical configuration", async () => {
    const { client, provider, wallet } = await setup();
    expect(() =>
      createProviderWalletClient({
        client,
        provider,
        account,
        networkHash: "0x" + networkHash,
      }),
    ).toThrow();
    const connected = Object.assign(client, {
      network: { networkHash: toNetworkHash(sha256Hash(new Uint8Array(32))) },
    });
    expect(() =>
      createProviderWalletClient({
        client: connected,
        provider,
        account,
        networkHash,
      }),
    ).toThrow(expect.objectContaining({ code: 4901 }));
    wallet.dispose();
  });
});
