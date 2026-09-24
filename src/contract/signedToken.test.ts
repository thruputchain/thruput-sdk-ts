import { describe, expect, it } from "vitest";
import { CxsReader, CxsWriter } from "@groundhogchain/protocol";
import { toHex } from "@groundhogchain/protocol/utils";
import {
  ContractTypeDefKind,
  ContractTypeKind,
  contractSpecString,
  type ContractType,
  type ContractSpecId,
} from "@groundhogchain/contract-spec";
import { createContractCodec, createContractCodecContext } from "./codec.js";
import { resolveCodec } from "./encode.js";
import { isSignedToken, signedToken } from "./signedToken.js";

const s = contractSpecString;

/** A spec id for a test type: one demo crate, so only the name varies. */
function specId(declared: string): ContractSpecId {
  return {
    crate_name: s("demo"),
    major: s("1"),
    module_path: s("demo"),
    declared: s(declared),
  };
}

const opaqueToken: ContractType = {
  v: ContractTypeKind.SignedToken,
  signed_token_preimage: { preimage_type: null },
};

describe("SignedToken codec", () => {
  it("occupies no bytes in either direction", () => {
    const codec = resolveCodec(opaqueToken);
    const writer = new CxsWriter();
    codec.encode(writer, signedToken());
    expect(writer.finish()).toHaveLength(0);

    const reader = new CxsReader(new Uint8Array());
    expect(codec.decode(reader)).toEqual(signedToken());
  });

  it("decodes a token list as its count of placeholders", () => {
    const context = createContractCodecContext([]);
    const codec = createContractCodec<unknown[]>(context, {
      v: ContractTypeKind.Vector,
      vector: { element: opaqueToken, max_len: 4294967295n },
    });
    expect(codec.decode(new Uint8Array([3]))).toEqual([
      signedToken(),
      signedToken(),
      signedToken(),
    ]);
    expect(toHex(codec.encode([signedToken(), signedToken()]))).toBe("02");
  });

  it("encodes a struct with a token field as its other fields only", () => {
    const context = createContractCodecContext([
      {
        v: ContractTypeDefKind.TypeDefStruct,
        struct_def: {
          name: specId("Call"),
          fields: [
            { name: s("amount"), ty: { v: ContractTypeKind.U64 } },
            {
              name: s("auth"),
              ty: {
                v: ContractTypeKind.SignedToken,
                signed_token_preimage: {
                  preimage_type: { v: ContractTypeKind.U64 },
                },
              },
            },
          ],
        },
      },
    ]);
    const codec = createContractCodec<{ amount: bigint; auth: unknown }>(
      context,
      { v: ContractTypeKind.Named, named: specId("Call") },
    );
    expect(toHex(codec.encode({ amount: 5n, auth: signedToken() }))).toBe("05");
    expect(codec.decode(new Uint8Array([5]))).toEqual({
      amount: 5n,
      auth: signedToken(),
    });
  });

  it("rejects anything but a placeholder where a token is expected", () => {
    const codec = resolveCodec(opaqueToken);
    for (const bad of [null, undefined, {}, { kind: "token" }, 1n]) {
      expect(() => codec.encode(new CxsWriter(), bad)).toThrow(TypeError);
    }
    expect(isSignedToken(signedToken())).toBe(true);
    expect(isSignedToken({ kind: "signedToken" })).toBe(true);
    expect(isSignedToken({})).toBe(false);
  });
});
