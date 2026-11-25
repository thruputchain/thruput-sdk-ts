import { validateTimer } from "../actions/deadline.js";
import type { WaitForTransactionReceiptOptions } from "../actions/public/waitForTransactionReceipt.js";

/**
 * Check execution wait options before preparing or signing, so an invalid
 * option never leaves a signed or sent transaction. `knownCommitment` applies
 * only to observing an existing hash, so execution rejects it.
 * @internal
 */
export function validateExecutionWait(
  wait: WaitForTransactionReceiptOptions | undefined,
): void {
  validateTimer(wait?.timeoutMs ?? 30000, "timeoutMs");
  validateTimer(wait?.pollingIntervalMs ?? 250, "pollingIntervalMs");
  if (wait?.knownCommitment !== undefined)
    throw new TypeError(
      "knownCommitment applies only when observing an existing transaction",
    );
}
