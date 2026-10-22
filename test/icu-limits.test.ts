import { describe, expect, it } from "vitest";
import { MessageSyntaxError } from "../src/errors";
import { formatToString } from "../src/icu/format";
import { PARSE_LIMITS, type ParseOptions, parseMessage } from "../src/icu/parse";
import { printMessage } from "../src/icu/print";
import { makeCtx } from "./support/ctx";

function outcome(source: string, options?: ParseOptions): string {
  try {
    parseMessage(source, options);
  } catch (error) {
    if (error instanceof MessageSyntaxError) return error.syntaxCode;
    throw error;
  }
  return "OK";
}

function failure(source: string, options?: ParseOptions): MessageSyntaxError {
  try {
    parseMessage(source, options);
  } catch (error) {
    if (error instanceof MessageSyntaxError) return error;
    throw error;
  }
  throw new Error("expected a MessageSyntaxError");
}

const tags = (depth: number, inner = "x"): string =>
  `${"<b>".repeat(depth)}${inner}${"</b>".repeat(depth)}`;
const selects = (depth: number, inner = "x"): string =>
  `${"{a, select, other {".repeat(depth)}${inner}${"}}".repeat(depth)}`;
const plurals = (depth: number, inner = "x"): string =>
  `${"{a, plural, other {".repeat(depth)}${inner}${"}}".repeat(depth)}`;

describe("parser limits", () => {
  it("[I18N-370] the documented defaults", () => {
    expect(PARSE_LIMITS).toEqual({
      maxLength: 20_000,
      maxDepth: 32,
      maxNodes: 5_000,
      maxDepthCeiling: 128,
    });
    expect(Object.isFrozen(PARSE_LIMITS)).toBe(true);
  });

  it("[I18N-370] length: exactly 20 000 code units is accepted, 20 001 is rejected before parsing", () => {
    expect(outcome("a".repeat(20_000))).toBe("OK");
    expect(outcome("a".repeat(20_001))).toBe("MESSAGE_TOO_LONG");
    // The check is on the source, not on what it produces: quoted, escaped and braced text count.
    expect(outcome("'".repeat(20_000))).toBe("OK");
    expect(outcome(`${"a".repeat(19_997)}{x}`)).toBe("OK");
    expect(outcome(`${"a".repeat(19_998)}{x}`)).toBe("MESSAGE_TOO_LONG");
    // Rejected before any scan: an unparseable source over the limit reports the length, not the syntax.
    expect(outcome(`}${"{".repeat(20_000)}`)).toBe("MESSAGE_TOO_LONG");
    const error = failure("a".repeat(20_001));
    expect(error.offset).toBe(0);
    expect(error.line).toBe(1);
    expect(error.column).toBe(1);
    expect(error.message).toContain("20001");
    // Astral characters are two code units each.
    expect(outcome("\u{1F600}".repeat(10_000))).toBe("OK");
    expect(outcome("\u{1F600}".repeat(10_001))).toBe("MESSAGE_TOO_LONG");
    // The limit is an option.
    expect(outcome("abcdefghij", { maxLength: 10 })).toBe("OK");
    expect(outcome("abcdefghijk", { maxLength: 10 })).toBe("MESSAGE_TOO_LONG");
    expect(outcome("a".repeat(40_000), { maxLength: 40_000 })).toBe("OK");
    expect(outcome("", { maxLength: 0 })).toBe("OK");
    expect(outcome("a", { maxLength: 0 })).toBe("MESSAGE_TOO_LONG");
  });

  it("[I18N-371] nesting: 32 levels are accepted and 33 are rejected", () => {
    // A tag with content is one level.
    expect(outcome(tags(32))).toBe("OK");
    expect(outcome(tags(33))).toBe("NESTING_TOO_DEEP");
    expect(failure(tags(33)).offset).toBe(96);
    // A plural or select is two levels (the argument and its clause body).
    expect(outcome(selects(16))).toBe("OK");
    expect(outcome(selects(17))).toBe("NESTING_TOO_DEEP");
    expect(outcome(plurals(16))).toBe("OK");
    expect(outcome(plurals(17))).toBe("NESTING_TOO_DEEP");
    expect(outcome(selects(16).replaceAll("select", "selectordinal"))).toBe("OK");
    // A mix: tag + select clause + tag ... totals 1 + 2 + 1 ...
    const mixed = (n: number): string => {
      let out = "x";
      for (let index = 0; index < n; index += 1) {
        out = index % 2 === 0 ? `<b>${out}</b>` : `{a, plural, other {${out}}}`;
      }
      return out;
    };
    // mixed(20) is 10 tags + 10 plurals = 10 + 20 = 30 levels; mixed(21) is 31; mixed(22) is 33.
    expect(outcome(mixed(31))).toBe("NESTING_TOO_DEEP");
    expect(outcome(mixed(20))).toBe("OK");
    expect(outcome(mixed(21))).toBe("OK");
    expect(outcome(mixed(22))).toBe("NESTING_TOO_DEEP");
    // A simple argument is one level, so it needs one free level.
    expect(outcome(tags(31, "{a}"))).toBe("OK");
    expect(outcome(tags(32, "{a}"))).toBe("NESTING_TOO_DEEP");
    expect(outcome(tags(31, "{a, number}"))).toBe("OK");
    expect(outcome(tags(32, "{a, number}"))).toBe("NESTING_TOO_DEEP");
    // Self-closing tags and text have no depth.
    expect(outcome(tags(32, "<br/>text"))).toBe("OK");
    // Options: smaller and larger limits.
    expect(outcome(tags(5), { maxDepth: 5 })).toBe("OK");
    expect(outcome(tags(6), { maxDepth: 5 })).toBe("NESTING_TOO_DEEP");
    expect(outcome(tags(100), { maxDepth: 100 })).toBe("OK");
    expect(outcome("plain", { maxDepth: 0 })).toBe("OK");
    expect(outcome("{a}", { maxDepth: 0 })).toBe("NESTING_TOO_DEEP");
    expect(outcome("{a}", { maxDepth: 1 })).toBe("OK");
    // The ceiling is 128 whatever is asked.
    expect(outcome(tags(128), { maxDepth: 10_000 })).toBe("OK");
    expect(outcome(tags(129), { maxDepth: 10_000 })).toBe("NESTING_TOO_DEEP");
    expect(outcome(tags(129), { maxDepth: Number.POSITIVE_INFINITY })).toBe("NESTING_TOO_DEEP");
  });

  it("[I18N-372] nodes: 5 000 are accepted and the 5 001st is rejected, each part counting once", () => {
    expect(outcome("{a}".repeat(5_000))).toBe("OK");
    expect(outcome("{a}".repeat(5_001))).toBe("TOO_MANY_NODES");
    // Text runs count too: text, argument, text, argument ...
    expect(outcome("x{a}".repeat(2_500))).toBe("OK");
    expect(outcome(`${"x{a}".repeat(2_500)}y`)).toBe("TOO_MANY_NODES");
    // Plural: the plural, each clause and each # are nodes: 1 + 2 clauses + 2 pounds.
    const plural = "{n, plural, one {#} other {#}}";
    expect(outcome(plural, { maxNodes: 5 })).toBe("OK");
    expect(outcome(plural, { maxNodes: 4 })).toBe("TOO_MANY_NODES");
    // Tags: the tag and its text.
    expect(outcome("<b>x</b>", { maxNodes: 2 })).toBe("OK");
    expect(outcome("<b>x</b>", { maxNodes: 1 })).toBe("TOO_MANY_NODES");
    expect(outcome("<br/><br/><br/>", { maxNodes: 3 })).toBe("OK");
    expect(outcome("<br/><br/><br/>", { maxNodes: 2 })).toBe("TOO_MANY_NODES");
    expect(outcome("{a}{b}{c}", { maxNodes: 3 })).toBe("OK");
    expect(outcome("{a}{b}{c}", { maxNodes: 2 })).toBe("TOO_MANY_NODES");
    expect(outcome("", { maxNodes: 0 })).toBe("OK");
    expect(outcome("x", { maxNodes: 0 })).toBe("TOO_MANY_NODES");
    // A larger cap is honored; the work stays linear.
    expect(parseMessage("{a}".repeat(6_000), { maxNodes: 6_000, maxLength: 20_000 })).toHaveLength(
      6_000,
    );
    // The error names the limit and points inside the source.
    const error = failure("{a}".repeat(5_001));
    expect(error.syntaxCode).toBe("TOO_MANY_NODES");
    expect(error.message).toContain("5000");
    expect(error.offset).toBeGreaterThan(0);
  });

  it("[I18N-373] a 1 MB input is rejected at once", () => {
    const sources = [
      "a".repeat(1_000_000),
      "{".repeat(1_000_000),
      "'".repeat(1_000_000),
      "<b>".repeat(333_334),
      "{a, plural, other {".repeat(52_632),
    ];
    for (const source of sources) {
      expect(source.length).toBeGreaterThanOrEqual(1_000_000);
      const started = performance.now();
      expect(outcome(source)).toBe("MESSAGE_TOO_LONG");
      // Measured in microseconds; the margin is three orders of magnitude.
      expect(performance.now() - started).toBeLessThan(1_000);
    }
    // The error keeps a short excerpt, not the megabyte.
    expect(failure("a".repeat(1_000_000)).message.length).toBeLessThan(500);
    expect(failure("a".repeat(1_000_000)).source.length).toBeLessThanOrEqual(80);
  });

  it("[I18N-374] a depth of 10 000 never overflows the stack: it fails with the depth error", () => {
    const deep = 10_000;
    const inputs: ReadonlyArray<readonly [string, string]> = [
      ["tags", "<b>".repeat(deep)],
      ["tags closed", tags(deep)],
      ["selects", "{a, select, other {".repeat(deep)],
      ["selects closed", selects(deep)],
      ["plurals", "{a, plural, other {".repeat(deep)],
      ["plurals closed", plurals(deep)],
      ["ordinals", "{a, selectordinal, other {".repeat(deep)],
      ["mixed", "<b>{a, select, other {".repeat(deep / 2)],
    ];
    const options: ReadonlyArray<ParseOptions> = [
      { maxLength: 1_000_000, maxNodes: 1_000_000 },
      { maxLength: 1_000_000, maxNodes: 1_000_000, maxDepth: 1_000_000 },
      { maxLength: 1_000_000, maxNodes: 1_000_000, maxDepth: Number.MAX_SAFE_INTEGER },
    ];
    for (const [label, source] of inputs) {
      for (const option of options) {
        const error = failure(source, option);
        expect({ label, code: error.syntaxCode }).toEqual({ label, code: "NESTING_TOO_DEEP" });
        // It stops at the first level past the ceiling, not after reading everything.
        expect(error.offset).toBeLessThan(128 * 24);
      }
    }
    // Unclosed brace runs end at the first brace (an argument needs a name), also fast.
    expect(failure("{".repeat(deep)).syntaxCode).toBe("INVALID_ARGUMENT_NAME");
    expect(failure("{a,".repeat(deep / 2)).syntaxCode).toBe("INVALID_ARGUMENT_TYPE");
    // The deepest tree that is accepted can be printed and formatted without trouble.
    const widest = tags(128);
    const nodes = parseMessage(widest, { maxDepth: 128 });
    expect(printMessage(nodes)).toBe(widest);
    const { ctx } = makeCtx("en");
    expect(formatToString(nodes, {}, ctx)).toBe("x");
    const select = selects(63, "{a}");
    expect(
      formatToString(parseMessage(select, { maxDepth: 128 }), { a: "ok" }, makeCtx("en").ctx),
    ).toBe("ok");
  });
});
