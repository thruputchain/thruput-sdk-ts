export const rpcTimeoutMs = 5_000;
export const airdropTimeoutMs = 30_000;
export const receiptTimeoutMs = 30_000;
export const eventsTimeoutMs = 30_000;

// Sequential work: two airdrops, one receipt wait, one wait for the event
// indexer to catch up, and eight other RPCs: network info, version, tip, two
// balance views, execution (tip + submit), and the invalid-transaction
// request. Polling RPCs are inside their budgets.
const operationBudgetMs =
  2 * airdropTimeoutMs + receiptTimeoutMs + eventsTimeoutMs + 8 * rpcTimeoutMs;

// Allow local file reads, signing, and scheduling, then leave room for the
// test runner to report failures and exit before the harness intervenes.
export const suiteTimeoutMs = operationBudgetMs + 20_000;
export const runnerTimeoutMs = suiteTimeoutMs + 10_000;
export const harnessTimeoutMs = runnerTimeoutMs + 20_000;
