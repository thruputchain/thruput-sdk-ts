import type {
  ContractViewRequest,
  ContractViewOutcome,
  ContractException,
} from "../../contract/method.js";
import type {
  Transport,
  TransportRequestOptions,
} from "../../transport/types.js";
import { viewBatch } from "./viewBatch.js";

/** Typed calls and an optional minimum committed height for one snapshot read. */
export interface ReadViewsRequest<
  TCalls extends readonly ContractViewRequest[],
> {
  calls: TCalls;
  minHeight?: bigint;
}

/** Ordered typed outcomes, preserving each tuple position's return and exception types. */
export interface ReadViewsResponse<
  TCalls extends readonly ContractViewRequest[],
> {
  height: bigint;
  results: {
    [K in keyof TCalls]: TCalls[K] extends ContractViewRequest<infer R, infer E>
      ? ContractViewOutcome<R, ContractException<E>>
      : never;
  };
}

/**
 * Read generated method requests against one shared committed snapshot.
 * Contract aborts and faults are outcomes. Transport, freshness, and decoding
 * failures reject the group. Calls are never split or emulated with separate views.
 *
 * @example
 * ```ts
 * const result = await client.readViews({ calls: [
 *   ERC20.totalSupply.viewRequest({ contract: token }),
 *   ERC20.getBalanceOf.viewRequest({ contract: token, args: { addr: owner } }),
 * ] });
 * ```
 */
export async function readViews<
  const TCalls extends readonly ContractViewRequest[],
>(
  transport: Transport,
  request: ReadViewsRequest<TCalls>,
  options?: TransportRequestOptions,
): Promise<ReadViewsResponse<TCalls>> {
  options?.signal?.throwIfAborted();
  // Retain the decoder order across the asynchronous request even if the caller
  // later edits its array. viewBatch serializes the byte inputs before yielding.
  const calls = request.calls.map((call) => ({
    request: call.request,
    decode: call.method.decodeViewOutcome,
  }));
  const response = await viewBatch(
    transport,
    {
      calls: calls.map((call) => call.request),
      ...(request.minHeight === undefined
        ? {}
        : { minHeight: request.minHeight }),
    },
    options,
  );
  const results = calls.map((call, index) =>
    call.decode({
      ...response.results[index]!,
      height: response.height,
    }),
  );
  // viewBatch validates the exact count; each position uses its retained decoder.
  return {
    height: response.height,
    results: results as ReadViewsResponse<TCalls>["results"],
  };
}
