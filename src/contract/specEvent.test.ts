import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { codec, deserialize } from "@thruputchain/contract-spec";
import { CxsWriter } from "@thruputchain/protocol";
import { thruput_erc20_if } from "../contracts/erc20.js";
import { createContractEventDecoder } from "./event.js";

const spec = deserialize(
  new Uint8Array(
    readFileSync(
      new URL("../../specs/contracts/erc20.spec.xdr", import.meta.url),
    ),
  ),
  codec.ContractSpec,
);
const transfer = thruput_erc20_if.v0_1.events.TransferEvent;

it("generic decoding agrees with the generated ERC20 binding", () => {
  const writer = new CxsWriter();
  writer.writeInt128(42n);
  const event = {
    topics: [
      transfer.signature,
      new Uint8Array(32).fill(1),
      new Uint8Array(32).fill(2),
    ],
    data: writer.finish(),
  };
  const generated = transfer.decode(event);
  const decoded = createContractEventDecoder(spec)(event);
  expect(decoded?.topics).toEqual(generated?.topics);
  expect(decoded?.fields).toEqual(generated?.fields);
  expect(decoded?.name).toContain("TransferEvent");
});

it("keeps unknown signatures distinct from malformed known events", () => {
  const decode = createContractEventDecoder(spec);
  expect(
    decode({ topics: [new Uint8Array(32).fill(255)], data: new Uint8Array() }),
  ).toBeNull();
  expect(() =>
    decode({ topics: [transfer.signature], data: new Uint8Array() }),
  ).toThrow();
});

it("rejects ambiguous duplicate event signatures", () => {
  expect(() =>
    createContractEventDecoder({
      ...spec,
      events: [...spec.events, ...spec.events],
    }),
  ).toThrow("Duplicate event signature");
});
