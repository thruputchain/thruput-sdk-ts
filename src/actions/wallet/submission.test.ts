import { describe, expect, it, vi } from "vitest";
import {
  calldata,
  contractEntrypointID,
  gasAmount,
  networkHash,
  sha256Hash,
} from "@thruputchain/protocol";
import { createThruputClient } from "../../client.js";
import { MockTransport } from "../../transport/mock.js";
import { Ed25519Signer } from "../../signers/ed25519.js";
import { createPubkeyAccount } from "../../wallet/account.js";
import { defaultWalletAdapter } from "../../wallet/invocationAdapter.js";
import { createWalletClient } from "../../wallet/client.js";
import { prepareContractDeployment } from "../../wallet/deployment.js";
import {
  ExecutionDecodeError,
  TransactionExecutionError,
  TransactionObservationError,
  UnsupportedTransactionAdmissionError,
} from "../../wallet/execution.js";
import { UnsupportedRpcValue } from "../../rpc/codec.js";
import { sendInvocation, signWalletTransaction } from "./sendInvocation.js";
import { sendTransaction } from "./sendTransaction.js";
import { prepareTransaction } from "./prepareTransaction.js";

const signingNetwork = networkHash(sha256Hash(new Uint8Array(32)));
async function setup(unknownAdmission = false) {
  const transport = new MockTransport();
  const original = transport.request.bind(transport);
  const rpc = vi
    .spyOn(transport, "request")
    .mockImplementation(async (method, params, options) => {
      const result = await original(method, params, options);
      return unknownAdmission && method === "sendTransaction"
        ? ({ ...(result as object), admission: "queued" } as never)
        : result;
    });
  const client = await createThruputClient({ transport });
  const signer = new Ed25519Signer(new Uint8Array(32).fill(1));
  const account = createPubkeyAccount({ signer });
  const request = {
    invocation: {
      invoked_address: account.address,
      entrypoint: contractEntrypointID(new Uint8Array(8)),
      gas_limit: gasAmount(1000n),
      calldata: calldata(new Uint8Array()),
    },
  };
  return { client, signer, account, request, rpc };
}

describe("high-level native submission", () => {
  it.each(["invocation", "signed"])(
    "does not report unfamiliar admission as an accepted %s hash",
    async (mode) => {
      const { client, account, request, rpc } = await setup(true);
      const transaction = await prepareTransaction(client, account, request);
      const signed = await signWalletTransaction(
        account,
        transaction,
        signingNetwork,
      );
      const error = await (
        mode === "invocation"
          ? sendInvocation(client, account, signingNetwork, request)
          : sendTransaction(client, signed)
      ).catch((error) => error);
      expect(error).toBeInstanceOf(TransactionObservationError);
      expect(error.phase).toBe("submission");
      expect(error.cause).toBeInstanceOf(UnsupportedTransactionAdmissionError);
      expect(error.cause.response.admission).toBeInstanceOf(
        UnsupportedRpcValue,
      );
      expect(error.cause.response.admission.raw).toBe("queued");
      expect(error.submission.signedTransaction.length).toBeGreaterThan(0);
      expect(error.submission.networkHash).toEqual(signingNetwork);
      expect(
        rpc.mock.calls.filter(([method]) => method === "sendTransaction"),
      ).toHaveLength(1);
    },
  );

  it("continues only read observation after unfamiliar admission and retains its evidence", async () => {
    const { client, account, request, rpc } = await setup(true);
    const lookup = new Error("receipt unavailable");
    const wait = vi
      .spyOn(client, "waitForTransactionReceipt")
      .mockRejectedValue(lookup);
    const wallet = createWalletClient({
      client,
      account,
      networkHash: signingNetwork,
    });
    const error = await wallet
      .executeAndWait({
        invocation: request.invocation,
        gasLimit: gasAmount(1000n),
      })
      .catch((error) => error);
    expect(error).toBeInstanceOf(TransactionObservationError);
    expect(error.phase).toBe("observation");
    expect(error.cause).toBe(lookup);
    expect(error.submissionCause).toBeInstanceOf(
      UnsupportedTransactionAdmissionError,
    );
    expect(error.submissionCause.response.admission.raw).toBe("queued");
    expect(error.submission.signedTransaction.length).toBeGreaterThan(0);
    expect(wait).toHaveBeenCalledOnce();
    expect(
      rpc.mock.calls.filter(([method]) => method === "sendTransaction"),
    ).toHaveLength(1);
  });

  it("reconciles unfamiliar admission to a committed receipt without another write", async () => {
    const { client, account, request, rpc } = await setup(true);
    const wait = vi
      .spyOn(client, "waitForTransactionReceipt")
      .mockImplementation(async (transactionHash) => ({
        transactionHash,
        blockHeight: 7n,
        gasUsed: 1n,
        events: [],
        execution: { result: "return", returnData: new Uint8Array() },
      }));
    const wallet = createWalletClient({
      client,
      account,
      networkHash: signingNetwork,
    });
    const result = await wallet.executeAndWait({
      invocation: request.invocation,
      gasLimit: gasAmount(1000n),
    });
    expect(result.receipt.blockHeight).toBe(7n);
    expect(result.receipt.transactionHash).toEqual(
      result.submission?.transactionHash,
    );
    expect(wait).toHaveBeenCalledOnce();
    expect(
      rpc.mock.calls.filter(([method]) => method === "sendTransaction"),
    ).toHaveLength(1);
  });

  it("rejects changed discovery during preparation before signing", async () => {
    const { client, signer, account, request, rpc } = await setup();
    let discovery = client.discovery;
    const guardedClient = {
      requireMethods: client.requireMethods,
      sendTransaction: client.sendTransaction,
      get discovery() {
        return discovery;
      },
      async getChainTip() {
        const tip = await client.getChainTip();
        discovery = {
          ...discovery,
          network: { networkHash: new Uint8Array(32).fill(1) },
        };
        return tip;
      },
    };
    const sign = vi.spyOn(signer, "sign");
    await expect(
      sendInvocation(guardedClient, account, signingNetwork, request),
    ).rejects.toThrow(/Signing network does not match/);
    expect(sign).not.toHaveBeenCalled();
    expect(
      rpc.mock.calls.some(([method]) => method === "sendTransaction"),
    ).toBe(false);
  });

  it("rejects a standalone invocation network mismatch before preparing or signing", async () => {
    const { client, signer, account, request, rpc } = await setup();
    const sign = vi.spyOn(signer, "sign");
    await expect(
      sendInvocation(
        client,
        account,
        networkHash(sha256Hash(new Uint8Array(32).fill(1))),
        request,
      ),
    ).rejects.toThrow(/Signing network does not match/);
    expect(sign).not.toHaveBeenCalled();
    expect(
      rpc.mock.calls.some(
        ([method]) => method === "getChainTip" || method === "sendTransaction",
      ),
    ).toBe(false);
  });

  it("retains signed evidence and does not write when discovery changes during persistence", async () => {
    const { client, account, request, rpc } = await setup();
    let discovery = client.discovery;
    const guardedClient = {
      requireMethods: client.requireMethods,
      sendTransaction: client.sendTransaction,
      getChainTip: client.getChainTip,
      get discovery() {
        return discovery;
      },
    };
    const error = await sendInvocation(
      guardedClient,
      account,
      signingNetwork,
      request,
      {
        onSigned() {
          discovery = {
            ...discovery,
            network: { networkHash: new Uint8Array(32).fill(1) },
          };
        },
      },
    ).catch((error) => error);
    expect(error).toBeInstanceOf(TransactionObservationError);
    expect(error.phase).toBe("beforeSubmission");
    expect(error.submission.signedTransaction.length).toBeGreaterThan(0);
    expect(
      rpc.mock.calls.some(([method]) => method === "sendTransaction"),
    ).toBe(false);
  });

  it("rejects a missing deployment decoder before signing or submitting", async () => {
    const { client, signer, account, rpc } = await setup();
    const sign = vi.spyOn(signer, "sign");
    const wallet = createWalletClient({
      client,
      account,
      networkHash: signingNetwork,
      invocationAdapter: {
        ...defaultWalletAdapter,
        decodeDeploymentReceipt: undefined,
      },
    });
    const plan = prepareContractDeployment({
      deployer: account.address,
      contract: new Uint8Array([1]),
    });
    await expect(
      wallet.deployContractAndWait(plan, {
        gasLimit: gasAmount(1000n),
        amount: 0n,
      }),
    ).rejects.toThrow(/deployment decoding/);
    expect(sign).not.toHaveBeenCalled();
    expect(
      rpc.mock.calls.some(([method]) => method === "sendTransaction"),
    ).toBe(false);
  });

  it("retains submission evidence on ordinary execution failure", async () => {
    const { client, account, request } = await setup();
    vi.spyOn(client, "waitForTransactionReceipt").mockImplementation(
      async (transactionHash) => ({
        transactionHash,
        blockHeight: 7n,
        gasUsed: 1n,
        events: [],
        execution: { result: "abort", abortData: new Uint8Array([7]) },
      }),
    );
    const wallet = createWalletClient({
      client,
      account,
      networkHash: signingNetwork,
    });
    const error = await wallet
      .executeAndWait({
        invocation: request.invocation,
        gasLimit: gasAmount(1000n),
      })
      .catch((error) => error);
    expect(error).toBeInstanceOf(TransactionExecutionError);
    expect(error.submission.transactionHash).toEqual(
      error.receipt.transactionHash,
    );
    expect(error.submission.signedTransaction.length).toBeGreaterThan(0);
  });

  it.each(["abort", "mismatch"] as const)(
    "retains typed deployment %s evidence",
    async (outcome) => {
      const { client, account, rpc } = await setup();
      const wallet = createWalletClient({
        client,
        account,
        networkHash: signingNetwork,
      });
      const plan = prepareContractDeployment({
        deployer: account.address,
        contract: new Uint8Array([1]),
      });
      const wait = vi
        .spyOn(client, "waitForTransactionReceipt")
        .mockImplementation(async (transactionHash) => ({
          transactionHash,
          blockHeight: 7n,
          gasUsed: 1n,
          events: [],
          execution:
            outcome === "abort"
              ? { result: "abort", abortData: new Uint8Array([7]) }
              : { result: "return", returnData: new Uint8Array(32) },
        }));
      const error = await wallet
        .deployContractAndWait(plan, { gasLimit: gasAmount(1000n), amount: 0n })
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
      expect(wait).toHaveBeenCalledOnce();
      expect(
        rpc.mock.calls.filter(([method]) => method === "sendTransaction"),
      ).toHaveLength(1);
    },
  );
});
