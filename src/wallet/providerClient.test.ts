import { runInNewContext } from "node:vm";
import {
  AuthClaimType,
  ExecResult,
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
} from "@thruputchain/protocol";
import { assert, describe, expect, it, vi } from "vitest";
import { Point, utils, verifyAsync } from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { createThruputClient } from "../client.js";
import { toHex0x } from "../actions/hex.js";
import { hashFromBase58, toBase58 } from "../encoding.js";
import { hashSignedTransaction } from "../derivation/transactionHash.js";
import { Ed25519Signer } from "../signers/ed25519.js";
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
import { prepareContractDeployment } from "./deployment.js";
import {
  ExecutionDecodeError,
  TransactionExecutionError,
} from "./execution.js";
import { DefaultWallet } from "../contracts/default_wallet.js";
import { Counter } from "../../examples/generated/counter.js";
import { ed25519Of } from "../testing/signatures.js";

const networkHash = toBase58(new Uint8Array(32).fill(171));
const signingNetwork = toNetworkHash(sha256Hash(new Uint8Array(32).fill(0xab)));
const signer = new Ed25519Signer(new Uint8Array(32).fill(1));
const localAccount = createPubkeyAccount({ signer, nonce: 7n });
const account = {
  address: toBase58(localAccount.address),
  publicKey: toBase58(signer.publicKey.ed25519),
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
  const originalRpc = transport.request.bind(transport);
  vi.spyOn(transport, "request").mockImplementation(
    async (method, params, options) =>
      method === "getNetworkInfo"
        ? ({ networkHash } as never)
        : originalRpc(method, params, options),
  );
  const client = await createThruputClient({ transport });
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
    info: { id: "test", name: "Test Wallet", version: "2.0.0" },
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
    hash: toBase58(hashSignedTransaction(signed)),
  };
}

describe("provider atomic batches", () => {
  it.each(["abort", "mismatch"] as const)(
    "retains provider deployment %s receipt and approved bytes",
    async (outcome) => {
      const { wallet, client, request } = await setup();
      const plan = prepareContractDeployment({
        deployer: localAccount.address,
        contract: new Uint8Array([1]),
      });
      vi.spyOn(client, "waitForTransactionReceipt").mockImplementation(
        async (transactionHash) => ({
          transactionHash,
          blockHeight: 7n,
          gasUsed: 1n,
          events: [],
          execution:
            outcome === "abort"
              ? { result: "abort", abortData: new Uint8Array([7]) }
              : { result: "return", returnData: new Uint8Array(32) },
        }),
      );
      const error = await wallet
        .deployContractAndWait(
          plan,
          { gasLimit: gasAmount(1000n), amount: 0n },
          { onSigned: () => {} },
        )
        .catch((error) => error);
      expect(error).toBeInstanceOf(
        outcome === "abort" ? TransactionExecutionError : ExecutionDecodeError,
      );
      if (outcome === "mismatch")
        expect(error.cause.message).toMatch(/expected/);
      expect(error.receipt.blockHeight).toBe(7n);
      expect(error.submission.transactionHash).toEqual(
        error.receipt.transactionHash,
      );
      expect(error.submission.signedTransaction.length).toBeGreaterThan(0);
      expect(
        request.mock.calls.filter(
          ([call]) => call.method === "submitTransaction",
        ),
      ).toHaveLength(1);
      wallet.dispose();
    },
  );

  it("signs and submits the exact unified deployment after preserving approval evidence", async () => {
    const { wallet, client, request } = await setup();
    const plan = prepareContractDeployment({
      deployer: localAccount.address,
      contract: new Uint8Array([1, 2, 3]),
    });
    const initializer = Counter.v0_1.initialize.invocation(
      plan.address,
      gasAmount(100n),
      { initialValue: 42n },
    );
    vi.spyOn(client, "waitForTransactionReceipt").mockImplementation(
      async (txHash) => ({
        transactionHash: txHash,
        blockHeight: 1n,
        events: [],
        execution: { result: "return", returnData: plan.address },
        gasUsed: 1n,
      }),
    );
    const onSigned = vi.fn((evidence: { signedTransaction: string }) => {
      const signed = parseSignedTransactionHex(evidence.signedTransaction);
      expect(signed.tx.contracts_to_deploy).toEqual([plan.contract]);
      expect(
        DefaultWallet.v0_1.deploy.decodeArgs(signed.tx.invocation.calldata),
      ).toMatchObject({
        amount: 123n,
        initializer: {
          entrypoint: initializer.entrypoint,
          calldata: initializer.calldata,
        },
      });
      expect(
        request.mock.calls.some(
          ([call]) => call.method === "submitTransaction",
        ),
      ).toBe(false);
    });
    const result = await wallet.deployContractAndWait(
      plan,
      { gasLimit: gasAmount(1000n), amount: 123n, initializer },
      { onSigned },
    );
    expect(result.address).toEqual(plan.address);
    expect(onSigned).toHaveBeenCalledOnce();
    expect(
      request.mock.calls.filter(
        ([call]) => call.method === "submitTransaction",
      ),
    ).toHaveLength(1);
  });
  it("awaits durable persistence and blocks approval replacement throughout execution", async () => {
    const { wallet, client, request } = await setup();
    const barrier = deferred<void>();
    const entered = deferred<void>();
    const wait = vi
      .spyOn(client, "waitForTransactionReceipt")
      .mockImplementation(async (txHash) => ({
        transactionHash: txHash,
        blockHeight: 1n,
        events: [],
        execution: { result: "return", returnData: new Uint8Array() },
        gasUsed: 0n,
      }));
    const pending = wallet.executeAndWait(execution, {
      onSigned: async (evidence) => {
        expect(evidence.networkHash).toBe(networkHash);
        expect(evidence.account).toEqual(account);
        entered.resolve();
        await barrier.promise;
      },
    });
    await entered.promise;
    expect(methodCalls(request, "submitTransaction")).toHaveLength(0);
    await expect(wallet.prepareExecution(execution)).rejects.toThrow(/pending/);
    barrier.resolve();
    const result = await pending;
    expect(methodCalls(request, "submitTransaction")).toHaveLength(1);
    expect(wait).toHaveBeenCalledWith(
      result.transactionHash,
      expect.objectContaining({ expectedNetworkHash: signingNetwork }),
    );
    wallet.dispose();
  });

  it.each(["abort", "deadline"])(
    "never dispatches after %s during the final session check",
    async (mode) => {
      const { wallet, request, client } = await setup();
      const original = request.getMockImplementation()!;
      const entered = deferred<void>(),
        session = deferred<unknown>();
      const controller = new AbortController();
      let saved: SignTransactionResult | undefined;
      const wait = vi.spyOn(client, "waitForTransactionReceipt");
      const outcome = wallet
        .executeAndWait(execution, {
          onSigned: (signed) => {
            saved = {
              signedTransaction: signed.signedTransaction,
              hash: signed.hash,
            };
            request.mockImplementation((input) => {
              if (input.method !== "getSession") return original(input);
              entered.resolve();
              return session.promise;
            });
          },
          wait: {
            signal: controller.signal,
            timeoutMs: mode === "deadline" ? 20 : 1000,
          },
        })
        .catch((error) => error);
      await entered.promise;
      if (mode === "abort") controller.abort(Error("cancelled"));
      const error = await outcome;
      expect(error.phase).toBe("beforeSubmission");
      expect(error.submission.signedTransaction.length).toBeGreaterThan(0);
      session.resolve({ networkHash, accounts: [account] });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(methodCalls(request, "submitTransaction")).toHaveLength(0);
      expect(wait).not.toHaveBeenCalled();
      await expect(wallet.submitTransaction(saved!)).rejects.toMatchObject({
        code: 4100,
      });
      expect(methodCalls(request, "submitTransaction")).toHaveLength(0);
      wallet.dispose();
    },
  );

  it.each([false, true])(
    "does not start another provider read after a cancelled submission resolves (wrong hash: %s)",
    async (wrongHash) => {
      const { wallet, request, client } = await setup();
      const original = request.getMockImplementation()!;
      const entered = deferred<void>(),
        response = deferred<unknown>();
      const controller = new AbortController();
      let signedHash: string | undefined;
      request.mockImplementation((input) => {
        if (input.method !== "submitTransaction") return original(input);
        entered.resolve();
        return response.promise;
      });
      const wait = vi.spyOn(client, "waitForTransactionReceipt");
      const outcome = wallet
        .executeAndWait(execution, {
          onSigned: (signed) => {
            signedHash = signed.hash;
          },
          wait: { signal: controller.signal },
        })
        .catch((error) => error);
      await entered.promise;
      controller.abort(Error("cancelled"));
      expect((await outcome).phase).toBe("submission");
      const calls = request.mock.calls.length;
      response.resolve({
        hash: wrongHash ? toBase58(new Uint8Array(32).fill(99)) : signedHash,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(request).toHaveBeenCalledTimes(calls);
      expect(wait).not.toHaveBeenCalled();
      if (wrongHash)
        await expect(wallet.getCapabilities()).rejects.toMatchObject({
          code: 4100,
        });
      wallet.dispose();
    },
  );

  it("checks discovery network even when the client has no cluster network property", async () => {
    const { wallet, client, provider } = await setup();
    expect("network" in client).toBe(false);
    expect(() =>
      createProviderWalletClient({
        client,
        provider,
        account,
        networkHash: toBase58(new Uint8Array(32)),
      }),
    ).toThrow(expect.objectContaining({ code: 4901 }));
    wallet.dispose();
  });

  it("does not submit when the lifecycle persistence callback fails", async () => {
    const { wallet, request } = await setup();
    await expect(
      wallet.executeAndWait(execution, {
        onSigned: () => {
          throw new Error("disk full");
        },
      }),
    ).rejects.toMatchObject({
      phase: "beforeSubmission",
      cause: { message: "disk full" },
    });
    expect(methodCalls(request, "submitTransaction")).toHaveLength(0);
    wallet.dispose();
  });

  it.each([true, false])(
    "fails immediately if the session changes during persistence (event: %s)",
    async (emit) => {
      const { wallet, client, request, change } = await setup();
      const entered = deferred<void>();
      const persisted = deferred<void>();
      const wait = vi
        .spyOn(client, "waitForTransactionReceipt")
        .mockRejectedValue(
          new Error("Must not observe an undispatched transaction"),
        );
      const pending = wallet.executeAndWait(execution, {
        onSigned: async () => {
          entered.resolve();
          await persisted.promise;
        },
      });
      await entered.promise;
      change({ networkHash, accounts: [] }, emit);
      persisted.resolve();
      await expect(pending).rejects.toMatchObject({
        phase: "beforeSubmission",
        cause: { code: 4100 },
      });
      expect(methodCalls(request, "submitTransaction")).toHaveLength(0);
      expect(wait).not.toHaveBeenCalled();
      // The lifecycle guard is released, while the old binding stays invalidated.
      await expect(wallet.getCapabilities()).rejects.toMatchObject({
        code: 4100,
      });
      wallet.dispose();
    },
  );

  it.each(["provider rejection", "post-submit session check"])(
    "still observes after dispatch when %s reports authorization loss",
    async (failure) => {
      const { wallet, client, request, change } = await setup();
      const wait = vi
        .spyOn(client, "waitForTransactionReceipt")
        .mockImplementation(async (txHash) => ({
          transactionHash: txHash,
          blockHeight: 1n,
          events: [],
          execution: { result: "return", returnData: new Uint8Array() },
          gasUsed: 0n,
        }));
      const original = request.getMockImplementation()!;
      request.mockImplementation(async (input) => {
        const result = await original(input);
        if (input.method === "submitTransaction") {
          if (failure === "provider rejection")
            throw new WalletProviderError(
              4100,
              "Authorization lost after dispatch",
            );
          change({ networkHash, accounts: [] }, false);
        }
        return result;
      });
      const result = await wallet.executeAndWait(execution, {
        onSigned: () => {},
      });
      expect(result.receipt.blockHeight).toBe(1n);
      expect(methodCalls(request, "submitTransaction")).toHaveLength(1);
      expect(wait).toHaveBeenCalledTimes(1);
      wallet.dispose();
    },
  );

  it("observes an approved hash even if submission loses the wallet session", async () => {
    const { wallet, client, request, change } = await setup();
    vi.spyOn(client, "waitForTransactionReceipt").mockImplementation(
      async (txHash) => ({
        transactionHash: txHash,
        blockHeight: 1n,
        events: [],
        execution: { result: "return", returnData: new Uint8Array() },
        gasUsed: 0n,
      }),
    );
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (input) => {
      if (input.method === "submitTransaction") {
        change({ networkHash, accounts: [] });
        throw new Error("connection lost after broadcast");
      }
      return original(input);
    });
    await expect(
      wallet.executeAndWait(execution, { onSigned: () => {} }),
    ).resolves.toHaveProperty("receipt.blockHeight", 1n);
    expect(methodCalls(request, "submitTransaction")).toHaveLength(1);
    wallet.dispose();
  });
  it("ignores unrelated method names and recognizes only the exact capability method", async () => {
    const { client, provider, request } = await setup();
    const names = [
      "vendor_getCapabilities",
      "vendor.getCapabilities",
      "vendor-getCapabilities",
    ];
    const unrelated = createProviderWalletClient({
      client,
      account,
      networkHash,
      provider: { ...provider, supportedMethods: names },
    });
    expect((await unrelated.getCapabilities()).atomicBatch).toBeNull();
    expect(methodCalls(request, "getCapabilities")).toHaveLength(0);
    unrelated.dispose();
    const capable = createProviderWalletClient({
      client,
      account,
      networkHash,
      provider: {
        ...provider,
        supportedMethods: [...names, "getCapabilities"],
      },
    });
    expect((await capable.getCapabilities()).atomicBatch?.maxCalls).toBe(16);
    expect(methodCalls(request, "getCapabilities")).toHaveLength(1);
    capable.dispose();
  });
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
      networkHash: toBase58(new Uint8Array(32).fill(205)),
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
    expect(MAX_UNSIGNED_TRANSACTION_BYTES).toBe(1_048_460);
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
      "prepareDeployment",
      "getCapabilities",
      "prepareBatchExecution",
      "prepareExecution",
      "signTransaction",
      "submitTransaction",
      "dispose",
      "deployContractAndWait",
      "executeAndWait",
      "executeCallsAndWait",
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
      toBase58(
        hashSignedTransaction(
          parseSignedTransactionHex(signed.signedTransaction),
        ),
      ),
    ).toBe(signed.hash);
    // The provider's decoded identifier is usable with the base58 RPC boundary.
    const receiptRequest = vi
      .spyOn(transport, "request")
      .mockResolvedValueOnce({
        transactionHash: signed.hash,
        blockHeight: "1",
        execution: { result: "return", returnData: "0x" },
        events: [],
        gasUsed: "0",
      });
    const receipt = await client.getTransactionReceipt({
      transactionHash: hashFromBase58(signed.hash),
    });
    expect(receiptRequest).toHaveBeenCalledWith(
      "getTransactionReceipt",
      { transactionHash: signed.hash },
      undefined,
    );
    expect(toBase58(receipt!.transactionHash)).toBe(signed.hash);
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
    "missing claim key",
    "wrong claim key",
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
      if (fault === "wrong key") {
        const other = new Ed25519Signer(new Uint8Array(32).fill(2));
        signed.signatures[0]!.signature = await other.sign(
          transactionSignaturePreimage(signingNetwork, signed.tx),
        );
      }
      if (fault === "missing claim key") signed.pubkey_claim_key = null;
      if (fault === "wrong claim key")
        signed.pubkey_claim_key = new Ed25519Signer(
          new Uint8Array(32).fill(2),
        ).publicKey;
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
        ed25519Of(signed.signatures[0]!.signature).fill(0);
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
      const signature = ed25519Of(signed.signatures[0]!.signature);
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
        {
          networkHash: toBase58(new Uint8Array(32).fill(205)),
          accounts: [account],
        },
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
    const signature = changed.signatures[0];
    assert.isDefined(signature);
    const bytes = ed25519Of(signature.signature);
    const firstByte = bytes[0];
    assert.isDefined(firstByte);
    bytes[0] = firstByte ^ 1;
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

  it("accepts matching byte arrays from another realm without accepting byte-like objects", async () => {
    const { client, provider, wallet } = await setup();
    const bytes = runInNewContext("new Uint8Array(bytes)", {
      bytes: Array.from(client.discovery.network.networkHash),
    }) as Uint8Array;
    expect(bytes instanceof Uint8Array).toBe(false);
    const connected = Object.assign(client, {
      network: { networkHash: bytes },
    });
    const foreign = createProviderWalletClient({
      client: connected,
      provider,
      account,
      networkHash,
    });
    foreign.dispose();
    Object.assign(connected.network, {
      networkHash: { length: 32, constructor: { name: "Uint8Array" } },
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
