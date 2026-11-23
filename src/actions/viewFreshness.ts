import { ThruputError } from "../errors/thruputError.js";

/**
 * Reject a successful view that violates the caller's snapshot constraint.
 * A node that cannot serve the floor answers `stateHeightUnavailable`, so a
 * lower height breaks the response contract: code `rpcValueInvalid`.
 */
export function assertViewFreshness(height: bigint, minHeight?: bigint): void {
  if (minHeight !== undefined && height < minHeight) {
    throw new ThruputError(
      "rpcValueInvalid",
      `View response height ${height} is below the requested minimum ${minHeight}`,
      { context: { path: "/result/stateBlockHeight", raw: height } },
    );
  }
}
