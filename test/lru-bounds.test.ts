import { describe, expect, it } from "vitest";
import { CATALOG_LIMITS, flattenCatalog } from "../src/catalog";
import type { I18nError } from "../src/errors";
import { icuCompile } from "../src/icu";
import { createIntlCache, INTL_CACHE_SIZE } from "../src/intl";
import { ACCEPT_LANGUAGE_LIMITS, parseAcceptLanguage } from "../src/locale";
import { BoundedCache } from "../src/lru";
import type { CompiledMessage } from "../src/message";
import { parseI18nState, STATE_MAX_LENGTH } from "../src/state";
import { createI18n } from "./support/full-instance";

/**
 * One test per cache and bound of the package. Where a bound already
 * has a test elsewhere, the id is named here and this file adds the exact edge.
 *
 * - compiled messages (`cacheSize`): [I18N-495] here, [I18N-202] and [I18N-56] for the old shape
 * - Intl formatter cache (256): [I18N-498] here, [I18N-201] for a small capacity
 * - catalog depth 32 / 100 000 keys: [I18N-496] here, [I18N-145] for `flattenCatalog`
 * - Accept-Language 32 entries / 1024 characters: [I18N-497] here, [I18N-100]
 * - hydration state 8 MB: [I18N-482] in state-hydration.test.ts
 * - source tokenizer 5 MB / template depth 64: [I18N-154], [I18N-155] in tooling.test.ts
 * - once-only reporter 500: [I18N-465] in missing-keys.test.ts, [I18N-203] and [I18N-204]
 */

describe("the compiled-message cache", () => {
  it("[I18N-495] BoundedCache evicts the least recently used entry first, and a read refreshes an entry", () => {
    const cache = new BoundedCache<number, string>(3);
    cache.set(1, "a");
    cache.set(2, "b");
    cache.set(3, "c");
    expect(cache.get(1)).toBe("a");
    cache.set(4, "d");
    expect([cache.has(1), cache.has(2), cache.has(3), cache.has(4)]).toEqual([
      true,
      false,
      true,
      true,
    ]);
    cache.set(3, "c2");
    cache.set(5, "e");
    // Rewriting key 3 made it the newest, so key 1 went and key 4 is now the oldest.
    expect([cache.has(1), cache.has(3), cache.has(4), cache.has(5)]).toEqual([
      false,
      true,
      true,
      true,
    ]);
    expect(cache.size).toBe(3);
    cache.set(6, "f");
    expect([cache.has(3), cache.has(4)]).toEqual([true, false]);
    // has() does not refresh: 3 is still the oldest after being asked about.
    expect(cache.has(3)).toBe(true);
    cache.set(7, "g");
    expect(cache.has(3)).toBe(false);
    expect(cache.size).toBe(3);
  });

  it("[I18N-495] with cacheSize 3 the instance compiles a text again exactly when it was evicted", () => {
    const compiled: string[] = [];
    const compile = (text: string): CompiledMessage => {
      compiled.push(text);
      return icuCompile(text);
    };
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: { a: "a {n}", b: "b {n}", c: "c {n}", d: "d {n}" } },
      cacheSize: 3,
      compile,
    });
    for (const key of ["a", "b", "c"] as const) i18n.translate(key, { n: 1 });
    expect(compiled).toEqual(["a {n}", "b {n}", "c {n}"]);
    // Hits do not compile; they refresh "a".
    i18n.translate("a", { n: 2 });
    i18n.translate("b", { n: 2 });
    i18n.translate("a", { n: 3 });
    expect(compiled).toHaveLength(3);
    // "d" evicts the least recently used, which is "c"... "b" was read after "c", "a" last.
    i18n.translate("d", { n: 1 });
    expect(compiled).toHaveLength(4);
    i18n.translate("a", { n: 4 });
    i18n.translate("b", { n: 4 });
    i18n.translate("d", { n: 4 });
    expect(compiled).toHaveLength(4);
    i18n.translate("c", { n: 4 });
    expect(compiled).toHaveLength(5);
    expect(compiled[4]).toBe("c {n}");
  });

  it("[I18N-495] cacheSize is rounded down and at least 1, so 0 or a fraction never disables or breaks rendering", () => {
    for (const cacheSize of [0, 0.4, -3, 1]) {
      const i18n = createI18n({
        defaultLocale: "en",
        locales: ["en"],
        messages: { en: { a: "a {n}", b: "b {n}" } },
        cacheSize,
      });
      for (let round = 0; round < 3; round += 1) {
        expect(i18n.translate("a", { n: round })).toBe(`a ${round}`);
        expect(i18n.translate("b", { n: round })).toBe(`b ${round}`);
      }
    }
  });
});

describe("catalog bounds", () => {
  const nested = (levels: number): Record<string, unknown> => {
    let value: unknown = "leaf";
    for (let level = 1; level < levels; level += 1) value = { n: value };
    return { n: value };
  };
  const wide = (count: number): Record<string, string> =>
    Object.fromEntries(Array.from({ length: count }, (_, index) => [`k${index}`, "x"]));

  it("[I18N-496] depth 32 is accepted and 33 is INVALID_CATALOG, for static, loaded, added and hydrated catalogs", async () => {
    expect(CATALOG_LIMITS).toEqual({ maxDepth: 32, maxKeys: 100_000 });
    const fine = nested(CATALOG_LIMITS.maxDepth);
    const tooDeep = nested(CATALOG_LIMITS.maxDepth + 1);
    expect(flattenCatalog(fine).size).toBe(1);
    expect(() => flattenCatalog(tooDeep)).toThrow(
      expect.objectContaining({ code: "INVALID_CATALOG" }),
    );

    const base = { defaultLocale: "en", locales: ["en", "fr"], syncDocument: false } as const;
    expect(() => createI18n({ ...base, messages: { en: fine as never } })).not.toThrow();
    expect(() => createI18n({ ...base, messages: { en: tooDeep as never } })).toThrow(
      expect.objectContaining({ code: "INVALID_CATALOG" }),
    );
    const i18n = createI18n({ ...base, messages: { en: { a: "A" } } });
    expect(() => i18n.addMessages("fr", tooDeep as never)).toThrow(
      expect.objectContaining({ code: "INVALID_CATALOG" }),
    );
    expect(() => i18n.hydrate({ v: 1, locale: "en", messages: { fr: tooDeep as never } })).toThrow(
      expect.objectContaining({ code: "INVALID_CATALOG" }),
    );
    expect(i18n.isLoaded("fr")).toBe(false);

    const errors: I18nError[] = [];
    const lazy = createI18n({
      ...base,
      messages: { en: { a: "A" } },
      loaders: { fr: () => Promise.resolve(tooDeep as never) },
      onError: (error) => errors.push(error),
    });
    await expect(lazy.setLocale("fr")).resolves.toBe("en");
    expect(errors.map((error) => error.code)).toEqual(["INVALID_CATALOG"]);
  });

  it("[I18N-496] 100 000 messages are accepted and 100 001 are INVALID_CATALOG, also in a loaded catalog", async () => {
    expect(flattenCatalog(wide(CATALOG_LIMITS.maxKeys)).size).toBe(CATALOG_LIMITS.maxKeys);
    expect(() => flattenCatalog(wide(CATALOG_LIMITS.maxKeys + 1))).toThrow(
      expect.objectContaining({ code: "INVALID_CATALOG" }),
    );
    const errors: I18nError[] = [];
    const lazy = createI18n({
      defaultLocale: "en",
      locales: ["en", "fr"],
      messages: { en: { a: "A" } },
      loaders: { fr: () => Promise.resolve(wide(CATALOG_LIMITS.maxKeys + 1)) },
      onError: (error) => errors.push(error),
      syncDocument: false,
    });
    await expect(lazy.setLocale("fr")).resolves.toBe("en");
    expect(errors.map((error) => error.code)).toEqual(["INVALID_CATALOG"]);
  });

  it("[I18N-496] a hydration state with more than 100 000 messages in a catalog is stopped by the parser", () => {
    const text = JSON.stringify({
      v: 1,
      locale: "en",
      messages: { en: wide(CATALOG_LIMITS.maxKeys + 1) },
    });
    expect(() => parseI18nState(text)).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    const ok = JSON.stringify({
      v: 1,
      locale: "en",
      messages: { en: wide(CATALOG_LIMITS.maxKeys) },
    });
    expect(Object.keys(parseI18nState(ok).messages["en"] ?? {})).toHaveLength(
      CATALOG_LIMITS.maxKeys,
    );
    expect(STATE_MAX_LENGTH).toBe(8_000_000);
  });
});

describe("Accept-Language bounds", () => {
  it("[I18N-497] 32 entries are kept and the 33rd is dropped; 1024 characters are read and 1025 are ignored whole", () => {
    expect(ACCEPT_LANGUAGE_LIMITS).toEqual({ maxEntries: 32, maxLength: 1024 });
    const tag = (index: number): string =>
      `a${String.fromCharCode(97 + (index % 26))}${String.fromCharCode(97 + Math.floor(index / 26))}`;
    const tags = (count: number): string =>
      Array.from({ length: count }, (_, i) => tag(i)).join(",");
    expect(parseAcceptLanguage(tags(32))).toHaveLength(32);
    expect(parseAcceptLanguage(tags(33))).toHaveLength(32);

    const header = (length: number): string => {
      // "en" plus padding spaces to reach exactly `length` characters.
      return `en${" ".repeat(length - 2)}`;
    };
    expect(header(ACCEPT_LANGUAGE_LIMITS.maxLength)).toHaveLength(1024);
    expect(parseAcceptLanguage(header(ACCEPT_LANGUAGE_LIMITS.maxLength))).toEqual(["en"]);
    expect(parseAcceptLanguage(header(ACCEPT_LANGUAGE_LIMITS.maxLength + 1))).toEqual([]);
  });

  it("[I18N-497] the entries kept are the best 32 by quality, not the first 32", () => {
    const low = Array.from(
      { length: 40 },
      (_, i) =>
        `b${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))};q=0.1`,
    ).join(",");
    const result = parseAcceptLanguage(`${low},fr;q=0.9`);
    expect(result).toHaveLength(32);
    expect(result[0]).toBe("fr");
  });
});

describe("the Intl formatter cache", () => {
  it("[I18N-498] holds at most 256 formatters by default, reaches that bound, and keeps working past it", () => {
    expect(INTL_CACHE_SIZE).toBe(256);
    const cache = createIntlCache();
    let distinct = 0;
    // 3 locales x 231 (minimum, maximum) fraction-digit pairs: 693 different formatters.
    for (const locale of ["en", "fr", "de"]) {
      for (let maximum = 0; maximum <= 20; maximum += 1) {
        for (let minimum = 0; minimum <= maximum; minimum += 1) {
          const formatter = cache.number(locale, {
            minimumFractionDigits: minimum,
            maximumFractionDigits: maximum,
          });
          expect(formatter.format(1.5)).toMatch(/\d/);
          distinct += 1;
          expect(cache.size).toBeLessThanOrEqual(256);
        }
      }
    }
    expect(distinct).toBe(693);
    expect(cache.size).toBe(256);
    // Other kinds share the same bound.
    for (let index = 0; index < 100; index += 1) {
      cache.date("en", {
        year: "numeric",
        timeZone: "UTC",
        fractionalSecondDigits: ((index % 3) + 1) as 1 | 2 | 3,
        hour12: index % 2 === 0,
        second: "numeric",
      });
      expect(cache.size).toBeLessThanOrEqual(256);
    }
  });
});

describe("cache sizes that would unbound the cache", () => {
  it("[I18N-495] a capacity that is NaN or infinite is rejected with INVALID_VALUE instead of leaving the cache unbounded", () => {
    for (const capacity of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => new BoundedCache<string, number>(capacity)).toThrow(
        expect.objectContaining({ code: "INVALID_VALUE" }),
      );
      expect(() =>
        createI18n({
          defaultLocale: "en",
          locales: ["en"],
          messages: { en: {} },
          cacheSize: capacity,
        }),
      ).toThrow(expect.objectContaining({ code: "INVALID_VALUE" }));
    }
  });

  it("[I18N-495] a cache of capacity 1 keeps only the newest entry", () => {
    const cache = new BoundedCache<string, number>(1.9);
    cache.set("a", 1);
    cache.set("b", 2);
    expect([cache.has("a"), cache.has("b"), cache.size, cache.capacity]).toEqual([
      false,
      true,
      1,
      1,
    ]);
  });
});
