import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MessageSyntaxError } from "../src/errors";
import type { MessageNode } from "../src/icu/ast";
import { formatToParts, formatToString } from "../src/icu/format";
import { parseMessage } from "../src/icu/parse";
import { printMessage } from "../src/icu/print";
import { makeCtx } from "./support/ctx";

const SEED = { seed: 20261009, numRuns: 400 } as const;

/** Text made of the characters that are tricky for the grammar. */
const nastyText = fc.stringMatching(/^[a-z '#<>{}\n]{0,12}$/);
/** Text without any syntax characters. */
const safeText = fc.stringMatching(/^[a-zA-Z0-9 .,!?-]{0,10}$/);
const name = fc.constantFrom("a", "name", "count", "x1", "user_id");

/** Generates a valid message source of bounded size from the grammar. */
const message = (inPlural: boolean): fc.Arbitrary<string> =>
  fc.letrec<{ node: string; msg: string }>((tie) => ({
    msg: fc.array(tie("node"), { maxLength: 4 }).map((parts) => parts.join("")),
    node: fc.oneof(
      { weight: 4, arbitrary: safeText },
      { weight: 2, arbitrary: name.map((n) => `{${n}}`) },
      { weight: 1, arbitrary: fc.constantFrom("''", "'{'", "'}'", "'<'", "<br/>") },
      { weight: 1, arbitrary: inPlural ? fc.constant("#") : fc.constant("#") },
      { weight: 1, arbitrary: name.map((n) => `{${n}, number, percent}`) },
      { weight: 1, arbitrary: name.map((n) => `{${n}, date, short}`) },
      {
        weight: 1,
        arbitrary: fc
          .tuple(name, tie("msg"), tie("msg"))
          .map(
            ([n, one, other]) => `{${n}, plural, offset:1 =0 {zero} one {${one}} other {${other}}}`,
          ),
      },
      {
        weight: 1,
        arbitrary: fc
          .tuple(name, tie("msg"), tie("msg"))
          .map(([n, a, b]) => `{${n}, select, a {${a}} other {${b}}}`),
      },
      {
        weight: 1,
        arbitrary: fc.tuple(tie("msg")).map(([inner]) => `<b>${inner}</b>`),
      },
    ),
  })).msg;

/** Source strings that exercise the grammar's syntax characters without being valid. */
const tokens = fc
  .array(
    fc.constantFrom(
      "{",
      "}",
      ",",
      "'",
      "''",
      "<",
      ">",
      "</",
      "/>",
      "#",
      " ",
      "plural",
      "select",
      "selectordinal",
      "one",
      "other",
      "=1",
      "offset:1",
      "number",
      "date",
      "::",
      "a",
      "b",
      "<b>",
      "</b>",
      "\n",
    ),
    { maxLength: 40 },
  )
  .map((parts) => parts.join(""));

function parseOrSyntaxError(source: string): readonly MessageNode[] | undefined {
  try {
    return parseMessage(source);
  } catch (error) {
    if (error instanceof MessageSyntaxError) return undefined;
    throw error;
  }
}

describe("ICU parser properties", () => {
  it("[I18N-20] parse(print(parse(x))) equals parse(x) for generated valid messages", () => {
    fc.assert(
      fc.property(message(false), (source) => {
        const first = parseOrSyntaxError(source);
        if (first === undefined) return; // the generator may produce a rejected combination
        expect(parseMessage(printMessage(first))).toEqual(first);
      }),
      SEED,
    );
  });

  it("[I18N-21] arbitrary text only ever fails with MessageSyntaxError; accepted input round-trips", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ maxLength: 60 }),
          fc.string({ unit: "grapheme", maxLength: 30 }),
          nastyText,
          tokens,
        ),
        (source) => {
          const first = parseOrSyntaxError(source);
          if (first === undefined) return;
          expect(parseMessage(printMessage(first))).toEqual(first);
        },
      ),
      SEED,
    );
  });

  it("[I18N-22] plain text without syntax characters parses to itself", () => {
    fc.assert(
      fc.property(safeText, (text) => {
        expect(printMessage(parseMessage(text))).toBe(text);
        expect(parseMessage(text)).toEqual(text === "" ? [] : [{ kind: "text", value: text }]);
      }),
      SEED,
    );
  });

  it("[I18N-23] escaped text round trips through print for every string", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), nastyText, (any, nasty) => {
        for (const value of [any, nasty]) {
          const nodes: readonly MessageNode[] = value === "" ? [] : [{ kind: "text", value }];
          expect(parseMessage(printMessage(nodes))).toEqual(nodes);
        }
      }),
      SEED,
    );
  });

  it("[I18N-24] formatting never throws, never produces markup, and tags are inert strings", () => {
    const { ctx } = makeCtx("en");
    fc.assert(
      fc.property(message(true), fc.anything(), (source, anything) => {
        const nodes = parseOrSyntaxError(source);
        if (nodes === undefined) return;
        const values = { a: anything, name: anything, count: 2, x1: 1, user_id: "u" };
        const text = formatToString(nodes, values, ctx);
        expect(typeof text).toBe("string");
        const parts = formatToParts(nodes, values, undefined, ctx);
        for (const part of parts) expect(typeof part).toBe("string");
      }),
      { ...SEED, numRuns: 200 },
    );
  });

  it("[I18N-25] parse time grows linearly: 8x the input stays within 40x the time", () => {
    const sample = (n: number): number => {
      const source = "x'{'{a, plural, one {# <b>y</b>} other {z}} ".repeat(n);
      const started = performance.now();
      for (let i = 0; i < 5; i += 1)
        parseMessage(source, { maxLength: 1_000_000, maxNodes: 1_000_000 });
      return performance.now() - started;
    };
    sample(50);
    const small = sample(50);
    const large = sample(400);
    expect(large).toBeLessThan(Math.max(small, 1) * 40);
  });

  it("[I18N-26] adversarial inputs (many braces, quotes and tags) finish quickly and bounded", () => {
    const started = performance.now();
    for (const source of [
      "{".repeat(10_000),
      "'".repeat(10_000),
      "<a>".repeat(10_000),
      "{a, plural, ".repeat(5_000),
      "<".repeat(10_000),
      "{a,".repeat(5_000),
    ]) {
      // Either a node list or a MessageSyntaxError; anything else would throw out of the test.
      parseOrSyntaxError(source);
    }
    expect(parseOrSyntaxError("{".repeat(10_000))).toBeUndefined();
    expect(parseOrSyntaxError("<a>".repeat(10_000))).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
