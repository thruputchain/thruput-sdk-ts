import type { ContractAddress } from "@thruputchain/protocol";
import type {
  Transport,
  TransportRequestOptions,
} from "../../transport/types.js";
import type {
  AddressAuthDataResponse,
  AuthPublicKey,
} from "../../types/rpc.js";
import { parseHeight } from "../decimal.js";
import { addressFromHex, fromHex0x, toHex0x } from "../hex.js";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid address auth response: expected object");
  }
  return value as Record<string, unknown>;
}

function integer(
  value: unknown,
  field: string,
  min = 0,
  max = 0xffff_ffff,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new Error(`Invalid address auth response: ${field}`);
  }
  return value;
}

function publicKey(value: unknown): AuthPublicKey {
  const key = object(value);
  if (key.scheme === "unknown") {
    return {
      scheme: "unknown",
      schemeId: integer(key.schemeId, "schemeId", -0x8000_0000, 0x7fff_ffff),
    };
  }
  if (key.scheme !== "ed25519" || typeof key.key !== "string") {
    throw new Error("Invalid address auth response: publicKey");
  }
  const bytes = fromHex0x(key.key);
  if (bytes.length !== 32)
    throw new Error(
      "Invalid address auth response: expected 32-byte public key",
    );
  return { scheme: "ed25519", key: bytes };
}

/** Read registered signers and their threshold at the latest committed snapshot. */
export async function getAddressAuthData(
  transport: Transport,
  address: ContractAddress,
  options?: TransportRequestOptions,
): Promise<AddressAuthDataResponse> {
  options?.signal?.throwIfAborted();
  const raw = object(
    await transport.request<unknown>(
      "groundhog_getAddressAuthData",
      [toHex0x(address)],
      options,
    ),
  );
  if (typeof raw.address !== "string")
    throw new Error("Invalid address auth response: address");
  const returnedAddress = addressFromHex(raw.address);
  if (toHex0x(returnedAddress) !== toHex0x(address))
    throw new Error("Invalid address auth response: address mismatch");
  const height = parseHeight(raw.height, "address auth height");
  if (raw.authData === null)
    return { address: returnedAddress, height, authData: null };
  const auth = object(raw.authData);
  if (!Array.isArray(auth.signers))
    throw new Error("Invalid address auth response: signers");
  return {
    address: returnedAddress,
    height,
    authData: {
      requiredWeight: integer(auth.requiredWeight, "requiredWeight"),
      signers: auth.signers.map((value) => {
        const signer = object(value);
        return {
          keyId: integer(signer.keyId, "keyId"),
          publicKey: publicKey(signer.publicKey),
          maxWeight: integer(signer.maxWeight, "maxWeight"),
        };
      }),
    },
  };
}
