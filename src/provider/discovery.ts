import { WalletProviderError, type WalletProvider } from "./types.js";
import { parseWalletProvider, parseWalletProviderInfo } from "./validation.js";

/** Discovery request event name. */
export const REQUEST_PROVIDER_EVENT = "groundhog:requestProvider";
/** Announcement detail is the provider itself, not an envelope. */
export const ANNOUNCE_PROVIDER_EVENT = "groundhog:announceProvider";
/** Maximum distinct provider IDs retained by one discovery subscription. */
export const MAX_DISCOVERED_PROVIDERS = 32;

function browserTarget(): EventTarget {
  const target = (globalThis as { window?: EventTarget }).window;
  if (!target)
    throw new WalletProviderError(
      4900,
      "Pass an EventTarget outside a browser",
    );
  return target;
}

/** Announce now and on discovery requests; cleanup stops future announcements. */
export function registerWalletProvider(
  provider: WalletProvider,
  target: EventTarget = browserTarget(),
): () => void {
  parseWalletProvider(provider);
  const announce = () => {
    target.dispatchEvent(
      new CustomEvent(ANNOUNCE_PROVIDER_EVENT, { detail: provider }),
    );
  };
  target.addEventListener(REQUEST_PROVIDER_EVENT, announce);
  announce();
  return () => target.removeEventListener(REQUEST_PROVIDER_EVENT, announce);
}

/** Discover multiple providers in either load order, reporting each valid ID once. */
export function discoverWalletProviders(
  listener: (provider: WalletProvider) => void,
  target: EventTarget = browserTarget(),
): () => void {
  const ids = new Set<string>();
  const announce = (event: Event) => {
    if (ids.size >= MAX_DISCOVERED_PROVIDERS) return;
    let provider: WalletProvider;
    let id: string;
    try {
      provider = parseWalletProvider((event as CustomEvent<unknown>).detail);
      id = parseWalletProviderInfo(provider.info).id;
    } catch {
      return;
    }
    if (ids.has(id)) return;
    ids.add(id);
    listener(provider);
  };
  target.addEventListener(ANNOUNCE_PROVIDER_EVENT, announce);
  target.dispatchEvent(new CustomEvent(REQUEST_PROVIDER_EVENT));
  return () => {
    target.removeEventListener(ANNOUNCE_PROVIDER_EVENT, announce);
    ids.clear();
  };
}
