import { afterEach, describe, expect, it, vi } from "vitest";
import type { I18nError } from "../src/errors";
import { drain, gatedLoader } from "./support/deferred";
import { createI18n } from "./support/full-instance";

const EN = { hello: "Hello {name}" };
const FR = { hello: "Bonjour {name}" };

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.removeAttribute("lang");
  document.documentElement.removeAttribute("dir");
  Reflect.set(document, "cookie", "locale=; Path=/; Max-Age=0");
  window.localStorage.clear();
});

function lazy(extra: object = {}) {
  const fr = gatedLoader();
  const errors: I18nError[] = [];
  const i18n = createI18n({
    defaultLocale: "en",
    locales: ["en", "fr"],
    messages: { en: EN },
    loaders: { fr: fr.load },
    onError: (error) => errors.push(error),
    ...extra,
  });
  return { i18n, fr, errors };
}

describe("dispose", () => {
  it("[I18N-458] setLocale, hydrate and replaceCatalog after dispose change nothing and call no loader", async () => {
    const { i18n, fr, errors } = lazy({ syncDocument: false });
    i18n.dispose();
    await expect(i18n.setLocale("fr")).resolves.toBe("en");
    i18n.hydrate({ v: 1, locale: "fr", messages: { fr: FR } });
    i18n.replaceCatalog("en", { hello: "Changed {name}" });
    expect(fr.calls).toHaveLength(0);
    expect(i18n.locale()).toBe("en");
    expect(i18n.pending()).toBeUndefined();
    expect(i18n.isLoaded("fr")).toBe(false);
    expect(i18n.translate("hello", { name: "x" })).toBe("Hello x");
    expect(errors).toEqual([]);
  });

  it("[I18N-458] load() after dispose does not call the loader and resolves at once", async () => {
    const { i18n, fr } = lazy({ syncDocument: false });
    i18n.dispose();
    const loading = i18n.load("fr");
    await drain();
    // Settle whatever a misbehaving instance started, so a failure is an assertion and not a hang.
    const started = fr.calls.length;
    for (const call of fr.calls) call.resolve(FR);
    await expect(loading).resolves.toBeUndefined();
    expect(started).toBe(0);
    expect(i18n.isLoaded("fr")).toBe(false);
  });

  it("[I18N-458] dispose is idempotent, works on an instance that never loaded anything, and reading still answers", async () => {
    const { i18n } = lazy({ syncDocument: false });
    i18n.dispose();
    i18n.dispose();
    expect(i18n.t("hello", { name: "x" })).toBe("Hello x");
    expect(i18n.locale()).toBe("en");
    expect(i18n.dir()).toBe("ltr");
    await expect(i18n.ready).resolves.toBeUndefined();
  });

  it("[I18N-458] a fork made after the instance was disposed cannot switch either", async () => {
    const { i18n, fr } = lazy({ syncDocument: false });
    i18n.dispose();
    const fork = i18n.fork("en");
    await expect(fork.setLocale("fr")).resolves.toBe("en");
    expect(fr.calls).toHaveLength(0);
  });

  it("[I18N-458] a dispose does not write the document or persistence again, and a disposed instance never persists", async () => {
    const { i18n, fr } = lazy({ persist: ["cookie", "localStorage"] });
    const call = i18n.setLocale("fr");
    i18n.dispose();
    fr.calls[0]?.resolve(FR);
    await call;
    await i18n.setLocale("fr");
    expect(window.localStorage.getItem("locale")).toBeNull();
    expect(document.cookie).not.toContain("locale=fr");
    expect(document.documentElement.getAttribute("lang")).toBe("en");
  });
});

describe("timers and listeners", () => {
  it("[I18N-459] creating, switching (sync and lazy), translating, formatting, forking, serializing and disposing create no timer and no listener", async () => {
    const timers = [
      vi.spyOn(globalThis, "setTimeout"),
      vi.spyOn(globalThis, "setInterval"),
      vi.spyOn(globalThis, "requestAnimationFrame"),
      vi.spyOn(globalThis, "setImmediate"),
    ];
    const listeners = [
      vi.spyOn(EventTarget.prototype, "addEventListener"),
      vi.spyOn(window, "addEventListener"),
      vi.spyOn(document, "addEventListener"),
      vi.spyOn(document.documentElement, "addEventListener"),
    ];
    const observers = vi.fn();
    vi.stubGlobal("MutationObserver", observers);
    vi.useFakeTimers();

    const { i18n, fr } = lazy({
      persist: ["cookie", "localStorage"],
      detect: { order: ["storage", "navigator"] },
      syncDocument: true,
    });
    i18n.translate("hello", { name: "x" });
    i18n.t.has("hello");
    i18n.formatNumber(1234.5);
    i18n.formatDate(new Date(0), { dateStyle: "short", timeZone: "UTC" });
    i18n.formatRelative(Date.now() - 86_400_000, { unit: "day" });
    i18n.formatList(["a", "b"]);
    i18n.formatDisplayName("fr", { type: "language" });
    const switching = i18n.setLocale("fr");
    fr.calls[0]?.resolve(FR);
    await switching;
    await i18n.setLocale("en");
    i18n.state();
    const fork = i18n.fork("fr");
    await fork.setLocale("en");
    fork.dispose();
    i18n.addMessages("fr", { extra: "x" });
    i18n.dispose();
    await drain();

    expect(vi.getTimerCount()).toBe(0);
    for (const spy of [...timers, ...listeners]) expect(spy).not.toHaveBeenCalled();
    expect(observers).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("[I18N-459] a failed load and a retry create no timer either: there is no backoff, the caller decides when to retry", async () => {
    vi.useFakeTimers();
    const timers = vi.spyOn(globalThis, "setTimeout");
    const { i18n, fr, errors } = lazy({ syncDocument: false });
    const failing = i18n.setLocale("fr");
    fr.calls[0]?.reject(new Error("offline"));
    await failing;
    expect(errors).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    // Time passing retries nothing.
    vi.advanceTimersByTime(60_000);
    await drain();
    expect(fr.calls).toHaveLength(1);
    expect(timers).not.toHaveBeenCalled();
  });
});
