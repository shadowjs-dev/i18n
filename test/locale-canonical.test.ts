import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ACCEPT_LANGUAGE_LIMITS,
  canonicalTag,
  matchLocale,
  negotiateLocale,
  parseAcceptLanguage,
} from "../src/locale";
import { createI18nWithIcu as createI18n } from "../src/with-icu";

const SEED = { seed: 20261010, numRuns: 300 } as const;

describe("canonicalTag", () => {
  const shapes: ReadonlyArray<readonly [input: string, expected: string]> = [
    ["en", "en"],
    ["EN", "en"],
    ["eN", "en"],
    ["en-us", "en-US"],
    ["EN-US", "en-US"],
    ["en_US", "en-US"],
    ["EN_us", "en-US"],
    ["zh-hant-tw", "zh-Hant-TW"],
    ["ZH-HANT-TW", "zh-Hant-TW"],
    ["zh_hant_tw", "zh-Hant-TW"],
    ["zh-hans", "zh-Hans"],
    ["sr-latn-rs", "sr-Latn-RS"],
    ["es-419", "es-419"],
    ["fil", "fil"],
    ["FIL-ph", "fil-PH"],
    ["haw", "haw"],
    ["yue-hk", "yue-HK"],
    ["de-de-1996", "de-DE-1996"],
    ["ca-es-valencia", "ca-ES-valencia"],
    ["und", "und"],
    ["iw", "he"],
    ["in", "id"],
    ["ji", "yi"],
    ["en-US-POSIX", "en-US-u-va-posix"],
  ];

  it.each(shapes)("[I18N-400] canonical casing of %s is %s", (input, expected) => {
    expect(canonicalTag(input)).toBe(expected);
  });

  const extensions: ReadonlyArray<readonly [input: string, expected: string]> = [
    ["en-us-u-nu-arab", "en-US-u-nu-arab"],
    ["EN-US-U-CA-GREGORY-NU-LATN", "en-US-u-ca-gregory-nu-latn"],
    ["ar-EG-u-nu-latn-ca-islamic", "ar-EG-u-ca-islamic-nu-latn"],
    ["th-u-ca-buddhist", "th-u-ca-buddhist"],
    ["ja_JP_u_ca_japanese", "ja-JP-u-ca-japanese"],
    ["en-x-Private", "en-x-private"],
    ["de-DE-u-co-phonebk-x-foo", "de-DE-u-co-phonebk-x-foo"],
  ];

  it.each(extensions)("[I18N-401] -u- and -x- extensions are kept: %s", (input, expected) => {
    expect(canonicalTag(input)).toBe(expected);
  });

  const grandfathered: ReadonlyArray<readonly [input: string, expected: string | undefined]> = [
    ["art-lojban", "jbo"],
    ["zh-hakka", "hak"],
    ["cel-gaulish", "xtg"],
    ["i-klingon", "tlh"],
    ["I-KLINGON", "tlh"],
    ["i-navajo", "nv"],
    ["i-lux", "lb"],
    ["i-hak", "hak"],
    ["i-ami", "ami"],
    ["i-bnn", "bnn"],
    ["i-pwn", "pwn"],
    ["i-tao", "tao"],
    ["i-tay", "tay"],
    ["i-tsu", "tsu"],
    ["en-gb-oed", "en-GB-oxendict"],
    ["sgn-be-fr", "sfb"],
    ["sgn-be-nl", "vgt"],
    ["sgn-ch-de", "sgg"],
    ["no-bok", "nb"],
    ["no-nyn", "nn"],
    ["zh-min-nan", "nan"],
    // Registered but without a preferred value: there is no locale to map them to.
    ["i-default", undefined],
    ["i-enochian", undefined],
    ["i-mingo", undefined],
    ["zh-min", undefined],
  ];

  it.each(grandfathered)(
    "[I18N-402] grandfathered tag %s canonicalizes to %s",
    (input, expected) => {
      expect(canonicalTag(input)).toBe(expected);
    },
  );

  const invalid: readonly string[] = [
    "",
    " ",
    "a",
    "abcdefghi",
    "123",
    "en-",
    "-en",
    "en--us",
    "en us",
    " en",
    "en ",
    "en@US",
    "en-US-u",
    "en-US-u-",
    "en-u",
    "x-whatever",
    "en-a",
    "!!",
    "en\u0000",
    "én",
    "en-١٢",
    "en-US-u-nu-arab-u-ca-gregory",
  ];

  it.each(invalid)("[I18N-403] invalid tag %j is undefined and never throws", (input) => {
    expect(() => canonicalTag(input)).not.toThrow();
    expect(canonicalTag(input)).toBeUndefined();
  });

  it("[I18N-403] very long input is ignored quickly", () => {
    const started = performance.now();
    expect(canonicalTag(`en-${"a".repeat(1_000_000)}`)).toBeUndefined();
    expect(canonicalTag(`en${"-abcdefgh".repeat(100_000)}`)).toBeUndefined();
    expect(canonicalTag("x".repeat(257))).toBeUndefined();
    expect(canonicalTag(`en-US-u-${"nu-latn-".repeat(40)}x-a`)).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(500);
    // A long but sensible tag is still fine.
    // `true` keyword values are dropped by canonicalization.
    expect(
      canonicalTag("de-DE-u-ca-gregory-co-phonebk-hc-h23-kf-false-kn-true-nu-latn-x-priv"),
    ).toBe("de-DE-u-ca-gregory-co-phonebk-hc-h23-kf-false-kn-nu-latn-x-priv");
  });

  it("[I18N-404] property: never throws, is idempotent, and has the shape of a tag", () => {
    const anything = fc.oneof(
      fc.string({ maxLength: 40 }),
      fc.stringMatching(/^[A-Za-z0-9_-]{0,40}$/),
      fc
        .tuple(
          fc.constantFrom("en", "ZH", "sr", "Fil", "i", "x"),
          fc.constantFrom("", "-latn", "_Hant", "-ARAB"),
          fc.constantFrom("", "-us", "_TW", "-419"),
          fc.constantFrom("", "-u-nu-arab", "-x-foo", "-1996"),
        )
        .map((parts) => parts.join("")),
    );
    fc.assert(
      fc.property(anything, (input) => {
        const once = canonicalTag(input);
        if (once === undefined) return true;
        expect(once).toMatch(/^[A-Za-z0-9-]+$/);
        expect(once.startsWith("-") || once.endsWith("-") || once.includes("--")).toBe(false);
        expect(canonicalTag(once)).toBe(once);
        return true;
      }),
      SEED,
    );
  });
});

describe("matchLocale", () => {
  it("[I18N-405] exact match ignores case, separators and the spelling of the supported list", () => {
    expect(matchLocale("EN-us", ["en-US", "fr"])).toBe("en-US");
    expect(matchLocale("en_us", ["en-US", "fr"])).toBe("en-US");
    expect(matchLocale("en-US", ["en_us", "fr"])).toBe("en_us");
    expect(matchLocale("ZH-hant-tw", ["zh", "zh-Hant-TW"])).toBe("zh-Hant-TW");
    expect(matchLocale("iw", ["en", "he"])).toBe("he");
    expect(matchLocale("he", ["en", "iw"])).toBe("iw");
    expect(matchLocale("i-klingon", ["en", "tlh"])).toBe("tlh");
  });

  it("[I18N-406] trailing subtags are removed one at a time: zh-Hant-TW, zh-Hant, zh", () => {
    expect(matchLocale("zh-Hant-TW", ["zh", "zh-Hant", "en"])).toBe("zh-Hant");
    expect(matchLocale("zh-Hant-TW", ["zh", "en"])).toBe("zh");
    expect(matchLocale("zh-Hant-TW", ["zh-Hant-TW", "zh-Hant", "zh"])).toBe("zh-Hant-TW");
    expect(matchLocale("zh-hant-hk", ["zh-Hant-TW", "zh-Hant", "zh"])).toBe("zh-Hant");
    // The parent beats a sibling region that is listed first.
    expect(matchLocale("pt-PT", ["pt-BR", "pt"])).toBe("pt");
    expect(matchLocale("pt-PT", ["pt-BR"])).toBe("pt-BR");
    // The first supported locale of the same language is the last resort.
    expect(matchLocale("pt", ["en", "pt-BR", "pt-PT"])).toBe("pt-BR");
    expect(matchLocale("en-GB", ["en-US", "fr"])).toBe("en-US");
  });

  it("[I18N-407] -u- and -x- extensions never decide the match, and are not kept in the result", () => {
    expect(matchLocale("ar-EG-u-nu-latn", ["en", "ar-EG"])).toBe("ar-EG");
    expect(matchLocale("ar-EG-u-nu-latn", ["en", "ar"])).toBe("ar");
    expect(matchLocale("en-US-x-private", ["en-US"])).toBe("en-US");
    expect(matchLocale("th-u-ca-buddhist", ["en", "th"])).toBe("th");
    expect(matchLocale("de-DE-u-co-phonebk-x-foo", ["de-DE", "de"])).toBe("de-DE");
    // A supported tag with extensions is still found by its plain form.
    expect(matchLocale("ar-EG", ["en", "ar-EG-u-nu-latn"])).toBe("ar-EG-u-nu-latn");
    expect(matchLocale("ar-EG-u-nu-latn", ["en", "ar-EG-u-nu-latn", "ar-EG"])).toBe(
      "ar-EG-u-nu-latn",
    );
  });

  it("[I18N-408] undefined for no match, invalid input, an empty list and unrelated languages", () => {
    expect(matchLocale("de", ["en-US", "fr"])).toBeUndefined();
    expect(matchLocale("", ["en"])).toBeUndefined();
    expect(matchLocale("!!!", ["en"])).toBeUndefined();
    expect(matchLocale("en", [])).toBeUndefined();
    expect(matchLocale("und", ["en"])).toBeUndefined();
    expect(matchLocale("x".repeat(100_000), ["en"])).toBeUndefined();
    // A supported name that is not a BCP 47 tag still matches itself exactly.
    expect(matchLocale("Pseudo_Local", ["en", "pseudo_local"])).toBe("pseudo_local");
    expect(() => matchLocale("en", [""])).not.toThrow();
  });

  it("[I18N-409] the fallback chain is the tag, its parents, the configured fallbacks and the default", () => {
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en", "zh", "zh-Hant", "zh-Hant-TW", "pt", "pt-BR"],
      messages: { en: { a: "A" } },
      fallbackLocale: { "pt-BR": ["pt"], default: "en" },
      syncDocument: false,
    });
    expect(i18n.chain("zh-Hant-TW")).toEqual(["zh-Hant-TW", "zh-Hant", "zh", "en"]);
    expect(i18n.chain("zh-Hant")).toEqual(["zh-Hant", "zh", "en"]);
    expect(i18n.chain("zh")).toEqual(["zh", "en"]);
    expect(i18n.chain("en")).toEqual(["en"]);
    expect(i18n.chain("pt-BR")).toEqual(["pt-BR", "pt", "en"]);
    const sparse = createI18n({
      defaultLocale: "fr",
      locales: ["fr", "zh", "zh-Hant-TW"],
      messages: { fr: { a: "A" } },
      syncDocument: false,
    });
    expect(sparse.chain("zh-Hant-TW")).toEqual(["zh-Hant-TW", "zh", "fr"]);
    // The tag a user typed resolves to the declared locale before the chain is built.
    return i18n.setLocale("ZH-hant-tw" as never).then((locale) => {
      expect(locale).toBe("zh-Hant-TW");
      expect(i18n.chain()).toEqual(["zh-Hant-TW", "zh-Hant", "zh", "en"]);
    });
  });

  it("[I18N-410] property: the result is undefined or a supported spelling of the same language", () => {
    const pool = [
      "en",
      "en-US",
      "en_GB",
      "fr",
      "fr-CA",
      "pt-BR",
      "zh-Hans",
      "zh-Hant-TW",
      "sr-Latn",
      "ar-EG",
      "he",
      "iw",
      "pseudo",
    ];
    const language = (tag: string): string | undefined =>
      canonicalTag(tag)?.split("-")[0] ?? tag.toLowerCase().split(/[-_]/)[0];
    const wanted = fc.oneof(
      fc.string({ maxLength: 30 }),
      fc.stringMatching(/^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,4}){0,3}$/),
      fc.constantFrom("EN-gb", "zh_hant_hk", "PT", "sr-cyrl", "he-IL", "iw-il", "ar-u-nu-latn"),
    );
    fc.assert(
      fc.property(wanted, fc.subarray(pool), (tag, supported) => {
        const hit = matchLocale(tag, supported);
        if (hit === undefined) return true;
        expect(supported).toContain(hit);
        // Whatever matched is a canonical tag of the same language as the request.
        const canonical = canonicalTag(hit);
        expect(canonical).toBeDefined();
        expect(language(hit)).toBe(language(tag));
        return true;
      }),
      SEED,
    );
  });
});

describe("parseAcceptLanguage", () => {
  it("[I18N-411] orders by quality, and equal quality keeps header order", () => {
    expect(parseAcceptLanguage("de;q=0.5,fr;q=0.5,es;q=0.5,en")).toEqual(["en", "de", "fr", "es"]);
    expect(parseAcceptLanguage("fr-CH, fr;q=0.9, en;q=0.8, de;q=0.7")).toEqual([
      "fr-CH",
      "fr",
      "en",
      "de",
    ]);
    expect(parseAcceptLanguage("en;q=0.1, fr;q=0.9, de")).toEqual(["de", "fr", "en"]);
    expect(parseAcceptLanguage("en;q=0.001, fr;q=0.002")).toEqual(["fr", "en"]);
    expect(parseAcceptLanguage("en;q=1.0, fr;q=1, de;q=1.000")).toEqual(["en", "fr", "de"]);
    // Tags keep their spelling.
    expect(parseAcceptLanguage("EN-us, zh_Hant")).toEqual(["EN-us", "zh_Hant"]);
  });

  it("[I18N-412] q=0, the wildcard and invalid weights are excluded", () => {
    expect(parseAcceptLanguage("en;q=0, fr")).toEqual(["fr"]);
    expect(parseAcceptLanguage("en;q=0.0, en-GB;q=0.000, fr")).toEqual(["fr"]);
    expect(parseAcceptLanguage("*")).toEqual([]);
    expect(parseAcceptLanguage("*;q=0.5, en")).toEqual(["en"]);
    expect(parseAcceptLanguage("en, *")).toEqual(["en"]);
    const badWeights = [
      "en;q=abc",
      "en;q=",
      "en;q=1.5",
      "en;q=1.001",
      "en;q=-1",
      "en;q=-0.5",
      "en;q=1e-1",
      "en;q=0x1",
      "en;q=Infinity",
      "en;q=NaN",
      "en;q=.5",
      "en;q=0.5.5",
      "en;q=0,5",
      "en;q=+1",
    ];
    for (const entry of badWeights) {
      expect(parseAcceptLanguage(`${entry}, fr;q=0.2`), entry).toEqual(["fr"]);
    }
  });

  it("[I18N-413] parameters other than q are ignored, spacing and case are tolerated", () => {
    expect(parseAcceptLanguage("en;level=1;q=0.5, fr;foo, de;Q=0.7")).toEqual(["fr", "de", "en"]);
    expect(parseAcceptLanguage("  en  ;  q=0.5  ,  fr  ")).toEqual(["fr", "en"]);
    expect(parseAcceptLanguage("\ten;q=0.5,\tfr")).toEqual(["fr", "en"]);
    expect(parseAcceptLanguage(",,en,,fr,")).toEqual(["en", "fr"]);
    expect(parseAcceptLanguage("")).toEqual([]);
    expect(parseAcceptLanguage(" ")).toEqual([]);
    expect(parseAcceptLanguage(undefined)).toEqual([]);
    expect(parseAcceptLanguage(null)).toEqual([]);
    expect(parseAcceptLanguage("not a tag, en us;q=1, e;q=1, fr")).toEqual(["fr"]);
    expect(parseAcceptLanguage("i-klingon, x-private, en-a-b")).toEqual(["i-klingon"]);
  });

  it("[I18N-414] a tag listed twice keeps its best weight and its first spelling at that weight", () => {
    expect(parseAcceptLanguage("en, fr, en;q=0.5, EN")).toEqual(["en", "fr"]);
    expect(parseAcceptLanguage("en;q=0.3, fr;q=0.5, en;q=0.9")).toEqual(["en", "fr"]);
    expect(parseAcceptLanguage("EN-us;q=0.3, de;q=0.5, en-US;q=0.9")).toEqual(["en-US", "de"]);
    expect(parseAcceptLanguage("en_US, en-US, EN-us")).toEqual(["en_US"]);
    expect(parseAcceptLanguage("en;q=0, en")).toEqual(["en"]);
    expect(parseAcceptLanguage("en, en;q=0")).toEqual(["en"]);
  });

  it("[I18N-415] bounds: the header is limited to 1024 characters, the list to 32 tags", () => {
    expect(ACCEPT_LANGUAGE_LIMITS).toEqual({ maxEntries: 32, maxLength: 1024 });
    expect(Object.isFrozen(ACCEPT_LANGUAGE_LIMITS)).toBe(true);
    const exact = `en${" ".repeat(ACCEPT_LANGUAGE_LIMITS.maxLength - 2)}`;
    expect(exact).toHaveLength(1024);
    expect(parseAcceptLanguage(exact)).toEqual(["en"]);
    expect(parseAcceptLanguage(`${exact} `)).toEqual([]);
    expect(parseAcceptLanguage(",".repeat(1024))).toEqual([]);
    expect(parseAcceptLanguage(`en${",".repeat(1024)}`)).toEqual([]);

    const letters = "abcdefghijklmnopqrstuvwxyz";
    const languages = Array.from(
      { length: 40 },
      (_, index) => `${letters[Math.floor(index / 26)]}${letters[index % 26]}`,
    );
    const ascending = languages.map(
      (tag, index) => `${tag};q=0.${String(index + 1).padStart(3, "0")}`,
    );
    const parsed = parseAcceptLanguage(ascending.join(", "));
    expect(ascending.join(", ").length).toBeLessThanOrEqual(1024);
    expect(parsed).toHaveLength(32);
    // The 32 best are kept, not the first 32 in header order.
    expect(parsed[0]).toBe(languages[39]);
    expect(parsed).not.toContain(languages[0]);
    expect(parsed).toEqual(languages.slice(8).reverse());
    const flat = parseAcceptLanguage(languages.join(","));
    expect(flat).toEqual(languages.slice(0, 32));
  });

  it("[I18N-416] negotiateLocale tries at most 32 tags", () => {
    const tags = Array.from({ length: 40 }, (_, index) => (index === 32 ? "fr" : "de"));
    expect(negotiateLocale(tags, ["en", "fr"])).toBeUndefined();
    tags[31] = "fr";
    expect(negotiateLocale(tags, ["en", "fr"])).toBe("fr");
    const consumed: string[] = [];
    function* lazy(): Generator<string> {
      for (let index = 0; index < 1000; index += 1) {
        consumed.push(String(index));
        yield "xx";
      }
    }
    expect(negotiateLocale(lazy(), ["en"])).toBeUndefined();
    expect(consumed.length).toBeLessThanOrEqual(33);
  });

  it("[I18N-417] property: tags are valid, unique, at most 32, and ordered like the model", () => {
    const entry = fc.record({
      tag: fc.constantFrom(
        "en",
        "EN-us",
        "fr-CA",
        "de",
        "zh-Hant-TW",
        "pt_BR",
        "bad tag",
        "*",
        "es-419",
        "ja",
      ),
      q: fc.option(fc.integer({ min: 0, max: 1000 }), { nil: undefined }),
    });
    fc.assert(
      fc.property(fc.array(entry, { maxLength: 60 }), (entries) => {
        const header = entries
          .map(({ tag, q }) =>
            q === undefined
              ? tag
              : `${tag};q=${q === 1000 ? "1" : `0.${String(q).padStart(3, "0")}`}`,
          )
          .join(", ");
        const result = parseAcceptLanguage(header);
        // Model: validity, q > 0, best weight per canonical tag, stable sort, bound.
        const best = new Map<string, { tag: string; q: number; index: number }>();
        entries.forEach(({ tag, q }, index) => {
          const key = canonicalTag(tag)?.toLowerCase();
          const weight = q === undefined ? 1 : q / 1000;
          if (key === undefined || tag === "*" || weight === 0) return;
          const known = best.get(key);
          if (known === undefined || weight > known.q) best.set(key, { tag, q: weight, index });
        });
        const expected = [...best.values()]
          .sort((a, b) => b.q - a.q || a.index - b.index)
          .slice(0, ACCEPT_LANGUAGE_LIMITS.maxEntries)
          .map((item) => item.tag);
        if (header.length > ACCEPT_LANGUAGE_LIMITS.maxLength) {
          expect(result).toEqual([]);
        } else {
          expect(result).toEqual(expected);
        }
        expect(new Set(result.map((tag) => canonicalTag(tag))).size).toBe(result.length);
        return true;
      }),
      SEED,
    );
  });

  it("[I18N-418] property: any header string is handled without throwing", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 1200 }), (header) => {
        const result = parseAcceptLanguage(header);
        expect(result.length).toBeLessThanOrEqual(ACCEPT_LANGUAGE_LIMITS.maxEntries);
        for (const tag of result) expect(canonicalTag(tag)).toBeDefined();
        return true;
      }),
      SEED,
    );
  });
});
