import { flushSync, useEffect, useSignal } from "@shadow-js/core";
import { createTestRoot } from "@shadow-js/testing";
import { describe, expect, it, vi } from "vitest";
import type { I18nError } from "../src/errors";
import { formatting } from "../src/format";
import { localeRouting } from "../src/routing";
import type { Messages } from "../src/types";
import { createI18nWithIcu as createI18n } from "../src/with-icu";
import { en, fr, lazyI18n } from "./support/catalogs";

function track<T>(read: () => T): { log: T[]; dispose: () => void } {
  const log: T[] = [];
  const root = createTestRoot(() => {
    useEffect(() => {
      log.push(read());
    });
  });
  return { log, dispose: root.dispose };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  flushSync();
};

describe("createI18n: translating", () => {
  it("[I18N-50] translates nested keys with arguments, plurals and formats", () => {
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en"],
      messages: { en },
      timeZone: "UTC",
    });
    expect(i18n.t("hello", { name: "Ada" })).toBe("Hello Ada");
    expect(i18n.t("cart.items", { count: 0 })).toBe("Your cart is empty");
    expect(i18n.t("cart.items", { count: 1 })).toBe("1 item");
    expect(i18n.t("cart.items", { count: 1234 })).toBe("1,234 items");
    expect(i18n.t("cart.total", { amount: 5 })).toBe("Total: $5.00");
    expect(i18n.t("terms")).toBe("Read the terms and privacy.");
    expect(i18n.scoped("cart")("items", { count: 2 })).toBe("2 items");
    expect(i18n.t.has("hello")).toBe(true);
    expect(i18n.t.has("nope")).toBe(false);
  });

  it("[I18N-51] partial catalogs fall back along the chain: region, configured, then default", () => {
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en", "fr", "fr-CA", "de"],
      messages: { en, fr, "fr-CA": { hello: "Allo {name}" }, de: { hello: "Hallo {name}" } },
      fallbackLocale: { de: "fr", default: "en" },
    });
    expect(i18n.chain("fr-CA")).toEqual(["fr-CA", "fr", "en"]);
    expect(i18n.chain("de")).toEqual(["de", "fr", "en"]);
    return i18n.setLocale("fr-CA").then(() => {
      expect(i18n.t("hello", { name: "A" })).toBe("Allo A");
      expect(i18n.t("terms", {})).toBe("Lisez les conditions et la confidentialite.");
      expect(i18n.t("only.en")).toBe("English only");
      return i18n.setLocale("de").then(() => {
        expect(i18n.t("cart.items", { count: 2 })).toBe("2 articles");
        expect(i18n.t("hello", { name: "B" })).toBe("Hallo B");
      });
    });
  });

  it("[I18N-52] a missing key reports MISSING_KEY and shows onMissing or the key", () => {
    const errors: I18nError[] = [];
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en"],
      messages: { en },
      onError: (error) => errors.push(error),
    });
    // The key type forbids this; dynamic keys are what hits the runtime path.
    expect(i18n.translate("cart.nope")).toBe("cart.nope");
    expect(errors.map((e) => e.code)).toEqual(["MISSING_KEY"]);
    const custom = createI18n({
      defaultLocale: "en",
      locales: ["en"],
      messages: { en },
      onMissing: ({ key, locale }) => `⟦${locale}:${key}⟧`,
      onError: () => undefined,
    });
    expect(custom.translate("zzz")).toBe("⟦en:zzz⟧");
    expect(custom.translateRich("zzz")).toEqual(["⟦en:zzz⟧"]);
  });

  it("[I18N-53] without onError, development warns once per problem", () => {
    const i18n = createI18n({ defaultLocale: "en", locales: ["en"], messages: { en } });
    i18n.translate("x.y");
    i18n.translate("x.y");
    expect(vi.mocked(console.warn).mock.calls).toHaveLength(1);
    expect(String(vi.mocked(console.warn).mock.calls[0]?.[0])).toContain("MISSING_KEY");
    vi.mocked(console.warn).mockClear();
  });

  it("[I18N-54] a malformed message is reported and the next locale in the chain answers", () => {
    const errors: I18nError[] = [];
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en", "fr"],
      messages: { en: { a: "ok {n}" }, fr: { a: "bad {n, plural, one {x}}" } },
      locale: "fr",
      onError: (e) => errors.push(e),
    });
    expect(i18n.translate("a", { n: 1 })).toBe("ok 1");
    expect(errors.map((e) => e.code)).toEqual(["SYNTAX"]);
    expect(errors[0]?.message).toContain("MISSING_OTHER_CLAUSE");
  });

  it("[I18N-55] a catalog with prototype-pollution keys is plain data", () => {
    const evil = JSON.parse(
      '{"__proto__": {"polluted": "yes"}, "constructor": {"prototype": "x"}, "a": "{__proto__}"}',
    ) as never;
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: evil },
      onError: () => undefined,
    });
    expect(i18n.translate("__proto__.polluted")).toBe("yes");
    expect(i18n.translate("constructor.prototype")).toBe("x");
    expect(i18n.translate("a", JSON.parse('{"__proto__": "own"}') as object)).toBe("own");
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
  });

  it("[I18N-56] the compiled-message cache is bounded and keeps working past its bound", () => {
    const messages = Object.fromEntries(
      Array.from({ length: 50 }, (_, i) => [`k${i}`, `value ${i} {n}`]),
    );
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: messages },
      cacheSize: 8,
    });
    for (let round = 0; round < 3; round += 1) {
      for (let i = 0; i < 50; i += 1)
        expect(i18n.translate(`k${i}`, { n: i })).toBe(`value ${i} ${i}`);
    }
  });

  it("[I18N-57] malformed static catalogs fail at creation with INVALID_CATALOG", () => {
    expect(() =>
      createI18n({ defaultLocale: "en", locales: ["en"], messages: { en: { a: 5 } as never } }),
    ).toThrow(/INVALID_CATALOG/);
    expect(() => createI18n({ defaultLocale: "xx" as "en", locales: ["en"] })).toThrow(
      /UNKNOWN_LOCALE/,
    );
    const deep = (n: number): object => (n === 0 ? { leaf: "x" } : { a: deep(n - 1) });
    expect(() =>
      createI18n({ defaultLocale: "en", locales: ["en"], messages: { en: deep(40) as never } }),
    ).toThrow(/deeper than 32/);
  });
});

describe("createI18n: reactive locale switching", () => {
  it("[I18N-60] t reads the locale and the arguments, so an effect reruns only for what changed", async () => {
    const { i18n, resolvers } = lazyI18n();
    const [name, setName] = useSignal("Ada");
    const watcher = track(() => i18n.t("hello", { name }));
    expect(watcher.log).toEqual(["Hello Ada"]);
    setName("Grace");
    flushSync();
    expect(watcher.log).toEqual(["Hello Ada", "Hello Grace"]);
    const switched = i18n.setLocale("fr");
    flushSync();
    expect(watcher.log).toEqual(["Hello Ada", "Hello Grace"]);
    resolvers["fr"]?.();
    await switched;
    flushSync();
    expect(watcher.log).toEqual(["Hello Ada", "Hello Grace", "Bonjour Grace"]);
    watcher.dispose();
  });

  it("[I18N-61] keep mode: the old locale stays until the new catalog is loaded; pending() shows the target", async () => {
    const { i18n, resolvers } = lazyI18n();
    expect(i18n.pending()).toBeUndefined();
    const switched = i18n.setLocale("fr");
    expect(i18n.pending()).toBe("fr");
    expect(i18n.locale()).toBe("en");
    expect(i18n.t("hello", { name: "A" })).toBe("Hello A");
    resolvers["fr"]?.();
    await expect(switched).resolves.toBe("fr");
    expect(i18n.pending()).toBeUndefined();
    expect(i18n.locale()).toBe("fr");
    expect(i18n.isLoaded("fr")).toBe(true);
  });

  it("[I18N-62] suspend mode: the locale switches at once and text waits for the catalog", async () => {
    const { i18n, resolvers } = lazyI18n({ transition: "suspend" });
    const switched = i18n.setLocale("ar");
    expect(i18n.locale()).toBe("ar");
    expect(i18n.pending()).toBe("ar");
    expect(i18n.dir()).toBe("rtl");
    // The Arabic catalog is pending; its fallback (en) is loaded, so keys that exist there show.
    expect(i18n.t("hello", { name: "x" })).toBe("Hello x");
    resolvers["ar"]?.();
    await switched;
    // Arabic is right to left: the interpolated value is isolated (U+2068 ... U+2069).
    expect(i18n.t("hello", { name: "x" })).toBe("مرحبا ⁨x⁩");
    expect(i18n.pending()).toBeUndefined();
  });

  it("[I18N-63] race: when setLocale is called again during a pending load, the last call wins", async () => {
    const { i18n, resolvers } = lazyI18n();
    const first = i18n.setLocale("fr");
    const second = i18n.setLocale("de");
    // The first finishes after the second was requested: it must not apply.
    resolvers["fr"]?.();
    await flush();
    expect(i18n.locale()).toBe("en");
    expect(i18n.pending()).toBe("de");
    resolvers["de"]?.();
    await expect(second).resolves.toBe("de");
    await expect(first).resolves.toBe("de");
    expect(i18n.locale()).toBe("de");
    expect(i18n.t("hello", { name: "x" })).toBe("Hallo x");
  });

  it("[I18N-64] race in the other order: an older load finishing last cannot override the newer locale", async () => {
    const { i18n, resolvers } = lazyI18n();
    const first = i18n.setLocale("fr");
    const second = i18n.setLocale("de");
    resolvers["de"]?.();
    await expect(second).resolves.toBe("de");
    resolvers["fr"]?.();
    await expect(first).resolves.toBe("de");
    expect(i18n.locale()).toBe("de");
    expect(i18n.isLoaded("fr")).toBe(true);
  });

  it("[I18N-65] concurrent setLocale calls for one locale load it once", async () => {
    const { i18n, resolvers, calls } = lazyI18n();
    const all = [i18n.setLocale("fr"), i18n.setLocale("fr"), i18n.load("fr")];
    expect(calls["fr"]).toBe(1);
    resolvers["fr"]?.();
    await Promise.all(all);
    expect(i18n.locale()).toBe("fr");
    await i18n.setLocale("en");
    await i18n.setLocale("fr");
    expect(calls["fr"]).toBe(1);
  });

  it("[I18N-66] switching to an already loaded locale is synchronous", async () => {
    const { i18n, resolvers } = lazyI18n();
    const first = i18n.setLocale("fr");
    resolvers["fr"]?.();
    await first;
    void i18n.setLocale("en");
    expect(i18n.locale()).toBe("en");
  });

  it("[I18N-67] a failed load is reported, keeps the old locale, and can be retried", async () => {
    const errors: unknown[] = [];
    const { i18n, rejecters, resolvers } = lazyI18n({ onError: (e) => errors.push(e) });
    const failing = i18n.setLocale("fr");
    rejecters["fr"]?.(new Error("network down"));
    await expect(failing).resolves.toBe("en");
    expect(i18n.locale()).toBe("en");
    expect(i18n.pending()).toBeUndefined();
    expect((errors[0] as I18nError).code).toBe("LOAD_FAILED");
    expect((errors[0] as I18nError).message).toContain("network down");
    const retry = i18n.setLocale("fr");
    resolvers["fr"]?.();
    await expect(retry).resolves.toBe("fr");
  });

  it("[I18N-68] unknown locales throw, regional tags resolve to a supported locale", async () => {
    const { i18n, resolvers } = lazyI18n();
    expect(() => i18n.setLocale("xx" as "en")).toThrow(/UNKNOWN_LOCALE/);
    const pending = i18n.setLocale("fr-CA" as "fr");
    resolvers["fr"]?.();
    await expect(pending).resolves.toBe("fr");
  });

  it("[I18N-69] a loader that returns a module with a default export, or a plain catalog, both work", async () => {
    const moduleLike = Object.defineProperty(
      { default: { hello: "Hallo {name}" } },
      Symbol.toStringTag,
      { value: "Module" },
    );
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en", "de", "es"],
      messages: { en },
      loaders: {
        de: () => Promise.resolve(moduleLike as never),
        es: () => ({ hello: "Hola {name}" }),
      },
      syncDocument: false,
    });
    await i18n.setLocale("de");
    expect(i18n.t("hello", { name: "A" })).toBe("Hallo A");
    await i18n.setLocale("es");
    expect(i18n.t("hello", { name: "A" })).toBe("Hola A");
  });

  it("[I18N-70] the first load: ready resolves after the initial locale and its fallbacks load", async () => {
    let release: () => void = () => undefined;
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en", "fr"],
      loaders: {
        en: () =>
          new Promise<Messages>((resolve) => {
            release = () => resolve(en);
          }),
        fr: () => fr as never,
      },
      locale: "fr",
      syncDocument: false,
      onError: () => undefined,
    });
    expect(i18n.isLoaded("en")).toBe(false);
    release();
    await i18n.ready;
    expect(i18n.isLoaded("en")).toBe(true);
    expect(i18n.translate("hello", { name: "x" })).toBe("Bonjour x");
  });

  it("[I18N-71] dispose stops pending loads from applying; nothing creates timers or listeners", async () => {
    const timers = vi.spyOn(globalThis, "setTimeout");
    const intervals = vi.spyOn(globalThis, "setInterval");
    const { i18n, resolvers } = lazyI18n();
    const pending = i18n.setLocale("fr");
    i18n.dispose();
    i18n.dispose();
    resolvers["fr"]?.();
    await pending;
    expect(i18n.locale()).toBe("en");
    await expect(i18n.setLocale("de")).resolves.toBe("en");
    expect(timers).not.toHaveBeenCalled();
    expect(intervals).not.toHaveBeenCalled();
  });
});

describe("createI18n: formatting helpers", () => {
  const make = (locale: "en" | "de" | "ar" | "ja" = "en") =>
    createI18n({
      defaultLocale: "en",
      locales: ["en", "de", "ar", "ja"],
      messages: { en, de: {}, ar: {}, ja: {} },
      locale,
      timeZone: "UTC",
      now: () => Date.UTC(2024, 5, 15, 12, 0, 0),
      formats: {
        number: { price: { style: "currency", currency: "EUR" } },
        date: { stamp: { dateStyle: "short", timeStyle: "short" } },
        list: { or: { type: "disjunction" } },
      },
      onError: () => undefined,
      features: [formatting],
    });

  it("[I18N-80] numbers: plain, named, currency, percent, unit, in several locales", () => {
    expect(make().formatNumber(1234567.5)).toBe("1,234,567.5");
    expect(make("de").formatNumber(1234567.5)).toBe("1.234.567,5");
    expect(make("de").formatNumber(5, "price")).toBe("5,00 €");
    expect(make().formatNumber(0.5, "percent")).toBe("50%");
    expect(make().formatNumber(12, { style: "unit", unit: "kilometer" })).toBe("12 km");
    expect(make().formatNumber(BigInt(1_000_000_000))).toBe("1,000,000,000");
  });

  it("[I18N-81] dates use the injected time zone and named formats", () => {
    const d = new Date(Date.UTC(2024, 0, 1, 23, 30));
    expect(make().formatDate(d)).toBe("Jan 1, 2024");
    expect(make().formatDate(d, "long")).toBe("January 1, 2024");
    expect(make().formatDate(d, { timeZone: "Asia/Tokyo", dateStyle: "short" })).toBe("1/2/24");
    expect(make().formatDate(d, "stamp").replace(/\s/g, " ")).toBe("1/1/24, 11:30 PM");
    expect(make("ja").formatDate(d, "long")).toBe("2024年1月1日");
    expect(make().formatDate(d.toISOString(), "short")).toBe("1/1/24");
  });

  it("[I18N-82] relative time uses the injected clock, picks the unit, and honors numeric/style", () => {
    const i18n = make();
    const now = Date.UTC(2024, 5, 15, 12, 0, 0);
    expect(i18n.formatRelative(now - 30_000)).toBe("30 seconds ago");
    expect(i18n.formatRelative(now + 3 * 3600_000)).toBe("in 3 hours");
    expect(i18n.formatRelative(now - 86_400_000)).toBe("yesterday");
    expect(i18n.formatRelative(now - 86_400_000, { numeric: "always" })).toBe("1 day ago");
    expect(i18n.formatRelative(new Date(now - 14 * 86_400_000))).toBe("2 weeks ago");
    expect(i18n.formatRelative(now - 400 * 86_400_000)).toBe("last year");
    expect(i18n.formatRelative(now - 5 * 60_000, { style: "short" })).toBe("5 min. ago");
    expect(i18n.formatRelative(now - 5 * 3600_000, { unit: "minute" })).toBe("300 minutes ago");
    expect(i18n.formatRelative(now)).toBe("now");
    expect(make("de").formatRelative(now - 3 * 86_400_000)).toBe("vor 3 Tagen");
  });

  it("[I18N-83] lists and display names", () => {
    expect(make().formatList(["a", "b", "c"])).toBe("a, b, and c");
    expect(make().formatList(["a", "b"], "or")).toBe("a or b");
    expect(make("de").formatList(["a", "b", "c"])).toBe("a, b und c");
    expect(make().formatDisplayName("fr", { type: "language" })).toBe("French");
    expect(make("de").formatDisplayName("JP", { type: "region" })).toBe("Japan");
    expect(make().formatDisplayName("EUR", { type: "currency" })).toBe("Euro");
  });

  it("[I18N-84] bad input is reported and shown as text instead of throwing", () => {
    const errors: I18nError[] = [];
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en"],
      messages: { en },
      onError: (e) => errors.push(e),
      features: [formatting],
    });
    expect(i18n.formatDate("not a date")).toBe("not a date");
    expect(i18n.formatNumber(Number.NaN)).toBe("NaN");
    expect(i18n.formatNumber(1, "bogus")).toBe("1");
    expect(i18n.formatDisplayName("zz-invalid-code!", { type: "region" })).toBe("zz-invalid-code!");
    expect(errors.map((e) => e.code)).toEqual([
      "INVALID_VALUE",
      "INVALID_VALUE",
      "FORMAT_FAILED",
      "FORMAT_FAILED",
    ]);
  });

  it("[I18N-85] direction: rtl for Arabic, ltr for Japanese, per locale argument too", () => {
    const i18n = make();
    expect(i18n.dir()).toBe("ltr");
    expect(i18n.dir("ar")).toBe("rtl");
    expect(i18n.dir("ja")).toBe("ltr");
  });

  it("[I18N-86] formatters track the locale signal", async () => {
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en", "de"],
      messages: { en: {}, de: {} },
      syncDocument: false,
      features: [formatting],
    });
    const watcher = track(() => i18n.formatNumber(1234.5));
    expect(watcher.log).toEqual(["1,234.5"]);
    await i18n.setLocale("de");
    flushSync();
    expect(watcher.log).toEqual(["1,234.5", "1.234,5"]);
    watcher.dispose();
  });
});

describe("createI18n: instances", () => {
  it("[I18N-90] fork gives an independent locale over shared catalogs", async () => {
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en", "fr"],
      messages: { en, fr },
    });
    const a = i18n.fork("fr");
    const b = i18n.fork();
    await a.ready;
    expect(a.t("hello", { name: "x" })).toBe("Bonjour x");
    expect(b.t("hello", { name: "x" })).toBe("Hello x");
    await b.setLocale("fr");
    expect(i18n.locale()).toBe("en");
    expect(a.locale()).toBe("fr");
    i18n.addMessages("fr", { extra: "Plus" });
    expect(a.translate("extra")).toBe("Plus");
  });

  it("[I18N-91] state() and hydrate() round trip the locale and loaded catalogs", async () => {
    const source = createI18n({
      defaultLocale: "en",
      locales: ["en", "fr"],
      messages: { en, fr },
      locale: "fr",
    });
    const state = JSON.parse(JSON.stringify(source.state())) as ReturnType<typeof source.state>;
    expect(state.locale).toBe("fr");
    expect(Object.keys(state.messages).sort()).toEqual(["en", "fr"]);
    const target = createI18n({
      defaultLocale: "en",
      locales: ["en", "fr"],
      loaders: {
        en: () => Promise.reject(new Error("must not load")),
        fr: () => Promise.reject(new Error("must not load")),
      },
      state,
      syncDocument: false,
    });
    expect(target.locale()).toBe("fr");
    expect(target.translate("cart.items", { count: 3 })).toBe("3 articles");
    await target.ready;
    expect(() => target.hydrate({ v: 2 } as never)).toThrow(/INVALID_STATE/);
  });

  it("[I18N-92] addMessages merges and notifies readers", () => {
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en"],
      messages: { en },
      onError: () => undefined,
    });
    const watcher = track(() => i18n.translate("late"));
    expect(watcher.log).toEqual(["late"]);
    i18n.addMessages("en", { late: "arrived" });
    flushSync();
    expect(watcher.log).toEqual(["late", "arrived"]);
    watcher.dispose();
  });

  it("[I18N-93] localePath prefixes with the locale according to the strategy", () => {
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en", "fr"],
      messages: { en },
      prefix: "as-needed",
      features: [localeRouting],
    });
    expect(i18n.localePath("/about", "fr")).toBe("/fr/about");
    expect(i18n.localePath("/about")).toBe("/about");
  });
});

describe("createI18n: development validation", () => {
  it("[I18N-94] validate reports catalog problems at creation through onError", () => {
    const errors: I18nError[] = [];
    createI18n({
      defaultLocale: "en",
      locales: ["en", "fr"],
      messages: { en: { a: "Hi {name}", b: "x" }, fr: { a: "Salut", c: "y" } },
      validate: true,
      onError: (error) => errors.push(error),
    });
    expect(errors.map((e) => e.message.replace(/^\[[^\]]*\] /, "").split(":")[0])).toEqual([
      "argument-mismatch [fr] a",
      "extra-key [fr] c",
    ]);
    const strict: I18nError[] = [];
    createI18n({
      defaultLocale: "en",
      locales: ["en", "fr"],
      messages: { en: { a: "x" }, fr: {} },
      validate: { allowMissing: false },
      onError: (error) => strict.push(error),
    });
    expect(strict).toHaveLength(1);
    const quiet: I18nError[] = [];
    createI18n({
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: { a: "x" } },
      onError: (e) => quiet.push(e),
    });
    expect(quiet).toEqual([]);
  });
});
