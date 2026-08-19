import {
  contractAddress,
  kMaxEventLength,
  type ContractAddress,
} from "@groundhogchain/protocol";
import { CxsReader, type XdrCodec } from "@groundhogchain/xdr";
import type {
  EmittedEvent,
  EventFilter,
  TransactionReceipt,
} from "../types/rpc.js";
import type { ContractCodecContext } from "./codec.js";
import { resolveContextCodec } from "./codec.js";
import { ContractDecodeError } from "./errors.js";
import { fixedBytes } from "./fixed.js";
import { ContractTypeKind, type ContractType } from "./spec.js";

/** Ordered metadata for one declared event topic after the signature. */
export interface ContractEventTopicMetadata {
  name: string;
  type: ContractType;
  representation: "address" | "fixedBytes32" | "hash";
}

/** Ordered metadata for one event payload field. */
export interface ContractEventFieldMetadata {
  name: string;
  type: ContractType;
}

/** Runtime definition consumed by a generated event descriptor. */
export interface ContractEventDefinition<TName extends string = string> {
  name: TName;
  signature: Uint8Array;
  topics: readonly ContractEventTopicMetadata[];
  fields: readonly ContractEventFieldMetadata[];
  codecs: ContractCodecContext;
}

/** One accepted direct-topic value or a non-empty OR constraint. */
export type ContractEventFilterValue<T> = T | { oneOf: readonly [T, ...T[]] };

/** Generated named topic constraints plus required emitter addresses. */
export interface ContractEventFilterInput<TFilter> {
  contractAddresses: readonly ContractAddress[];
  topics?: TFilter;
}

/** Emitter scope for receipt extraction. */
export interface ContractEventReceiptOptions {
  contractAddress: ContractAddress;
}

/** Canonical value returned by generated event decoders. */
export interface DecodedContractEvent<TName extends string, TTopics, TFields> {
  name: TName;
  topics: TTopics;
  fields: TFields;
}

/** Decoded receipt event retaining the emitting contract address. */
export type ContractReceiptEvent<
  TName extends string,
  TTopics,
  TFields,
> = DecodedContractEvent<TName, TTopics, TFields> & {
  contractAddress: ContractAddress;
};

/** Complete generated event API. */
export interface ContractEvent<
  TName extends string,
  TTopics,
  TFields,
  TFilter,
> {
  readonly signature: Uint8Array;
  decode(
    event: Pick<EmittedEvent, "topics" | "data">,
  ): DecodedContractEvent<TName, TTopics, TFields> | null;
  filter(input: ContractEventFilterInput<TFilter>): EventFilter;
  allFromReceipt(
    receipt: Pick<TransactionReceipt, "events">,
    options: ContractEventReceiptOptions,
  ): ContractReceiptEvent<TName, TTopics, TFields>[];
  singleFromReceipt(
    receipt: Pick<TransactionReceipt, "events">,
    options: ContractEventReceiptOptions,
  ): ContractReceiptEvent<TName, TTopics, TFields>;
}

interface ResolvedField {
  metadata: ContractEventFieldMetadata;
  codec: XdrCodec<unknown>;
}

interface ResolvedTopic {
  name: string;
  representation: ContractEventTopicMetadata["representation"];
}

/** Build one generated event descriptor from direct ABI metadata. */
export function defineContractEvent<
  const TName extends string,
  TTopics,
  TFields,
  TFilter,
>(
  definition: ContractEventDefinition<TName>,
): ContractEvent<TName, TTopics, TFields, TFilter> {
  const signature = fixedBytes(Uint8Array.from(definition.signature), 32);
  if (definition.topics.length > 2) {
    throw new Error(
      `${definition.name} declares ${definition.topics.length + 1} topics; protocol maximum is 3`,
    );
  }
  assertUniqueNames(definition.topics, `${definition.name} topic`);
  assertUniqueNames(definition.fields, `${definition.name} field`);

  const resolvedTopics: ResolvedTopic[] = definition.topics.map((metadata) => {
    const expected = topicRepresentation(metadata.type);
    if (metadata.representation !== expected) {
      throw new Error(
        `${definition.name} topic "${metadata.name}" representation "${metadata.representation}" does not match its declared type; expected "${expected}"`,
      );
    }
    return { name: metadata.name, representation: metadata.representation };
  });

  const fields: ResolvedField[] = definition.fields.map((metadata) => ({
    metadata: { ...metadata },
    codec: resolveContextCodec(definition.codecs, metadata.type),
  }));

  const descriptor: ContractEvent<TName, TTopics, TFields, TFilter> = {
    get signature() {
      return Uint8Array.from(signature);
    },

    decode(event) {
      if (!bytesEqual(event.topics[0], signature)) return null;
      try {
        const expectedTopicCount = resolvedTopics.length + 1;
        if (event.topics.length !== expectedTopicCount) {
          throw new Error(
            `expected ${expectedTopicCount} topics, got ${event.topics.length}`,
          );
        }
        assertEventSize(event.topics, event.data);

        const decodedTopics: Record<string, unknown> = {};
        for (let index = 0; index < resolvedTopics.length; index++) {
          const metadata = resolvedTopics[index];
          const topic = fixedBytes(event.topics[index + 1], 32);
          decodedTopics[metadata.name] =
            metadata.representation === "address"
              ? contractAddress(topic)
              : metadata.representation === "fixedBytes32"
                ? topic
                : event.topics[index + 1];
        }

        const reader = new CxsReader(event.data);
        const decodedFields: Record<string, unknown> = {};
        for (const field of fields) {
          decodedFields[field.metadata.name] = field.codec.decode(reader);
        }
        if (reader.remaining !== 0) {
          throw new Error(`${reader.remaining} trailing payload bytes`);
        }

        return {
          name: definition.name,
          topics: decodedTopics,
          fields: decodedFields,
        } as DecodedContractEvent<TName, TTopics, TFields>;
      } catch (cause) {
        if (cause instanceof ContractDecodeError) throw cause;
        const detail = cause instanceof Error ? `: ${cause.message}` : "";
        throw new ContractDecodeError(
          `Failed to decode ${definition.name}${detail}`,
          { cause },
        );
      }
    },

    filter(input) {
      if (input.contractAddresses.length === 0) {
        throw new Error(
          `${definition.name} filter requires a contract address`,
        );
      }
      for (const address of input.contractAddresses) fixedBytes(address, 32);

      const filterTopics: NonNullable<EventFilter["topics"]> = {
        topic0: [Uint8Array.from(signature)],
      };
      const constraints = input.topics as Record<string, unknown> | undefined;
      if (constraints) {
        const directTopics = new Map(
          resolvedTopics
            .map((metadata, index) => ({ metadata, index }))
            .filter(({ metadata }) => metadata.representation !== "hash")
            .map(({ metadata, index }) => [metadata.name, index] as const),
        );
        for (const [name, constraint] of Object.entries(constraints)) {
          const index = directTopics.get(name);
          if (index === undefined) {
            throw new Error(
              `${definition.name} topic "${name}" is not directly filterable`,
            );
          }
          const values = filterValues(constraint, definition.name, name);
          const key = `topic${index + 1}` as "topic1" | "topic2";
          filterTopics[key] = values.map((value) => fixedBytes(value, 32));
        }
      }
      return {
        contractAddresses: [...input.contractAddresses],
        topics: filterTopics,
      };
    },

    allFromReceipt(receipt, options) {
      const matches: ContractReceiptEvent<TName, TTopics, TFields>[] = [];
      for (const event of receipt.events) {
        if (!bytesEqual(event.contractAddress, options.contractAddress)) {
          continue;
        }
        const decoded = descriptor.decode(event);
        if (decoded !== null) {
          matches.push({ ...decoded, contractAddress: event.contractAddress });
        }
      }
      return matches;
    },

    singleFromReceipt(receipt, options) {
      const matches = descriptor.allFromReceipt(receipt, options);
      if (matches.length !== 1) {
        throw new Error(
          `Expected exactly one ${definition.name} event, got ${matches.length}`,
        );
      }
      return matches[0];
    },
  };

  return descriptor;
}

function topicRepresentation(
  type: ContractType,
): ContractEventTopicMetadata["representation"] {
  if (type.v === ContractTypeKind.Address) return "address";
  if (
    type.v === ContractTypeKind.Array &&
    type.array.len === 32n &&
    type.array.element?.v === ContractTypeKind.U8
  ) {
    return "fixedBytes32";
  }
  return "hash";
}

/** Compare public byte identifiers. This function is not constant-time. */
export function bytesEqual(
  left: Uint8Array | undefined,
  right: Uint8Array,
): boolean {
  if (!left || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function filterValues(
  constraint: unknown,
  eventName: string,
  topicName: string,
): Uint8Array[] {
  if (
    constraint &&
    typeof constraint === "object" &&
    !Array.isArray(constraint) &&
    !(constraint instanceof Uint8Array) &&
    "oneOf" in constraint
  ) {
    const values = constraint.oneOf;
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error(
        `${eventName} topic "${topicName}" oneOf must not be empty`,
      );
    }
    return values.map((value) => requireBytes(value, eventName, topicName));
  }
  return [requireBytes(constraint, eventName, topicName)];
}

function requireBytes(
  value: unknown,
  eventName: string,
  topicName: string,
): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError(`${eventName} topic "${topicName}" must be bytes`);
  }
  return value;
}

function assertEventSize(
  topics: readonly Uint8Array[],
  data: Uint8Array,
): void {
  const size = topics.reduce(
    (total, topic) => total + topic.length,
    data.length,
  );
  const limit = Number(kMaxEventLength);
  if (size > limit) {
    throw new Error(`serialized event size ${size} exceeds ${limit} bytes`);
  }
}

function assertUniqueNames(
  values: readonly { name: string }[],
  label: string,
): void {
  const names = new Set<string>();
  for (const value of values) {
    if (names.has(value.name)) {
      throw new Error(`Duplicate ${label} name "${value.name}"`);
    }
    names.add(value.name);
  }
}
