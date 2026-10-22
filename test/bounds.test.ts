import { SuspenseContext, type SuspenseTracker } from "@shadow-js/core";
import { createTestRoot } from "@shadow-js/testing";
import { describe, expect, it, vi } from "vitest";
import type { I18nError } from "../src/errors";
import { createIntlCache } from "../src/intl";
import { BoundedCache } from "../src/lru";
import { createI18nWithIcu as createI18n } from "../src/with-icu";
import { lazyI18n } from "./support/catalogs";

describe("bounded caches", () => {
  it("[I18N-200] BoundedCache drops the least recently used entry and never exceeds its capacity", () => {
    const cache = new BoundedCache<string, number>(3);
    for (const key of ["a", "b", "c"]) cache.set(key, key.charCodeAt(0));
    expect(cache.get("a")).toBe(97);
    cache.set("d", 100);
    expect(cache.size).toBe(3);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("a")).toBe(true);
    for (let i = 0; i < 1000; i += 1) cache.set(`k${i}`, i);
    expect(cache.size).toBe(3);
    expect(cache.capacity).toBe(3);
    expect(new BoundedCache<string, number>(0).capacity).toBe(1);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("[I18N-201] the Intl formatter cache is bounded, shares equal option bags, and keeps recent entries", () => {
    const cache = createIntlCache(4);
    const first = cache.number("en", { style: "currency", currency: "EUR" });
    expect(cache.number("en", { currency: "EUR", style: "currency" })).toBe(first);
    for (let digits = 0; digits < 20; digits += 1)
      cache.number("en", { maximumFractionDigits: digits });
    expect(cache.size).toBe(4);
    expect(cache.number("en", { style: "currency", currency: "EUR" })).not.toBe(first);
    cache.clear();
    expect(cache.size).toBe(0);
    for (const make of [
      () => cache.date("en", { dateStyle: "short" }),
      () => cache.plural("en", "ordinal"),
      () => cache.list("en"),
      () => cache.relative("en"),
      () => cache.displayNames("en", { type: "region" }),
      () => cache.locale("en-US"),
    ]) {
      expect(make()).toBe(make());
    }
  });

  it("[I18N-202] the compiled-message cache holds at most cacheSize messages", () => {
    const messages = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`k${i}`, `v${i} {n}`]),
    );
    const parsed: string[] = [];
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: messages },
      cacheSize: 5,
      parse: { maxNodes: 100 },
    });
    for (let i = 0; i < 30; i += 1) parsed.push(i18n.translate(`k${i}`, { n: 1 }));
    expect(parsed).toHaveLength(30);
    // The first keys were evicted and are parsed again without any visible difference.
    expect(i18n.translate("k0", { n: 2 })).toBe("v0 2");
  });

  it("[I18N-203] a recurring data problem is reported once, one-off problems every time; the filter is bounded", () => {
    const errors: I18nError[] = [];
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: { a: "x {n}" } },
      onError: (error) => errors.push(error),
    });
    for (let i = 0; i < 5; i += 1) i18n.translate("missing");
    expect(errors).toHaveLength(1);
    for (let i = 0; i < 600; i += 1) i18n.translate(`missing${i}`);
    expect(errors).toHaveLength(601);
    // 600 distinct problems exceeded the 500 limit, so the oldest were forgotten and report again.
    i18n.translate("missing0");
    expect(errors).toHaveLength(602);
  });

  it("[I18N-204] the once-only filter forgets the oldest problems at its limit, so they warn again in development", () => {
    const i18n = createI18n({ defaultLocale: "en", locales: ["en"], messages: { en: {} } });
    const warnings = vi.mocked(console.warn);
    for (let i = 0; i < 510; i += 1) i18n.translate(`key${i}`);
    expect(warnings.mock.calls).toHaveLength(510);
    i18n.translate("key509");
    expect(warnings.mock.calls).toHaveLength(510);
    i18n.translate("key0");
    expect(warnings.mock.calls).toHaveLength(511);
    warnings.mockClear();
  });
});

describe("disposal releases waiting boundaries", () => {
  it("[I18N-205] dispose lets a Suspense boundary that waits for a catalog go", async () => {
    const { i18n } = lazyI18n({ transition: "suspend" });
    let held = 0;
    const tracker: SuspenseTracker = {
      increment: () => {
        held += 1;
      },
      decrement: () => {
        held -= 1;
      },
    };
    void i18n.setLocale("fr");
    createTestRoot(() => {
      SuspenseContext({
        value: tracker,
        get children() {
          // "only.en" exists in en; "missing.key" does not exist anywhere, so the chain is checked.
          return i18n.translate("missing.key");
        },
      });
    });
    expect(held).toBe(1);
    i18n.dispose();
    expect(held).toBe(0);
    vi.mocked(console.warn).mockClear();
  });
});
