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
  ContractAddress,
  GasAmount,
  Invocation,
} from "@groundhogchain/protocol";

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
  const invocation: Invocation = transfer.invocation(contract, gasLimit, {
    receiver: recipient,
    amount: 1n,
  });

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
  ERC20TransferEvent.filter({
    contractAddresses: [contract],
    topics: { to: { oneOf: [recipient] } },
  });
  decodeERC20Event(event);

  void invocation;
  void balance.value;
  void outcome.kind;
  void ContractDecodeError;
  void defineContractMethod;
}

void packageBoundaryTypecheck;
