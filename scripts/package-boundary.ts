import type {
  ContractMethod,
  ContractViewOutcome,
  GroundhogClient,
} from "@groundhogchain/client";
import {
  ContractDecodeError,
  defineContractMethod,
} from "@groundhogchain/client/contract";
import {
  ERC20,
  ERC20ApprovalEvent,
  ERC20Metadata,
  ERC20TransferEvent,
  decodeERC20Event,
} from "@groundhogchain/client/contracts";
import type {
  ERC20TransferArgs,
  ERC20TransferEventFilter,
} from "@groundhogchain/client/contracts";
import type {
  ContractAddress,
  GasAmount,
  Invocation,
} from "@groundhogchain/protocol";
import {
  loadLocalDevAccount,
  type LoadLocalDevAccountOptions,
  type LocalDevAccount,
} from "@groundhogchain/client/local-dev";

async function packageBoundaryTypecheck(
  client: GroundhogClient,
  contract: ContractAddress,
  recipient: ContractAddress,
  gasLimit: GasAmount,
  event: { topics: Uint8Array[]; data: Uint8Array },
): Promise<void> {
  const transfer: ContractMethod<
    { receiver: ContractAddress; amount: bigint },
    void,
    unknown
  > = ERC20.transfer;
  const transferArgs: ERC20TransferArgs = {
    receiver: recipient,
    amount: 1n,
  };
  const invocation: Invocation = transfer.invocation(
    contract,
    gasLimit,
    transferArgs,
  );

  const balance = await ERC20.getBalanceOf.view({
    client,
    contract,
    args: { addr: recipient },
  });
  const outcome: ContractViewOutcome<bigint, unknown> =
    await ERC20.getBalanceOf.viewOutcome({
      client,
      contract,
      args: { addr: recipient },
    });

  ERC20Metadata.symbol.invocation(contract, gasLimit);
  ERC20ApprovalEvent.filter({
    contractAddresses: [contract],
    topics: { owner: contract },
  });
  const transferTopics: ERC20TransferEventFilter = {
    to: { oneOf: [recipient] },
  };
  ERC20TransferEvent.filter({
    contractAddresses: [contract],
    topics: transferTopics,
  });
  decodeERC20Event(event);

  void invocation;
  void balance.value;
  void outcome.kind;
  void ContractDecodeError;
  void defineContractMethod;

  const localDevOptions: LoadLocalDevAccountOptions = {
    localUserOffset: 1,
    env: { GROUNDHOG_RPC_URL: "http://127.0.0.1:9545" },
  };
  const localDevAccount: Promise<LocalDevAccount> =
    loadLocalDevAccount(localDevOptions);
  void localDevAccount;
}

void packageBoundaryTypecheck;
