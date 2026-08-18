// Generated from counter.wasm - Counter interface v0.1.0.
// Client imports point at local source so the repository example runs before build.

import type {
  ContractAddress,
  GasAmount,
  Invocation,
} from "@groundhogchain/protocol";
import { contractEntrypointID, topic } from "@groundhogchain/protocol";
import { fromHex } from "@groundhogchain/protocol/utils";
import {
  ContractTypeKind,
  ContractTypeDefKind,
  contractSpecString,
} from "@groundhogchain/contract-spec";
import {
  buildNamedCodecs,
  createInvocation,
  encodeCalldata,
  resolveCodec,
} from "../../src/index.js";
import type { ContractSpec } from "../../src/index.js";
import { CxsReader } from "@groundhogchain/xdr";

const s = contractSpecString;

const entrypoints = {
  Counter: {
    decrement: contractEntrypointID(fromHex("048705b4b12f5264")),
    error: contractEntrypointID(fromHex("dcb12efadd026c01")),
    get: contractEntrypointID(fromHex("4a63f587ead25ca6")),
    increment: contractEntrypointID(fromHex("009cca8514f955ce")),
    initialize: contractEntrypointID(fromHex("2bfe21a62e5119c4")),
    ping: contractEntrypointID(fromHex("1bdf2969df1758bd")),
  },
} as const;

export enum CounterError {
  NotAuthorized = 1,
}

export const spec: ContractSpec = {
  interfaces: [
    {
      name: s("Counter"),
      vers: s("0.1.0"),
      throws: [
        {
          selector: 0xeb2cf72be75a4c62n,
          ty: { v: ContractTypeKind.Named, named: s("CounterError") },
        },
      ],
      methods: [
        {
          name: s("decrement"),
          args: [{ name: s("amount"), ty: { v: ContractTypeKind.U64 } }],
          return_type: { v: ContractTypeKind.Void },
        },
        {
          name: s("error"),
          args: [],
          return_type: { v: ContractTypeKind.U64 },
        },
        {
          name: s("get"),
          args: [],
          return_type: { v: ContractTypeKind.U64 },
        },
        {
          name: s("increment"),
          args: [{ name: s("amount"), ty: { v: ContractTypeKind.U64 } }],
          return_type: { v: ContractTypeKind.Void },
        },
        {
          name: s("initialize"),
          args: [{ name: s("initial_value"), ty: { v: ContractTypeKind.U64 } }],
          return_type: { v: ContractTypeKind.Void },
        },
        {
          name: s("ping"),
          args: [{ name: s("tag"), ty: { v: ContractTypeKind.U64 } }],
          return_type: { v: ContractTypeKind.Void },
        },
      ],
    },
  ],
  type_defs: [
    {
      v: ContractTypeDefKind.TypeDefEnum,
      enum_def: {
        name: s("CounterError"),
        variants: [{ name: s("NotAuthorized"), value: 1n }],
      },
    },
  ],
  events: [
    {
      name: s("PingEvent"),
      signature: topic(
        fromHex(
          "f0c8fa264c489d9d6bc8796daa7d6ab408d76b37ef41b6d6d951e20f63d10f52",
        ),
      ),
      topics: [{ name: s("tag"), ty: { v: ContractTypeKind.U64 } }],
      fields: [],
    },
  ],
};

const namedCodecs = buildNamedCodecs(spec.type_defs);

export const Counter = {
  decrement(
    contract: ContractAddress,
    gasLimit: GasAmount,
    args: { amount: bigint },
  ): Invocation {
    return createInvocation({
      invoked_address: contract,
      entrypoint: entrypoints.Counter.decrement,
      gas_limit: gasLimit,
      calldata: encodeCalldata(
        spec,
        "Counter",
        "decrement",
        [args.amount],
        namedCodecs,
      ),
    });
  },
  error(contract: ContractAddress, gasLimit: GasAmount): Invocation {
    return createInvocation({
      invoked_address: contract,
      entrypoint: entrypoints.Counter.error,
      gas_limit: gasLimit,
      calldata: encodeCalldata(spec, "Counter", "error", [], namedCodecs),
    });
  },
  get(contract: ContractAddress, gasLimit: GasAmount): Invocation {
    return createInvocation({
      invoked_address: contract,
      entrypoint: entrypoints.Counter.get,
      gas_limit: gasLimit,
      calldata: encodeCalldata(spec, "Counter", "get", [], namedCodecs),
    });
  },
  increment(
    contract: ContractAddress,
    gasLimit: GasAmount,
    args: { amount: bigint },
  ): Invocation {
    return createInvocation({
      invoked_address: contract,
      entrypoint: entrypoints.Counter.increment,
      gas_limit: gasLimit,
      calldata: encodeCalldata(
        spec,
        "Counter",
        "increment",
        [args.amount],
        namedCodecs,
      ),
    });
  },
  initialize(
    contract: ContractAddress,
    gasLimit: GasAmount,
    args: { initialValue: bigint },
  ): Invocation {
    return createInvocation({
      invoked_address: contract,
      entrypoint: entrypoints.Counter.initialize,
      gas_limit: gasLimit,
      calldata: encodeCalldata(
        spec,
        "Counter",
        "initialize",
        [args.initialValue],
        namedCodecs,
      ),
    });
  },
  ping(
    contract: ContractAddress,
    gasLimit: GasAmount,
    args: { tag: bigint },
  ): Invocation {
    return createInvocation({
      invoked_address: contract,
      entrypoint: entrypoints.Counter.ping,
      gas_limit: gasLimit,
      calldata: encodeCalldata(
        spec,
        "Counter",
        "ping",
        [args.tag],
        namedCodecs,
      ),
    });
  },
} as const;

function topicEquals(a: Uint8Array | undefined, b: Uint8Array): boolean {
  if (a === undefined || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export interface PingEvent {
  name: "PingEvent";
  topics: { tag: Uint8Array };
  fields: {};
}
export const PingEvent = {
  /** Topic-0 signature hash from the contract spec. */
  signature: fromHex(
    "f0c8fa264c489d9d6bc8796daa7d6ab408d76b37ef41b6d6d951e20f63d10f52",
  ),
  /** Returns null if topic 0 does not identify this event. */
  decode(event: { topics: Uint8Array[]; data: Uint8Array }): PingEvent | null {
    if (!topicEquals(event.topics[0], PingEvent.signature)) return null;
    if (event.topics.length !== 2) {
      throw new Error(
        `PingEvent: expected 2 topics, got ${event.topics.length}`,
      );
    }
    const r = new CxsReader(event.data);
    if (r.remaining !== 0) {
      throw new Error(`PingEvent: ${r.remaining} trailing bytes after payload`);
    }
    return { name: "PingEvent", topics: { tag: event.topics[1] }, fields: {} };
  },
} as const;

export type CounterEvent = PingEvent;

export function decodeEvent(event: {
  topics: Uint8Array[];
  data: Uint8Array;
}): CounterEvent | null {
  return PingEvent.decode(event);
}
