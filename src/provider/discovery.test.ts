import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ANNOUNCE_PROVIDER_EVENT,
  REQUEST_PROVIDER_EVENT,
  discoverWalletProviders,
  registerWalletProvider,
  type WalletProvider,
} from "./index.js";

function provider(id: string): WalletProvider {
  return {
    info: { id, name: "Test Wallet", version: "1.0.0" },
    request: vi.fn(),
    on: () => () => {},
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("wallet provider discovery", () => {
  it.each([true, false])(
    "supports either load order (provider first: %s)",
    (providerFirst) => {
      const target = new EventTarget();
      const wallet = provider("wallet");
      const listener = vi.fn();
      const cleanups = providerFirst
        ? [
            registerWalletProvider(wallet, target),
            discoverWalletProviders(listener, target),
          ]
        : [
            discoverWalletProviders(listener, target),
            registerWalletProvider(wallet, target),
          ];
      expect(listener).toHaveBeenCalledExactlyOnceWith(wallet);
      target.dispatchEvent(new CustomEvent(REQUEST_PROVIDER_EVENT));
      expect(listener).toHaveBeenCalledTimes(1);
      cleanups.forEach((cleanup) => {
        cleanup();
        cleanup();
      });
    },
  );

  it("discovers multiple IDs, ignoring duplicate IDs and malformed announcements", () => {
    const target = new EventTarget();
    const listener = vi.fn();
    const stop = discoverWalletProviders(listener, target);
    for (const detail of [
      null,
      {},
      { info: { id: "x" } },
      {
        get info() {
          throw new Error("getter");
        },
      },
    ]) {
      target.dispatchEvent(
        new CustomEvent(ANNOUNCE_PROVIDER_EVENT, { detail }),
      );
    }
    const a = provider("a");
    const b = provider("b");
    const cleanups = [a, provider("a"), b].map((wallet) =>
      registerWalletProvider(wallet, target),
    );
    expect(listener.mock.calls).toEqual([[a], [b]]);
    stop();
    cleanups.forEach((cleanup) => cleanup());
  });

  it("bounds retained IDs and removes both kinds of event listeners", () => {
    const target = new EventTarget();
    const listener = vi.fn();
    const stop = discoverWalletProviders(listener, target);
    for (let i = 0; i < 40; i++) {
      target.dispatchEvent(
        new CustomEvent(ANNOUNCE_PROVIDER_EVENT, {
          detail: provider(String(i)),
        }),
      );
    }
    expect(listener).toHaveBeenCalledTimes(32);
    stop();
    const announce = vi.fn();
    target.addEventListener(ANNOUNCE_PROVIDER_EVENT, announce);
    const unregister = registerWalletProvider(provider("new"), target);
    unregister();
    unregister();
    target.dispatchEvent(new CustomEvent(REQUEST_PROVIDER_EVENT));
    expect(announce).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(32);
  });

  it("uses window by default without overwriting a global wallet", () => {
    const target = Object.assign(new EventTarget(), { groundhog: "untouched" });
    vi.stubGlobal("window", target);
    const listener = vi.fn();
    const stop = discoverWalletProviders(listener);
    const unregister = registerWalletProvider(provider("default"));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(target.groundhog).toBe("untouched");
    stop();
    unregister();
  });

  it("requires an explicit target outside a browser and rejects bad registrations", () => {
    vi.stubGlobal("window", undefined);
    expect(() => discoverWalletProviders(() => {})).toThrow(
      expect.objectContaining({ code: 4900 }),
    );
    expect(() =>
      registerWalletProvider(
        { ...provider("a"), info: { id: "", name: "x", version: "1.0.0" } },
        new EventTarget(),
      ),
    ).toThrow();
  });
});
