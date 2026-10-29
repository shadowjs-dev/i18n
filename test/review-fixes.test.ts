import { createRoot, flushSync, useEffect, useSignal } from "@shadow-js/core";
import { describe, expect, it } from "vitest";
import { assignKey } from "../src/cli/run";
import { readXliff } from "../src/cli/xliff";
import { createI18n } from "../src/create-i18n";
import { MessageSyntaxError } from "../src/errors";
import { createI18nFull } from "../src/full";
import { i18nHeadTags } from "../src/head";
import { formatToParts, formatToString } from "../src/icu/format";
import { parseMessage } from "../src/icu/parse";
import { chainOf, type Shared } from "../src/internal/shared";
import { matchLocale, negotiateLocale } from "../src/locale";
import { plainMessage } from "../src/message";
import { makeCtx } from "./support/ctx";

describe("og:locale spelling", () => {
  function app(locales: readonly string[]) {
    return createI18nFull({
      defaultLocale: locales[0] ?? "en",
      locales,
      messages: { [locales[0] ?? "en"]: { a: "A" } },
      prefix: "always",
      syncDocument: false,
    });
  }

  it("[I18N-REV-1] og:locale is language_REGION: the script and extension subtags are dropped", () => {
    const i18n = app(["en", "zh-Hant-TW", "zh-Hans-CN", "pt-BR", "sr-Latn"]);
    const tags = i18nHeadTags(i18n, {
      path: "/",
      origin: "https://example.com",
      locale: "zh-Hant-TW",
      openGraph: true,
    });
    const content = tags
      .filter((tag) => tag.tag === "meta")
      .map((tag) => `${tag.props["property"]}=${tag.props["content"]}`);
    expect(content).toEqual([
      "og:locale=zh_TW",
      "og:locale:alternate=en",
      "og:locale:alternate=zh_CN",
      "og:locale:alternate=pt_BR",
      "og:locale:alternate=sr",
    ]);
  });

  it("[I18N-REV-1] two locales that share a language and region give one alternate", () => {
    const i18n = app(["en", "zh-Hans-CN", "zh-CN"]);
    const tags = i18nHeadTags(i18n, {
      path: "/",
      origin: "https://example.com",
      locale: "en",
      openGraph: true,
    });
    const alternates = tags
      .filter((tag) => tag.props["property"] === "og:locale:alternate")
      .map((tag) => tag.props["content"]);
    expect(alternates).toEqual(["zh_CN"]);
  });
});

describe("values that are not objects", () => {
  it("[I18N-REV-2] a primitive in place of the values object means no values and never throws", () => {
    const { ctx, reports } = makeCtx();
    const text = formatToString(
      parseMessage("{length} {n, plural, other {x}}"),
      "hello" as never,
      ctx,
    );
    expect(text).toBe("{length} {n}");
    expect(reports.map((error) => error.code)).toEqual(["MISSING_VALUE", "MISSING_VALUE"]);
  });
});

describe("tag handlers", () => {
  it("[I18N-REV-3] a value that is not a function under a tag's name is a missing handler, not a TypeError", () => {
    const { ctx, reports } = makeCtx();
    const parts = formatToParts(
      parseMessage("<b>hi</b>"),
      {},
      { b: "text" as unknown as (chunks: readonly unknown[]) => unknown },
      ctx,
    );
    expect(parts).toEqual(["hi"]);
    expect(reports.map((error) => error.code)).toEqual(["MISSING_TAG_HANDLER"]);
  });
});

describe("hydrate input", () => {
  it("[I18N-REV-4] a snapshot without a messages object is INVALID_STATE, not a TypeError", () => {
    const i18n = createI18nFull({
      defaultLocale: "en",
      locales: ["en", "fr"],
      messages: { en: { a: "A" } },
      syncDocument: false,
    });
    for (const messages of [null, undefined, 3, "x", []]) {
      expect(() => i18n.hydrate({ v: 1, locale: "en", messages } as never)).toThrowError(
        /INVALID_STATE/,
      );
    }
    expect(i18n.locale()).toBe("en");
  });
});

describe("XLIFF scanning", () => {
  it("[I18N-REV-5] an element name repeated as a prefix a hundred thousand times does not overflow the stack", () => {
    const hostile = `<xliff>${"<filex ".repeat(100_000)}</xliff>`;
    expect(readXliff(hostile).units).toEqual([]);
  });
});

describe("assignKey", () => {
  it("[I18N-REV-6] a __proto__ key becomes data, like every other key", () => {
    const catalog: Record<string, unknown> = {};
    assignKey(catalog, "__proto__.a", "x");
    assignKey(catalog, "__proto__", "y");
    expect(Object.getPrototypeOf(catalog)).toBe(Object.prototype);
    expect(Object.keys(catalog)).toEqual(["__proto__"]);
    expect(Object.getOwnPropertyDescriptor(catalog, "__proto__")?.value).toBe("y");
    const nested: Record<string, unknown> = {};
    assignKey(nested, "__proto__.a", "x");
    const inner = Object.getOwnPropertyDescriptor(nested, "__proto__")?.value as Record<
      string,
      unknown
    >;
    expect(inner["a"]).toBe("x");
    expect(({} as Record<string, unknown>)["a"]).toBeUndefined();
  });
});

describe("locale matching by script", () => {
  it("[I18N-REV-7] a request without a script matches the supported locale of the script it implies", () => {
    expect(matchLocale("zh-TW", ["zh-Hans", "zh-Hant"])).toBe("zh-Hant");
    expect(matchLocale("zh-HK", ["zh-Hans", "zh-Hant"])).toBe("zh-Hant");
    expect(matchLocale("zh-CN", ["zh-Hant", "zh-Hans"])).toBe("zh-Hans");
    expect(matchLocale("zh", ["zh-Hant", "zh-Hans"])).toBe("zh-Hans");
    expect(negotiateLocale(["zh-TW", "en"], ["en", "zh-Hans", "zh-Hant"])).toBe("zh-Hant");
  });

  it("[I18N-REV-7] a requested script matches the supported locale of that script", () => {
    expect(matchLocale("sr-Latn", ["sr-Cyrl", "sr-Latn-RS"])).toBe("sr-Latn-RS");
    expect(matchLocale("zh-Hant", ["zh-Hans", "zh-Hant-TW"])).toBe("zh-Hant-TW");
  });

  it("[I18N-REV-7] when no supported locale has the script, the first one of the language still wins", () => {
    expect(matchLocale("zh-TW", ["zh-Hans-CN", "zh-Hans-SG"])).toBe("zh-Hans-CN");
    expect(matchLocale("pt-BR", ["pt-PT"])).toBe("pt-PT");
  });
});

describe("formatters given a value that cannot become text", () => {
  it("[I18N-REV-8] an object with no usable toString is reported and shown, never thrown", () => {
    const reports: string[] = [];
    const i18n = createI18nFull({
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: { a: "A" } },
      syncDocument: false,
      onError: (error) => reports.push(error.code),
    });
    const bare = Object.create(null) as never;
    const hostile = {
      toString() {
        throw new Error("no text");
      },
    } as never;
    for (const value of [bare, hostile]) {
      expect(i18n.formatNumber(value)).toBe("an object");
      expect(i18n.formatDate(value)).toBe("an object");
      expect(i18n.formatRelative(value)).toBe("an object");
    }
    expect(i18n.formatNumber(Symbol("s") as never)).toBe("Symbol(s)");
    expect(new Set(reports)).toEqual(new Set(["INVALID_VALUE", "FORMAT_FAILED"]));
  });
});

describe("fallback chain cache", () => {
  it("[I18N-REV-9] chain() of a tag the instance does not declare is not remembered", () => {
    const chains = new Map<string, readonly string[]>();
    const shared = {
      locales: ["en", "fr"],
      defaultLocale: "en",
      options: {},
      chains,
    } as unknown as Shared<string>;
    for (let index = 0; index < 1000; index += 1) {
      expect(chainOf(shared, `x${index}`)).toEqual(["en"]);
    }
    expect(chains.size).toBe(0);
    expect(chainOf(shared, "fr")).toEqual(["fr", "en"]);
    expect(chainOf(shared, "fr")).toBe(chainOf(shared, "fr"));
    expect(chains.size).toBe(1);
  });
});

describe("parse limits that are not numbers", () => {
  it("[I18N-REV-10] a NaN limit means the default limit, not no limit", () => {
    const deep = `${"{a, select, other {".repeat(100_000)}x${"}}".repeat(100_000)}`;
    const attempt = (options: { maxDepth?: number; maxNodes?: number; maxLength?: number }) => {
      try {
        parseMessage(deep, options);
      } catch (error) {
        return error;
      }
      return undefined;
    };
    for (const options of [
      { maxDepth: Number.NaN, maxNodes: Number.NaN, maxLength: Number.NaN },
      { maxDepth: Number.NaN },
    ]) {
      const error = attempt({ ...options, maxLength: 10_000_000 });
      expect(error).toBeInstanceOf(MessageSyntaxError);
    }
    const tooLong = attempt({ maxLength: Number.NaN });
    expect(tooLong).toBeInstanceOf(MessageSyntaxError);
    expect((tooLong as MessageSyntaxError).syntaxCode).toBe("MESSAGE_TOO_LONG");
  });
});

describe("catalog validation at creation", () => {
  it("[I18N-REV-11] the onError callback that receives the validation issues runs untracked", () => {
    const [source, setSource] = useSignal(0);
    let created = 0;
    let issues = 0;
    const stop = createRoot((dispose) => {
      // A computation that creates the instance must not depend on what the callback reads.
      useEffect(() => {
        created += 1;
        createI18nFull({
          defaultLocale: "en",
          locales: ["en", "fr"],
          messages: { en: { a: "Hi {name}" }, fr: { a: "Salut" } },
          syncDocument: false,
          validate: true,
          onError: () => {
            issues += 1;
            source();
          },
        });
      });
      return dispose;
    });
    flushSync();
    expect(issues).toBeGreaterThan(0);
    setSource(1);
    flushSync();
    expect(created).toBe(1);
    stop();
  });
});

describe("the compile option", () => {
  it("[I18N-REV-12] runs untracked: its reads do not subscribe the reader that triggered the compile", () => {
    const [source, setSource] = useSignal(0);
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: { a: "Hi {name}" } },
      syncDocument: false,
      compile: (text) => {
        source();
        return plainMessage(text);
      },
    });
    let runs = 0;
    const stop = createRoot((dispose) => {
      const read = (): void => {
        runs += 1;
        i18n.t("a", { name: "x" });
      };
      useEffect(read);
      return dispose;
    });
    flushSync();
    setSource(1);
    flushSync();
    expect(runs).toBe(1);
    stop();
  });
});
