import { describe, expect, it } from "vitest";
import { type DetectInput, detectLocale, readCookie } from "../src/detect";
import { localeDirection, matchLocale, negotiateLocale, parseAcceptLanguage } from "../src/locale";
import { cookieStrategy, storageStrategy } from "../src/persist";
import { createLocaleRouting } from "../src/routing";

describe("locale negotiation", () => {
  it("[I18N-100] parses Accept-Language by quality, dropping q=0, wildcards and junk", () => {
    expect(parseAcceptLanguage("fr-CH, fr;q=0.9, en;q=0.8, *;q=0.5")).toEqual([
      "fr-CH",
      "fr",
      "en",
    ]);
    expect(parseAcceptLanguage("en;q=0.5, de;q=0.5, fr")).toEqual(["fr", "en", "de"]);
    expect(parseAcceptLanguage("de;q=0, en;q=x, !!!, a b, es;q=1.5")).toEqual([]);
    expect(parseAcceptLanguage(null)).toEqual([]);
    expect(parseAcceptLanguage("en".repeat(600))).toEqual([]);
    const region = (i: number): string =>
      String.fromCharCode(65 + Math.floor(i / 26), 65 + (i % 26));
    const many = Array.from({ length: 100 }, (_, i) => `en-${region(i)}`).join(",");
    expect(parseAcceptLanguage(many)).toHaveLength(32);
  });

  it("[I18N-101] matches exact, then truncated, then same-language locales", () => {
    const supported = ["en-US", "fr", "pt-BR", "zh-Hant"] as const;
    expect(matchLocale("en-us", supported)).toBe("en-US");
    expect(matchLocale("en-GB", supported)).toBe("en-US");
    expect(matchLocale("fr-CA", supported)).toBe("fr");
    expect(matchLocale("pt", supported)).toBe("pt-BR");
    expect(matchLocale("zh-Hant-TW", supported)).toBe("zh-Hant");
    expect(matchLocale("de", supported)).toBeUndefined();
    expect(negotiateLocale(["de", "fr-BE", "en"], supported)).toBe("fr");
    expect(negotiateLocale([], supported)).toBeUndefined();
  });

  it("[I18N-102] direction uses Intl text info and falls back by script and language", () => {
    for (const rtl of ["ar", "he", "fa", "ur", "ar-EG", "ps", "yi", "ku-Arab", "sd-Arab"]) {
      expect(localeDirection(rtl), rtl).toBe("rtl");
    }
    for (const ltr of ["en", "ja", "de", "ru", "zh-Hans", "hi", "en-IL"]) {
      expect(localeDirection(ltr), ltr).toBe("ltr");
    }
    expect(localeDirection("not a locale!")).toBe("ltr");
  });

  it("[I18N-103] direction falls back when Intl.Locale has no text info", () => {
    const real = Intl.Locale;
    class Bare {
      readonly language: string;
      readonly script: string | undefined;
      constructor(tag: string) {
        this.language = tag.split("-")[0] ?? "";
        this.script = tag.includes("Arab") ? "Arab" : undefined;
      }
    }
    Object.defineProperty(Intl, "Locale", { value: Bare, configurable: true });
    try {
      expect(localeDirection("he")).toBe("rtl");
      expect(localeDirection("xx-Arab")).toBe("rtl");
      expect(localeDirection("en")).toBe("ltr");
    } finally {
      Object.defineProperty(Intl, "Locale", { value: real, configurable: true });
    }
  });
});

describe("detection", () => {
  const routing = createLocaleRouting({
    locales: ["en", "fr", "de"],
    defaultLocale: "en",
    prefix: "always",
  });
  const base = { locales: ["en", "fr", "de"] as const, routing };

  it("[I18N-104] sources are tried in the configured order", () => {
    const input: DetectInput = {
      pathname: "/de/about",
      cookie: "a=1; locale=fr",
      storage: "en",
      acceptLanguage: "en-GB",
      navigatorLanguages: ["fr-FR"],
    };
    expect(detectLocale(input, base)).toEqual({ locale: "de", source: "url" });
    expect(detectLocale(input, { ...base, order: ["cookie", "url"] })).toEqual({
      locale: "fr",
      source: "cookie",
    });
    expect(detectLocale(input, { ...base, order: ["storage"] })).toEqual({
      locale: "en",
      source: "storage",
    });
    expect(detectLocale(input, { ...base, order: ["accept-language"] })).toEqual({
      locale: "en",
      source: "accept-language",
    });
    expect(detectLocale(input, { ...base, order: ["navigator"] })).toEqual({
      locale: "fr",
      source: "navigator",
    });
    expect(detectLocale({ pathname: "/about", cookie: "locale=xx" }, base)).toBeUndefined();
  });

  it("[I18N-105] unprefixedIsDefault makes the URL decide for as-needed schemes", () => {
    const needed = createLocaleRouting({ locales: ["en", "fr"], defaultLocale: "en" });
    const options = { locales: ["en", "fr"] as const, routing: needed };
    expect(detectLocale({ pathname: "/about", cookie: "locale=fr" }, options)).toEqual({
      locale: "fr",
      source: "cookie",
    });
    expect(
      detectLocale(
        { pathname: "/about", cookie: "locale=fr" },
        { ...options, unprefixedIsDefault: true },
      ),
    ).toEqual({
      locale: "en",
      source: "url",
    });
  });

  it("[I18N-106] readCookie decodes, uses a custom name, and survives malformed input", () => {
    expect(readCookie("a=1; NEXT_LOCALE=pt%2DBR", "NEXT_LOCALE")).toBe("pt-BR");
    expect(readCookie("locale=%E0%A4%A", "locale")).toBeUndefined();
    expect(readCookie(undefined, "x")).toBeUndefined();
    expect(readCookie("x".repeat(9000), "x")).toBeUndefined();
  });
});

describe("persistence", () => {
  it("[I18N-107] the cookie strategy reads and writes through the injected document", () => {
    const doc = { cookie: "other=1; locale=fr" };
    const strategy = cookieStrategy({ document: doc, secure: true, maxAge: 60 });
    expect(strategy.read()).toBe("fr");
    strategy.write("de");
    expect(doc.cookie).toBe("locale=de; Path=/; Max-Age=60; SameSite=Lax; Secure");
    expect(() => cookieStrategy({ name: "bad name" })).toThrow(/INVALID_VALUE/);
    expect(() => cookieStrategy({ path: "/a;b" })).toThrow(/INVALID_VALUE/);
  });

  it("[I18N-108] the storage strategy reports blocked storage instead of throwing", () => {
    const store = new Map<string, string>();
    const ok = storageStrategy({
      key: "k",
      storage: {
        getItem: (key) => store.get(key) ?? null,
        setItem: (key, value) => void store.set(key, value),
      },
    });
    ok.write("fr");
    expect(ok.read()).toBe("fr");
    const reports: string[] = [];
    const blocked = storageStrategy({
      storage: {
        getItem: () => {
          throw new DOMException("denied", "SecurityError");
        },
        setItem: () => {
          throw new DOMException("quota", "QuotaExceededError");
        },
      },
      report: (error) => reports.push(error.code),
    });
    expect(blocked.read()).toBeUndefined();
    blocked.write("fr");
    expect(reports).toEqual(["INVALID_STATE", "INVALID_STATE"]);
  });

  it("[I18N-109] strategies are inert where there is no document or storage (SSR)", () => {
    expect(cookieStrategy().read()).toBeUndefined();
    cookieStrategy().write("fr");
    expect(storageStrategy({ storage: undefined }).read()).toBeUndefined();
  });
});

describe("locale routing helpers", () => {
  const routing = createLocaleRouting({ locales: ["en", "fr", "pt-BR"], defaultLocale: "en" });

  it("[I18N-110] localePath prefixes according to the strategy and keeps query and hash", () => {
    expect(routing.localePath("/about", "fr")).toBe("/fr/about");
    expect(routing.localePath("/about", "en")).toBe("/about");
    expect(routing.localePath("/", "fr")).toBe("/fr");
    expect(routing.localePath("/a?x=1#h", "pt-BR")).toBe("/pt-BR/a?x=1#h");
    const always = createLocaleRouting({
      locales: ["en", "fr"],
      defaultLocale: "en",
      prefix: "always",
    });
    expect(always.localePath("/about", "en")).toBe("/en/about");
    const never = createLocaleRouting({
      locales: ["en", "fr"],
      defaultLocale: "en",
      prefix: "never",
    });
    expect(never.localePath("/about", "fr")).toBe("/about");
  });

  it("[I18N-111] localePath can never produce a protocol-relative or foreign URL", () => {
    expect(routing.localePath("//evil.com/x", "en")).toBe("/evil.com/x");
    expect(routing.localePath("///evil.com", "fr")).toBe("/fr/evil.com");
    expect(routing.localePath("\\\\evil.com", "en")).toBe("/evil.com");
    expect(routing.localePath("/\t/evil.com", "en")).toBe("/evil.com");
    expect(routing.localePath("", "fr")).toBe("/fr");
    expect(routing.localePath("https://evil.com", "en")).toBe("/https://evil.com");
  });

  it("[I18N-112] parse splits the locale from the path; unknown prefixes stay in the path", () => {
    expect(routing.parse("/fr/about")).toEqual({ locale: "fr", path: "/about" });
    expect(routing.parse("/FR")).toEqual({ locale: "fr", path: "/" });
    expect(routing.parse("/pt-br/x/y")).toEqual({ locale: "pt-BR", path: "/x/y" });
    expect(routing.parse("/about")).toEqual({ locale: undefined, path: "/about" });
    expect(routing.parse("/frx/about")).toEqual({ locale: undefined, path: "/frx/about" });
  });

  it("[I18N-113] canonical says where a request should be redirected", () => {
    expect(routing.canonical("/en/about", "en")).toBe("/about");
    expect(routing.canonical("/about", "fr")).toBe("/fr/about");
    expect(routing.canonical("/fr/about", "fr")).toBeUndefined();
    expect(routing.canonical("/about", "en")).toBeUndefined();
  });

  it("[I18N-114] alternates build absolute hreflang links with x-default", () => {
    expect(routing.alternates("/about", "https://example.com/")).toEqual([
      { hreflang: "en", href: "https://example.com/about" },
      { hreflang: "fr", href: "https://example.com/fr/about" },
      { hreflang: "pt-BR", href: "https://example.com/pt-BR/about" },
      { hreflang: "x-default", href: "https://example.com/about" },
    ]);
    expect(() => routing.alternates("/", "javascript:alert(1)")).toThrow(/http\(s\)/);
    expect(() => routing.alternates("/", "/relative")).toThrow(/absolute/);
    expect(() => createLocaleRouting({ locales: ["en"], defaultLocale: "fr" as "en" })).toThrow(
      /UNKNOWN_LOCALE/,
    );
    expect(routing.pattern).toBe("/:locale");
  });
});

describe("router integration", () => {
  const routing = createLocaleRouting({
    locales: ["en", "fr"],
    defaultLocale: "en",
    prefix: "always",
  });

  it("[I18N-115] resolve gives locale, path and the canonical redirect for /:locale routes", () => {
    expect(routing.resolve("/fr/about")).toEqual({
      locale: "fr",
      path: "/about",
      redirectTo: undefined,
    });
    expect(routing.resolve("/about")).toEqual({
      locale: "en",
      path: "/about",
      redirectTo: "/en/about",
    });
    expect(routing.resolve("/about", "fr")).toEqual({
      locale: "fr",
      path: "/about",
      redirectTo: "/fr/about",
    });
    expect(routing.resolve("//evil.com", "fr").redirectTo).toBe("/fr/evil.com");
    const needed = createLocaleRouting({ locales: ["en", "fr"], defaultLocale: "en" });
    expect(needed.resolve("/en/about").redirectTo).toBe("/about");
  });

  it("[I18N-116] fromParam validates a :locale route param", () => {
    expect(routing.fromParam("FR")).toBe("fr");
    expect(routing.fromParam("xx")).toBeUndefined();
    expect(routing.fromParam(undefined)).toBeUndefined();
    expect(
      createLocaleRouting({ locales: ["en"], defaultLocale: "en", prefix: "never" }).fromParam(
        "en",
      ),
    ).toBeUndefined();
  });
});
