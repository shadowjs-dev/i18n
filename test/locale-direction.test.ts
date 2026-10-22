import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createIntlCache } from "../src/intl";
import { type Direction, localeDirection } from "../src/locale";

const SEED = { seed: 20261011, numRuns: 200 } as const;

describe("localeDirection", () => {
  const table: ReadonlyArray<readonly [tag: string, direction: Direction]> = [
    // Right to left by language.
    ["ar", "rtl"],
    ["ar-EG", "rtl"],
    ["ar-SA", "rtl"],
    ["he", "rtl"],
    ["he-IL", "rtl"],
    ["iw", "rtl"],
    ["fa", "rtl"],
    ["fa-IR", "rtl"],
    ["fa-AF", "rtl"],
    ["ur", "rtl"],
    ["ur-PK", "rtl"],
    ["ps", "rtl"],
    ["yi", "rtl"],
    ["ug", "rtl"],
    ["ckb", "rtl"],
    ["syr", "rtl"],
    ["dv", "rtl"],
    ["nqo", "rtl"],
    ["ks", "rtl"],
    ["sd", "rtl"],
    // Right to left by script: Arabic, Hebrew, Syriac, Thaana, N'Ko, Adlam, Hanifi Rohingya.
    ["sd-Arab", "rtl"],
    ["pa-Arab", "rtl"],
    ["ku-Arab", "rtl"],
    ["uz-Arab", "rtl"],
    ["az-Arab", "rtl"],
    ["tr-Arab", "rtl"],
    ["ha-Arab", "rtl"],
    ["en-Arab", "rtl"],
    ["en-Hebr", "rtl"],
    ["und-Hebr", "rtl"],
    ["syr-Syrc", "rtl"],
    ["dv-Thaa", "rtl"],
    ["man-Nkoo", "rtl"],
    ["ff-Adlm", "rtl"],
    ["rhg-Rohg", "rtl"],
    // The script subtag wins over the language.
    ["ur-Deva", "ltr"],
    ["ks-Deva", "ltr"],
    ["ar-Latn", "ltr"],
    ["he-Latn", "ltr"],
    ["fa-Latn", "ltr"],
    ["sd-Deva", "ltr"],
    // Left to right.
    ["en", "ltr"],
    ["en-US", "ltr"],
    ["en-IL", "ltr"],
    ["fr-CA", "ltr"],
    ["de", "ltr"],
    ["ja", "ltr"],
    ["zh-Hans", "ltr"],
    ["zh-Hant-TW", "ltr"],
    ["ru", "ltr"],
    ["hi", "ltr"],
    ["th", "ltr"],
    ["ku", "ltr"],
    ["ku-Latn", "ltr"],
    ["pa", "ltr"],
    ["pa-Guru", "ltr"],
    ["uz", "ltr"],
    ["ha", "ltr"],
    ["ff", "ltr"],
    // Unknown and invalid tags are left to right.
    ["zz", "ltr"],
    ["xx-YY", "ltr"],
    ["und", "ltr"],
    ["", "ltr"],
    ["not a locale!", "ltr"],
    ["e", "ltr"],
    ["en-", "ltr"],
    ["x-whatever", "ltr"],
    // Case, separators and extensions do not change the answer.
    ["AR", "rtl"],
    ["ar_EG", "rtl"],
    ["AR-eg", "rtl"],
    ["SD-ARAB", "rtl"],
    ["UR_deva", "ltr"],
    ["ar-EG-u-nu-latn", "rtl"],
    ["ar-u-nu-latn-x-private", "rtl"],
    ["en-u-nu-arab", "ltr"],
  ];

  it.each(table)("[I18N-420] direction of %j is %s", (tag, direction) => {
    expect(localeDirection(tag)).toBe(direction);
    expect(localeDirection(tag, createIntlCache())).toBe(direction);
  });

  it("[I18N-421] very long input is left to right without throwing", () => {
    expect(localeDirection(`ar-${"a".repeat(100_000)}`)).toBe("ltr");
  });

  it("[I18N-422] property: never throws, and a script subtag decides regardless of the language", () => {
    const languages = fc.constantFrom("ar", "he", "fa", "ur", "en", "de", "ja", "und", "zz", "ku");
    const separators = fc.constantFrom("-", "_");
    const rtlScripts = fc.constantFrom("Arab", "Hebr", "Syrc", "Thaa", "Nkoo", "Adlm");
    const ltrScripts = fc.constantFrom("Latn", "Cyrl", "Deva", "Grek", "Hans", "Hant", "Jpan");
    fc.assert(
      fc.property(
        languages,
        separators,
        rtlScripts,
        ltrScripts,
        (language, separator, rtl, ltr) => {
          expect(localeDirection(`${language}${separator}${rtl}`)).toBe("rtl");
          expect(localeDirection(`${language}${separator}${ltr}`)).toBe("ltr");
          return true;
        },
      ),
      SEED,
    );
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (tag) => {
        expect(["ltr", "rtl"]).toContain(localeDirection(tag));
        return true;
      }),
      SEED,
    );
  });

  /** A stand-in for `Intl.Locale` on a runtime without text info. */
  interface Stub {
    readonly language: string;
    readonly script?: string;
    maximize?(): { readonly script?: string | undefined };
  }

  function withLocale<T>(make: (tag: string) => Stub, run: () => T): T {
    const real = Intl.Locale;
    // A function (not a class) so that `new` can hand back the stand-in object.
    const Fake = function Fake(tag: string): Stub {
      return make(tag);
    };
    Object.defineProperty(Intl, "Locale", { value: Fake, configurable: true });
    try {
      return run();
    } finally {
      Object.defineProperty(Intl, "Locale", { value: real, configurable: true });
    }
  }

  const maximized: Readonly<Record<string, string>> = {
    ar: "Arab",
    he: "Hebr",
    ur: "Arab",
    ku: "Latn",
    en: "Latn",
  };

  const maximizing = (tag: string): Stub => {
    const [language = "", explicit] = tag.split("-");
    const script = explicit !== undefined && explicit.length === 4 ? explicit : undefined;
    return {
      language,
      ...(script === undefined ? {} : { script }),
      maximize: () => ({ script: script ?? maximized[language] }),
    };
  };

  it("[I18N-423] without text info the maximized script decides, then the explicit one", () => {
    withLocale(maximizing, () => {
      expect(localeDirection("ar")).toBe("rtl");
      expect(localeDirection("ur")).toBe("rtl");
      expect(localeDirection("he-IL")).toBe("rtl");
      expect(localeDirection("ur-Deva")).toBe("ltr");
      expect(localeDirection("sd-Arab")).toBe("rtl");
      expect(localeDirection("ku")).toBe("ltr");
      expect(localeDirection("en")).toBe("ltr");
    });
  });

  it("[I18N-424] without text info and without maximize the language list decides", () => {
    const bare = (tag: string): Stub => {
      const [language = "", explicit] = tag.split("-");
      return explicit !== undefined && explicit.length === 4
        ? { language, script: explicit }
        : { language };
    };
    withLocale(bare, () => {
      const rtl = [
        "ar",
        "he",
        "iw",
        "fa",
        "ur",
        "ps",
        "sd",
        "ug",
        "yi",
        "dv",
        "ckb",
        "syr",
        "ks",
        "nqo",
      ];
      for (const language of rtl) expect(localeDirection(language), language).toBe("rtl");
      for (const language of ["en", "de", "ja", "ku", "pa", "ff", "ha", "uz", "zz"]) {
        expect(localeDirection(language), language).toBe("ltr");
      }
      expect(localeDirection("ku-Arab")).toBe("rtl");
      expect(localeDirection("pa-Arab")).toBe("rtl");
      expect(localeDirection("ur-Deva")).toBe("ltr");
      expect(localeDirection("ff-Adlm")).toBe("rtl");
      expect(localeDirection("dv-Thaa")).toBe("rtl");
      expect(localeDirection("man-Nkoo")).toBe("rtl");
      expect(localeDirection("syr-Syrc")).toBe("rtl");
      expect(localeDirection("en-Hebr")).toBe("rtl");
    });
  });

  it("[I18N-425] the older textInfo property is read, and a getter that reports nothing falls through", () => {
    const legacy =
      (direction: string | undefined) =>
      (tag: string): Stub & { readonly textInfo: { readonly direction?: string } } => ({
        language: tag,
        textInfo: direction === undefined ? {} : { direction },
      });
    withLocale(legacy("rtl"), () => expect(localeDirection("xx")).toBe("rtl"));
    withLocale(legacy("ltr"), () => expect(localeDirection("ar")).toBe("ltr"));
    withLocale(legacy(undefined), () => expect(localeDirection("ar")).toBe("rtl"));
    const modern = (tag: string) => ({
      language: tag,
      getTextInfo: () => ({ direction: "rtl" }),
    });
    withLocale(modern, () => expect(localeDirection("xx")).toBe("rtl"));
  });

  it("[I18N-426] an Intl.Locale error other than RangeError is not swallowed", () => {
    const boom = (): Stub => {
      throw new TypeError("boom");
    };
    withLocale(boom, () => expect(() => localeDirection("ar")).toThrow(TypeError));
  });
});
