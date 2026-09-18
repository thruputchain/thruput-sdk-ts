import {
  contractAddress,
  kMaxEventLength,
  type ContractAddress,
} from "@groundhogchain/protocol";
import {
  CxsReader,
  CxsWriter,
  fixedBytes,
  type XdrCodec,
} from "@groundhogchain/xdr";
import type {
  EmittedEvent,
  EventFilter,
  TransactionReceipt,
} from "../types/rpc.js";
import type { ContractCodecContext } from "./codec.js";
import { resolveContextCodec } from "./codec.js";
import { ContractDecodeError } from "./errors.js";
import { ContractTypeKind, type ContractType } from "./spec.js";

const maxFilterContractAddresses = 5;
const maxFilterTopicValues = 16;

/** Ordered metadata for one declared event topic after the signature. */
export interface ContractEventTopicMetadata {
  name: string;
  type: ContractType;
  representation: "address" | "fixedBytes32" | "u256" | "i256" | "hash";
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

type ResolvedTopic =
  | {
      name: string;
      representation: "address" | "fixedBytes32" | "hash";
    }
  | {
      name: string;
      representation: "u256" | "i256";
      codec: XdrCodec<unknown>;
    };

/** Build one generated event descriptor from direct ABI metadata. */
export function defineContractEvent<
  const TName extends string,
  TTopics,
  TFields,
  TFilter,
>(
  definition: ContractEventDefinition<TName>,
): ContractEvent<TName, TTopics, TFields, TFilter> {
  const eventName = definition.name;
  const signature = fixedBytes(Uint8Array.from(definition.signature), 32);
  if (definition.topics.length > 2) {
    throw new Error(
      `${eventName} declares ${definition.topics.length + 1} topics; protocol maximum is 3`,
    );
  }
  assertUniqueNames(definition.topics, `${eventName} topic`);
  assertUniqueNames(definition.fields, `${eventName} field`);

  const resolvedTopics: ResolvedTopic[] = definition.topics.map((metadata) => {
    const expected = topicRepresentation(metadata.type);
    if (metadata.representation !== expected) {
      throw new Error(
        `${eventName} topic "${metadata.name}" representation "${metadata.representation}" does not match its declared type; expected "${expected}"`,
      );
    }
    if (
      metadata.representation === "u256" ||
      metadata.representation === "i256"
    ) {
      return {
        name: metadata.name,
        representation: metadata.representation,
        codec: resolveContextCodec(definition.codecs, metadata.type),
      };
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
        for (const [index, metadata] of resolvedTopics.entries()) {
          const rawTopic = event.topics[index + 1];
          if (rawTopic === undefined) {
            throw new Error(`missing topic "${metadata.name}"`);
          }
          const topic = fixedBytes(rawTopic, 32);
          const value = decodeTopic(metadata, topic);
          defineRecordValue(decodedTopics, metadata.name, value);
        }

        const reader = new CxsReader(event.data);
        const decodedFields: Record<string, unknown> = {};
        for (const field of fields) {
          defineRecordValue(
            decodedFields,
            field.metadata.name,
            field.codec.decode(reader),
          );
        }
        if (reader.remaining !== 0) {
          throw new Error(`${reader.remaining} trailing payload bytes`);
        }

        return {
          name: eventName,
          topics: decodedTopics,
          fields: decodedFields,
        } as DecodedContractEvent<TName, TTopics, TFields>;
      } catch (cause) {
        if (cause instanceof ContractDecodeError) throw cause;
        const detail = cause instanceof Error ? `: ${cause.message}` : "";
        throw new ContractDecodeError(
          `Failed to decode ${eventName}${detail}`,
          { cause },
        );
      }
    },

    filter(input) {
      if (input.contractAddresses.length === 0) {
        throw new Error(`${eventName} filter requires a contract address`);
      }
      if (input.contractAddresses.length > maxFilterContractAddresses) {
        throw new Error(
          `${eventName} filter supports at most ${maxFilterContractAddresses} contract addresses`,
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
            .map((topic) => [topic.metadata.name, topic] as const),
        );
        for (const [name, constraint] of Object.entries(constraints)) {
          const topic = directTopics.get(name);
          if (topic === undefined) {
            throw new Error(
              `${eventName} topic "${name}" is not directly filterable`,
            );
          }
          const { metadata, index } = topic;
          const values = filterValues(constraint, eventName, metadata);
          const key = `topic${index + 1}` as "topic1" | "topic2";
          filterTopics[key] = values.map((value) =>
            encodeTopic(metadata, value, eventName),
          );
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
      const match = matches[0];
      if (matches.length !== 1 || match === undefined) {
        throw new Error(
          `Expected exactly one ${eventName} event, got ${matches.length}`,
        );
      }
      return match;
    },
  };

  return descriptor;
}

function topicRepresentation(
  type: ContractType,
): ContractEventTopicMetadata["representation"] {
  if (type.v === ContractTypeKind.Address) return "address";
  if (type.v === ContractTypeKind.U256) return "u256";
  if (type.v === ContractTypeKind.I256) return "i256";
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
  topic: ResolvedTopic,
): unknown[] {
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
        `${eventName} topic "${topic.name}" oneOf must not be empty`,
      );
    }
    if (values.length > maxFilterTopicValues) {
      throw new Error(
        `${eventName} topic "${topic.name}" oneOf supports at most ${maxFilterTopicValues} values`,
      );
    }
    return values;
  }
  return [constraint];
}

function decodeTopic(topic: ResolvedTopic, bytes: Uint8Array): unknown {
  switch (topic.representation) {
    case "address":
      return contractAddress(bytes);
    case "fixedBytes32":
    case "hash":
      return bytes;
    case "u256":
    case "i256":
      return topic.codec.decode(new CxsReader(bytes));
  }
}

function encodeTopic(
  topic: ResolvedTopic,
  value: unknown,
  eventName: string,
): Uint8Array {
  switch (topic.representation) {
    case "address":
    case "fixedBytes32":
      return fixedBytes(requireBytes(value, eventName, topic.name), 32);
    case "hash":
      throw new Error(
        `${eventName} topic "${topic.name}" is not directly filterable`,
      );
    case "u256":
    case "i256": {
      const writer = new CxsWriter();
      try {
        topic.codec.encode(writer, value);
      } catch (cause) {
        const detail = cause instanceof Error ? `: ${cause.message}` : "";
        throw new Error(
          `${eventName} topic "${topic.name}" failed to encode${detail}`,
          { cause },
        );
      }
      return fixedBytes(writer.finish(), 32);
    }
  }
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

function defineRecordValue(
  record: Record<string, unknown>,
  name: string,
  value: unknown,
): void {
  Object.defineProperty(record, name, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}
