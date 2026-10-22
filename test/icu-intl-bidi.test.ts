import { describe, expect, it } from "vitest";
import { createI18nFull } from "../src/full";
import { icuCompile, icuCompiler } from "../src/icu/compile";
import { type FormatOptions, formatToParts, formatToString } from "../src/icu/format";
import { parseMessage } from "../src/icu/parse";
import { createI18nWithIcu } from "../src/with-icu";
import { makeCtx } from "./support/ctx";

const FSI = "⁨";
const PDI = "⁩";
const WHEN = new Date(Date.UTC(2024, 2, 5, 23, 30, 15));

function run(
  source: string,
  values: object | undefined,
  locale = "en",
  options?: FormatOptions,
  extra: Parameters<typeof makeCtx>[1] = {},
): string {
  const { ctx, reports } = makeCtx(locale, extra);
  const out = formatToString(parseMessage(source), values, ctx, options);
  expect(reports).toEqual([]);
  return out;
}

describe("number, date and time arguments go through Intl", () => {
  const NUMBERS: ReadonlyArray<readonly [style: string, options: Intl.NumberFormatOptions]> = [
    ["", {}],
    [", percent", { style: "percent" }],
    [", integer", { maximumFractionDigits: 0 }],
    [", ::percent", { style: "percent" }],
    [", ::currency/EUR", { style: "currency", currency: "EUR" }],
    [
      ", ::currency/USD .00",
      { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 },
    ],
    [", ::compact-short", { notation: "compact", compactDisplay: "short" }],
    [", ::compact-long", { notation: "compact", compactDisplay: "long" }],
    [", ::unit/kilometer-per-hour", { style: "unit", unit: "kilometer-per-hour" }],
    [", ::scientific", { notation: "scientific" }],
    [", ::sign-always", { signDisplay: "always" }],
    [", ::group-off", { useGrouping: false }],
    [", ::percent .0", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }],
  ];

  it("[I18N-380] number styles and skeletons equal Intl.NumberFormat for several locales", () => {
    for (const locale of ["en", "de", "fr", "ar", "ja", "hi", "ru"]) {
      for (const [style, options] of NUMBERS) {
        for (const value of [0, 0.256, 1234.5, -42.75, 1_234_567.891]) {
          const expected = new Intl.NumberFormat(locale, options).format(value);
          expect({
            locale,
            style,
            value,
            out: run(`{x, number${style}}`, { x: value }, locale),
          }).toEqual({ locale, style, value, out: expected });
        }
      }
    }
  });

  it("[I18N-380] fixed examples, not derived from Intl at run time", () => {
    expect(run("{x, number, percent}", { x: 0.256 })).toBe("26%");
    expect(run("{x, number, percent}", { x: 0.256 }, "de").replace(/\s/g, " ")).toBe("26 %");
    expect(run("{x, number, ::currency/EUR}", { x: 1234.5 })).toBe("€1,234.50");
    expect(run("{x, number, ::currency/EUR}", { x: 1234.5 }, "de").replace(/\s/g, " ")).toBe(
      "1.234,50 €",
    );
    expect(run("{x, number, ::currency/JPY}", { x: 1234.5 }, "ja")).toBe("￥1,235");
    expect(run("{x, number}", { x: 1234567.891 }, "en")).toBe("1,234,567.891");
    expect(run("{x, number, ::compact-short}", { x: 12_500 })).toBe("13K");
    expect(run("{x, number, integer}", { x: 2.5 })).toBe("3");
    expect(run("{x, number, ::scale/100 .0}", { x: 0.5 })).toBe("50.0");
  });

  it("[I18N-380] bigint, numeric strings and Infinity are formatted, not rejected", () => {
    expect(run("{x, number}", { x: 12345678901234567890n })).toBe("12,345,678,901,234,567,890");
    expect(run("{x, number}", { x: "1234.5" })).toBe("1,234.5");
    expect(run("{x, number}", { x: Number.POSITIVE_INFINITY })).toBe("∞");
    expect(run("{x, number}", { x: Number.NEGATIVE_INFINITY })).toBe("-∞");
    expect(run("{x, number}", { x: -0 })).toBe("-0");
    expect(run("{x, number, percent}", { x: 3n })).toBe("300%");
  });

  const DATES: ReadonlyArray<readonly [message: string, options: Intl.DateTimeFormatOptions]> = [
    ["{x, date}", { dateStyle: "medium" }],
    ["{x, date, short}", { dateStyle: "short" }],
    ["{x, date, medium}", { dateStyle: "medium" }],
    ["{x, date, long}", { dateStyle: "long" }],
    ["{x, date, full}", { dateStyle: "full" }],
    ["{x, time}", { timeStyle: "medium" }],
    ["{x, time, short}", { timeStyle: "short" }],
    ["{x, time, long}", { timeStyle: "long" }],
    ["{x, time, full}", { timeStyle: "full" }],
    ["{x, date, ::yMMMd}", { year: "numeric", month: "short", day: "numeric" }],
    [
      "{x, date, ::yMMMMEEEEd}",
      { year: "numeric", month: "long", weekday: "long", day: "numeric" },
    ],
    ["{x, date, ::yyyyMMdd}", { year: "numeric", month: "2-digit", day: "2-digit" }],
    ["{x, time, ::Hm}", { hour: "numeric", hourCycle: "h23", minute: "numeric" }],
    [
      "{x, time, ::hmsa}",
      { hour: "numeric", hourCycle: "h12", minute: "numeric", second: "numeric" },
    ],
    [
      "{x, time, ::Hmsz}",
      {
        hour: "numeric",
        hourCycle: "h23",
        minute: "numeric",
        second: "numeric",
        timeZoneName: "short",
      },
    ],
    ["{x, date, ::GyMMMd}", { era: "short", year: "numeric", month: "short", day: "numeric" }],
  ];

  it("[I18N-381] date and time styles and skeletons equal Intl.DateTimeFormat in the context time zone", () => {
    for (const locale of ["en", "de", "fr", "ar", "ja", "ru"]) {
      for (const [message, options] of DATES) {
        const expected = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(
          WHEN,
        );
        expect({
          locale,
          message,
          out: run(message, { x: WHEN }, locale, undefined, { timeZone: "UTC" }),
        }).toEqual({ locale, message, out: expected });
      }
    }
  });

  it("[I18N-381] the zone comes from the context, a timestamp or ISO string is accepted", () => {
    const tokyo = { timeZone: "Asia/Tokyo" };
    expect(run("{x, date, short}", { x: WHEN }, "en", undefined, { timeZone: "UTC" })).toBe(
      "3/5/24",
    );
    expect(run("{x, date, short}", { x: WHEN }, "en", undefined, tokyo)).toBe("3/6/24");
    expect(run("{x, date, short}", { x: WHEN.getTime() }, "en", undefined, tokyo)).toBe("3/6/24");
    expect(run("{x, date, short}", { x: WHEN.toISOString() }, "en", undefined, tokyo)).toBe(
      "3/6/24",
    );
    expect(run("{x, time, ::Hm}", { x: WHEN }, "en", undefined, tokyo)).toBe("08:30");
    expect(run("{x, date, ::yMMMMEEEEd}", { x: WHEN }, "fr", undefined, { timeZone: "UTC" })).toBe(
      "mardi 5 mars 2024",
    );
    expect(run("{x, date, long}", { x: WHEN }, "de", undefined, { timeZone: "UTC" })).toBe(
      "5. März 2024",
    );
  });

  it("[I18N-382] an Intl failure in a style is reported and falls back to readable text", () => {
    const { ctx, reports } = makeCtx("en", { timeZone: "Not/AZone" });
    expect(formatToString(parseMessage("{x, date, short}"), { x: WHEN }, ctx)).toBe(
      WHEN.toISOString(),
    );
    expect(formatToString(parseMessage("{x}"), { x: WHEN }, ctx)).toBe(WHEN.toISOString());
    expect(reports.map((report) => report.code)).toEqual(["FORMAT_FAILED", "FORMAT_FAILED"]);
  });
});

describe("bidi isolation of interpolated strings", () => {
  const RTL = ["ar", "he", "fa", "ur", "ar-EG", "az-Arab", "ps", "yi", "dv"];
  const LTR = ["en", "fr", "de", "ja", "zh-Hans", "tr", "ru", "hi", "az-Latn"];

  it("[I18N-383] in a right-to-left locale a string value is wrapped in FSI and PDI", () => {
    for (const locale of RTL) {
      expect({ locale, out: run("Hello {name}!", { name: "Ada" }, locale) }).toEqual({
        locale,
        out: `Hello ${FSI}Ada${PDI}!`,
      });
    }
    // Each interpolation is fenced on its own.
    expect(run("{a} and {b}", { a: "x", b: "y" }, "ar")).toBe(`${FSI}x${PDI} and ${FSI}y${PDI}`);
    // Values with their own direction marks are still fenced once.
    expect(run("{a}", { a: "‫مرحبا‬" }, "he")).toBe(`${FSI}‫مرحبا‬${PDI}`);
    // Inside plural, select and tag content.
    expect(run("{n, plural, other {{who} has #}}", { n: 2, who: "Ada" }, "ar")).toBe(
      `${FSI}Ada${PDI} has ${new Intl.NumberFormat("ar").format(2)}`,
    );
    expect(run("{s, select, a {{who}} other {-}}", { s: "a", who: "Bob" }, "fa")).toBe(
      `${FSI}Bob${PDI}`,
    );
  });

  it("[I18N-383] only non-empty string values are wrapped, nothing else is", () => {
    const out = (source: string, values: object): string => run(source, values, "ar");
    expect(out("[{x}]", { x: "" })).toBe("[]");
    expect(out("[{x}]", { x: 5 })).toBe("[5]");
    expect(out("[{x}]", { x: 5n })).toBe("[5]");
    expect(out("[{x}]", { x: true })).toBe("[true]");
    expect(out("[{x}]", { x: -0 })).toBe("[0]");
    expect(out("[{x, select, a {A} other {O}}]", { x: "a" })).toBe("[A]");
    // A function value is an accessor: the string it returns is wrapped.
    expect(out("[{x}]", { x: () => "Ada" })).toBe(`[${FSI}Ada${PDI}]`);
    // Literal text of the message is never wrapped, also when it is Arabic.
    expect(out("مرحبا {x}", { x: "Ada" })).toBe(`مرحبا ${FSI}Ada${PDI}`);
    // A missing value shows the placeholder, which is not a value.
    const { ctx, reports } = makeCtx("ar");
    expect(formatToString(parseMessage("[{x}]"), {}, ctx)).toBe("[{x}]");
    expect(reports.map((report) => report.code)).toEqual(["MISSING_VALUE"]);
    // Numbers, dates and times formatted by Intl carry their own direction handling.
    const { ctx: dateCtx } = makeCtx("ar");
    expect(formatToString(parseMessage("{d, date, short}"), { d: WHEN }, dateCtx)).not.toContain(
      FSI,
    );
    expect(formatToString(parseMessage("{n, number}"), { n: 12 }, dateCtx)).not.toContain(FSI);
  });

  it("[I18N-384] left-to-right output is unchanged by default, byte for byte", () => {
    for (const locale of LTR) {
      expect({ locale, out: run("Hello {name}!", { name: "Ada" }, locale) }).toEqual({
        locale,
        out: "Hello Ada!",
      });
      // Even with an RTL value in it: the default does not touch left-to-right messages.
      const hebrew = "שלום";
      expect(run("Hi {name}", { name: hebrew }, locale)).toBe(`Hi ${hebrew}`);
      expect(run("Hi {name}", { name: hebrew }, locale, {})).toBe(`Hi ${hebrew}`);
      expect(run("Hi {name}", { name: hebrew }, locale, { isolation: "auto" })).toBe(
        `Hi ${hebrew}`,
      );
    }
    expect(run("Hi {name}", { name: "x" }, "en")).not.toContain(FSI);
    // A locale tag Intl rejects is treated as left to right.
    expect(run("Hi {name}", { name: "x" }, "not a locale!")).toBe("Hi x");
    expect(run("Hi {name}", { name: "x" }, "")).toBe("Hi x");
  });

  it("[I18N-384] the isolation option: always isolates also left-to-right, never removes it", () => {
    expect(run("Hi {n}", { n: "Ada" }, "en", { isolation: "always" })).toBe(`Hi ${FSI}Ada${PDI}`);
    expect(run("Hi {n}", { n: "Ada" }, "ja", { isolation: "always" })).toBe(`Hi ${FSI}Ada${PDI}`);
    expect(run("Hi {n}", { n: "Ada" }, "ar", { isolation: "always" })).toBe(`Hi ${FSI}Ada${PDI}`);
    expect(run("Hi {n}", { n: "Ada" }, "ar", { isolation: "never" })).toBe("Hi Ada");
    expect(run("Hi {n}", { n: "Ada" }, "he", { isolation: "never" })).toBe("Hi Ada");
    expect(run("Hi {n}", { n: "Ada" }, "en", { isolation: "never" })).toBe("Hi Ada");
    expect(run("Hi {n}", { n: "Ada" }, "ar", { isolation: "auto" })).toBe(`Hi ${FSI}Ada${PDI}`);
    // An unknown value behaves as "auto".
    const unknown = { isolation: "sideways" } as unknown as FormatOptions;
    expect(run("Hi {n}", { n: "Ada" }, "en", unknown)).toBe("Hi Ada");
    expect(run("Hi {n}", { n: "Ada" }, "ar", unknown)).toBe(`Hi ${FSI}Ada${PDI}`);
  });

  it("[I18N-385] rich parts and the compiled message apply the same rule", () => {
    const { ctx } = makeCtx("ar");
    const parts = formatToParts(
      parseMessage("<b>{name}</b> {n, plural, other {#}}"),
      { name: "Ada", n: 1 },
      { b: (chunks) => ({ bold: chunks }) },
      ctx,
    );
    expect(parts[0]).toEqual({ bold: [`${FSI}Ada${PDI}`] });
    const { ctx: enCtx } = makeCtx("en");
    expect(
      formatToParts(parseMessage("<b>{name}</b>"), { name: "Ada" }, { b: (c) => c }, enCtx),
    ).toEqual([["Ada"]]);
    expect(
      formatToParts(parseMessage("<b>{name}</b>"), { name: "Ada" }, { b: (c) => c }, enCtx, {
        isolation: "always",
      }),
    ).toEqual([[`${FSI}Ada${PDI}`]]);

    const message = icuCompile("Hi {name}");
    expect(message.format({ name: "Ada" }, makeCtx("ar").ctx)).toBe(`Hi ${FSI}Ada${PDI}`);
    expect(message.format({ name: "Ada" }, makeCtx("en").ctx)).toBe("Hi Ada");
    const forced = icuCompile("Hi {name}", undefined, { isolation: "always" });
    expect(forced.format({ name: "Ada" }, makeCtx("en").ctx)).toBe(`Hi ${FSI}Ada${PDI}`);
    expect(forced.parts({ name: "Ada" }, undefined, makeCtx("en").ctx)).toEqual([
      `Hi ${FSI}Ada${PDI}`,
    ]);
    const compile = icuCompiler({ tags: false }, { isolation: "never" });
    expect(compile("<b>{name}</b>").format({ name: "Ada" }, makeCtx("ar").ctx)).toBe("<b>Ada</b>");
  });
});

describe("the format option of the ICU factories", () => {
  const messages = { en: { hi: "Hi {n}" }, ar: { hi: "مرحبا {n}" } } as const;

  it("[I18N-500] createI18nWithIcu and createI18nFull pass `format` to the compiler; the default leaves English unchanged", () => {
    const base = {
      defaultLocale: "en" as const,
      locales: ["en", "ar"] as const,
      messages,
      syncDocument: false,
    };
    const plain = createI18nWithIcu(base);
    expect(plain.translate("hi", { n: "Ada" })).toBe("Hi Ada");
    expect(plain.fork("ar").translate("hi", { n: "Ada" })).toBe(`مرحبا ${FSI}Ada${PDI}`);

    const always = createI18nWithIcu({ ...base, format: { isolation: "always" } });
    expect(always.translate("hi", { n: "Ada" })).toBe(`Hi ${FSI}Ada${PDI}`);

    const never = createI18nFull({ ...base, format: { isolation: "never" } });
    expect(never.translate("hi", { n: "Ada" })).toBe("Hi Ada");
    expect(never.fork("ar").translate("hi", { n: "Ada" })).toBe("مرحبا Ada");
  });
});
