import { XdrReader, type CodecLimits } from "@thruputchain/xdr";
import {
  codec,
  ContractTypeKind,
  ContractTypeDefKind,
  ContractUnionCaseKind,
} from "@thruputchain/contract-spec";
import { ContractDecodeError } from "./errors.js";

// Generated XDR counts envelope/option/container levels and value visits,
// unlike schema-1's type levels and collection entries. Preflight remains the
// authoritative schema limit; these bounds allow its accepted inputs to decode.
export const contractSpecCodecLimits: CodecLimits = {
  maxDepth: 256,
  maxWork: 1_000_000,
};

/**
 * Schema-1 tooling limits, mirrored by tools' contract_spec/bounded.rs.
 * Count collection entries and type nodes (tuple elements count in both).
 * Type depth starts at one; named references are leaves, not expansions.
 * This bounds the generated decoder before it recurses or allocates lists.
 */
export function preflightContractSpec(bytes: Uint8Array): void {
  if (bytes.length > 16 * 1024 * 1024)
    throw new ContractDecodeError(
      "Contract spec exceeds byte limit (16777216)",
    );
  const reader = new XdrReader(bytes);
  let work = 100_000;
  const spend = (count: number) => {
    work -= count;
    if (work < 0)
      throw new ContractDecodeError(
        "Contract spec exceeds work limit (100000)",
      );
  };
  const list = (item: () => void) => {
    const count = Number(reader.readUint32());
    if (count > Math.floor(reader.remaining / 4))
      throw new ContractDecodeError("Truncated contract spec collection");
    spend(count);
    for (let i = 0; i < count; i++) item();
  };
  const string = () => {
    codec.ContractSpecString.decode(reader);
  };
  const id = () => {
    codec.ContractSpecId.decode(reader);
  };
  const type = (depth = 1): void => {
    if (depth > 64)
      throw new ContractDecodeError(
        "Contract spec exceeds type nesting limit (64)",
      );
    spend(1);
    const kind = Number(reader.readInt32());
    switch (kind) {
      case ContractTypeKind.Void:
      case ContractTypeKind.Bool:
      case ContractTypeKind.U8:
      case ContractTypeKind.U32:
      case ContractTypeKind.I32:
      case ContractTypeKind.U64:
      case ContractTypeKind.I64:
      case ContractTypeKind.U128:
      case ContractTypeKind.I128:
      case ContractTypeKind.U256:
      case ContractTypeKind.I256:
      case ContractTypeKind.String:
      case ContractTypeKind.Bytes:
      case ContractTypeKind.Address:
        return;
      case ContractTypeKind.Option:
        type(depth + 1);
        return;
      case ContractTypeKind.Vector:
      case ContractTypeKind.Array:
        type(depth + 1);
        reader.readUint32();
        return;
      case ContractTypeKind.Tuple:
        list(() => type(depth + 1));
        return;
      case ContractTypeKind.Named:
        id();
        return;
      case ContractTypeKind.SignedToken:
        if (reader.readBool()) type(depth + 1);
        return;
      default:
        throw new ContractDecodeError(`Unknown contract spec type ${kind}`);
    }
  };
  const field = () => {
    string();
    type();
  };
  try {
    list(() => {
      string();
      string();
      list(() => {
        reader.readUint64();
        type();
      });
      list(() => {
        string();
        list(field);
        type();
        if (reader.readBool()) codec.ContractMethodEffect.decode(reader);
      });
    });
    list(() => {
      const kind = Number(reader.readInt32());
      id();
      switch (kind) {
        case ContractTypeDefKind.TypeDefStruct:
          list(field);
          break;
        case ContractTypeDefKind.TypeDefEnum:
          list(() => {
            codec.ContractEnumVariant.decode(reader);
          });
          break;
        case ContractTypeDefKind.TypeDefUnion:
          list(() => {
            string();
            reader.readInt32();
            const kind = Number(reader.readInt32());
            switch (kind) {
              case ContractUnionCaseKind.UnionCaseVoid:
                break;
              case ContractUnionCaseKind.UnionCaseTuple:
                list(() => type());
                break;
              case ContractUnionCaseKind.UnionCaseStruct:
                list(field);
                break;
              default:
                throw new ContractDecodeError(
                  `Unknown contract spec union case ${kind}`,
                );
            }
          });
          break;
        default:
          throw new ContractDecodeError(
            `Unknown contract spec definition ${kind}`,
          );
      }
    });
    list(() => {
      id();
      reader.readFixedOpaque(32);
      list(field);
      list(field);
    });
    if (reader.remaining !== 0)
      throw new ContractDecodeError("Trailing contract spec bytes");
  } catch (cause) {
    if (cause instanceof ContractDecodeError) throw cause;
    throw new ContractDecodeError("Invalid contract spec XDR", { cause });
  }
}
