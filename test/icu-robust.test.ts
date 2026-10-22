import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { I18nError, type I18nErrorCode } from "../src/errors";
import { formatToParts, formatToString } from "../src/icu/format";
import { parseMessage } from "../src/icu/parse";
import { printMessage } from "../src/icu/print";
import { makeCtx } from "./support/ctx";
import { ICU_SEED, messageTree, valuesRecord } from "./support/icu-arbitraries";

const EPOCH = new Date(0);
const MEDIUM_DATE = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });
const MEDIUM_TIME = new Intl.DateTimeFormat("en", { timeStyle: "medium", timeZone: "UTC" });

type Code = I18nErrorCode | undefined;
type Row = readonly [text: string, code: Code];

/** What each kind of node shows, and reports, for one kind of value. */
interface Expectation {
  readonly simple: Row;
  readonly number: Row;
  readonly date: Row;
  readonly time: Row;
  readonly plural: Row;
  readonly select: Row;
}

const NODES = {
  simple: "{x}",
  number: "{x, number}",
  date: "{x, date}",
  time: "{x, time}",
  plural: "{x, plural, other {#}}",
  select: "{x, select, a {A} other {O}}",
} as const;

const invalid = (): Row => ["{x}", "INVALID_VALUE"];
const none = (text: string): Row => [text, undefined];

const KINDS: ReadonlyArray<readonly [label: string, value: unknown, expected: Expectation]> = [
  [
    "string",
    "abc",
    {
      simple: none("abc"),
      number: invalid(),
      date: invalid(),
      time: invalid(),
      plural: invalid(),
      select: none("O"),
    },
  ],
  [
    "select key string",
    "a",
    {
      simple: none("a"),
      number: invalid(),
      date: invalid(),
      time: invalid(),
      plural: invalid(),
      select: none("A"),
    },
  ],
  [
    "empty string",
    "",
    {
      simple: none(""),
      number: invalid(),
      date: invalid(),
      time: invalid(),
      plural: invalid(),
      select: none("O"),
    },
  ],
  [
    "numeric string",
    "1234",
    {
      simple: none("1234"),
      number: none("1,234"),
      date: none(MEDIUM_DATE.format(new Date("1234"))),
      time: none(MEDIUM_TIME.format(new Date("1234"))),
      plural: none("1,234"),
      select: none("O"),
    },
  ],
  [
    "ISO date string",
    "2024-01-15T10:20:30Z",
    {
      simple: none("2024-01-15T10:20:30Z"),
      number: invalid(),
      date: none("Jan 15, 2024"),
      time: none(MEDIUM_TIME.format(new Date("2024-01-15T10:20:30Z"))),
      plural: invalid(),
      select: none("O"),
    },
  ],
  [
    "number",
    1234.5,
    {
      simple: none("1234.5"),
      number: none("1,234.5"),
      date: none(MEDIUM_DATE.format(new Date(1234.5))),
      time: none(MEDIUM_TIME.format(new Date(1234.5))),
      plural: none("1,234.5"),
      select: none("O"),
    },
  ],
  [
    "NaN",
    Number.NaN,
    {
      simple: none("NaN"),
      number: invalid(),
      date: invalid(),
      time: invalid(),
      plural: invalid(),
      select: none("O"),
    },
  ],
  [
    "Infinity",
    Number.POSITIVE_INFINITY,
    {
      simple: none("Infinity"),
      number: none("∞"),
      date: invalid(),
      time: invalid(),
      plural: invalid(),
      select: none("O"),
    },
  ],
  [
    "-Infinity",
    Number.NEGATIVE_INFINITY,
    {
      simple: none("-Infinity"),
      number: none("-∞"),
      date: invalid(),
      time: invalid(),
      plural: invalid(),
      select: none("O"),
    },
  ],
  [
    "-0",
    -0,
    {
      simple: none("0"),
      number: none("-0"),
      date: none(MEDIUM_DATE.format(EPOCH)),
      time: none(MEDIUM_TIME.format(EPOCH)),
      plural: none("0"),
      select: none("O"),
    },
  ],
  [
    "bigint",
    10n,
    {
      simple: none("10"),
      number: none("10"),
      date: invalid(),
      time: invalid(),
      plural: none("10"),
      select: none("O"),
    },
  ],
  [
    "huge bigint",
    2n ** 80n,
    {
      simple: none("1208925819614629174706176"),
      number: none("1,208,925,819,614,629,174,706,176"),
      date: invalid(),
      time: invalid(),
      plural: none("1,208,925,819,614,629,174,706,176"),
      select: none("O"),
    },
  ],
  [
    "valid Date",
    EPOCH,
    {
      simple: none(MEDIUM_DATE.format(EPOCH)),
      number: invalid(),
      date: none(MEDIUM_DATE.format(EPOCH)),
      time: none(MEDIUM_TIME.format(EPOCH)),
      plural: invalid(),
      select: ["O", "INVALID_VALUE"],
    },
  ],
  [
    "invalid Date",
    new Date(Number.NaN),
    {
      simple: invalid(),
      number: invalid(),
      date: invalid(),
      time: invalid(),
      plural: invalid(),
      select: ["O", "INVALID_VALUE"],
    },
  ],
  [
    "null",
    null,
    {
      simple: invalid(),
      number: invalid(),
      date: invalid(),
      time: invalid(),
      plural: invalid(),
      select: none("O"),
    },
  ],
  [
    "undefined",
    undefined,
    {
      simple: invalid(),
      number: invalid(),
      date: invalid(),
      time: invalid(),
      plural: invalid(),
      select: none("O"),
    },
  ],
  [
    "true",
    true,
    {
      simple: none("true"),
      number: invalid(),
      date: invalid(),
      time: invalid(),
      plural: invalid(),
      select: none("O"),
    },
  ],
  [
    "false",
    false,
    {
      simple: none("false"),
      number: invalid(),
      date: invalid(),
      time: invalid(),
      plural: invalid(),
      select: none("O"),
    },
  ],
  [
    "object",
    { a: 1 },
    {
      simple: invalid(),
      number: invalid(),
      date: invalid(),
      time: invalid(),
      plural: invalid(),
      select: ["O", "INVALID_VALUE"],
    },
  ],
  [
    "array",
    [1, 2],
    {
      simple: invalid(),
      number: invalid(),
      date: invalid(),
      time: invalid(),
      plural: invalid(),
      select: ["O", "INVALID_VALUE"],
    },
  ],
  [
    "object without prototype",
    Object.create(null),
    {
      simple: invalid(),
      number: invalid(),
      date: invalid(),
      time: invalid(),
      plural: invalid(),
      select: ["O", "INVALID_VALUE"],
    },
  ],
  [
    "object whose toString throws",
    {
      toString(): string {
        throw new Error("toString must not be called");
      },
    },
    {
      simple: invalid(),
      number: invalid(),
      date: invalid(),
      time: invalid(),
      plural: invalid(),
      select: ["O", "INVALID_VALUE"],
    },
  ],
  [
    "symbol",
    Symbol("s"),
    {
      simple: invalid(),
      number: invalid(),
      date: invalid(),
      time: invalid(),
      plural: invalid(),
      select: ["O", "INVALID_VALUE"],
    },
  ],
  [
    "accessor returning a number",
    () => 3,
    {
      simple: none("3"),
      number: none("3"),
      date: none(MEDIUM_DATE.format(new Date(3))),
      time: none(MEDIUM_TIME.format(new Date(3))),
      plural: none("3"),
      select: none("O"),
    },
  ],
  [
    "accessor returning NaN",
    () => Number.NaN,
    {
      simple: none("NaN"),
      number: invalid(),
      date: invalid(),
      time: invalid(),
      plural: invalid(),
      select: none("O"),
    },
  ],
];

function render(source: string, values: object | undefined): { text: string; codes: Code[] } {
  const { ctx, reports } = makeCtx("en");
  const text = formatToString(parseMessage(source), values, ctx);
  return { text, codes: reports.map((report) => report.code) };
}

describe("formatting never throws for any value", () => {
  it("[I18N-395] every kind of value in every kind of argument: readable text, and a report when it cannot be used", () => {
    for (const [label, value, expected] of KINDS) {
      for (const [node, source] of Object.entries(NODES)) {
        const [text, code] = expected[node as keyof Expectation];
        const { text: out, codes } = render(source, { x: value });
        expect({ label, node, out, codes }).toEqual({
          label,
          node,
          out: text,
          codes: code === undefined ? [] : [code],
        });
      }
    }
  });

  it("[I18N-395] a missing value is MISSING_VALUE in every kind of argument", () => {
    for (const [node, source] of Object.entries(NODES)) {
      const { text, codes } = render(source, {});
      expect({ node, text, codes }).toEqual({
        node,
        text: node === "select" ? "O" : "{x}",
        codes: ["MISSING_VALUE"],
      });
    }
    // `undefined` for the whole values object is the same as an empty one.
    expect(render("{x}", undefined)).toEqual({ text: "{x}", codes: ["MISSING_VALUE"] });
    // Values on the prototype are not values.
    const inherited = Object.create({ x: "from prototype" }) as object;
    expect(render("{x}", inherited)).toEqual({ text: "{x}", codes: ["MISSING_VALUE"] });
  });

  it("[I18N-396] property: no tree, locale, time zone or values record makes the formatter throw", () => {
    const locales = [
      "en",
      "ar",
      "ru",
      "pl",
      "cy",
      "ja",
      "fr",
      "he",
      "und",
      "xx-invalid-!!",
      "",
      "en-u-nu-arab",
    ];
    const allowed = new Set<string>([
      "MISSING_VALUE",
      "INVALID_VALUE",
      "FORMAT_FAILED",
      "MISSING_TAG_HANDLER",
    ]);
    fc.assert(
      fc.property(
        messageTree,
        valuesRecord,
        fc.constantFrom(...locales),
        fc.constantFrom<string | undefined>(undefined, "UTC", "Asia/Tokyo", "Not/AZone"),
        (tree, values, locale, timeZone) => {
          const nodes = parseMessage(printMessage(tree));
          const { ctx, reports } = makeCtx(locale, timeZone === undefined ? {} : { timeZone });
          const text = formatToString(nodes, values, ctx);
          expect(typeof text).toBe("string");
          const parts = formatToParts(nodes, values, undefined, ctx);
          expect(Array.isArray(parts)).toBe(true);
          for (const report of reports) {
            expect(report).toBeInstanceOf(I18nError);
            expect(allowed.has(report.code)).toBe(true);
          }
        },
      ),
      { ...ICU_SEED, numRuns: 600 },
    );
  });

  it("[I18N-397] an unusable locale or time zone is reported per node and the text stays readable", () => {
    const { ctx, reports } = makeCtx("not a locale!");
    const out = formatToString(
      parseMessage("{n, plural, one {# one} other {# other}} {m, number} {d, date, short} {d}"),
      { n: 1, m: 1234.5, d: new Date(0) },
      ctx,
    );
    // plural -> other clause (rules unavailable), # and number -> raw digits, dates -> ISO
    expect(out).toBe("1 other 1234.5 1970-01-01T00:00:00.000Z 1970-01-01T00:00:00.000Z");
    expect(reports.every((report) => report.code === "FORMAT_FAILED")).toBe(true);
    expect(reports.length).toBeGreaterThanOrEqual(4);
    const zone = makeCtx("en", { timeZone: "Not/AZone" });
    expect(formatToString(parseMessage("{d, time}"), { d: EPOCH }, zone.ctx)).toBe(
      EPOCH.toISOString(),
    );
    expect(zone.reports.map((report) => report.code)).toEqual(["FORMAT_FAILED"]);
  });

  it("[I18N-397] a bigint keeps all its digits in #, and -0 never shows a minus sign", () => {
    const huge = 12345678901234567890n;
    expect(render("{n, plural, other {#}}", { n: huge }).text).toBe("12,345,678,901,234,567,890");
    expect(render("{n, plural, offset:1 other {#}}", { n: huge }).text).toBe(
      "12,345,678,901,234,567,889",
    );
    expect(render("{n, plural, other {#}}", { n: -0 }).text).toBe("0");
    expect(render("{n, plural, offset:2 other {#}}", { n: 2 }).text).toBe("0");
    expect(render("{n, plural, offset:2 other {#}}", { n: 1 }).text).toBe("-1");
    expect(render("{n, plural, other {#}}", { n: -5 }).text).toBe("-5");
    expect(render("{n, plural, other {#}}", { n: 1e21 }).text).toBe(
      "1,000,000,000,000,000,000,000",
    );
  });

  it("[I18N-397] only the caller's own accessors and handlers can throw out of the formatter", () => {
    const { ctx } = makeCtx("en");
    expect(() =>
      formatToString(
        parseMessage("{x}"),
        {
          x: () => {
            throw new Error("boom");
          },
        },
        ctx,
      ),
    ).toThrow("boom");
    expect(() =>
      formatToParts(
        parseMessage("<b>x</b>"),
        {},
        {
          b: () => {
            throw new Error("handler");
          },
        },
        ctx,
      ),
    ).toThrow("handler");
  });
});

describe("big messages", () => {
  it("[I18N-398] a 20 000-character plain string is parsed and formatted exactly and fast", () => {
    const characters =
      "abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789.,;:!?()[]-_/\n\té名";
    let text = "";
    for (let index = 0; text.length < 20_000; index += 1) {
      text += characters[(index * 7) % characters.length] ?? "";
    }
    expect(text).toHaveLength(20_000);
    const started = performance.now();
    const nodes = parseMessage(text);
    expect(nodes).toEqual([{ kind: "text", value: text }]);
    const { ctx, reports } = makeCtx("en");
    expect(formatToString(nodes, {}, ctx)).toBe(text);
    expect(formatToParts(nodes, {}, undefined, ctx)).toEqual([text]);
    expect(printMessage(nodes)).toBe(text);
    expect(reports).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1_000);
    // 20 000 characters of quoting: 10 000 doubled apostrophes are 10 000 apostrophes.
    expect(formatToString(parseMessage("''".repeat(10_000)), {}, ctx)).toBe("'".repeat(10_000));
    // A quoted block that fills the message.
    const quoted = `'{${"x".repeat(19_997)}'`;
    expect(quoted).toHaveLength(20_000);
    expect(formatToString(parseMessage(quoted), {}, ctx)).toBe(`{${"x".repeat(19_997)}`);
    // A value of a megabyte is inserted untouched.
    const big = "v".repeat(1_000_000);
    expect(formatToString(parseMessage("[{x}]"), { x: big }, ctx)).toBe(`[${big}]`);
  });

  it("[I18N-399] a 1 000-argument message formats every value in order", () => {
    const names = Array.from({ length: 1_000 }, (_, index) => `arg${index}`);
    const source = names.map((name) => `{${name}}`).join("-");
    const values = Object.fromEntries(names.map((name, index) => [name, `v${index}`]));
    const { ctx, reports } = makeCtx("en");
    const nodes = parseMessage(source);
    expect(nodes).toHaveLength(1_999);
    const expected = names.map((_, index) => `v${index}`).join("-");
    expect(formatToString(nodes, values, ctx)).toBe(expected);
    expect(formatToParts(nodes, values, undefined, ctx)).toEqual([expected]);
    expect(reports).toEqual([]);
    // The same with a number, a plural and two kinds of text in turn.
    const mixedSource = names
      .map((name, index) =>
        index % 4 === 0
          ? `{${name}, number}`
          : index % 4 === 1
            ? `{${name}, plural, one {#} other {#}}`
            : `{${name}}`,
      )
      .join(" ");
    const mixedValues = Object.fromEntries(
      names.map((name, index) => [name, index % 4 === 3 ? `s${index}` : index]),
    );
    const grouped = new Intl.NumberFormat("en");
    const mixedExpected = names
      .map((_, index) =>
        index % 4 === 0 || index % 4 === 1
          ? grouped.format(index)
          : index % 4 === 2
            ? String(index)
            : `s${index}`,
      )
      .join(" ");
    expect(
      formatToString(
        parseMessage(mixedSource, { maxNodes: 20_000, maxLength: 100_000 }),
        mixedValues,
        ctx,
      ),
    ).toBe(mixedExpected);
    // Leave one value out: exactly one report, and its placeholder shows.
    const rest = Object.fromEntries(Object.entries(values).filter(([name]) => name !== "arg500"));
    const second = makeCtx("en");
    expect(formatToString(nodes, rest, second.ctx)).toBe(expected.replace("v500", "{arg500}"));
    expect(second.reports.map((report) => report.code)).toEqual(["MISSING_VALUE"]);
  });

  it("[I18N-399] a message at the node cap formats, with clauses chosen per value", () => {
    const source = "{n, plural, =0 {z} one {o} other {m}}".repeat(700);
    const nodes = parseMessage(source, { maxLength: 100_000 });
    const { ctx } = makeCtx("en");
    expect(formatToString(nodes, { n: 0 }, ctx)).toBe("z".repeat(700));
    expect(formatToString(nodes, { n: 1 }, ctx)).toBe("o".repeat(700));
    expect(formatToString(nodes, { n: 7 }, ctx)).toBe("m".repeat(700));
  });
});
