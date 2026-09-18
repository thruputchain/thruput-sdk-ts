/**
 * Generated method and event descriptors for standard contracts shipped with
 * the SDK.
 *
 * Method descriptors build typed invocations, decode views and root receipts,
 * and expose declared exceptions. Event descriptors decode events, build named
 * topic filters, and extract matching receipt events.
 *
 * @example
 * ```ts
 * import { ERC20 } from "@groundhogchain/client/contracts";
 *
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
  ERC20Error,
  ApprovalEvent as ERC20ApprovalEvent,
  BurnEvent as ERC20BurnEvent,
  MintEvent as ERC20MintEvent,
  TransferEvent as ERC20TransferEvent,
  decodeEvent as decodeERC20Event,
  spec as ERC20Spec,
} from "./erc20.js";
export type {
  ApprovalEventFilter as ERC20ApprovalEventFilter,
  BurnEventFilter as ERC20BurnEventFilter,
  MintEventFilter as ERC20MintEventFilter,
  ERC20AdjustAllowanceArgs,
  ERC20AdjustAllowanceResult,
  ERC20AllowanceArgs,
  ERC20AllowanceResult,
  ERC20BurnArgs,
  ERC20BurnResult,
  ERC20DeclaredException,
  ERC20Event,
  ERC20Exception,
  ERC20GetBalanceArgs,
  ERC20GetBalanceOfArgs,
  ERC20GetBalanceOfResult,
  ERC20GetBalanceResult,
  ERC20InitializeArgs,
  ERC20InitializeResult,
  ERC20MetadataDecimalsArgs,
  ERC20MetadataDecimalsResult,
  ERC20MetadataDeclaredException,
  ERC20MetadataException,
  ERC20MetadataInitializeArgs,
  ERC20MetadataInitializeResult,
  ERC20MetadataNameArgs,
  ERC20MetadataNameResult,
  ERC20MetadataSymbolArgs,
  ERC20MetadataSymbolResult,
  ERC20MintArgs,
  ERC20MintResult,
  ERC20TotalSupplyArgs,
  ERC20TotalSupplyResult,
  ERC20TransferArgs,
  ERC20TransferFromArgs,
  ERC20TransferFromResult,
  ERC20TransferResult,
  TransferEventFilter as ERC20TransferEventFilter,
} from "./erc20.js";
export {
  DefaultWallet,
  WalletError,
  spec as DefaultWalletSpec,
} from "./default_wallet.js";
export type {
  DefaultWalletDeclaredException,
  DefaultWalletDeployArgs,
  DefaultWalletDeployResult,
  DefaultWalletException,
  DefaultWalletExecuteArgs,
  DefaultWalletExecuteResult,
  WalletCall,
} from "./default_wallet.js";
export { DevWallet, spec as DevWalletSpec } from "./dev_wallet.js";
export type {
  DevWalletCreateWalletArgs,
  DevWalletCreateWalletResult,
  DevWalletDeclaredException,
  DevWalletDeployArgs,
  DevWalletDeployResult,
  DevWalletDoActionArgs,
  DevWalletDoActionResult,
  DevWalletException,
  DevWalletInitializeArgs,
  DevWalletInitializeResult,
} from "./dev_wallet.js";
export { SignedOp, SignedOpError, spec as SignedOpSpec } from "./signed_op.js";
export type {
  Operation as SignedOpOperation,
  SignedOpDeclaredException,
  SignedOpException,
  SignedOpExecuteSignedOpArgs,
  SignedOpExecuteSignedOpResult,
} from "./signed_op.js";
