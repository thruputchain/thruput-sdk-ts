import { addressFromBase58 } from "../encoding.js";
import { kMaxEventLength, kMaxTopics } from "@thruputchain/protocol";
import type { EmittedEvent } from "../types/rpc.js";
import { fromHex0x } from "./hex.js";

interface RawEmittedEvent {
  contractAddress?: unknown;
  topics?: unknown;
  data?: unknown;
}

export function parseEmittedEvent(value: unknown): EmittedEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid emitted event: expected an object");
  }

  const event = value as RawEmittedEvent;
  if (typeof event.contractAddress !== "string") {
    throw new Error("Invalid emitted event: expected contractAddress");
  }
  if (!Array.isArray(event.topics)) {
    throw new Error("Invalid emitted event: expected topics");
  }
  if (typeof event.data !== "string") {
    throw new Error("Invalid emitted event: expected data");
  }
  if (BigInt(event.topics.length) > kMaxTopics) {
    throw new Error(
      `Invalid emitted event: expected at most ${kMaxTopics} topics`,
    );
  }

  const topics = event.topics.map((topic, index) => {
    if (typeof topic !== "string") {
      throw new Error(
        `Invalid emitted event: expected topic ${index} to be hex`,
      );
    }
    const bytes = fromHex0x(topic);
    if (bytes.length !== 32) {
      throw new Error(
        `Invalid emitted event: expected topic ${index} to be exactly 32 bytes, got ${bytes.length}`,
      );
    }
    return bytes;
  });
  const data = fromHex0x(event.data);
  const serializedLength = topics.reduce(
    (length, topic) => length + topic.length,
    data.length,
  );
  if (BigInt(serializedLength) > kMaxEventLength) {
    throw new Error(
      `Invalid emitted event: serialized topics and data exceed ${kMaxEventLength} bytes`,
    );
  }

  return {
    contractAddress: addressFromBase58(event.contractAddress),
    topics,
    data,
  };
}
