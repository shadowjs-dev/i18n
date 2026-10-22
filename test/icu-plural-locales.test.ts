import { describe, expect, it } from "vitest";
import { formatToString } from "../src/icu/format";
import { parseMessage } from "../src/icu/parse";
import { makeCtx } from "./support/ctx";

/** One arm per CLDR category; each arm prints its own category name so the choice is visible. */
const CARDINAL = "{n, plural, zero {zero} one {one} two {two} few {few} many {many} other {other}}";
const ORDINAL =
  "{n, selectordinal, zero {zero} one {one} two {two} few {few} many {many} other {other}}";

function pick(source: string, locale: string, n: number | string | bigint): string {
  const { ctx, reports } = makeCtx(locale);
  const text = formatToString(parseMessage(source), { n }, ctx);
  expect(reports).toEqual([]);
  return text;
}

/**
 * Expected categories come from the CLDR plural rules, written out by hand (not read back from
 * `Intl.PluralRules`), so a regression in how the formatter feeds the rules shows up. The values are
 * chosen where the categories differ.
 */
const CARDINAL_TABLE: ReadonlyArray<{
  locale: string;
  id: string;
  rows: ReadonlyArray<readonly [number, string]>;
}> = [
  {
    locale: "ar",
    id: "I18N-350",
    rows: [
      [0, "zero"],
      [1, "one"],
      [2, "two"],
      [3, "few"],
      [10, "few"],
      [11, "many"],
      [99, "many"],
      [100, "other"],
      [102, "other"],
      [103, "few"],
      [111, "many"],
      [1.5, "other"],
    ],
  },
  {
    locale: "ru",
    id: "I18N-351",
    rows: [
      [0, "many"],
      [1, "one"],
      [2, "few"],
      [4, "few"],
      [5, "many"],
      [11, "many"],
      [12, "many"],
      [21, "one"],
      [22, "few"],
      [25, "many"],
      [101, "one"],
      [111, "many"],
      [1.5, "other"],
    ],
  },
  {
    locale: "uk",
    id: "I18N-351",
    rows: [
      [0, "many"],
      [1, "one"],
      [2, "few"],
      [5, "many"],
      [11, "many"],
      [21, "one"],
      [22, "few"],
      [25, "many"],
      [1.5, "other"],
    ],
  },
  {
    locale: "pl",
    id: "I18N-352",
    rows: [
      [0, "many"],
      [1, "one"],
      [2, "few"],
      [4, "few"],
      [5, "many"],
      [12, "many"],
      [22, "few"],
      [25, "many"],
      [112, "many"],
      [1.5, "other"],
    ],
  },
  {
    locale: "cy",
    id: "I18N-353",
    rows: [
      [0, "zero"],
      [1, "one"],
      [2, "two"],
      [3, "few"],
      [4, "other"],
      [5, "other"],
      [6, "many"],
      [7, "other"],
      [11, "other"],
    ],
  },
  {
    locale: "fr",
    id: "I18N-354",
    rows: [
      [0, "one"],
      [1, "one"],
      [1.5, "one"],
      [2, "other"],
      [5, "other"],
      [100, "other"],
    ],
  },
  {
    locale: "ja",
    id: "I18N-355",
    rows: [
      [0, "other"],
      [1, "other"],
      [2, "other"],
      [5, "other"],
      [1.5, "other"],
    ],
  },
  {
    locale: "zh",
    id: "I18N-355",
    rows: [
      [0, "other"],
      [1, "other"],
      [2, "other"],
      [100, "other"],
    ],
  },
  {
    locale: "en",
    id: "I18N-354",
    rows: [
      [0, "other"],
      [1, "one"],
      [2, "other"],
      [1.5, "other"],
    ],
  },
];

describe("plural categories per language", () => {
  for (const { locale, id, rows } of CARDINAL_TABLE) {
    it(`[${id}] ${locale}: every value picks the clause of its CLDR category`, () => {
      for (const [n, category] of rows) {
        expect({ n, picked: pick(CARDINAL, locale, n) }).toEqual({ n, picked: category });
      }
    });
  }

  it("[I18N-354] French treats 0, 1 and 1.5 as one, and =0 still beats the category", () => {
    const withExact = "{n, plural, =0 {none} one {one} other {other}}";
    expect(pick(withExact, "fr", 0)).toBe("none");
    expect(pick(withExact, "fr", 1)).toBe("one");
    expect(pick(withExact, "fr", 1.5)).toBe("one");
    expect(pick(withExact, "fr", 2)).toBe("other");
    // No `one` clause: falls back to `other`.
    expect(pick("{n, plural, other {other}}", "fr", 1)).toBe("other");
  });

  it("[I18N-355] Japanese and Chinese only have other: category clauses never apply", () => {
    for (const locale of ["ja", "zh", "ko", "vi"]) {
      expect(pick("{n, plural, one {one} other {other}}", locale, 1)).toBe("other");
      expect(pick("{n, plural, few {few} many {many} other {other}}", locale, 3)).toBe("other");
    }
    // =N still applies in them.
    expect(pick("{n, plural, =1 {exactly one} other {other}}", "ja", 1)).toBe("exactly one");
  });

  it("[I18N-356] an exact =n clause beats the category clause in every locale", () => {
    const source =
      "{n, plural, =0 {exact-0} =1 {exact-1} =2 {exact-2} zero {zero} one {one} two {two} few {few} many {many} other {other}}";
    const cases: ReadonlyArray<readonly [string, number, string]> = [
      ["ar", 0, "exact-0"],
      ["ar", 1, "exact-1"],
      ["ar", 2, "exact-2"],
      ["ar", 3, "few"],
      ["ru", 1, "exact-1"],
      ["ru", 21, "one"],
      ["pl", 2, "exact-2"],
      ["pl", 22, "few"],
      ["cy", 0, "exact-0"],
      ["cy", 6, "many"],
      ["fr", 0, "exact-0"],
      ["fr", 1, "exact-1"],
      ["ja", 0, "exact-0"],
      ["ja", 3, "other"],
      ["en", 1, "exact-1"],
      ["en", 5, "other"],
    ];
    for (const [locale, n, expected] of cases) {
      expect({ locale, n, picked: pick(source, locale, n) }).toEqual({
        locale,
        n,
        picked: expected,
      });
    }
    // The exact value is compared before the offset is taken off.
    const offset = "{n, plural, offset:1 =1 {exact} one {one} other {other}}";
    expect(pick(offset, "en", 1)).toBe("exact");
    expect(pick(offset, "en", 2)).toBe("one");
    expect(pick(offset, "en", 3)).toBe("other");
  });

  it("[I18N-356] =N also matches decimals and numeric strings and bigints", () => {
    const source = "{n, plural, =1.5 {one and a half} =3 {three} other {other}}";
    expect(pick(source, "en", 1.5)).toBe("one and a half");
    expect(pick(source, "en", "3")).toBe("three");
    expect(pick(source, "en", 3n)).toBe("three");
    expect(pick(source, "en", 3.0000001)).toBe("other");
  });
});

describe("selectordinal", () => {
  it("[I18N-357] English: one, two, few and other, with the teens as other", () => {
    const rows: ReadonlyArray<readonly [number, string]> = [
      [1, "one"],
      [2, "two"],
      [3, "few"],
      [4, "other"],
      [10, "other"],
      [11, "other"],
      [12, "other"],
      [13, "other"],
      [21, "one"],
      [22, "two"],
      [23, "few"],
      [24, "other"],
      [101, "one"],
      [111, "other"],
      [112, "other"],
      [113, "other"],
      [121, "one"],
    ];
    for (const [n, category] of rows) {
      expect({ n, picked: pick(ORDINAL, "en", n) }).toEqual({ n, picked: category });
    }
    const suffix = "{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}";
    expect(
      [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 24, 101, 111].map((n) => pick(suffix, "en", n)),
    ).toEqual([
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
      "24th",
      "101st",
      "111th",
    ]);
  });

  it("[I18N-358] Swedish (one for 1, 2, 21, 22 ...) and Welsh (zero to many) differ from English", () => {
    const sv: ReadonlyArray<readonly [number, string]> = [
      [1, "one"],
      [2, "one"],
      [3, "other"],
      [11, "other"],
      [12, "other"],
      [21, "one"],
      [22, "one"],
      [23, "other"],
      [31, "one"],
    ];
    for (const [n, category] of sv) {
      expect({ n, picked: pick(ORDINAL, "sv", n) }).toEqual({ n, picked: category });
    }
    const cy: ReadonlyArray<readonly [number, string]> = [
      [0, "zero"],
      [7, "zero"],
      [8, "zero"],
      [9, "zero"],
      [1, "one"],
      [2, "two"],
      [3, "few"],
      [4, "few"],
      [5, "many"],
      [6, "many"],
      [10, "other"],
    ];
    for (const [n, category] of cy) {
      expect({ n, picked: pick(ORDINAL, "cy", n) }).toEqual({ n, picked: category });
    }
    // French: only 1 is one.
    expect([1, 2, 3].map((n) => pick(ORDINAL, "fr", n))).toEqual(["one", "other", "other"]);
  });

  it("[I18N-358] ordinal and cardinal rules are independent, and =N beats an ordinal category", () => {
    expect(pick("{n, plural, one {card-one} other {card-other}}", "en", 2)).toBe("card-other");
    expect(pick("{n, selectordinal, two {ord-two} other {ord-other}}", "en", 2)).toBe("ord-two");
    expect(pick("{n, selectordinal, =1 {first} one {#st} other {#th}}", "en", 1)).toBe("first");
    expect(pick("{n, selectordinal, =1 {first} one {#st} other {#th}}", "en", 21)).toBe("21st");
    // Offset applies to ordinals as it does to plurals.
    expect(pick("{n, selectordinal, offset:10 one {#st} other {#th}}", "en", 11)).toBe("1st");
  });
});
