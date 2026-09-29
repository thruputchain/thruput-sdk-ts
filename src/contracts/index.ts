/**
 * Generated method and event descriptors for standard contracts shipped with
 * the SDK.
 *
 * Method descriptors build typed invocations, decode views and root receipts,
 * and expose declared exceptions. Event descriptors decode events, build named
 * topic filters, and extract matching receipt events.
 *
 * Each interface nests its methods, argument and result types, and exceptions
 * under the major version its entrypoints hash (`ERC20.v0_1.transfer`,
 * `ERC20.v0_1.TransferArgs`). Named types, enum values, and event descriptors
 * nest under the declaring crate and major (`groundhog_erc20_if.v0_1.error.ERC20Error`,
 * `groundhog_erc20_if.v0_1.events.TransferEvent`). Select a major once and
 * keep short calls from there.
 *
 * @example
 * ```ts
 * import { ERC20 as ERC20Versions } from "@groundhogchain/client/contracts";
 *
 * const ERC20 = ERC20Versions.v0_1;
 * const invocation = ERC20.transfer.invocation(tokenAddress, gasLimit, {
 *   receiver,
 *   amount: 1_000n,
 * });
 * ```
 *
 * @module
 */
export {
  ERC20,
  ERC20Metadata,
  groundhog_erc20_if,
  decodeEvent as decodeERC20Event,
  spec as ERC20Spec,
} from "./erc20.js";
export type { ERC20Event } from "./erc20.js";
export {
  DefaultWallet,
  default_wallet,
  spec as DefaultWalletSpec,
} from "./default_wallet.js";
export { DevWallet, spec as DevWalletSpec } from "./dev_wallet.js";
export {
  SignedOp,
  groundhog_signed_op_if,
  spec as SignedOpSpec,
} from "./signed_op.js";
export {
  ERC20Permit,
  groundhog_erc20_permit_if,
  spec as ERC20PermitSpec,
} from "./erc20_permit.js";
