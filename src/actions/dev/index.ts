import type { Transport } from "../../transport/types.js";
import type { DevAccount } from "../../types/rpc.js";
import { addressFromHex, fromHex0x } from "../hex.js";

export async function devReset(transport: Transport): Promise<void> {
  await transport.request("groundhog_dev_reset");
}

export async function devGetAccounts(
  transport: Transport,
): Promise<DevAccount[]> {
  const result = await transport.request<any[]>("groundhog_dev_getAccounts");
  return result.map((a) => ({
    address: addressFromHex(a.address),
    publicKey: fromHex0x(a.publicKey),
    privateKey: fromHex0x(a.privateKey),
    initialStorageTokens: BigInt(a.initialStorageTokens),
  }));
}
