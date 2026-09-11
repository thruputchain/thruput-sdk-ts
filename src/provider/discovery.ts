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

/**
 * Validate and announce a live provider now and on each discovery request.
 * Announcement detail is the provider itself. Defaults to `window`; pass an
 * `EventTarget` outside a browser. Importing this module needs no browser globals.
 *
 * @returns Idempotent cleanup that removes the request listener. It stops future
 * announcements from this registration, but does not retract a provider already
 * discovered, disconnect sessions, or revoke permissions. There is no unregister event.
 *
 * @see https://docs.groundhog.dev/tools/wallet-provider/
 */
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

/**
 * Discover multiple providers in either load order, reporting each valid ID once.
 * Installs the announcement listener before requesting providers. Malformed
 * announcements are ignored; the first valid announcement for an ID wins, up to
 * {@link MAX_DISCOVERED_PROVIDERS} IDs per subscription. IDs remain reserved until
 * cleanup, even if a provider stops announcing. Discovery does not track removals.
 *
 * Defaults to `window`; pass an `EventTarget` outside a browser. IDs and names can
 * be spoofed by page scripts: discovery validates shape, not wallet identity or trust.
 * Render names as text, never HTML.
 *
 * @returns Idempotent cleanup that removes the listener and releases retained IDs.
 * It does not disconnect discovered providers or revoke their permissions.
 *
 * @see https://docs.groundhog.dev/tools/wallet-integration/
 */
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
