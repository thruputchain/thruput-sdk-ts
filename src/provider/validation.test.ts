import { describe, expect, it } from "vitest";
import { toBase58 } from "../encoding.js";
import { PrivateKeySigner } from "../signers/privateKey.js";
import { createPubkeyAccount } from "../wallet/account.js";
import {
  MAX_TRANSACTION_BYTES,
  WalletProviderError,
  parseProviderRequest,
  parseSignedTransactionHex,
  parseTransactionHex,
  parseWalletAccount,
  parseWalletIdentifier,
  parseWalletNetworkHash,
  parseWalletProvider,
  parseWalletProviderError,
  parseWalletProviderInfo,
  parseWalletSession,
} from "./index.js";

const signer = new PrivateKeySigner(new Uint8Array(32).fill(1));
const localAccount = createPubkeyAccount({ signer, nonce: 7n });
const account = {
  address: toBase58(localAccount.address),
  publicKey: toBase58(signer.publicKey.ed25519),
  nonce: "7",
};
const networkHash = toBase58(new Uint8Array(32).fill(171));

it("preserves case and leading zero bytes in provider identifiers", () => {
  const first = "29d2S7vB453rNYFdR5Ycwt7y9haRT5fwVwL9zTmBhfV2";
  const second = "29D2S7vB453rNYFdR5Ycwt7y9haRT5fwVwL9zTmBhfV2";
  expect(parseWalletIdentifier(first)).toBe(first);
  expect(parseWalletIdentifier(second)).toBe(second);
  expect(parseWalletNetworkHash("1".repeat(32))).toBe("1".repeat(32));
  for (const size of [0, 31, 33]) {
    expect(() =>
      parseWalletIdentifier(toBase58(new Uint8Array(size))),
    ).toThrow();
  }
});

describe("provider boundary validation", () => {
  it("accepts opaque extension names alongside the recognized capability method", () => {
    const provider = {
      info: { id: "wallet", name: "Wallet", version: "2.0.0" as const },
      supportedMethods: [
        "vendor_method",
        "vendor.method",
        "vendor-method",
        "vendor:" + "x".repeat(100),
        "",
        "getCapabilities",
      ],
      request: async () => null,
      on: () => () => {},
    };
    expect(parseWalletProvider(provider)).toBe(provider);
  });

  it.each(
    [
      null,
      "getCapabilities",
      [123],
      [null],
      Array(1),
      Array(33).fill("extension"),
    ].map((supportedMethods) => ({ supportedMethods })),
  )("rejects malformed optional method lists: %j", ({ supportedMethods }) => {
    expect(() =>
      parseWalletProvider({
        info: { id: "wallet", name: "Wallet", version: "2.0.0" },
        supportedMethods,
        request: async () => null,
        on: () => () => {},
      }),
    ).toThrow(WalletProviderError);
  });
  it("preserves the live provider identity, metadata, and method receiver", async () => {
    const provider = {
      info: { id: "wallet", name: "Wallet", version: "2.0.0" as const },
      session: { networkHash, accounts: [account] },
      async request() {
        return this.session;
      },
      on: () => () => {},
    };
    const parsed = parseWalletProvider(provider);
    expect(parsed).toBe(provider);
    provider.info.name = "Renamed Wallet";
    expect(parsed.info.name).toBe("Renamed Wallet");
    expect(await parsed.request({ method: "getSession" })).toBe(
      provider.session,
    );
  });

  it("snapshots and freezes valid sessions, including disconnected sessions", () => {
    const input = { networkHash, accounts: [{ ...account }] };
    const session = parseWalletSession(input);
    input.accounts[0]!.nonce = "8";
    expect(session.accounts).toEqual([account]);
    expect(Object.isFrozen(session)).toBe(true);
    expect(Object.isFrozen(session.accounts)).toBe(true);
    expect(Object.isFrozen(session.accounts[0])).toBe(true);
    expect(parseWalletSession({ networkHash, accounts: [] }).accounts).toEqual(
      [],
    );
  });

  it.each([
    null,
    [],
    {},
    { networkHash, accounts: null },
    { networkHash, accounts: [account, account] },
    { networkHash, accounts: Array(33).fill(account) },
    { networkHash, accounts: Array(1) },
    { networkHash, accounts: [], extra: true },
  ])("rejects malformed sessions: %j", (value) => {
    expect(() => parseWalletSession(value)).toThrow(WalletProviderError);
  });

  it.each([
    "0x" + networkHash,
    "ab".repeat(32),
    "a".repeat(63),
    "g".repeat(64),
    networkHash + "\n",
    1,
  ])("rejects noncanonical network hashes: %s", (value) => {
    expect(() => parseWalletNetworkHash(value)).toThrow();
  });

  it.each([
    "ab".repeat(32),
    "0x" + networkHash.toUpperCase(),
    "0x1",
    "0x" + "aa".repeat(33),
    "0x" + networkHash + "\n",
  ])("rejects invalid base58 identifiers: %s", (value) => {
    expect(() => parseWalletIdentifier(value)).toThrow();
  });

  it.each([
    "",
    "01",
    "+1",
    "-1",
    "1.0",
    "1e1",
    "18446744073709551616",
    "1".repeat(100),
    "7\n",
    "7\r",
    7,
  ])("rejects noncanonical account nonces: %s", (nonce) => {
    expect(() => parseWalletAccount({ ...account, nonce })).toThrow();
  });

  it("accepts the full u64 derivation range", () => {
    for (const nonce of [0n, 0xffff_ffff_ffff_ffffn]) {
      const derived = createPubkeyAccount({ signer, nonce });
      expect(
        parseWalletAccount({
          ...account,
          address: toBase58(derived.address),
          nonce: String(nonce),
        }).nonce,
      ).toBe(String(nonce));
    }
  });

  it.each([
    toBase58(new Uint8Array(32)),
    toBase58(Uint8Array.from([1, ...new Uint8Array(31)])),
    toBase58(new Uint8Array(32).fill(255)),
  ])("rejects invalid or small-order public keys", (publicKey) => {
    expect(() => parseWalletAccount({ ...account, publicKey })).toThrow(
      "Invalid Ed25519 public key",
    );
  });

  it("rejects a mismatched address or derivation nonce", () => {
    expect(() =>
      parseWalletAccount({ ...account, address: toBase58(new Uint8Array(32)) }),
    ).toThrow("derivation mismatch");
    expect(() => parseWalletAccount({ ...account, nonce: "8" })).toThrow(
      "derivation mismatch",
    );
  });

  it.each([
    { id: "", name: "Wallet", version: "2.0.0" },
    { id: "a".repeat(65), name: "Wallet", version: "2.0.0" },
    { id: "a b", name: "Wallet", version: "2.0.0" },
    { id: "a\n", name: "Wallet", version: "2.0.0" },
    { id: "a", name: "x".repeat(81), version: "2.0.0" },
    { id: "a", name: " Wallet", version: "2.0.0" },
    { id: "a", name: "Wallet\n", version: "2.0.0" },
    { id: "a", name: "Wallet", version: "1.0.0" },
  ])("rejects invalid discovery info %j", (info) => {
    expect(() => parseWalletProviderInfo(info)).toThrow();
  });

  it.each([4001, 4100, 4200, 4900, 4901, -32602, -32603, -32002] as const)(
    "preserves error code %s across a wire boundary",
    (code) => {
      const error = parseWalletProviderError({ code, message: "Failure" });
      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({
        name: "WalletProviderError",
        code,
        message: "Failure",
      });
      expect(
        parseWalletProviderError(new WalletProviderError(code, "Failure")),
      ).toMatchObject({ code });
    },
  );

  it.each([
    { code: 1, message: "Failure" },
    { code: "4001", message: "Failure" },
    { code: 4001, message: "x".repeat(1025) },
  ])("rejects invalid wire errors", (value) =>
    expect(() => parseWalletProviderError(value)).toThrow(),
  );

  it("rejects unknown methods and extra request fields", () => {
    expect(() => parseProviderRequest({ method: "signMessage" })).toThrow(
      expect.objectContaining({ code: 4200 }),
    );
    expect(() =>
      parseProviderRequest({ method: "connect", params: {} }),
    ).toThrow(expect.objectContaining({ code: -32602 }));
    for (const method of ["connect", "getSession", "disconnect"] as const) {
      expect(parseProviderRequest({ method })).toEqual({ method });
    }
  });

  it.each([parseTransactionHex, parseSignedTransactionHex])(
    "bounds hex before decoding XDR",
    (parse) => {
      for (const value of [
        "0x",
        "0x0",
        "0xGG",
        "0X0000",
        "0x00",
        "0x" + "00".repeat(MAX_TRANSACTION_BYTES + 1),
      ]) {
        expect(() => parse(value)).toThrow(
          expect.objectContaining({ code: -32602 }),
        );
      }
    },
  );
});
