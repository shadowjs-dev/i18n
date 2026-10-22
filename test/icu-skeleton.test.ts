import { describe, expect, it } from "vitest";
import { DateSkeletonError, parseDateSkeleton } from "../src/icu/date-skeleton";
import { parseNumberSkeleton, SkeletonError } from "../src/icu/number-skeleton";

function numberError(text: string): SkeletonError {
  try {
    parseNumberSkeleton(text);
  } catch (error) {
    if (error instanceof SkeletonError) return error;
    throw error;
  }
  throw new Error(`expected a SkeletonError for ${JSON.stringify(text)}`);
}

function dateError(text: string): DateSkeletonError {
  try {
    parseDateSkeleton(text);
  } catch (error) {
    if (error instanceof DateSkeletonError) return error;
    throw error;
  }
  throw new Error(`expected a DateSkeletonError for ${JSON.stringify(text)}`);
}

describe("number skeletons", () => {
  const OK: ReadonlyArray<readonly [skeleton: string, options: object, scale?: number]> = [
    ["percent", { style: "percent" }],
    ["%", { style: "percent" }],
    ["currency/EUR", { style: "currency", currency: "EUR" }],
    ["currency/eur", { style: "currency", currency: "EUR" }],
    ["unit/meter", { style: "unit", unit: "meter" }],
    ["unit/kilometer-per-hour", { style: "unit", unit: "kilometer-per-hour" }],
    ["measure-unit/length-meter", { style: "unit", unit: "meter" }],
    ["compact-short", { notation: "compact", compactDisplay: "short" }],
    ["K", { notation: "compact", compactDisplay: "short" }],
    ["compact-long", { notation: "compact", compactDisplay: "long" }],
    ["KK", { notation: "compact", compactDisplay: "long" }],
    ["scientific", { notation: "scientific" }],
    ["engineering", { notation: "engineering" }],
    ["notation-simple", { notation: "standard" }],
    ["precision-integer", { minimumFractionDigits: 0, maximumFractionDigits: 0 }],
    [".", { minimumFractionDigits: 0, maximumFractionDigits: 0 }],
    [".00", { minimumFractionDigits: 2, maximumFractionDigits: 2 }],
    [".0#", { minimumFractionDigits: 1, maximumFractionDigits: 2 }],
    [".##", { minimumFractionDigits: 0, maximumFractionDigits: 2 }],
    [".00*", { minimumFractionDigits: 2, maximumFractionDigits: 20 }],
    ["@@@", { minimumSignificantDigits: 3, maximumSignificantDigits: 3 }],
    ["@", { minimumSignificantDigits: 1, maximumSignificantDigits: 1 }],
    ["@#", { minimumSignificantDigits: 1, maximumSignificantDigits: 2 }],
    ["@@#", { minimumSignificantDigits: 2, maximumSignificantDigits: 3 }],
    ["@@*", { minimumSignificantDigits: 2, maximumSignificantDigits: 21 }],
    ["integer-width/*000", { minimumIntegerDigits: 3 }],
    ["integer-width/000", { minimumIntegerDigits: 3 }],
    ["0000", { minimumIntegerDigits: 4 }],
    ["sign-always", { signDisplay: "always" }],
    ["+!", { signDisplay: "always" }],
    ["sign-except-zero", { signDisplay: "exceptZero" }],
    ["+?", { signDisplay: "exceptZero" }],
    ["sign-never", { signDisplay: "never" }],
    ["+_", { signDisplay: "never" }],
    ["sign-auto", { signDisplay: "auto" }],
    [
      "currency/EUR sign-accounting",
      { currencySign: "accounting", currency: "EUR", style: "currency" },
    ],
    [
      "currency/EUR sign-accounting-always",
      { currencySign: "accounting", signDisplay: "always", currency: "EUR", style: "currency" },
    ],
    ["group-off", { useGrouping: false }],
    [",_", { useGrouping: false }],
    ["group-min2", { useGrouping: "min2" }],
    ["group-auto", { useGrouping: "auto" }],
    ["group-on-aligned", { useGrouping: "auto" }],
    [
      "currency/USD unit-width-short",
      { style: "currency", currency: "USD", currencyDisplay: "symbol" },
    ],
    [
      "currency/USD unit-width-narrow",
      { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol" },
    ],
    [
      "currency/USD unit-width-full-name",
      { style: "currency", currency: "USD", currencyDisplay: "name" },
    ],
    [
      "currency/USD unit-width-iso-code",
      { style: "currency", currency: "USD", currencyDisplay: "code" },
    ],
    ["unit/meter unit-width-full-name", { style: "unit", unit: "meter", unitDisplay: "long" }],
    ["unit/meter unit-width-iso-code", { style: "unit", unit: "meter", unitDisplay: "short" }],
    ["rounding-mode-ceiling", { roundingMode: "ceil" }],
    ["rounding-mode-floor", { roundingMode: "floor" }],
    ["rounding-mode-down", { roundingMode: "trunc" }],
    ["rounding-mode-up", { roundingMode: "expand" }],
    ["rounding-mode-half-even", { roundingMode: "halfEven" }],
    ["rounding-mode-half-down", { roundingMode: "halfTrunc" }],
    ["rounding-mode-half-up", { roundingMode: "halfExpand" }],
    ["scale/100", {}, 100],
    ["scale/0.5 .0", { minimumFractionDigits: 1, maximumFractionDigits: 1 }, 0.5],
  ];

  it("[I18N-386] every supported token becomes the right Intl option", () => {
    for (const [skeleton, options, scale] of OK) {
      const parsed = parseNumberSkeleton(skeleton);
      expect({ skeleton, options: parsed.options }).toEqual({ skeleton, options });
      expect(parsed.scale).toBe(scale ?? 1);
      expect(Object.isFrozen(parsed)).toBe(true);
      expect(Object.isFrozen(parsed.options)).toBe(true);
    }
  });

  it("[I18N-386] tokens may be separated by any white space, also none at the ends", () => {
    for (const separator of [" ", "  ", "\t", "\n", "\r\n", " ", "　", " ", "   "]) {
      const parsed = parseNumberSkeleton(`${separator}currency/EUR${separator}.00${separator}`);
      expect(parsed.options).toEqual({
        style: "currency",
        currency: "EUR",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
  });

  it("[I18N-386] an unsupported or malformed token is an error that names the token", () => {
    const BAD: ReadonlyArray<readonly [skeleton: string, token: string]> = [
      ["", ""],
      ["   ", "   "],
      ["bogus", "bogus"],
      ["percent bogus", "bogus"],
      ["currency/", "currency/"],
      ["currency/EU", "currency/EU"],
      ["currency/EURO", "currency/EURO"],
      ["currency/E1R", "currency/E1R"],
      ["currency/ÉUR", "currency/ÉUR"],
      ["unit/", "unit/"],
      ["unit/Meter", "unit/Meter"],
      ["unit/meter-", "unit/meter-"],
      ["unit/-meter", "unit/-meter"],
      ["unit/meter--second", "unit/meter--second"],
      ["unit/meter2", "unit/meter2"],
      ["measure-unit/", "measure-unit/"],
      ["scale/", "scale/"],
      ["scale/abc", "scale/abc"],
      ["scale/Infinity", "scale/Infinity"],
      [".0*#", ".0*#"],
      [".0x", ".0x"],
      [".#0", ".#0"],
      ["@@x", "@@x"],
      ["@@*#", "@@*#"],
      ["integer-width/", "integer-width/"],
      ["integer-width/*", "integer-width/*"],
      ["integer-width/00x", "integer-width/00x"],
      ["integer-width/##0", "integer-width/##0"],
      ["integer-width/+00", "integer-width/+00"],
      ["00x", "00x"],
      ["sign-sometimes", "sign-sometimes"],
      ["group-everywhere", "group-everywhere"],
      ["unit-width-wide", "unit-width-wide"],
      ["rounding-mode-random", "rounding-mode-random"],
      ["PERCENT", "PERCENT"],
    ];
    for (const [skeleton, token] of BAD) {
      const error = numberError(skeleton);
      expect({ skeleton, name: error.name, token: error.token }).toEqual({
        skeleton,
        name: "SkeletonError",
        token,
      });
    }
  });

  it("[I18N-386] later tokens override earlier ones of the same kind", () => {
    expect(parseNumberSkeleton("percent currency/EUR").options).toMatchObject({
      style: "currency",
    });
    expect(parseNumberSkeleton(".00 .0").options).toMatchObject({
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  });
});

describe("date skeletons", () => {
  const OK: ReadonlyArray<readonly [skeleton: string, options: object]> = [
    ["y", { year: "numeric" }],
    ["yy", { year: "2-digit" }],
    ["yyyy", { year: "numeric" }],
    ["yyyyyyyy", { year: "numeric" }],
    ["M", { month: "numeric" }],
    ["MM", { month: "2-digit" }],
    ["MMM", { month: "short" }],
    ["MMMM", { month: "long" }],
    ["MMMMM", { month: "narrow" }],
    ["L", { month: "numeric" }],
    ["LLLL", { month: "long" }],
    ["d", { day: "numeric" }],
    ["dd", { day: "2-digit" }],
    ["E", { weekday: "short" }],
    ["EEEE", { weekday: "long" }],
    ["EEEEE", { weekday: "narrow" }],
    ["EEEEEE", { weekday: "short" }],
    ["c", { weekday: "short" }],
    ["cccc", { weekday: "long" }],
    ["G", { era: "short" }],
    ["GGGG", { era: "long" }],
    ["GGGGG", { era: "narrow" }],
    ["h", { hour: "numeric", hourCycle: "h12" }],
    ["hh", { hour: "2-digit", hourCycle: "h12" }],
    ["H", { hour: "numeric", hourCycle: "h23" }],
    ["HH", { hour: "2-digit", hourCycle: "h23" }],
    ["K", { hour: "numeric", hourCycle: "h11" }],
    ["k", { hour: "numeric", hourCycle: "h24" }],
    ["j", { hour: "numeric" }],
    ["J", { hour: "numeric" }],
    ["C", { hour: "numeric" }],
    ["m", { minute: "numeric" }],
    ["mm", { minute: "2-digit" }],
    ["s", { second: "numeric" }],
    ["ss", { second: "2-digit" }],
    ["S", { fractionalSecondDigits: 1 }],
    ["SS", { fractionalSecondDigits: 2 }],
    ["SSS", { fractionalSecondDigits: 3 }],
    ["a", {}],
    ["b", {}],
    ["B", {}],
    ["z", { timeZoneName: "short" }],
    ["zzzz", { timeZoneName: "long" }],
    ["O", { timeZoneName: "shortOffset" }],
    ["OOOO", { timeZoneName: "longOffset" }],
    ["Z", { timeZoneName: "shortOffset" }],
    ["v", { timeZoneName: "shortGeneric" }],
    ["vvvv", { timeZoneName: "longGeneric" }],
    ["V", { timeZoneName: "shortGeneric" }],
    ["yMMMd", { year: "numeric", month: "short", day: "numeric" }],
    ["Hm", { hour: "numeric", hourCycle: "h23", minute: "numeric" }],
    ["EEEEd", { weekday: "long", day: "numeric" }],
  ];

  it("[I18N-387] every supported letter and width becomes the right Intl option", () => {
    for (const [skeleton, options] of OK) {
      const parsed = parseDateSkeleton(skeleton);
      expect({ skeleton, options: parsed.options }).toEqual({ skeleton, options });
      expect(Object.isFrozen(parsed)).toBe(true);
      expect(Object.isFrozen(parsed.options)).toBe(true);
    }
  });

  it("[I18N-387] an empty skeleton, an unknown letter or a run longer than its letter allows is an error", () => {
    const BAD: ReadonlyArray<readonly [skeleton: string, token: string]> = [
      ["", ""],
      ["q", "q"],
      ["QQQ", "QQQ"],
      ["w", "w"],
      ["D", "D"],
      ["u", "u"],
      ["x", "x"],
      ["yMMMq", "q"],
      ["y M", " "],
      ["ddd", "ddd"],
      ["mmm", "mmm"],
      ["sss", "sss"],
      ["hhh", "hhh"],
      ["HHH", "HHH"],
      ["MMMMMM", "MMMMMM"],
      ["GGGGGG", "GGGGGG"],
      ["EEEEEEE", "EEEEEEE"],
      ["zzzzz", "zzzzz"],
      ["OOOOO", "OOOOO"],
      ["vvvvv", "vvvvv"],
      ["SSSS", "SSSS"],
    ];
    for (const [skeleton, token] of BAD) {
      const error = dateError(skeleton);
      expect({ skeleton, name: error.name, token: error.token }).toEqual({
        skeleton,
        name: "DateSkeletonError",
        token,
      });
    }
  });
});
