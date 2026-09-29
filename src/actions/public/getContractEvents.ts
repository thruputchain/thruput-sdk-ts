import type {
  ContractEvent,
  ContractEventFilterInput,
  DecodedContractEvent,
} from "../../contract/event.js";
import { ContractDecodeError } from "../../contract/errors.js";
import type {
  Transport,
  TransportRequestOptions,
} from "../../transport/types.js";
import type {
  EmittedEvent,
  EventPage,
  EventQuery,
  IdentifiedEvent,
} from "../../types/rpc.js";
import { getEvents } from "./getEvents.js";

/** One generated event descriptor with named filters and ordinary page controls. */
export type ContractEventQuery<
  TName extends string,
  TTopics,
  TFields,
  TFilter,
> = Omit<EventQuery, "filters"> &
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
  Pick<EmittedEvent, "contractAddress">;

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
 * const page = await getContractEvents(transport, {
 *   event: groundhog_erc20_if.v0_1.events.TransferEvent,
 *   contractAddresses: [tokenAddress],
 *   topics: { to: accountAddress },
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
  transport: Transport,
  query: ContractEventQuery<TName, TTopics, TFields, TFilter>,
  options?: TransportRequestOptions,
): Promise<ContractEventPage<TName, TTopics, TFields>> {
  options?.signal?.throwIfAborted();
  const { event, contractAddresses, topics, ...pageQuery } = query;
  const page = await getEvents(
    transport,
    {
      ...pageQuery,
      filters: [event.filter({ contractAddresses, topics })],
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
      return { ...decoded, ...identity, contractAddress: raw.contractAddress };
    }),
  };
}
