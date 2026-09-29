import { describe, expect, it } from "vitest";
import {
  contractAddress,
  gasAmount,
  blockHeight,
  AuthClaimType,
  bitMap,
  weight,
  sha256Hash,
  networkHash,
  CxsWriter,
} from "@groundhogchain/protocol";
import { hashSignedTransaction } from "../derivation/transactionHash.js";
import { PrivateKeySigner } from "../signers/privateKey.js";
import { createTransaction } from "../transaction/build.js";
import { signTransaction } from "../transaction/sign.js";
import { decodeCalldata } from "../contract/encode.js";
import { buildNamedCodecs } from "../contract/codegen.js";
import { ERC20, ERC20Metadata, spec } from "./erc20.js";
import { decodeERC20Event, groundhog_erc20_if } from "./index.js";

const {
  AllowanceChangeEvent: ERC20AllowanceChangeEvent,
  BurnEvent: ERC20BurnEvent,
  MintEvent: ERC20MintEvent,
  TransferEvent: ERC20TransferEvent,
} = groundhog_erc20_if.v0_1.events;

const namedCodecs = buildNamedCodecs(spec.type_defs);

const testNetworkHash = networkHash(sha256Hash(new Uint8Array(32).fill(0x5a)));

describe("generated ERC20 events", () => {
  const token = contractAddress(new Uint8Array(32).fill(0x11));
  const account = contractAddress(new Uint8Array(32).fill(0x22));
  const other = contractAddress(new Uint8Array(32).fill(0x33));

  // Signatures and wire layouts from groundhog-erc20-if 0.1.41, independent
  // of the generated descriptors so a stale binding cannot bless itself.
  const cases = [
    {
      name: "AllowanceChangeEvent",
      descriptor: ERC20AllowanceChangeEvent,
      signature:
        "8f651cf72869c41d81740e5d5c083f66b7cb8c9041ab203c243c8296ac0fb050",
      topics: [account, other],
      decodedTopics: { owner: account, spender: other },
      fields: { difference: -1000n },
      value: -1000n,
    },
    {
      name: "BurnEvent",
      descriptor: ERC20BurnEvent,
      signature:
        "513f00645e2752c8b6273adbbd6b0dae498cf7c4028751e05c7d8900fb4182c5",
      topics: [account],
      decodedTopics: { from: account },
      fields: { amount: 1000n },
      value: 1000n,
    },
    {
      name: "MintEvent",
      descriptor: ERC20MintEvent,
      signature:
        "10c4493b678f7f00f19a3bbf4fa153186a2d1f4cf328a495718af7679fa54ea4",
      topics: [account],
      decodedTopics: { to: account },
      fields: { amount: 1000n },
      value: 1000n,
    },
    {
      name: "TransferEvent",
      descriptor: ERC20TransferEvent,
      signature:
        "5ff62377bf52711e75461f4d8f9b4585f17d1c20f7e1eceb280194a7764bae5f",
      topics: [account, other],
      decodedTopics: { from: account, to: other },
      fields: { amount: 1000n },
      value: 1000n,
    },
  ];

  it.each(cases)("decodes and extracts $name", (testCase) => {
    const writer = new CxsWriter();
    writer.writeInt128(testCase.value);
    const event = {
      contractAddress: token,
      topics: [
        Uint8Array.from(Buffer.from(testCase.signature, "hex")),
        ...testCase.topics,
      ],
      data: writer.finish(),
    };
    const decoded = {
      name: testCase.name,
      topics: testCase.decodedTopics,
      fields: testCase.fields,
    };

    expect(testCase.descriptor.signature).toEqual(event.topics[0]);
    expect(testCase.descriptor.decode(event)).toEqual(decoded);
    expect(decodeERC20Event(event)).toEqual(decoded);
    expect(
      testCase.descriptor.allFromReceipt(
        {
          events: [
            { ...event, contractAddress: other },
            { ...event, topics: [new Uint8Array(32)] },
            event,
          ],
        },
        { contractAddress: token },
      ),
    ).toEqual([{ ...decoded, contractAddress: token }]);
    expect(() =>
      testCase.descriptor.decode({ ...event, data: new Uint8Array() }),
    ).toThrow();
  });

  it("builds named mint and burn topic filters", () => {
    expect(
      ERC20MintEvent.filter({
        contractAddresses: [token],
        topics: { to: account },
      }),
    ).toEqual({
      contractAddresses: [token],
      topics: { topic0: [ERC20MintEvent.signature], topic1: [account] },
    });
    expect(
      ERC20BurnEvent.filter({
        contractAddresses: [token],
        topics: { from: { oneOf: [account, other] } },
      }),
    ).toEqual({
      contractAddresses: [token],
      topics: { topic0: [ERC20BurnEvent.signature], topic1: [account, other] },
    });
  });

  it("returns null for unrelated event signatures", () => {
    expect(
      decodeERC20Event({
        topics: [new Uint8Array(32)],
        data: new Uint8Array(),
      }),
    ).toBeNull();
  });
});

describe("generated ERC20 contract bindings", () => {
  it("transfer() builds a valid invocation", () => {
    const token = contractAddress(new Uint8Array(32).fill(0x11));
    const recipient = contractAddress(new Uint8Array(32).fill(0x22));

    const invocation = ERC20.v0_1.transfer.invocation(
      token,
      gasAmount(1_000_000n),
      {
        receiver: recipient,
        amount: 500n,
      },
    );

    expect(invocation.invoked_address).toEqual(token);
    expect(invocation.gas_limit).toBe(1_000_000n);
    expect(invocation.entrypoint.length).toBe(8);

    const decoded = decodeCalldata(
      spec,
      "ERC20",
      "transfer",
      invocation.calldata,
      namedCodecs,
    );
    expect(decoded.receiver).toEqual(recipient);
    expect(decoded.amount).toBe(500n);
  });

  it("getBalance() builds a zero-arg invocation", () => {
    const token = contractAddress(new Uint8Array(32).fill(0x11));
    const invocation = ERC20.v0_1.getBalance.invocation(
      token,
      gasAmount(500_000n),
    );

    expect(invocation.invoked_address).toEqual(token);
    expect(invocation.calldata.length).toBe(0);
  });

  it("metadata symbol() builds a zero-arg invocation", () => {
    const token = contractAddress(new Uint8Array(32).fill(0x11));
    const invocation = ERC20Metadata.v0_1.symbol.invocation(
      token,
      gasAmount(500_000n),
    );

    expect(invocation.invoked_address).toEqual(token);
    expect(invocation.calldata.length).toBe(0);
  });

  it("composes into a full signed transaction", async () => {
    const secretKey = new Uint8Array(32);
    secretKey[0] = 0xab;
    const signer = new PrivateKeySigner(secretKey);

    const token = contractAddress(new Uint8Array(32).fill(0x11));
    const recipient = contractAddress(new Uint8Array(32).fill(0x22));

    const invocation = ERC20.v0_1.transfer.invocation(
      token,
      gasAmount(1_000_000n),
      {
        receiver: recipient,
        amount: 100n,
      },
    );

    const tx = createTransaction({
      invocation,
      uniquifier: { block_expiry_height: blockHeight(500n), nonce: 1n },
      contracts_to_deploy: [],
      auth_claim: {
        claim_type: AuthClaimType.kSourceAddressAuthData,
        source_address_claim: {
          allowed_keys: bitMap(0xffffffffn),
          required_weight: weight(1n),
        },
      },
    });

    const signed = await signTransaction(
      tx,
      [{ signer, publicKeyId: 0n }],
      testNetworkHash,
    );
    const hash = hashSignedTransaction(signed);
    expect(hash.length).toBe(32);
  });
});
