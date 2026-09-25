import { describe, it, expect, expectTypeOf, vi } from "vitest";
import {
  ContractType,
  ExecResult,
  contractAddress,
  gasAmount,
  sha256Hash,
} from "@groundhogchain/protocol";
import { CxsWriter, Uint64Codec } from "@groundhogchain/xdr";
import { Counter } from "../../examples/generated/counter.js";
import { DefaultWallet, WalletError } from "../contracts/default_wallet.js";
import { getContract } from "../contract/instance.js";
import {
  decodeExecution,
  walletGasLimit,
  ExecutionReturnUnavailableError,
  submitAndObserve,
  TransactionObservationError,
  TransactionExecutionError,
} from "./execution.js";
import { devWalletAdapter, defaultWalletAdapter } from "./invocationAdapter.js";
import {
  prepareContractDeployment,
  deploymentRequest,
  decodeDeployment,
} from "./deployment.js";
import type { TransactionReceipt } from "../types/rpc.js";

const address = contractAddress(new Uint8Array(32));
const gas = gasAmount(100n);
const receipt: TransactionReceipt = {
  txHash: sha256Hash(new Uint8Array(32)),
  height: 1n,
  execResult: ExecResult.ExecResultOK,
  events: [],
  returnData: null,
  abortData: null,
  gasUsed: 1_000n,
};

describe("contract execution DX", () => {
  it("preserves failed root receipts without invoking a child decoder", () => {
    const writer = new CxsWriter();
    writer.writeUint64(0x931d3297d37d1bdfn);
    writer.writeInt32(WalletError.InvalidAuthClaim);
    const decodeReceiptOutcome = vi.fn(() => {
      throw new Error("Child decoder must not run");
    });
    const call = Counter.get.call({ contract: address, gasLimit: gas });
    const child = { ...call, method: { ...call.method, decodeReceiptOutcome } };
    for (const abortData of [writer.finish(), new Uint8Array([0xff]), null]) {
      const failed = {
        ...receipt,
        execResult: ExecResult.ExecResultTxRootFrameReverted,
        abortData,
      };
      for (const calls of [[child], [child, child]]) {
        try {
          decodeExecution(failed, calls);
          expect.fail("Expected a transaction execution error");
        } catch (error) {
          expect(error).toBeInstanceOf(TransactionExecutionError);
          expect((error as TransactionExecutionError).receipt).toBe(failed);
        }
      }
    }
    expect(decodeReceiptOutcome).not.toHaveBeenCalled();
  });

  it("retains the transaction identity and both causes after ambiguous submission", async () => {
    const submissionCause = new Error("connection lost");
    const cause = new DOMException("observation cancelled", "AbortError");
    const pending = submitAndObserve(
      {
        waitForTransactionReceipt: async () => {
          throw cause;
        },
      },
      receipt.txHash,
      async () => {
        throw submissionCause;
      },
    );
    await expect(pending).rejects.toBeInstanceOf(TransactionObservationError);
    await expect(pending).rejects.toMatchObject({
      txHash: receipt.txHash,
      cause,
      submissionCause,
    });
  });
  it("keeps method identity, types, and bound read metadata", async () => {
    const call = Counter.increment.call({
      contract: address,
      gasLimit: gas,
      args: { amount: 5n },
    });
    expect(call.invocation).toEqual(
      Counter.increment.invocation(address, gas, { amount: 5n }),
    );
    expect(call.method.name).toBe("Counter.increment");
    expect(() =>
      Counter.increment.call({
        contract: address,
        gasLimit: gas,
        args: { amount: 5 as unknown as bigint },
      }),
    ).toThrow(/Counter.increment: argument "amount"/);
    const writer = new CxsWriter();
    Uint64Codec.encode(writer, 42n);
    const contract = getContract({
      binding: Counter,
      address,
      client: {
        view: async () => ({
          output: { result: "return", returnData: writer.finish() },
          height: 9n,
          events: [],
        }),
      },
    });
    const result = await contract.get.view({});
    expectTypeOf(result.value).toEqualTypeOf<bigint>();
    expect(result).toMatchObject({ value: 42n, height: 9n });
  });

  it("does not pretend a wallet that discards returns exposes a typed value", () => {
    const call = Counter.get.call({ contract: address, gasLimit: gas });
    expect(() => decodeExecution(receipt, [call], devWalletAdapter)).toThrow(
      ExecutionReturnUnavailableError,
    );
  });

  it("validates wallet result count without changing the root receipt", () => {
    // DefaultWallet's CXS return is a vector of byte vectors.
    const data = new Uint8Array([0]);
    const original = { ...receipt, returnData: data };
    expect(DefaultWallet.execute.decodeReceipt(original).value).toEqual([]);
    expect(() =>
      decodeExecution(original, [
        Counter.get.call({ contract: address, gasLimit: gas }),
      ]),
    ).toThrow(/expected 1/);
    expect(original.returnData).toBe(data);
  });

  it("derives explicit root budgets with overflow protection", () => {
    expect(walletGasLimit([{ gas_limit: gas }], gasAmount(5n))).toBe(105n);
    expect(() =>
      walletGasLimit([{ gas_limit: gas }], gasAmount(0xffff_ffff_ffff_ffffn)),
    ).toThrow(/u64/);
  });
});

describe("deployment descriptions", () => {
  it("snapshots inputs and attaches canonical code at the wallet root", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const nonce = new Uint8Array(32);
    const plan = prepareContractDeployment({
      deployer: address,
      contract: bytes,
      deploymentNonce: nonce,
    });
    bytes.fill(4);
    nonce.fill(5);
    expect(plan.contract).toEqual({
      contract_type: ContractType.kRv32,
      rv32_contract: { data: new Uint8Array([1, 2, 3]) },
    });
    const request = deploymentRequest(plan, address, gas, defaultWalletAdapter);
    expect(request.contractsToDeploy).toEqual([plan.contract]);
    expect(request.invocation.entrypoint).toEqual(
      DefaultWallet.deploy.entrypoint,
    );
    expect(
      decodeDeployment(
        { ...receipt, returnData: plan.address },
        plan,
        defaultWalletAdapter,
      ),
    ).toEqual(plan.address);
    expect(() =>
      decodeDeployment(
        { ...receipt, returnData: address },
        plan,
        defaultWalletAdapter,
      ),
    ).toThrow(/expected/);
    plan.deploymentNonce.fill(1);
    expect(() =>
      deploymentRequest(plan, address, gas, defaultWalletAdapter),
    ).toThrow(/no longer match/);
  });
});
