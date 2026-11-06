import type { Invocation } from "@thruputchain/protocol";
import { deriveEntrypointID } from "../derivation/entrypointId.js";
import { createContractCodecContext } from "./codec.js";
import { ContractDecodeError } from "./errors.js";
import {
  defineContractMethodWithExceptions,
  resolveContractExceptions,
  type ContractMethod,
} from "./method.js";
import type { ContractSpec } from "./spec.js";

/** A declared exception decoded from a spec without generated value types. */
export interface SpecDeclaredException {
  kind: "declared";
  selector: bigint;
  name: string | null;
  value: unknown;
}

/** A call interpreted using the supplied spec, not evidence of code execution. */
export interface SpecDecodedCall {
  interfaceName: string;
  interfaceVersion: string;
  methodName: string;
  args: Record<string, unknown> | undefined;
  method: ContractMethod<
    Record<string, unknown> | void,
    unknown,
    SpecDeclaredException
  >;
}

/**
 * Decode a selector and arguments with the generated-binding codecs.
 * Unknown selectors return null; malformed known inputs throw. The caller must
 * establish the spec's identity. A current spec does not prove historical code.
 */
export function createContractCallDecoder(
  spec: ContractSpec,
): (
  invocation: Pick<Invocation, "entrypoint" | "calldata">,
) => SpecDecodedCall | null {
  const snapshot = structuredClone(spec);
  const codecs = createContractCodecContext(snapshot.type_defs);
  const methods = new Map<string, Omit<SpecDecodedCall, "args">>();
  for (const iface of snapshot.interfaces) {
    const throws = iface.throws.map((exception) => ({
      selector: exception.selector,
      name: null,
      type: exception.ty,
    }));
    const exceptions = resolveContractExceptions({ throws, codecs });
    for (const method of iface.methods) {
      const key = deriveEntrypointID(iface.name, iface.vers, method.name).join(
        ",",
      );
      if (methods.has(key))
        throw new ContractDecodeError(
          "Duplicate method selector in contract spec",
        );
      if (
        new Set(method.args.map((arg) => arg.name)).size !== method.args.length
      ) {
        throw new ContractDecodeError(
          "Duplicate argument name in contract spec",
        );
      }
      const descriptor = defineContractMethodWithExceptions<
        Record<string, unknown> | void,
        unknown,
        SpecDeclaredException
      >(
        {
          interfaceName: iface.name,
          interfaceVersion: iface.vers,
          publicName: method.name,
          abiName: method.name,
          entrypoint: deriveEntrypointID(iface.name, iface.vers, method.name),
          effect: method.effect,
          args: method.args.map((arg) => ({
            abiName: arg.name,
            publicName: arg.name,
            type: arg.ty,
          })),
          returnType: method.return_type,
          throws,
          codecs,
        },
        exceptions,
      );
      methods.set(key, {
        interfaceName: iface.name,
        interfaceVersion: iface.vers,
        methodName: method.name,
        method: descriptor,
      });
    }
  }
  return (invocation) => {
    const found = methods.get(invocation.entrypoint.join(","));
    if (!found) return null;
    return {
      ...found,
      args: found.method.decodeArgs(invocation.calldata) || undefined,
    };
  };
}
