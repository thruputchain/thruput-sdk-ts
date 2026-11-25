// Errors that this copy of the package raised before it dispatched a request.
// Only these prove that a request was not sent: a transport, or another copy of
// the package, can throw an error with the same code after it sent one.
const localErrors = new WeakSet<object>();

/** Record an error that the client raised before dispatch. */
export function markLocalError<T extends object>(error: T): T {
  localErrors.add(error);
  return error;
}

/** True only for an error recorded by {@link markLocalError}. */
export function isLocalError(error: unknown): boolean {
  return typeof error === "object" && error !== null && localErrors.has(error);
}
