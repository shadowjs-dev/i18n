import { describe, expect, it, vi } from "vitest";
import type { I18nError } from "../src/errors";
import { drain, gatedLoader } from "./support/deferred";
import { createI18n } from "./support/full-instance";

const EN = { hello: "Hello {name}" };
const FR = { hello: "Bonjour {name}" };
const DE = { hello: "Hallo {name}" };

/** English is static; French and German are lazy and gated by the test. */
function harness(options: { transition?: "keep" | "suspend" } = {}) {
  const errors: I18nError[] = [];
  const fr = gatedLoader();
  const de = gatedLoader();
  const i18n = createI18n({
    defaultLocale: "en",
    locales: ["en", "fr", "de"],
    messages: { en: EN },
    loaders: { fr: fr.load, de: de.load },
    syncDocument: false,
    onError: (error) => errors.push(error),
    ...options,
  });
  return { i18n, fr, de, errors };
}

describe("lazy catalog races", () => {
  it("[I18N-450] fr, de, fr with the loaders resolving in reverse order: the last call wins and the stale de result never applies", async () => {
    const { i18n, fr, de } = harness();
    const first = i18n.setLocale("fr");
    const second = i18n.setLocale("de");
    const third = i18n.setLocale("fr");
    // The third call shares the load of the first.
    expect(fr.calls).toHaveLength(1);
    expect(de.calls).toHaveLength(1);
    expect(i18n.pending()).toBe("fr");

    // The newest-but-one load answers first: it is stale and must not apply, to state or to text.
    de.calls[0]?.resolve(DE);
    await drain();
    expect(i18n.locale()).toBe("en");
    expect(i18n.pending()).toBe("fr");
    expect(i18n.translate("hello", { name: "x" })).toBe("Hello x");

    fr.calls[0]?.resolve(FR);
    await expect(Promise.all([first, second, third])).resolves.toEqual(["fr", "fr", "fr"]);
    expect(i18n.locale()).toBe("fr");
    expect(i18n.pending()).toBeUndefined();
    expect(i18n.translate("hello", { name: "x" })).toBe("Bonjour x");
  });

  it("[I18N-450] the same race in the other resolution order lands on the same locale", async () => {
    const { i18n, fr, de } = harness();
    const calls = [i18n.setLocale("fr"), i18n.setLocale("de"), i18n.setLocale("fr")];
    fr.calls[0]?.resolve(FR);
    await drain();
    // fr finished first, but the de call is older than the last fr call: fr is the answer already.
    expect(i18n.locale()).toBe("fr");
    de.calls[0]?.resolve(DE);
    await expect(Promise.all(calls)).resolves.toEqual(["fr", "fr", "fr"]);
    expect(i18n.locale()).toBe("fr");
    expect(i18n.isLoaded("de")).toBe(true);
    expect(i18n.translate("hello", { name: "x" })).toBe("Bonjour x");
  });

  it("[I18N-451] a stale response never changes t output in suspend mode, where the locale switches at once", async () => {
    const { i18n, fr, de } = harness({ transition: "suspend" });
    void i18n.setLocale("fr");
    void i18n.setLocale("de");
    expect(i18n.locale()).toBe("de");
    fr.calls[0]?.resolve(FR);
    await drain();
    expect(i18n.locale()).toBe("de");
    // fr is loaded now, but the active locale is de: its chain (de, en) answers.
    expect(i18n.translate("hello", { name: "x" })).toBe("Hello x");
    de.calls[0]?.resolve(DE);
    await drain();
    expect(i18n.translate("hello", { name: "x" })).toBe("Hallo x");
    expect(i18n.pending()).toBeUndefined();
  });

  it("[I18N-452] a loader that rejects keeps the old locale, reports once, and a second setLocale for that locale succeeds", async () => {
    const { i18n, fr, errors } = harness();
    const failing = i18n.setLocale("fr");
    fr.calls[0]?.reject(new Error("network down"));
    await expect(failing).resolves.toBe("en");
    expect(i18n.locale()).toBe("en");
    expect(i18n.pending()).toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("LOAD_FAILED");
    expect(errors[0]?.message).toContain("network down");

    const retry = i18n.setLocale("fr");
    expect(fr.calls).toHaveLength(2);
    fr.calls[1]?.resolve(FR);
    await expect(retry).resolves.toBe("fr");
    expect(i18n.locale()).toBe("fr");
    expect(i18n.translate("hello", { name: "x" })).toBe("Bonjour x");
    expect(errors).toHaveLength(1);
  });

  it("[I18N-452] a loader that rejects with a non-Error value is reported as LOAD_FAILED and does not throw", async () => {
    const { i18n, fr, errors } = harness();
    const failing = i18n.setLocale("fr");
    fr.calls[0]?.reject("boom");
    await expect(failing).resolves.toBe("en");
    expect(errors.map((error) => error.code)).toEqual(["LOAD_FAILED"]);
    expect(errors[0]?.message).toContain("boom");
  });

  it("[I18N-452] a malformed catalog from a loader is an INVALID_CATALOG report, the old locale stays, a fixed retry works", async () => {
    const { i18n, fr, errors } = harness();
    const failing = i18n.setLocale("fr");
    fr.calls[0]?.resolve({ hello: 3 } as never);
    await expect(failing).resolves.toBe("en");
    expect(errors.map((error) => error.code)).toEqual(["INVALID_CATALOG"]);
    const retry = i18n.setLocale("fr");
    fr.calls[1]?.resolve(FR);
    await expect(retry).resolves.toBe("fr");
  });

  it("[I18N-453] a load that fails while a newer call supersedes it is still reported (load errors are never swallowed)", async () => {
    const { i18n, fr, de, errors } = harness();
    const first = i18n.setLocale("fr");
    const second = i18n.setLocale("de");
    fr.calls[0]?.reject(new Error("fr is down"));
    await drain();
    de.calls[0]?.resolve(DE);
    await expect(Promise.all([first, second])).resolves.toEqual(["de", "de"]);
    expect(i18n.locale()).toBe("de");
    expect(errors.map((error) => error.code)).toEqual(["LOAD_FAILED"]);
    expect(errors[0]?.message).toContain("fr is down");
  });

  it("[I18N-454] loads of one locale are shared while in flight: the loader runs once for setLocale, load and every fork", async () => {
    const { i18n, fr } = harness();
    const calls = [
      i18n.setLocale("fr"),
      i18n.setLocale("fr"),
      i18n.load("fr"),
      i18n.fork("fr").setLocale("fr"),
      i18n.fork("fr").load("fr"),
    ];
    await drain();
    expect(fr.calls).toHaveLength(1);
    fr.calls[0]?.resolve(FR);
    await Promise.all(calls);
    expect(fr.calls).toHaveLength(1);
    // Loaded: no further loader call, whatever asks.
    await i18n.setLocale("en");
    await i18n.setLocale("fr");
    await i18n.load("fr");
    expect(fr.calls).toHaveLength(1);
  });

  it("[I18N-454] a failed shared load rejects every waiter of load() and the next load() calls the loader again", async () => {
    const { i18n, fr } = harness();
    const waiters = [i18n.load("fr"), i18n.load("fr")];
    const settled = Promise.allSettled(waiters);
    expect(fr.calls).toHaveLength(1);
    fr.calls[0]?.reject(new Error("offline"));
    const results = await settled;
    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    const again = i18n.load("fr");
    expect(fr.calls).toHaveLength(2);
    fr.calls[1]?.resolve(FR);
    await again;
    expect(i18n.isLoaded("fr")).toBe(true);
  });

  it("[I18N-455] dispose during a pending load releases every waiter and nothing applies", async () => {
    const { i18n, fr, errors } = harness();
    const pendingSet = i18n.setLocale("fr");
    const pendingLoad = i18n.load("fr");
    const pendingFork = i18n.fork("fr").setLocale("fr");
    i18n.dispose();
    fr.calls[0]?.resolve(FR);
    await expect(pendingSet).resolves.toBe("en");
    await expect(pendingLoad).resolves.toBeUndefined();
    await expect(pendingFork).resolves.toBe("fr");
    expect(i18n.locale()).toBe("en");
    expect(i18n.isLoaded("fr")).toBe(false);
    expect(errors).toEqual([]);
  });

  it("[I18N-455] a loader that rejects after dispose settles the waiters and reports nothing", async () => {
    const { i18n, fr, errors } = harness();
    const pendingSet = i18n.setLocale("fr");
    i18n.dispose();
    fr.calls[0]?.reject(new Error("late failure"));
    await expect(pendingSet).resolves.toBe("en");
    expect(errors).toEqual([]);
    expect(i18n.locale()).toBe("en");
  });

  it("[I18N-455] dispose before the initial load settles lets ready resolve and applies nothing", async () => {
    const en = gatedLoader();
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en"],
      loaders: { en: en.load },
      syncDocument: false,
    });
    expect(i18n.isLoaded("en")).toBe(false);
    i18n.dispose();
    en.calls[0]?.resolve(EN);
    await expect(i18n.ready).resolves.toBeUndefined();
    expect(i18n.isLoaded("en")).toBe(false);
  });

  it("[I18N-456] setLocale concurrent with dispose settles, does not apply, and leaves no stuck pending() indicator", async () => {
    const { i18n, fr } = harness();
    const settled = vi.fn();
    const call = i18n.setLocale("fr").then(settled);
    expect(i18n.pending()).toBe("fr");
    i18n.dispose();
    expect(i18n.pending()).toBeUndefined();
    fr.calls[0]?.resolve(FR);
    await call;
    expect(settled).toHaveBeenCalledWith("en");
    expect(i18n.locale()).toBe("en");
    expect(i18n.pending()).toBeUndefined();
  });

  it("[I18N-456] a setLocale made after dispose is a no-op for loaded and lazy locales and never calls a loader", async () => {
    const { i18n, fr } = harness();
    await i18n.setLocale("en");
    i18n.dispose();
    await expect(i18n.setLocale("fr")).resolves.toBe("en");
    await expect(i18n.setLocale("en")).resolves.toBe("en");
    expect(fr.calls).toHaveLength(0);
    expect(i18n.locale()).toBe("en");
    expect(i18n.pending()).toBeUndefined();
    // dispose twice is fine
    i18n.dispose();
  });

  it("[I18N-457] a fork finishing a load after the primary switched keeps its own locale and the primary is untouched", async () => {
    const { i18n, fr, de } = harness();
    const forked = i18n.fork("en");
    const forkCall = forked.setLocale("fr");
    const primaryCall = i18n.setLocale("de");
    de.calls[0]?.resolve(DE);
    await primaryCall;
    fr.calls[0]?.resolve(FR);
    await forkCall;
    expect(i18n.locale()).toBe("de");
    expect(forked.locale()).toBe("fr");
    expect(forked.translate("hello", { name: "x" })).toBe("Bonjour x");
    expect(i18n.translate("hello", { name: "x" })).toBe("Hallo x");
  });
});
