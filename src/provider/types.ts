/** Public identity advertised by a version 1 provider. Not an attestation. */
export interface WalletProviderInfo {
  id: string;
  name: string;
  version: "1.0.0";
}

/** Wire pubkey account: canonical 0x hex and a decimal u64 derivation nonce. */
export interface WalletAccount {
  address: string;
  publicKey: string;
  nonce: string;
}

/** Origin-authorized accounts on a network (64 lowercase hex, no 0x). */
export interface WalletSession {
  networkHash: string;
  accounts: readonly WalletAccount[];
}

/** The complete provider request surface. Signing never broadcasts. */
export type ProviderRequest =
  | { method: "connect" }
  | { method: "getSession" }
  | { method: "disconnect" }
  | {
      method: "signTransaction";
      params: { account: string; networkHash: string; transaction: string };
    }
  | {
      method: "submitTransaction";
      params: {
        account: string;
        networkHash: string;
        signedTransaction: string;
      };
    };

/** Approved signed XDR and the canonical RPC transaction/receipt hash. */
export interface SignTransactionResult {
  signedTransaction: string;
  hash: string;
}

/** Broadcast acknowledgement, not an execution receipt. */
export interface SubmitTransactionResult {
  hash: string;
}

/** Framework- and transport-neutral, origin-scoped wallet interface. */
export interface WalletProvider {
  info: WalletProviderInfo;
  /** Changes caused by connect/disconnect reach listeners before this resolves. */
  request(request: ProviderRequest): Promise<unknown>;
  on(event: "change", listener: (session: WalletSession) => void): () => void;
}

/** Stable provider error codes, including JSON-RPC-style request failures. */
export type WalletProviderErrorCode =
  | 4001
  | 4100
  | 4200
  | 4900
  | 4901
  | -32602
  | -32603
  | -32002;

/** A provider failure. After submit starts, even failure may mean broadcast. */
export class WalletProviderError extends Error {
  constructor(
    readonly code: WalletProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WalletProviderError";
  }
}
