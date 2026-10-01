import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type { ContractAddress, NetworkHash } from "@groundhogchain/protocol";
import {
  networkHash as toNetworkHash,
  sha256Hash,
} from "@groundhogchain/protocol";
import { parse } from "smol-toml";
import { addressFromHex, fromHex, fromHex0x, toHex0x } from "../actions/hex.js";
import { PrivateKeySigner } from "../signers/index.js";
import type { Signer } from "../signers/index.js";
import { createPubkeyAccount } from "../wallet/account.js";

const supportedDerivationScheme = "groundhog-bootstrap-account-v1";
const maxRuntimeManifestBytes = 1024 * 1024;
const maxDerivationIndex = 0xffff_ffff;

export type LocalDevAccountRole = "faucet" | "local_user";

export interface LocalDevAccount {
  index: number;
  keyName: `dev-${number}`;
  role: LocalDevAccountRole;
  /** Manifest-verified nonce-zero native pubkey account address. */
  address: ContractAddress;
  signer: Signer;
  /**
   * Network hash of the running node, from the manifest. Pass it to
   * `signTransaction`: it is part of every signature preimage, so a signature
   * made against the wrong one is rejected.
   */
  networkHash: NetworkHash;
}

export interface LoadLocalDevAccountOptions {
  /** Account role to select. Defaults to `local_user`. */
  role?: LocalDevAccountRole;
  /** Zero-based position among accounts with the selected role. */
  roleOffset?: number;
  /** Environment override used by tests and scripted applications. */
  env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Load one account from the active `groundhog node` manifest.
 *
 * This Node.js-only helper is intended for local development. Its deterministic
 * signer must not be used with production networks or funds of value.
 */
export async function loadLocalDevAccount(
  options: LoadLocalDevAccountOptions = {},
): Promise<LocalDevAccount> {
  const env = options.env ?? process.env;
  const role = options.role ?? "local_user";
  const roleOffset = options.roleOffset ?? 0;
  if (!Number.isSafeInteger(roleOffset) || roleOffset < 0) {
    throw new RangeError("roleOffset must be a non-negative integer");
  }

  const manifestOverride = nonBlank(env.GROUNDHOG_RUNTIME_MANIFEST);
  let manifestPath: string;
  if (manifestOverride) {
    manifestPath = resolve(manifestOverride);
  } else {
    const configHome =
      nonBlank(env.XDG_CONFIG_HOME) ?? join(requireHome(env), ".config");
    const configPath = join(configHome, "groundhog", "config.toml");
    const config = parse(await readLocalFile(configPath, "Groundhog config"));
    const runtimeState = requireRecord(
      config.local_runtime_state,
      "Groundhog config is missing local_runtime_state; start `groundhog node`",
    );
    manifestPath = requireString(
      runtimeState.runtime_manifest,
      "Groundhog config is missing local_runtime_state.runtime_manifest",
    );
    if (!isAbsolute(manifestPath)) {
      throw new Error("Groundhog runtime manifest path must be absolute");
    }
  }

  const manifest = requireRecord(
    JSON.parse(
      await readLocalFile(
        manifestPath,
        "Groundhog runtime manifest",
        maxRuntimeManifestBytes,
      ),
    ),
    "Groundhog runtime manifest must be an object",
  );
  if (manifest.schemaVersion !== 3 || manifest.kind !== "hogd-dev-runtime") {
    throw new Error("Unsupported Groundhog runtime manifest");
  }
  const derivation = requireRecord(
    manifest.bootstrapAccountDerivation,
    "Groundhog runtime manifest is missing bootstrapAccountDerivation",
  );
  const scheme = requireString(
    derivation.scheme,
    "Groundhog runtime manifest is missing its derivation scheme",
  );
  if (scheme !== supportedDerivationScheme) {
    throw new Error(`Unsupported local account derivation scheme: ${scheme}`);
  }
  const seed = requireString(
    derivation.seed,
    "Groundhog runtime manifest is missing its derivation seed",
  );
  if (!Array.isArray(manifest.bootstrapAccounts)) {
    throw new Error("Groundhog runtime manifest is missing bootstrapAccounts");
  }

  const accounts = manifest.bootstrapAccounts
    .map((value) => requireRecord(value, "Invalid bootstrap account"))
    .filter((account) => account.role === role)
    .sort((a, b) => requireIndex(a.index) - requireIndex(b.index));
  const account = accounts[roleOffset];
  if (!account) {
    throw new Error(
      `Groundhog runtime manifest does not contain ${role} account ${roleOffset + 1}`,
    );
  }

  const index = requireIndex(account.index);
  const secretKey = createHash("sha256")
    .update(`${seed}:account-${index}`)
    .digest();
  const signer = new PrivateKeySigner(secretKey);
  const expectedPublicKey = fromHex0x(
    requireString(account.publicKey, "Bootstrap account is missing publicKey"),
  );
  if (toHex0x(signer.publicKey.ed25519) !== toHex0x(expectedPublicKey)) {
    throw new Error(`Derived key does not match dev-${index}`);
  }

  const address = addressFromHex(
    requireString(
      account.walletAddress,
      "Bootstrap account is missing walletAddress",
    ),
  );
  const nativeAccount = createPubkeyAccount({ signer, nonce: 0n });
  if (toHex0x(address) !== toHex0x(nativeAccount.address)) {
    throw new Error(
      `Bootstrap address does not match nonce-zero native account dev-${index}`,
    );
  }

  // The manifest writes networkHash as bare hex, unlike its 0x-prefixed
  // walletAddress and publicKey. The prefix is tolerated so a later
  // normalization of the manifest does not break this reader.
  const networkHashHex = requireString(
    manifest.networkHash,
    "Groundhog runtime manifest is missing networkHash",
  );
  const manifestNetworkHash = fromHex(
    networkHashHex.startsWith("0x") ? networkHashHex.slice(2) : networkHashHex,
  );
  if (manifestNetworkHash.length !== 32) {
    throw new Error(
      `Groundhog runtime manifest networkHash is ${manifestNetworkHash.length} bytes, expected 32`,
    );
  }

  return {
    index,
    keyName: `dev-${index}`,
    role,
    address,
    signer,
    networkHash: toNetworkHash(sha256Hash(manifestNetworkHash)),
  };
}

async function readLocalFile(
  path: string,
  label: string,
  maxBytes?: number,
): Promise<string> {
  let file;
  try {
    file = await open(path, "r");
  } catch (cause) {
    throw new Error(`${label} is unavailable at ${path}`, { cause });
  }

  let contents: string;
  let exceededLimit = false;
  try {
    if (maxBytes === undefined) {
      contents = await file.readFile("utf8");
    } else {
      const buffer = Buffer.allocUnsafe(maxBytes + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await file.read(
          buffer,
          length,
          buffer.length - length,
          length,
        );
        if (bytesRead === 0) break;
        length += bytesRead;
      }
      exceededLimit = length > maxBytes;
      contents = buffer.toString("utf8", 0, length);
    }
  } catch (cause) {
    throw new Error(`${label} is unavailable at ${path}`, { cause });
  } finally {
    await file.close();
  }

  if (exceededLimit) {
    throw new Error(`${label} exceeds ${maxBytes} bytes at ${path}`);
  }
  return contents;
}

function requireRecord(
  value: unknown,
  message: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(message);
  }
  return value;
}

function requireIndex(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > maxDerivationIndex
  ) {
    throw new Error("Bootstrap account has an invalid derivation index");
  }
  return value as number;
}

function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function requireHome(
  env: Readonly<Record<string, string | undefined>>,
): string {
  const home = nonBlank(env.HOME);
  if (!home) {
    throw new Error("HOME environment variable is not set");
  }
  return home;
}
