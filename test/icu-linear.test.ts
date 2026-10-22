import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MessageSyntaxError } from "../src/errors";
import { parseDateSkeleton } from "../src/icu/date-skeleton";
import { parseNumberSkeleton } from "../src/icu/number-skeleton";
import { type ParseOptions, parseMessage } from "../src/icu/parse";

/** Limits high enough that a long input is parsed (or fails syntactically), not refused for size. */
const WIDE: ParseOptions = { maxLength: 4_000_000, maxNodes: 4_000_000, maxDepth: 128 };

function run(source: string): "ok" | "syntax" {
  try {
    parseMessage(source, WIDE);
    return "ok";
  } catch (error) {
    if (error instanceof MessageSyntaxError) return "syntax";
    throw error;
  }
}

/** Best of `runs` wall-clock times in milliseconds; the minimum drops scheduler and GC noise. */
function best(task: () => void, runs = 9): number {
  let fastest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now();
    task();
    fastest = Math.min(fastest, performance.now() - started);
  }
  return fastest;
}

/**
 * Pathological families, each given the number of characters to produce. Some are valid messages
 * with many parts, others fail quickly with a syntax error; both must stay linear.
 */
const FAMILIES: ReadonlyArray<readonly [name: string, build: (size: number) => string]> = [
  ["run of {", (n) => "{".repeat(n)],
  ["run of }", (n) => "}".repeat(n)],
  ["run of '", (n) => "'".repeat(n)],
  ["run of #", (n) => "#".repeat(n)],
  ["run of <", (n) => "<".repeat(n)],
  ["run of quoted braces", (n) => "'{'".repeat(Math.ceil(n / 3))],
  ["quote left open", (n) => `'{${"a".repeat(n)}`],
  ["apostrophes between words", (n) => "a'b ".repeat(Math.ceil(n / 4))],
  ["nested plural openers", (n) => "{a, plural, other {".repeat(Math.ceil(n / 19))],
  ["nested select openers", (n) => "{a, select, other {".repeat(Math.ceil(n / 19))],
  ["nested tag openers", (n) => "<a>".repeat(Math.ceil(n / 3))],
  ["self-closing tags", (n) => "<br/>".repeat(Math.ceil(n / 5))],
  ["tag names that never end", (n) => `<${"a".repeat(n)}`],
  ["closing tag names that never end", (n) => `</${"a".repeat(n)}`],
  ["many pounds in a plural", (n) => `{n, plural, other {${"#".repeat(n)}}}`],
  ["many arguments", (n) => "{a}".repeat(Math.ceil(n / 3))],
  [
    "many clauses",
    (n) =>
      `{n, select, ${Array.from({ length: Math.ceil(n / 8) }, (_, index) => `s${index} {x}`).join(" ")} other {z}}`,
  ],
  ["long white space before an argument", (n) => `${" ".repeat(n)}{a}`],
  ["white space after an open argument", (n) => `{a${" ".repeat(n)}`],
  ["white space in an empty plural", (n) => `{a, plural, ${" ".repeat(n)}}`],
  ["unclosed style", (n) => `{a, number, ${"x".repeat(n)}`],
  ["long selector", (n) => `{a, select, ${"s".repeat(n)} {x} other {y}}`],
  ["long argument name", (n) => `{${"n".repeat(n)}}`],
  ["long text with one argument", (n) => `${"word ".repeat(Math.ceil(n / 5))}{a}`],
  ["commas", (n) => `{a${",".repeat(n)}`],
  ["colons and offsets", (n) => `{a, plural, offset:${"1".repeat(n)} other {x}}`],
];

describe("parse time is linear in the input", () => {
  it("[I18N-375] 8x the input takes about 8x the time, not 64x, for every pathological family", () => {
    // A quadratic scan would take 64 times longer for 8 times the input; a linear one about 8 times
    // longer. The bound is three times the linear ratio (24), and the small input is large enough
    // (a fraction of a millisecond to a few milliseconds) for its time to be measurable. Each time is the best of several
    // runs, which keeps scheduler and GC pauses out of it. The floor of 0.15 milliseconds covers
    // families that fail on the first characters, whose time is constant.
    const small = 50_000;
    const large = 400_000;
    for (const [name, build] of FAMILIES) {
      const little = build(small);
      const big = build(large);
      // Same outcome class for both sizes (the failures are about the shape, not the size).
      expect({ name, outcome: run(big) }).toEqual({ name, outcome: run(little) });
      run(little);
      // A loaded machine can stall every run of one measurement; a quadratic scan is slow in every
      // attempt, so the family passes when any of three attempts is within the bound.
      let last = { t1: 0, t8: 0, slow: true };
      for (let attempt = 0; attempt < 3 && last.slow; attempt += 1) {
        const t1 = best(() => run(little));
        const t8 = best(() => run(big));
        last = { t1, t8, slow: t8 > Math.max(t1, 0.15) * 24 };
      }
      expect({ name, ...last }).toMatchObject({ name, slow: false });
    }
  }, 60_000);

  it("[I18N-376] every family completes quickly and only ever fails with a syntax error", () => {
    const started = performance.now();
    for (const [, build] of FAMILIES) {
      for (const size of [1, 2, 3, 7, 100, 20_000]) {
        run(build(size));
      }
    }
    // 26 families x 6 sizes; a regular expression with backtracking would not finish.
    expect(performance.now() - started).toBeLessThan(5_000);
  });

  it("[I18N-378] skeletons are scanned linearly too: long runs of tokens and white space", () => {
    const tokens = `${"percent ".repeat(20_000)}`;
    const t1 = best(() => parseNumberSkeleton(tokens.slice(0, 40_000)));
    const t8 = best(() =>
      parseNumberSkeleton(
        `${tokens}${tokens}${tokens}${tokens}${tokens}${tokens}${tokens}${tokens}`,
      ),
    );
    // The long input is 32 times the short one (1.28 million against 40,000 characters), so a linear scan takes about 32
    // times as long; a quadratic one would take about a thousand times. 64 leaves room for a slower machine.
    expect(t8).toBeLessThan(Math.max(t1, 0.5) * 64);
    expect(parseNumberSkeleton(" \t\n  percent　   ").options).toEqual({
      style: "percent",
    });
    expect(parseDateSkeleton("y".repeat(100_000)).options).toEqual({ year: "numeric" });
    const spaces = `unit/${"a".repeat(50_000)}-${"b".repeat(50_000)}`;
    expect(parseNumberSkeleton(spaces).options).toMatchObject({ style: "unit" });
  });
});

describe("no regular expression runs over message text", () => {
  it("[I18N-379] the ICU sources contain no regex literal and no regex method call", () => {
    const directory = new URL("../src/icu/", import.meta.url);
    const files = readdirSync(directory).filter((file) => file.endsWith(".ts"));
    expect(files).toEqual(
      expect.arrayContaining([
        "parse.ts",
        "print.ts",
        "format.ts",
        "pseudo.ts",
        "number-skeleton.ts",
      ]),
    );
    const methods = [
      ".exec(",
      ".match(",
      ".matchAll(",
      ".search(",
      ".test(",
      "new RegExp",
      "RegExp(",
    ];
    for (const file of files) {
      const code = stripCommentsAndStrings(readFileSync(new URL(file, directory), "utf8"));
      for (const method of methods) {
        expect({ file, method, found: code.includes(method) }).toEqual({
          file,
          method,
          found: false,
        });
      }
      // `.replace(` and `.split(` are fine with plain strings; a regex literal argument is not.
      expect({ file, regex: hasRegexLiteralArgument(code) }).toEqual({ file, regex: false });
    }
  });

  it("[I18N-379] the scanner used by that check does see a regex", () => {
    expect(hasRegexLiteralArgument(stripCommentsAndStrings("const x = a.split(/\\s+/);"))).toBe(
      true,
    );
    expect(
      hasRegexLiteralArgument(stripCommentsAndStrings('const x = a.replace(/a/g, "b");')),
    ).toBe(true);
    expect(hasRegexLiteralArgument(stripCommentsAndStrings('const x = a.split(" "); // /x/'))).toBe(
      false,
    );
    expect(hasRegexLiteralArgument(stripCommentsAndStrings("const x = a / b / c;"))).toBe(false);
    expect(stripCommentsAndStrings('a.test("x") /* .exec( */').includes(".exec(")).toBe(false);
  });
});

/** Replaces comments, string literals and template text by spaces so that only code is left. */
function stripCommentsAndStrings(source: string): string {
  let out = "";
  let index = 0;
  while (index < source.length) {
    const character = source[index] ?? "";
    const next = source[index + 1];
    if (character === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
    } else if (character === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        index += 1;
      }
      index += 2;
      out += " ";
    } else if (character === '"' || character === "'" || character === "`") {
      index += 1;
      while (index < source.length && source[index] !== character) {
        index += source[index] === "\\" ? 2 : 1;
      }
      index += 1;
      out += '""';
    } else {
      out += character;
      index += 1;
    }
  }
  return out;
}

/** True when `(/` follows a method call opening: `.split(/x/)`, `.replace(/x/g, ...)`. */
function hasRegexLiteralArgument(code: string): boolean {
  return code.includes("(/") || code.includes("= /") || code.includes(", /") || code.includes("!/");
}
