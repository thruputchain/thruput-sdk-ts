// Consumer snippets from the DX guides, checked against the built public package.
import {
  createGroundhogClient,
  createPubkeyAccount,
  createWalletClient,
  HttpTransport,
  getContract,
  gasAmount,
  parseUnits,
  formatUnits,
  classifyReadError,
  type ContractAddress,
  type Signer,
} from "@groundhogchain/client";
import { ERC20, groundhog_erc20_if } from "@groundhogchain/client/contracts";

export async function documentedReads(
  tokenAddress: ContractAddress,
  accountAddress: ContractAddress,
) {
  const client = await createGroundhogClient({
    transport: new HttpTransport("https://rpc.example.com", { batch: true }),
  });
  const controller = new AbortController();
  const { signal } = controller;
  const token = getContract({
    binding: ERC20.v0_1,
    address: tokenAddress,
    client,
  });
  try {
    await client.getChainTip({ signal });
    await token.getBalanceOf.view({ args: { addr: accountAddress }, signal });
  } catch (error) {
    console.error(classifyReadError(error, { signal }), error);
  }
  const amount = parseUnits("12.05", 2);
  const transfer = ERC20.v0_1.transfer.invocation(
    tokenAddress,
    gasAmount(500_000n),
    {
      receiver: accountAddress,
      amount,
    },
  );
  const args: ERC20.v0_1.TransferArgs = ERC20.v0_1.transfer.decodeArgs(
    transfer.calldata,
  );
  const noArgs: void = ERC20.v0_1.totalSupply.decodeArgs(new Uint8Array());
  const { TransferEvent } = groundhog_erc20_if.v0_1.events;
  const page = await client.getContractEvents(
    {
      event: TransferEvent,
      contractAddresses: [tokenAddress],
      topics: { to: accountAddress },
      limit: 20,
    },
    { signal },
  );
  for await (const rawPage of client.iterateEventPages(
    {
      filters: [TransferEvent.filter({ contractAddresses: [tokenAddress] })],
      limit: 20,
    },
    { signal },
  )) {
    if (rawPage.cursor.length === 0) break;
  }
  const version = await client.getVersion();
  return {
    args,
    noArgs,
    page,
    display: formatUnits(amount, 2),
    release: version.releaseVersion,
    digest: version.bundleManifestDigest,
  };
}

export async function documentedWalletSharing(
  firstSigner: Signer,
  secondSigner: Signer,
) {
  const { localnet } = await import("@groundhogchain/client");
  const client = await createGroundhogClient({ cluster: localnet() });
  const first = createWalletClient({
    client,
    account: createPubkeyAccount({ signer: firstSigner }),
  });
  const second = createWalletClient({
    client,
    account: createPubkeyAccount({ signer: secondSigner }),
  });
  return { first, second };
}
