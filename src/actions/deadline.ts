/** Run one operation within the caller's wall-clock budget and cancellation signal. */
export async function beforeDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  deadline: number,
  caller: AbortSignal | undefined,
  timeout: () => Error,
): Promise<T> {
  caller?.throwIfAborted();
  if (performance.now() >= deadline) throw timeout();
  const controller = new AbortController();
  const signal = caller
    ? AbortSignal.any([caller, controller.signal])
    : controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort = () => {};
  try {
    return await Promise.race([
      new Promise<T>((_, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(
          () => controller.abort(timeout()),
          Math.ceil(Math.max(0, deadline - performance.now())),
        );
      }),
      operation(signal),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
    controller.abort();
  }
}
export function validateTimer(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 2147483647)
    throw new RangeError(`${field} must be between 0 and 2147483647`);
}
export function waitDelay(delay: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const finish = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, delay);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}
