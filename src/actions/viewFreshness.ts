/** Reject a successful view that violates the caller's snapshot constraint. */
export function assertViewFreshness(height: bigint, minHeight?: bigint): void {
  if (minHeight !== undefined && height < minHeight) {
    throw new Error(
      `View response height ${height} is below the requested minimum ${minHeight}`,
    );
  }
}
