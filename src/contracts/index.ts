/**
 * Generated invocation builders and event decoders for the standard ERC-20
 * contract interfaces shipped with the SDK.
 *
 * The bindings build typed `Invocation` values. Pass those invocations to a
 * transaction or `view` call depending on whether you are reading or writing.
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
  TransferEvent as ERC20TransferEvent,
  decodeEvent as decodeERC20Event,
  spec as ERC20Spec,
} from "./erc20.js";
export type * from "./erc20.js";
