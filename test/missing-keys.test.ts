import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nError } from "../src/errors";
import { createI18n } from "./support/full-instance";

const warnings = (): string[] => vi.mocked(console.warn).mock.calls.map((args) => args.join(" "));

afterEach(() => {
  vi.unstubAllGlobals();
});

const CHAIN_LOCALES = ["en", "zh", "zh-Hant", "zh-Hant-TW"] as const;

/** Each level of the chain owns one key; "level.en" lives in the default locale only. */
function chained(
  extra: {
    onMissing?: (info: { key: string; locale: string; chain: readonly string[] }) => string;
    onError?: (e: I18nError) => void;
  } = {},
) {
  return createI18n({
    defaultLocale: "en",
    locales: CHAIN_LOCALES,
    messages: {
      en: {
        "level.en": "from en",
        "level.zh": "en zh",
        "level.hant": "en hant",
        "level.tw": "en tw",
      },
      zh: { "level.zh": "from zh", "level.hant": "zh hant", "level.tw": "zh tw" },
      "zh-Hant": { "level.hant": "from zh-Hant", "level.tw": "hant tw" },
      "zh-Hant-TW": { "level.tw": "from zh-Hant-TW" },
    },
    locale: "zh-Hant-TW",
    syncDocument: false,
    ...extra,
  });
}

describe("missing keys in development", () => {
  it("[I18N-460] a missing key warns once per key and returns the key", () => {
    const i18n = createI18n({ defaultLocale: "en", locales: ["en"], messages: { en: { a: "A" } } });
    for (let round = 0; round < 3; round += 1) {
      expect(i18n.translate("nope" as never)).toBe("nope");
    }
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain("[shadow-i18n MISSING_KEY]");
    expect(warnings()[0]).toContain('"nope"');
    expect(i18n.translate("other" as never)).toBe("other");
    expect(warnings()).toHaveLength(2);
    expect(i18n.translate("a")).toBe("A");
    expect(warnings()).toHaveLength(2);
    vi.mocked(console.warn).mockClear();
  });

  it("[I18N-460] the same key missing in another active locale is a different problem and warns again", async () => {
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en", "fr"],
      messages: { en: {}, fr: {} },
      syncDocument: false,
    });
    i18n.translate("k" as never);
    await i18n.setLocale("fr");
    i18n.translate("k" as never);
    i18n.translate("k" as never);
    expect(warnings()).toHaveLength(2);
    vi.mocked(console.warn).mockClear();
  });

  it("[I18N-460] translateRich, scoped translators and the t function report through the same once-only filter", () => {
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: { nav: { home: "Home" } } },
    });
    expect(i18n.translateRich("nav.gone" as never)).toEqual(["nav.gone"]);
    expect((i18n.scoped("nav") as unknown as (key: string) => string)("gone")).toBe("nav.gone");
    expect(i18n.translate("nav.gone" as never)).toBe("nav.gone");
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain('"nav.gone"');
    vi.mocked(console.warn).mockClear();
  });

  it("[I18N-460] has() answers without reporting or calling onMissing", () => {
    const onMissing = vi.fn(() => "x");
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: { a: "A" } },
      onMissing,
    });
    expect(i18n.t.has("a")).toBe(true);
    expect(i18n.t.has("b" as never)).toBe(false);
    expect(onMissing).not.toHaveBeenCalled();
    expect(warnings()).toEqual([]);
  });
});

describe("missing keys in production", () => {
  it("[I18N-461] production is silent without onError: no console output, the key string is the last resort", () => {
    vi.stubGlobal("__DEV__", false);
    const i18n = createI18n({ defaultLocale: "en", locales: ["en"], messages: { en: {} } });
    expect(i18n.translate("absent" as never)).toBe("absent");
    expect(warnings()).toEqual([]);
  });

  it("[I18N-461] production still reports to onError, once per key", () => {
    vi.stubGlobal("__DEV__", false);
    const errors: I18nError[] = [];
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: {} },
      onError: (error) => errors.push(error),
    });
    i18n.translate("absent" as never);
    i18n.translate("absent" as never);
    expect(errors.map((error) => error.code)).toEqual(["MISSING_KEY"]);
    expect(warnings()).toEqual([]);
  });
});

describe("the fallback chain", () => {
  it("[I18N-462] zh-Hant-TW falls back to zh-Hant, then zh, then the default, and the last resort is the key", () => {
    vi.stubGlobal("__DEV__", false);
    const i18n = chained();
    expect(i18n.chain("zh-Hant-TW")).toEqual(["zh-Hant-TW", "zh-Hant", "zh", "en"]);
    expect(i18n.translate("level.tw" as never)).toBe("from zh-Hant-TW");
    expect(i18n.translate("level.hant" as never)).toBe("from zh-Hant");
    expect(i18n.translate("level.zh" as never)).toBe("from zh");
    expect(i18n.translate("level.en" as never)).toBe("from en");
    expect(i18n.translate("level.nowhere" as never)).toBe("level.nowhere");
  });

  it("[I18N-462] a regional tag that is not declared still resolves along the declared chain", async () => {
    vi.stubGlobal("__DEV__", false);
    const i18n = chained();
    await i18n.setLocale("zh-Hant");
    expect(i18n.chain()).toEqual(["zh-Hant", "zh", "en"]);
    expect(i18n.translate("level.tw" as never)).toBe("hant tw");
  });

  it("[I18N-462] t.has follows the chain too", () => {
    const i18n = chained();
    expect(i18n.t.has("level.en" as never)).toBe(true);
    expect(i18n.t.has("level.none" as never)).toBe(false);
  });
});

describe("onMissing", () => {
  it("[I18N-463] receives the key, the active locale and the whole chain, and its result is the output", () => {
    vi.stubGlobal("__DEV__", false);
    const seen: Array<{ key: string; locale: string; chain: readonly string[] }> = [];
    const i18n = chained({
      onMissing: (info) => {
        seen.push(info);
        return `[${info.locale}:${info.key}]`;
      },
    });
    expect(i18n.translate("level.nowhere" as never)).toBe("[zh-Hant-TW:level.nowhere]");
    expect(seen).toEqual([
      { key: "level.nowhere", locale: "zh-Hant-TW", chain: ["zh-Hant-TW", "zh-Hant", "zh", "en"] },
    ]);
  });

  it("[I18N-463] a scoped translator passes the full dotted key, and translateRich uses the same hook", () => {
    vi.stubGlobal("__DEV__", false);
    const keys: string[] = [];
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: { nav: { home: "Home" } } },
      onMissing: ({ key }) => {
        keys.push(key);
        return `?${key}`;
      },
    });
    expect((i18n.scoped("nav") as unknown as (key: string) => string)("gone")).toBe("?nav.gone");
    expect(i18n.translateRich("nav.other" as never)).toEqual(["?nav.other"]);
    expect(keys).toEqual(["nav.gone", "nav.other"]);
  });

  it("[I18N-463] onMissing runs for every miss, while the report is once per key", () => {
    const errors: I18nError[] = [];
    const onMissing = vi.fn(({ key }: { key: string }) => key.toUpperCase());
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: {} },
      onMissing,
      onError: (error) => errors.push(error),
    });
    i18n.translate("k" as never);
    i18n.translate("k" as never);
    expect(onMissing).toHaveBeenCalledTimes(2);
    expect(errors).toHaveLength(1);
  });

  it("[I18N-464] a throwing onMissing is reported and rendering continues with the key", () => {
    const boom = new Error("handler exploded");
    const errors: I18nError[] = [];
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: { ok: "fine" } },
      onMissing: () => {
        throw boom;
      },
      onError: (error) => errors.push(error),
    });
    let output = "";
    expect(() => {
      output = i18n.translate("absent" as never);
    }).not.toThrow();
    expect(output).toBe("absent");
    expect(i18n.translate("ok")).toBe("fine");
    const handlerErrors = errors.filter((error) => error.cause === boom);
    expect(handlerErrors).toHaveLength(1);
    expect(handlerErrors[0]).toBeInstanceOf(I18nError);
    expect(handlerErrors[0]?.message).toContain("handler exploded");
  });

  it("[I18N-464] a throwing onMissing does not break translateRich, and a non-string result falls back to the key", () => {
    const errors: I18nError[] = [];
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: {} },
      onMissing: () => {
        throw new Error("rich boom");
      },
      onError: (error) => errors.push(error),
    });
    expect(i18n.translateRich("absent" as never)).toEqual(["absent"]);
    expect(errors.some((error) => error.message.includes("rich boom"))).toBe(true);

    const odd = createI18n({
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: {} },
      onMissing: () => undefined as unknown as string,
      onError: () => undefined,
    });
    expect(odd.translate("absent" as never)).toBe("absent");
  });
});

describe("the once-only reporter", () => {
  it("[I18N-465] remembers at most 500 problems: the 501st clears the filter, so the oldest report again", () => {
    const errors: I18nError[] = [];
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: {} },
      onError: (error) => errors.push(error),
    });
    for (let index = 0; index < 500; index += 1) i18n.translate(`key${index}`);
    expect(errors).toHaveLength(500);
    // Everything up to the bound is still remembered.
    for (let index = 0; index < 500; index += 1) i18n.translate(`key${index}`);
    expect(errors).toHaveLength(500);
    // The 501st distinct problem hits the bound.
    i18n.translate("key500");
    expect(errors).toHaveLength(501);
    // key0 was forgotten and reports again; key500 is remembered.
    i18n.translate("key0");
    expect(errors).toHaveLength(502);
    i18n.translate("key500");
    i18n.translate("key0");
    expect(errors).toHaveLength(502);
  });

  it("[I18N-465] one-off problems (load failures) are never filtered and do not use up filter slots", async () => {
    const errors: I18nError[] = [];
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en", "fr"],
      messages: { en: {} },
      loaders: {
        fr: () => Promise.reject(new Error("down")),
      },
      onError: (error) => errors.push(error),
      syncDocument: false,
    });
    for (let attempt = 0; attempt < 3; attempt += 1) await i18n.setLocale("fr");
    expect(errors.filter((error) => error.code === "LOAD_FAILED")).toHaveLength(3);
    for (let index = 0; index < 500; index += 1) i18n.translate(`k${index}`);
    expect(errors.filter((error) => error.code === "MISSING_KEY")).toHaveLength(500);
  });
});
