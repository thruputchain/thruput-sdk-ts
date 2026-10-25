import type {
  ContractEvent,
  ContractEventFilterInput,
  DecodedContractEvent,
} from "../../contract/event.js";
import { ContractDecodeError } from "../../contract/errors.js";
import type { TransportRequestOptions } from "../../transport/types.js";
import type {
  EmittedEvent,
  EventPage,
  EventQuery,
  IdentifiedEvent,
} from "../../types/rpc.js";
import type { RpcClient } from "../../rpc/client.js";

/** One generated event descriptor with named filters and ordinary page controls. */
export type ContractEventQuery<
  TName extends string,
  TTopics,
  TFields,
  TFilter,
> = (EventQuery extends infer Q
  ? Q extends EventQuery
    ? Omit<Q, "filters">
    : never
  : never) &
  ContractEventFilterInput<NoInfer<TFilter>> & {
    event: ContractEvent<TName, TTopics, TFields, TFilter>;
  };

/** A decoded event with its emitter, transaction, and position in history. */
export type IdentifiedContractEvent<
  TName extends string,
  TTopics,
  TFields,
> = DecodedContractEvent<TName, TTopics, TFields> &
  Omit<IdentifiedEvent, "event"> &
  Pick<EmittedEvent, "address">;

/** One decoded event page, retaining the RPC cursor and indexer bounds. */
export type ContractEventPage<TName extends string, TTopics, TFields> = Omit<
  EventPage,
  "events"
> & {
  events: IdentifiedContractEvent<TName, TTopics, TFields>[];
};

/**
 * Fetch exactly one page using a generated event's filter and decoder.
 *
 * No additional pages are fetched. Pass the returned cursor into the next call
 * with the same filters. Malformed events and unexpected signatures throw
 * ContractDecodeError rather than silently disappearing from the page.
 *
 * @example
 * ```ts
 * const page = await getContractEvents(client, {
 *   event: thruput_erc20_if.v0_1.events.TransferEvent,
 *   addresses: [tokenAddress],
 *   topics: { to: accountAddress },
 *   start: { order: "ascending", anchor: { kind: "atBeginning" } },
 *   limit: 20,
 * }, { signal });
 * ```
 */
export async function getContractEvents<
  TName extends string,
  TTopics,
  TFields,
  TFilter,
>(
  client: Pick<RpcClient, "getEvents">,
  query: ContractEventQuery<TName, TTopics, TFields, TFilter>,
  options?: TransportRequestOptions,
): Promise<ContractEventPage<TName, TTopics, TFields>> {
  options?.signal?.throwIfAborted();
  const { event, addresses, topics, ...pageQuery } = query;
  const page = await client.getEvents(
    {
      ...pageQuery,
      filters: [event.filter({ addresses, topics })],
    },
    options,
  );
  return {
    ...page,
    events: page.events.map(({ event: raw, ...identity }) => {
      const decoded = event.decode(raw);
      if (decoded === null) {
        throw new ContractDecodeError(
          "Event query returned an unexpected event signature",
        );
      }
      return { ...decoded, ...identity, address: raw.address };
    }),
  };
}
