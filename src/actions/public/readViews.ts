import type { RpcClient } from "../../rpc/client.js";
import type {
  ContractViewRequest,
  ContractViewOutcome,
  ContractException,
} from "../../contract/method.js";
import type { TransportRequestOptions } from "../../transport/types.js";
import { ContractDecodeError } from "../../contract/errors.js";

/** Typed calls and an optional minimum committed height for one snapshot read. */
export interface ReadViewsRequest<
  TCalls extends readonly ContractViewRequest[],
> {
  calls: TCalls;
  minStateBlockHeight?: bigint;
}

/** Ordered typed outcomes, preserving each tuple position's return and exception types. */
export interface ReadViewsResponse<
  TCalls extends readonly ContractViewRequest[],
> {
  stateBlockHeight: bigint;
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
 *   ERC20.v0_1.totalSupply.viewRequest({ address: token }),
 *   ERC20.v0_1.getBalanceOf.viewRequest({ address: token, args: { addr: owner } }),
 * ] });
 * ```
 */
export async function readViews<
  const TCalls extends readonly ContractViewRequest[],
>(
  client: Pick<RpcClient, "simulateInvocations">,
  request: ReadViewsRequest<TCalls>,
  options?: TransportRequestOptions,
): Promise<ReadViewsResponse<TCalls>> {
  options?.signal?.throwIfAborted();
  // Retain the decoder order across the asynchronous request even if the caller
  // later edits its array. simulateInvocations serializes the byte inputs before yielding.
  const calls = request.calls.map((call) => {
    if ("minStateBlockHeight" in call) {
      throw new TypeError(
        "Set minStateBlockHeight on readViews, not on a prepared call",
      );
    }
    return {
      request: call.request,
      name: call.method.name,
      decode: call.method.decodeViewOutcome,
    };
  });
  const response = await client.simulateInvocations(
    {
      invocations: calls.map((call) => call.request),
      ...(request.minStateBlockHeight === undefined
        ? {}
        : { minStateBlockHeight: request.minStateBlockHeight }),
    },
    options,
  );
  const results = calls.map((call, index) => {
    try {
      return call.decode({
        ...response.results[index]!,
        stateBlockHeight: response.stateBlockHeight,
      });
    } catch (cause) {
      throw new ContractDecodeError(
        `Failed to decode readViews result ${index} (${call.name})`,
        { cause },
      );
    }
  });
  // simulateInvocations validates the exact count; each position uses its retained decoder.
  return {
    stateBlockHeight: response.stateBlockHeight,
    results: results as ReadViewsResponse<TCalls>["results"],
  };
}
