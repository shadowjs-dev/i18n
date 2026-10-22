import { useSignal } from "@shadow-js/core";
import { describe, expect, it } from "vitest";
import { formatToParts, formatToString } from "../src/icu/format";
import { parseMessage } from "../src/icu/parse";
import { makeCtx } from "./support/ctx";

function run(
  source: string,
  values: object | undefined,
  locale = "en",
  extra: Parameters<typeof makeCtx>[1] = {},
): string {
  const { ctx } = makeCtx(locale, extra);
  return formatToString(parseMessage(source), values, ctx);
}

const CATS = "{n, plural, zero {Z} one {O} two {T} few {F} many {M} other {X}}";

describe("ICU formatter", () => {
  it("[I18N-30] simple arguments are plain text; numbers are not locale formatted", () => {
    expect(run("Hi {name}, {n} {ok}", { name: "Ada", n: 1234.5, ok: true })).toBe(
      "Hi Ada, 1234.5 true",
    );
  });

  it("[I18N-31] plural categories follow Intl for en, ar, ru, pl, ja, he", () => {
    const pick = (locale: string, n: number): string => run(CATS, { n }, locale);
    expect([0, 1, 2, 3, 11, 100].map((n) => pick("ar", n))).toEqual(["Z", "O", "T", "F", "M", "X"]);
    expect([1, 2, 5, 21, 1.5].map((n) => pick("ru", n))).toEqual(["O", "F", "M", "O", "X"]);
    expect([1, 2, 5, 22, 1.5].map((n) => pick("pl", n))).toEqual(["O", "F", "M", "F", "X"]);
    expect([0, 1, 2, 100].map((n) => pick("ja", n))).toEqual(["X", "X", "X", "X"]);
    expect([1, 2, 5].map((n) => pick("en", n))).toEqual(["O", "X", "X"]);
    for (const n of [1, 2, 3, 20]) {
      const category = new Intl.PluralRules("he").select(n);
      const expected = { one: "O", two: "T", few: "F", many: "M", other: "X", zero: "Z" }[category];
      expect(pick("he", n)).toBe(expected);
    }
  });

  it("[I18N-32] =N matches before categories, # is formatted, offset subtracts", () => {
    const source =
      "{n, plural, =0 {nobody} =1 {just you} one {you and # other} other {you and # others}}";
    expect(run(source, { n: 0 })).toBe("nobody");
    expect(run(source, { n: 1 })).toBe("just you");
    expect(
      run(
        "{n, plural, offset:1 =0 {nobody} =1 {just you} one {you and # other} other {you and # others}}",
        { n: 2 },
      ),
    ).toBe("you and 1 other");
    expect(
      run("{n, plural, offset:1 =1 {just you} one {you and # other} other {you and # others}}", {
        n: 1234,
      }),
    ).toBe("you and 1,233 others");
    expect(run("{n, plural, other {# in de}}", { n: 1234.5 }, "de")).toBe("1.234,5 in de");
  });

  it("[I18N-33] selectordinal", () => {
    const source = "{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}";
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map((n) => run(source, { n }))).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd",
      "101st",
    ]);
  });

  it("[I18N-34] select with other fallback; nested plural inside select keeps its own #", () => {
    const source =
      "{g, select, f {{n, plural, one {she has # cat} other {she has # cats}}} other {they have {n} cats}}";
    expect(run(source, { g: "f", n: 3 })).toBe("she has 3 cats");
    expect(run(source, { g: "zzz", n: 3 })).toBe("they have 3 cats");
    expect(run("{x, select, a {A} other {O}}", {})).toBe("O");
  });

  it("[I18N-35] number: default, percent, integer, skeletons, currency, unit, compact", () => {
    expect(run("{n, number}", { n: 1234567.891 })).toBe("1,234,567.891");
    expect(run("{n, number}", { n: 1234567.891 }, "de")).toBe("1.234.567,891");
    expect(run("{n, number, percent}", { n: 0.256 })).toBe("26%");
    expect(run("{n, number, integer}", { n: 2.6 })).toBe("3");
    expect(run("{n, number, ::currency/EUR}", { n: 1234.5 }, "de")).toBe("1.234,50 €");
    expect(run("{n, number, ::currency/USD}", { n: 5 })).toBe("$5.00");
    expect(run("{n, number, ::percent .0}", { n: 0.1234 })).toBe("12.3%");
    expect(run("{n, number, ::compact-short}", { n: 12_500 })).toBe("13K");
    expect(run("{n, number, ::unit/kilometer-per-hour}", { n: 50 })).toBe("50 km/h");
    expect(run("{n, number, ::measure-unit/length-meter unit-width-full-name}", { n: 3 })).toBe(
      "3 meters",
    );
    expect(run("{n, number, ::sign-always}", { n: 4 })).toBe("+4");
    expect(run("{n, number, ::scale/100 .0}", { n: 0.5 })).toBe("50.0");
    expect(run("{n, number, ::integer-width/*000}", { n: 7 })).toBe("007");
    expect(run("{n, number, ::group-off}", { n: 12345 })).toBe("12345");
    expect(run("{n, number, ::@@#}", { n: 1234.567 })).toBe("1,230");
  });

  it("[I18N-36] named formats come from the formats option", () => {
    const formats = {
      number: { price: { style: "currency", currency: "USD" } },
      date: { day: { dateStyle: "short" } },
    } as const;
    expect(run("{n, number, price}", { n: 3 }, "en", { formats })).toBe("$3.00");
    expect(run("{d, date, day}", { d: new Date(Date.UTC(2024, 0, 31)) }, "en", { formats })).toBe(
      "1/31/24",
    );
    const { ctx, reports } = makeCtx("en");
    expect(formatToString(parseMessage("{n, number, nope}"), { n: 3 }, ctx)).toBe("3");
    expect(reports.map((r) => r.code)).toEqual(["FORMAT_FAILED"]);
  });

  it("[I18N-37] dates are deterministic with an injected timeZone", () => {
    const d = new Date(Date.UTC(2024, 2, 5, 23, 30));
    expect(run("{d, date, short}", { d }, "en", { timeZone: "UTC" })).toBe("3/5/24");
    expect(run("{d, date, short}", { d }, "en", { timeZone: "Asia/Tokyo" })).toBe("3/6/24");
    expect(run("{d, date, long}", { d }, "en")).toBe("March 5, 2024");
    expect(
      run("{d, time, short}", { d }, "en", { timeZone: "America/New_York" }).replace(/\s/g, " "),
    ).toBe("6:30 PM");
    expect(run("{d, date, ::yMMMd}", { d }, "en")).toBe("Mar 5, 2024");
    expect(run("{d, date, ::yMMMMEEEEd}", { d }, "fr")).toBe("mardi 5 mars 2024");
    expect(run("{d, time, ::Hm}", { d }, "en", { timeZone: "UTC" })).toBe("23:30");
    expect(run("{d, date, ::yyyyMMdd}", { d: d.getTime() }, "en")).toBe("03/05/2024");
    expect(run("{d, date}", { d: d.toISOString() }, "en")).toBe("Mar 5, 2024");
  });

  it("[I18N-38] rich tags: handlers receive formatted chunks; plain formatting drops tags", () => {
    const { ctx, reports } = makeCtx("en");
    const nodes = parseMessage("Read <a>the <b>terms</b> of {name}</a>.<br/>");
    const out = formatToParts(
      nodes,
      { name: "X" },
      { a: (chunks) => ({ a: chunks }), b: (chunks) => `*${chunks.join("")}*`, br: () => "\n" },
      ctx,
    );
    expect(out).toEqual(["Read ", { a: ["the *terms* of X"] }, ".\n"]);
    expect(reports).toEqual([]);
    expect(formatToString(nodes, { name: "X" }, ctx)).toBe("Read the terms of X.");
    expect(formatToParts(nodes, { name: "X" }, { b: () => "?" }, ctx)).toEqual([
      "Read the ? of X.",
    ]);
    expect(reports.map((r) => r.code)).toEqual(["MISSING_TAG_HANDLER", "MISSING_TAG_HANDLER"]);
  });

  it("[I18N-39] values are never interpreted as markup: output parts are text", () => {
    const evil = '<img src=x onerror=alert(1)> & "q" {name}';
    const { ctx } = makeCtx("en");
    const parts = formatToParts(parseMessage("<b>{x}</b>"), { x: evil }, { b: (c) => c }, ctx);
    expect(parts).toEqual([[evil]]);
    expect(run("{x}", { x: evil })).toBe(evil);
    expect(run("{x}", { x: "{y}" })).toBe("{y}");
  });

  it("[I18N-40] missing and wrong-typed values are reported and shown as {name}", () => {
    const { ctx, reports } = makeCtx("en");
    expect(
      formatToString(
        parseMessage("a {x} b {n, number} c {p, plural, other {z}} d {d, date}"),
        {},
        ctx,
      ),
    ).toBe("a {x} b {n} c {p} d {d}");
    expect(reports.map((r) => r.code)).toEqual([
      "MISSING_VALUE",
      "MISSING_VALUE",
      "MISSING_VALUE",
      "MISSING_VALUE",
    ]);
    reports.length = 0;
    expect(
      formatToString(
        parseMessage("{n, number} {d, date} {o}"),
        { n: "abc", d: "not a date", o: { a: 1 } },
        ctx,
      ),
    ).toBe("{n} {d} {o}");
    expect(reports.map((r) => r.code)).toEqual(["INVALID_VALUE", "INVALID_VALUE", "INVALID_VALUE"]);
  });

  it("[I18N-41] values named like Object.prototype members are not read from the prototype", () => {
    const { ctx, reports } = makeCtx("en");
    expect(formatToString(parseMessage("{toString} {__proto__} {constructor}"), {}, ctx)).toBe(
      "{toString} {__proto__} {constructor}",
    );
    expect(reports).toHaveLength(3);
    const own = JSON.parse('{"__proto__": "own"}') as object;
    expect(formatToString(parseMessage("{__proto__}"), own, ctx)).toBe("own");
    expect(({} as Record<string, unknown>)["own"]).toBeUndefined();
  });

  it("[I18N-42] accessor values are called, so the caller's effect tracks them", () => {
    const [name] = useSignal("Ada");
    expect(run("Hi {n}", { n: name })).toBe("Hi Ada");
    expect(run("{c, plural, one {#} other {# items}}", { c: () => 3 })).toBe("3 items");
  });

  it("[I18N-43] unsupported Intl input falls back instead of throwing", () => {
    const { ctx, reports } = makeCtx("en");
    expect(formatToString(parseMessage("{n, number, ::unit/meter-per-bogus}"), { n: 1 }, ctx)).toBe(
      "1",
    );
    expect(formatToString(parseMessage("{n, number, ::unit/not-a-unit}"), { n: 1 }, ctx)).toBe("1");
    expect(reports.map((r) => r.code)).toEqual(["FORMAT_FAILED", "FORMAT_FAILED"]);
  });
});
