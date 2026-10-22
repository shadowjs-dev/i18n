import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { I18nError } from "../src/errors";
import { createI18nFull as createI18n } from "../src/full";
import type { DisplayNameOptions, I18n, RelativeOptions } from "../src/i18n-types";
import { createIntlCache, INTL_CACHE_SIZE, intlSupport } from "../src/intl";

/** The moment every date test formats: 2024-01-15 22:30:05 UTC. */
const MOMENT = new Date(Date.UTC(2024, 0, 15, 22, 30, 5));
const NOW = Date.UTC(2024, 5, 15, 12, 0, 0);

/** Replaces every kind of space, including the narrow no-break space newer ICU puts before AM/PM. */
const plain = (text: string): string => text.replace(/\s/g, " ");

interface Made {
  readonly i18n: I18n<string, Record<never, never>>;
  readonly errors: I18nError[];
}

function make(
  locale: string,
  extra: { readonly timeZone?: string; readonly messages?: boolean } = {},
): Made {
  const errors: I18nError[] = [];
  const i18n = createI18n({
    defaultLocale: "en",
    locales: locale === "en" ? ["en"] : ["en", locale],
    locale,
    timeZone: extra.timeZone ?? "UTC",
    now: () => NOW,
    syncDocument: false,
    onError: (error) => errors.push(error),
  }) as unknown as I18n<string, Record<never, never>>;
  return { i18n, errors };
}

const IntlRecord = Intl as unknown as Record<string, unknown>;

/** Runs `run` with `Intl[name]` removed, and puts the original back whatever happens. */
function withoutIntl<T>(name: string, run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(Intl, name);
  Object.defineProperty(Intl, name, { value: undefined, configurable: true, writable: true });
  try {
    return run();
  } finally {
    if (original === undefined) Reflect.deleteProperty(IntlRecord, name);
    else Object.defineProperty(Intl, name, original);
  }
}

describe("number formatting", () => {
  const table: ReadonlyArray<
    readonly [
      locale: string,
      value: number,
      format: Intl.NumberFormatOptions | string,
      text: string,
    ]
  > = [
    ["en", 0.256, "percent", "26%"],
    ["en", 0.256, { style: "percent", maximumFractionDigits: 1 }, "25.6%"],
    ["en", 1_234_567, { notation: "compact" }, "1.2M"],
    ["en", 1_234_567, { notation: "compact", compactDisplay: "long" }, "1.2 million"],
    ["de", 1_234_567, { notation: "compact", compactDisplay: "long" }, "1,2 Millionen"],
    ["en", 88, { style: "unit", unit: "kilometer-per-hour" }, "88 km/h"],
    ["en", 3, { style: "unit", unit: "liter", unitDisplay: "long" }, "3 liters"],
    ["de", 12.5, { style: "unit", unit: "kilometer" }, "12,5 km"],
    ["en", 1234.5, { style: "currency", currency: "USD" }, "$1,234.50"],
    ["en", 1234.5, { style: "currency", currency: "USD", currencyDisplay: "code" }, "USD 1,234.50"],
    [
      "en",
      1234.5,
      { style: "currency", currency: "USD", currencyDisplay: "name" },
      "1,234.50 US dollars",
    ],
    [
      "en",
      1234.5,
      { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol" },
      "$1,234.50",
    ],
    // Currencies without minor units and with three.
    ["en", 1234.5, { style: "currency", currency: "JPY" }, "¥1,235"],
    ["en", 1234.4, { style: "currency", currency: "JPY" }, "¥1,234"],
    ["en", 1234.5, { style: "currency", currency: "KWD" }, "KWD 1,234.500"],
    ["en", 5, { style: "currency", currency: "EUR", minimumFractionDigits: 0 }, "€5"],
    ["en", 1234.5, "integer", "1,235"],
    ["en", Number.POSITIVE_INFINITY, undefined as never, "∞"],
    ["en", -0, undefined as never, "-0"],
  ];

  it.each(table)("[I18N-427] %s formats %s with %j as %j", (locale, value, format, expected) => {
    const { i18n, errors } = make(locale);
    expect(plain(i18n.formatNumber(value, format as never))).toBe(
      plain(expected).replace("‏", plain("‏")),
    );
    expect(errors).toEqual([]);
  });

  it("[I18N-427] numeric strings and bigints are accepted; other values are reported and shown as text", () => {
    const { i18n, errors } = make("en");
    expect(i18n.formatNumber("1234.5" as never)).toBe("1,234.5");
    expect(i18n.formatNumber(12_345_678_901_234_567_890n as never)).toBe(
      "12,345,678,901,234,567,890",
    );
    expect(errors).toEqual([]);
    expect(i18n.formatNumber("abc" as never)).toBe("abc");
    expect(i18n.formatNumber(null as never)).toBe("null");
    expect(errors.map((error) => error.code)).toEqual(["INVALID_VALUE", "INVALID_VALUE"]);
    expect(errors[0]?.message).toContain('got "abc"');
    expect(errors[1]?.message).toContain("got null");
    // NaN is a different problem again; the same value is reported once.
    i18n.formatNumber("abc" as never);
    i18n.formatNumber(Number.NaN);
    i18n.formatNumber(Number.NaN);
    expect(errors).toHaveLength(3);
    expect(errors[2]?.message).toContain("got NaN");
  });

  it("[I18N-427] a bad option is a FORMAT_FAILED report and the plain number, never a throw", () => {
    const { i18n, errors } = make("en");
    expect(i18n.formatNumber(5, { style: "currency" })).toBe("5");
    expect(i18n.formatNumber(5, { style: "currency", currency: "not-a-code" })).toBe("5");
    expect(i18n.formatNumber(5, { style: "unit", unit: "parsec" })).toBe("5");
    expect(i18n.formatNumber(5, { minimumFractionDigits: 101 })).toBe("5");
    expect(i18n.formatNumber(5, "nope")).toBe("5");
    expect(errors.map((error) => error.code)).toEqual(Array(5).fill("FORMAT_FAILED"));
  });
});

describe("numbering systems and calendars", () => {
  it("[I18N-428] digits follow the locale and the -u-nu- extension", () => {
    expect(make("ar-EG").i18n.formatNumber(1234567.89)).toBe("١٬٢٣٤٬٥٦٧٫٨٩");
    expect(make("ar-EG-u-nu-latn").i18n.formatNumber(1234.5)).toBe("1,234.5");
    expect(make("en-u-nu-arab").i18n.formatNumber(1234.5)).toBe("١٬٢٣٤٫٥");
    expect(make("en-u-nu-deva").i18n.formatNumber(1234)).toBe("१,२३४");
    expect(make("fa").i18n.formatNumber(1234.5)).toBe("۱٬۲۳۴٫۵");
    expect(make("fa-IR").i18n.formatNumber(0.5, "percent")).toBe("۵۰٪");
    expect(make("ar-EG").i18n.formatDate(MOMENT, "long")).toBe("١٥ يناير ٢٠٢٤");
    expect(make("en-u-nu-arab").i18n.formatDate(MOMENT, { year: "numeric" })).toBe("٢٠٢٤");
  });

  const calendars: ReadonlyArray<readonly [locale: string, expected: string]> = [
    ["hi", "15 जनवरी 2024"],
    ["th-u-ca-buddhist", "15 มกราคม 2567"],
    ["ja-u-ca-japanese", "令和6年1月15日"],
    ["fa-IR", "۲۵ دی ۱۴۰۲"],
    ["en", "January 15, 2024"],
    ["en-u-ca-persian", "Dey 25, 1402 AP"],
    ["en-u-ca-hebrew", "5 Shevat 5784"],
  ];

  it.each(calendars)("[I18N-428] %s long date is %s", (locale, expected) => {
    const { i18n, errors } = make(locale);
    expect(i18n.formatDate(MOMENT, "long")).toBe(expected);
    expect(errors).toEqual([]);
  });
});

describe("date and time formatting", () => {
  it("[I18N-429] dateStyle, timeStyle and the named built-in styles", () => {
    const { i18n } = make("en");
    expect(plain(i18n.formatDate(MOMENT))).toBe("Jan 15, 2024");
    expect(plain(i18n.formatDate(MOMENT, "short"))).toBe("1/15/24");
    expect(plain(i18n.formatDate(MOMENT, "medium"))).toBe("Jan 15, 2024");
    expect(plain(i18n.formatDate(MOMENT, "long"))).toBe("January 15, 2024");
    expect(plain(i18n.formatDate(MOMENT, "full"))).toBe("Monday, January 15, 2024");
    expect(plain(i18n.formatDate(MOMENT, { dateStyle: "full", timeStyle: "long" }))).toBe(
      "Monday, January 15, 2024 at 10:30:05 PM UTC",
    );
    expect(plain(i18n.formatDate(MOMENT, { timeStyle: "short" }))).toBe("10:30 PM");
    expect(plain(i18n.formatDate(MOMENT, { weekday: "long" }))).toBe("Monday");
    expect(plain(i18n.formatDate(MOMENT, { month: "long", year: "numeric" }))).toBe("January 2024");
  });

  it("[I18N-429] hourCycle and hour12 choose the clock", () => {
    const { i18n } = make("en");
    const clock = { hour: "numeric", minute: "2-digit" } as const;
    expect(plain(i18n.formatDate(MOMENT, { ...clock, hourCycle: "h23" }))).toBe("22:30");
    expect(plain(i18n.formatDate(MOMENT, { ...clock, hourCycle: "h12" }))).toBe("10:30 PM");
    expect(plain(i18n.formatDate(MOMENT, { ...clock, hour12: false }))).toBe("22:30");
    const midnight = new Date(Date.UTC(2024, 0, 15, 0, 5));
    expect(plain(i18n.formatDate(midnight, { ...clock, hourCycle: "h23" }))).toBe("00:05");
    expect(plain(i18n.formatDate(midnight, { ...clock, hourCycle: "h24" }))).toBe("24:05");
    expect(plain(make("de").i18n.formatDate(MOMENT, { ...clock }))).toBe("22:30");
  });

  it("[I18N-429] dates may be Date objects, timestamps or ISO strings", () => {
    const { i18n, errors } = make("en");
    const expected = i18n.formatDate(MOMENT, "long");
    expect(i18n.formatDate(MOMENT.getTime(), "long")).toBe(expected);
    expect(i18n.formatDate(MOMENT.toISOString(), "long")).toBe(expected);
    expect(i18n.formatDate(0, "short")).toBe("1/1/70");
    expect(errors).toEqual([]);
    for (const bad of ["", "not a date", Number.NaN, new Date(Number.NaN), null, {}, true]) {
      expect(i18n.formatDate(bad as never)).toBe(String(bad));
    }
    expect(new Set(errors.map((error) => error.code))).toEqual(new Set(["INVALID_VALUE"]));
  });

  it("[I18N-430] time zones: the instance zone is the default and an option wins", () => {
    const full = { dateStyle: "medium", timeStyle: "short" } as const;
    expect(plain(make("en").i18n.formatDate(MOMENT, full))).toBe("Jan 15, 2024, 10:30 PM");
    expect(plain(make("en", { timeZone: "Asia/Riyadh" }).i18n.formatDate(MOMENT, full))).toBe(
      "Jan 16, 2024, 1:30 AM",
    );
    expect(plain(make("en", { timeZone: "America/New_York" }).i18n.formatDate(MOMENT, full))).toBe(
      "Jan 15, 2024, 5:30 PM",
    );
    expect(
      plain(
        make("en", { timeZone: "America/New_York" }).i18n.formatDate(MOMENT, {
          ...full,
          timeZone: "Asia/Riyadh",
        }),
      ),
    ).toBe("Jan 16, 2024, 1:30 AM");
    // Daylight saving time moves the offset by the date, not by the zone name.
    const summer = new Date(Date.UTC(2024, 6, 15, 22, 30));
    expect(plain(make("en", { timeZone: "America/New_York" }).i18n.formatDate(summer, full))).toBe(
      "Jul 15, 2024, 6:30 PM",
    );
    expect(plain(make("en", { timeZone: "Asia/Riyadh" }).i18n.formatDate(summer, full))).toBe(
      "Jul 16, 2024, 1:30 AM",
    );
  });

  it("[I18N-430] an invalid time zone is reported and the date is shown as an ISO string", () => {
    const perCall = make("en");
    expect(perCall.i18n.formatDate(MOMENT, { timeStyle: "short", timeZone: "Mars/Base" })).toBe(
      "2024-01-15T22:30:05.000Z",
    );
    expect(perCall.errors).toHaveLength(1);
    expect(perCall.errors[0]?.code).toBe("FORMAT_FAILED");
    expect(perCall.errors[0]?.message).toContain("formatDate");
    expect(perCall.errors[0]?.message).toContain("Mars/Base");
    // Repeating it is not reported again, and other formats keep working.
    perCall.i18n.formatDate(MOMENT, { timeStyle: "short", timeZone: "Mars/Base" });
    expect(perCall.errors).toHaveLength(1);
    expect(plain(perCall.i18n.formatDate(MOMENT, "long"))).toBe("January 15, 2024");

    const instanceWide = make("en", { timeZone: "Not/AZone" });
    expect(instanceWide.i18n.formatDate(MOMENT, "long")).toBe("2024-01-15T22:30:05.000Z");
    expect(instanceWide.errors.map((error) => error.code)).toEqual(["FORMAT_FAILED"]);
    // An explicit valid zone rescues a call on an instance with a bad default.
    expect(
      plain(instanceWide.i18n.formatDate(MOMENT, { dateStyle: "long", timeZone: "UTC" })),
    ).toBe("January 15, 2024");
  });
});

describe("relative time, lists and display names", () => {
  const relative: ReadonlyArray<
    readonly [
      locale: string,
      offsetSeconds: number,
      options: RelativeOptions | undefined,
      text: string,
    ]
  > = [
    ["en", 0, undefined, "now"],
    ["en", -30, undefined, "30 seconds ago"],
    ["en", 1, undefined, "in 1 second"],
    ["en", -90, undefined, "2 minutes ago"],
    ["en", 90, undefined, "in 2 minutes"],
    ["en", -20, { unit: "minute", numeric: "always" }, "0 minutes ago"],
    ["en", 20, { unit: "minute", numeric: "always" }, "in 0 minutes"],
    ["en", -20, { unit: "minute" }, "this minute"],
    ["en", 3 * 3600, undefined, "in 3 hours"],
    ["en", -86_400, undefined, "yesterday"],
    ["en", 86_400, undefined, "tomorrow"],
    ["en", -86_400, { numeric: "always" }, "1 day ago"],
    ["en", 2 * 86_400, undefined, "in 2 days"],
    ["en", -14 * 86_400, undefined, "2 weeks ago"],
    ["en", -400 * 86_400, undefined, "last year"],
    ["en", 800 * 86_400, undefined, "in 2 years"],
    ["en", -5 * 60, { style: "short" }, "5 min. ago"],
    ["en", -5 * 60, { style: "narrow" }, "5m ago"],
    ["en", -5 * 3600, { unit: "minute" }, "300 minutes ago"],
    ["en", -5 * 3600, { unit: "minutes" }, "300 minutes ago"],
    ["en", 3 * 86_400, { unit: "hour", numeric: "always" }, "in 72 hours"],
    ["en", -100 * 86_400, { unit: "quarter" }, "last quarter"],
    ["en", -100 * 86_400, { unit: "quarter", numeric: "always" }, "1 quarter ago"],
    ["en", 0, { unit: "day" }, "today"],
    ["en", 0, { unit: "day", numeric: "always" }, "in 0 days"],
    ["de", -3 * 86_400, undefined, "vor 3 Tagen"],
    ["ar", -3 * 86_400, undefined, "قبل 3 أيام"],
    ["ja", -3 * 86_400, undefined, "3 日前"],
  ];

  it.each(relative)("[I18N-431] %s relative %is %j is %j", (locale, seconds, options, expected) => {
    const { i18n, errors } = make(locale);
    expect(plain(i18n.formatRelative(NOW + seconds * 1000, options))).toBe(plain(expected));
    expect(errors).toEqual([]);
  });

  it("[I18N-431] a Date, an explicit reference time, and bad input", () => {
    const { i18n, errors } = make("en");
    expect(i18n.formatRelative(new Date(NOW - 7_200_000))).toBe("2 hours ago");
    expect(i18n.formatRelative(NOW + 60_000, { now: NOW + 3_600_000 })).toBe("59 minutes ago");
    expect(i18n.formatRelative(NOW + 60_000, { now: new Date(NOW + 3_600_000) })).toBe(
      "59 minutes ago",
    );
    expect(errors).toEqual([]);
    expect(i18n.formatRelative(Number.NaN)).toBe("NaN");
    expect(i18n.formatRelative(Number.POSITIVE_INFINITY)).toBe("Infinity");
    expect(i18n.formatRelative(0, { now: Number.NaN })).toBe("0");
    expect(i18n.formatRelative(new Date(Number.NaN))).toBe("Invalid Date");
    expect(new Set(errors.map((error) => error.code))).toEqual(new Set(["INVALID_VALUE"]));
  });

  it("[I18N-431] an unknown unit is reported and the unit follows from the distance", () => {
    const odd = make("en");
    for (const unit of ["fortnight", "constructor", "", "s", 5, null, {}]) {
      expect(odd.i18n.formatRelative(NOW - 86_400_000, { unit: unit as never }), String(unit)).toBe(
        "yesterday",
      );
    }
    expect(odd.errors.map((error) => error.code)).toEqual(Array(7).fill("FORMAT_FAILED"));
    expect(odd.errors[0]?.message).toContain('unknown unit "fortnight"');
  });

  it("[I18N-431] property: past and future of the same distance are mirror images", () => {
    const { i18n } = make("en");
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.constantFrom(undefined, "second", "minute", "hour", "day", "week", "month", "year"),
        (seconds, unit) => {
          const options = { numeric: "always", ...(unit === undefined ? {} : { unit }) } as const;
          const future = i18n.formatRelative(NOW + seconds * 1000, options);
          const past = i18n.formatRelative(NOW - seconds * 1000, options);
          expect(future.replace(/^in /, "")).toBe(past.replace(/ ago$/, ""));
          return true;
        },
      ),
      { seed: 20261013, numRuns: 300 },
    );
  });

  it("[I18N-432] lists: conjunction, disjunction and unit, in several locales", () => {
    const { i18n, errors } = make("en");
    const items = ["a", "b", "c"];
    expect(i18n.formatList(items)).toBe("a, b, and c");
    expect(i18n.formatList(items, { type: "conjunction" })).toBe("a, b, and c");
    expect(i18n.formatList(items, { type: "disjunction" })).toBe("a, b, or c");
    expect(i18n.formatList(items, { type: "unit" })).toBe("a, b, c");
    expect(i18n.formatList(items, { type: "unit", style: "narrow" })).toBe("a b c");
    expect(i18n.formatList(items, { style: "short" })).toBe("a, b, & c");
    expect(i18n.formatList(["a", "b"])).toBe("a and b");
    expect(i18n.formatList(["a"])).toBe("a");
    expect(i18n.formatList([])).toBe("");
    expect(i18n.formatList(new Set(["x", "y"]))).toBe("x and y");
    expect(make("de").i18n.formatList(items)).toBe("a, b und c");
    expect(make("es").i18n.formatList(items, { type: "disjunction" })).toBe("a, b o c");
    expect(make("ar").i18n.formatList(items)).toBe("a وb وc");
    expect(errors).toEqual([]);
    expect(i18n.formatList(items, "missing")).toBe("a, b, and c");
    expect(i18n.formatList(items, { type: "bogus" as never })).toBe("a, b, c");
    expect(errors.map((error) => error.code)).toEqual(["FORMAT_FAILED", "FORMAT_FAILED"]);
  });

  const names: ReadonlyArray<
    readonly [locale: string, code: string, options: DisplayNameOptions, text: string]
  > = [
    ["en", "SA", { type: "region" }, "Saudi Arabia"],
    ["de", "JP", { type: "region" }, "Japan"],
    ["ar", "SA", { type: "region" }, "المملكة العربية السعودية"],
    ["en", "fr", { type: "language" }, "French"],
    ["fr", "de", { type: "language" }, "allemand"],
    ["en", "en-GB", { type: "language" }, "British English"],
    ["en", "en-GB", { type: "language", languageDisplay: "standard" }, "English (United Kingdom)"],
    ["en", "JPY", { type: "currency" }, "Japanese Yen"],
    ["en", "EUR", { type: "currency", style: "short" }, "Euro"],
    ["en", "Arab", { type: "script" }, "Arabic"],
    ["fr", "Latn", { type: "script" }, "latin"],
    ["en", "gregory", { type: "calendar" }, "Gregorian Calendar"],
    ["en", "month", { type: "dateTimeField" }, "month"],
    // A code `Intl` does not know comes back as it was written.
    ["en", "zz", { type: "region" }, "zz"],
    ["en", "ZZ", { type: "region" }, "Unknown Region"],
  ];

  it.each(names)("[I18N-432] %s display name of %s %j is %j", (locale, code, options, expected) => {
    const { i18n, errors } = make(locale);
    expect(i18n.formatDisplayName(code, options)).toBe(expected);
    expect(errors).toEqual([]);
  });

  it("[I18N-432] a malformed code is reported and shown as written", () => {
    const { i18n, errors } = make("en");
    expect(i18n.formatDisplayName("zz-invalid-code!", { type: "region" })).toBe("zz-invalid-code!");
    expect(i18n.formatDisplayName("12", { type: "currency" })).toBe("12");
    expect(i18n.formatDisplayName("", { type: "language" })).toBe("");
    expect(errors.map((error) => error.code)).toEqual([
      "FORMAT_FAILED",
      "FORMAT_FAILED",
      "FORMAT_FAILED",
    ]);
  });
});

describe("Intl feature detection and fallbacks", () => {
  it("[I18N-433] intlSupport reports each constructor, live", () => {
    expect(intlSupport()).toEqual({
      numberFormat: true,
      dateTimeFormat: true,
      pluralRules: true,
      listFormat: true,
      relativeTimeFormat: true,
      displayNames: true,
      locale: true,
      supportedValuesOf: true,
    });
    const features = [
      ["NumberFormat", "numberFormat"],
      ["DateTimeFormat", "dateTimeFormat"],
      ["PluralRules", "pluralRules"],
      ["ListFormat", "listFormat"],
      ["RelativeTimeFormat", "relativeTimeFormat"],
      ["DisplayNames", "displayNames"],
      ["Locale", "locale"],
      ["supportedValuesOf", "supportedValuesOf"],
    ] as const;
    for (const [global, field] of features) {
      const seen = withoutIntl(global, () => intlSupport());
      expect(seen[field], field).toBe(false);
      expect(
        Object.entries(seen)
          .filter(([, present]) => !present)
          .map(([name]) => name),
      ).toEqual([field]);
      expect(intlSupport()[field], `${field} restored`).toBe(true);
    }
  });

  it("[I18N-434] without Intl.ListFormat lists are joined with commas, reported once", () => {
    const { i18n, errors } = make("en");
    withoutIntl("ListFormat", () => {
      expect(i18n.formatList(["a", "b", "c"])).toBe("a, b, c");
      expect(i18n.formatList(["x", "y"], { type: "disjunction" })).toBe("x, y");
      expect(i18n.formatList([])).toBe("");
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("FORMAT_FAILED");
    expect(errors[0]?.message).toContain("Intl.ListFormat is not available");
    // Back to normal once the feature is back, with no leftover state.
    expect(i18n.formatList(["a", "b", "c"])).toBe("a, b, and c");
  });

  it("[I18N-434] without Intl.RelativeTimeFormat the text is plain English, reported once", () => {
    const { i18n, errors } = make("de");
    withoutIntl("RelativeTimeFormat", () => {
      expect(i18n.formatRelative(NOW - 3 * 86_400_000)).toBe("3 days ago");
      expect(i18n.formatRelative(NOW + 3_600_000)).toBe("in 1 hour");
      expect(i18n.formatRelative(NOW + 2 * 3_600_000)).toBe("in 2 hours");
      expect(i18n.formatRelative(NOW)).toBe("now");
      expect(i18n.formatRelative(NOW - 400 * 86_400_000, { unit: "year" })).toBe("1 year ago");
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("Intl.RelativeTimeFormat is not available");
    expect(i18n.formatRelative(NOW - 3 * 86_400_000)).toBe("vor 3 Tagen");
  });

  it("[I18N-434] without Intl.DisplayNames the code is shown, reported once", () => {
    const { i18n, errors } = make("en");
    withoutIntl("DisplayNames", () => {
      expect(i18n.formatDisplayName("SA", { type: "region" })).toBe("SA");
      expect(i18n.formatDisplayName("fr", { type: "language" })).toBe("fr");
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("Intl.DisplayNames is not available");
    expect(i18n.formatDisplayName("SA", { type: "region" })).toBe("Saudi Arabia");
  });

  it("[I18N-434] without Intl.PluralRules a plural message uses its other clause, reported once", () => {
    const errors: I18nError[] = [];
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: { items: "{count, plural, one {# item} other {# items}}" } },
      syncDocument: false,
      onError: (error) => errors.push(error),
    });
    expect(i18n.t("items", { count: 1 })).toBe("1 item");
    expect(errors).toEqual([]);
    withoutIntl("PluralRules", () => {
      const fresh = createI18n({
        defaultLocale: "en",
        locales: ["en"],
        messages: { en: { items: "{count, plural, one {# item} other {# items}}" } },
        syncDocument: false,
        onError: (error) => errors.push(error),
      });
      expect(fresh.t("items", { count: 1 })).toBe("1 items");
      expect(fresh.t("items", { count: 5 })).toBe("5 items");
      expect(intlSupport().pluralRules).toBe(false);
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("FORMAT_FAILED");
    expect(errors[0]?.message).toContain("PluralRules");
    expect(i18n.t("items", { count: 1 })).toBe("1 item");
  });

  it("[I18N-434] each missing feature has its own report, and numbers and dates keep working", () => {
    const { i18n, errors } = make("en");
    withoutIntl("ListFormat", () =>
      withoutIntl("DisplayNames", () =>
        withoutIntl("RelativeTimeFormat", () => {
          i18n.formatList(["a"]);
          i18n.formatDisplayName("SA", { type: "region" });
          i18n.formatRelative(NOW - 1000);
          expect(i18n.formatNumber(1234.5)).toBe("1,234.5");
          expect(plain(i18n.formatDate(MOMENT, "long"))).toBe("January 15, 2024");
          expect(i18n.dir("ar")).toBe("rtl");
        }),
      ),
    );
    expect(errors.map((error) => error.message.split(":")[0])).toEqual([
      "[shadow-i18n FORMAT_FAILED] formatList",
      "[shadow-i18n FORMAT_FAILED] formatDisplayName",
      "[shadow-i18n FORMAT_FAILED] formatRelative",
    ]);
  });

  it("[I18N-434] without Intl.Locale the direction still comes from the language list", () => {
    withoutIntl("Locale", () => {
      const { i18n } = make("en");
      expect(i18n.dir("ar")).toBe("rtl");
      expect(i18n.dir("he")).toBe("rtl");
      expect(i18n.dir("en")).toBe("ltr");
    });
  });
});

describe("the Intl formatter cache", () => {
  /** A valid tag that is different for every index: language `aa`..`zz` with a region. */
  const tagAt = (index: number): string =>
    `${String.fromCharCode(97 + (Math.floor(index / 26) % 26))}${String.fromCharCode(97 + (index % 26))}-${String.fromCharCode(65 + Math.floor(index / 676))}A`;

  it("[I18N-435] the default capacity is 256 and the size never exceeds the bound", () => {
    expect(INTL_CACHE_SIZE).toBe(256);
    const cache = createIntlCache();
    for (let index = 0; index < 700; index += 1) {
      cache.number(tagAt(index));
      expect(cache.size).toBeLessThanOrEqual(256);
    }
    expect(cache.size).toBe(256);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("[I18N-435] the least recently used formatter goes first, and a hit refreshes it", () => {
    const cache = createIntlCache();
    const first = cache.number(tagAt(0));
    const second = cache.number(tagAt(1));
    for (let index = 2; index < 256; index += 1) cache.number(tagAt(index));
    expect(cache.size).toBe(256);
    // Touch the oldest, then overflow by one: the second oldest is the one dropped.
    expect(cache.number(tagAt(0))).toBe(first);
    cache.number(tagAt(256));
    expect(cache.size).toBe(256);
    expect(cache.number(tagAt(0))).toBe(first);
    expect(cache.number(tagAt(1))).not.toBe(second);
  });

  it("[I18N-435] all kinds share one bound", () => {
    const cache = createIntlCache(4);
    cache.number("en");
    cache.date("en", { dateStyle: "short" });
    cache.plural("en", "cardinal");
    cache.list("en");
    cache.relative("en");
    cache.displayNames("en", { type: "region" });
    cache.locale("en");
    expect(cache.size).toBe(4);
    const zero = createIntlCache(0);
    expect(zero.number("en").format(1)).toBe("1");
    expect(zero.size).toBe(0);
  });

  it("[I18N-435] an invalid capacity is an INVALID_VALUE error", () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "4" as never]) {
      expect(() => createIntlCache(bad), String(bad)).toThrow(/INVALID_VALUE/);
    }
  });

  it("[I18N-436] equal options share a formatter whatever their order or undefined members", () => {
    const cache = createIntlCache();
    const a = cache.number("en", { style: "currency", currency: "EUR" });
    expect(cache.number("en", { currency: "EUR", style: "currency" })).toBe(a);
    expect(cache.number("en", { currency: "EUR", style: "currency", unit: undefined })).toBe(a);
    expect(cache.number("de", { currency: "EUR", style: "currency" })).not.toBe(a);
    expect(cache.number("en", { currency: "USD", style: "currency" })).not.toBe(a);
    expect(cache.number("en")).toBe(cache.number("en", {}));
    expect(cache.number("en")).toBe(cache.number("en", undefined));
    expect(cache.plural("en", "cardinal")).not.toBe(cache.plural("en", "ordinal"));
    expect(cache.size).toBe(6);
  });

  it("[I18N-436] options are keyed by type and by inherited properties too", () => {
    const cache = createIntlCache();
    const inherited = Object.create({ style: "percent" }) as Intl.NumberFormatOptions;
    expect(cache.number("en", inherited).format(0.5)).toBe("50%");
    expect(cache.number("en", inherited)).not.toBe(cache.number("en"));
    expect(cache.number("en", inherited)).toBe(cache.number("en", { style: "percent" }));
    expect(cache.number("en").format(0.5)).toBe("0.5");
    // 2 and "2" are different options for `Intl`, so they are different cache entries.
    const asNumber = cache.number("en", { minimumFractionDigits: 2 });
    const asText = cache.number("en", { minimumFractionDigits: "2" as never });
    expect(asNumber).not.toBe(asText);
    // A value the key cannot print is still `Intl`'s error to raise, and nothing is cached.
    const before = cache.size;
    expect(() => cache.number("en", { minimumFractionDigits: Symbol("x") as never })).toThrow(
      TypeError,
    );
    expect(() => cache.number("en", { minimumFractionDigits: 5n as never })).toThrow(TypeError);
    expect(cache.size).toBe(before);
  });

  it("[I18N-436] an invalid locale or option throws what Intl throws and caches nothing", () => {
    const cache = createIntlCache();
    expect(() => cache.number("not a locale")).toThrow(RangeError);
    expect(() => cache.date("en", { timeZone: "Mars/Base" })).toThrow(RangeError);
    expect(() => cache.displayNames("en", { type: "region" })).not.toThrow();
    expect(() => cache.locale("")).toThrow(RangeError);
    expect(cache.size).toBe(1);
  });
});
