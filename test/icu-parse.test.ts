import { describe, expect, it } from "vitest";
import { MessageSyntaxError } from "../src/errors";
import { PARSE_LIMITS, parseMessage } from "../src/icu/parse";
import { printMessage } from "../src/icu/print";

function syntaxCode(source: string, options?: Parameters<typeof parseMessage>[1]): string {
  try {
    parseMessage(source, options);
  } catch (error) {
    if (error instanceof MessageSyntaxError) return error.syntaxCode;
    throw error;
  }
  return "OK";
}

describe("ICU parser", () => {
  it("[I18N-1] plain text, arguments and merged adjacent text", () => {
    expect(parseMessage("Hello {name}!")).toEqual([
      { kind: "text", value: "Hello " },
      { kind: "argument", name: "name" },
      { kind: "text", value: "!" },
    ]);
    expect(parseMessage("")).toEqual([]);
    expect(parseMessage("a''b'{'c")).toEqual([{ kind: "text", value: "a'b{c" }]);
  });

  it("[I18N-2] apostrophe rules follow ICU DOUBLE_OPTIONAL", () => {
    expect(parseMessage("It's fine")).toEqual([{ kind: "text", value: "It's fine" }]);
    expect(parseMessage("It''s")).toEqual([{ kind: "text", value: "It's" }]);
    expect(parseMessage("'{name}' is literal")).toEqual([
      { kind: "text", value: "{name} is literal" },
    ]);
    expect(parseMessage("'{a''b}'")).toEqual([{ kind: "text", value: "{a'b}" }]);
    // An unterminated quote runs to the end.
    expect(parseMessage("x '{y")).toEqual([{ kind: "text", value: "x {y" }]);
    // # is only special inside a plural.
    expect(parseMessage("#1 '#'")).toEqual([{ kind: "text", value: "#1 '#'" }]);
  });

  it("[I18N-3] plural with offset, exact matches, pound and nesting", () => {
    const nodes = parseMessage(
      "{n, plural, offset:1 =0 {none} one {you and # other} other {you and # others}}",
    );
    expect(nodes).toHaveLength(1);
    const plural = nodes[0];
    expect(plural).toMatchObject({ kind: "plural", name: "n", offset: 1, ordinal: false });
    expect(plural?.kind === "plural" && plural.cases.map((c) => c.selector)).toEqual([
      "=0",
      "one",
      "other",
    ]);
    const ordinal = parseMessage("{p, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}");
    expect(ordinal[0]).toMatchObject({ kind: "plural", ordinal: true });
  });

  it("[I18N-4] select, number, date and time with styles and skeletons", () => {
    expect(parseMessage("{g, select, male {he} female {she} other {they}}")[0]).toMatchObject({
      kind: "select",
      name: "g",
    });
    expect(parseMessage("{n, number}")[0]).toMatchObject({ kind: "number", style: undefined });
    expect(parseMessage("{n, number, percent}")[0]).toMatchObject({ style: "percent" });
    const skeleton = parseMessage("{n, number, ::currency/EUR .00}")[0];
    expect(skeleton).toMatchObject({ kind: "number", style: "::currency/EUR .00" });
    expect(skeleton?.kind === "number" && skeleton.skeleton?.options).toMatchObject({
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
    });
    expect(parseMessage("{d, date, ::yMMMd}")[0]).toMatchObject({ kind: "date" });
    expect(parseMessage("{d, time, short}")[0]).toMatchObject({ kind: "time", style: "short" });
  });

  it("[I18N-5] rich text tags, self closing tags and literal less-than signs", () => {
    expect(parseMessage("a <b>bold <i>it</i></b> <br/>c")).toMatchObject([
      { kind: "text", value: "a " },
      { kind: "tag", name: "b", selfClosing: false },
      { kind: "text", value: " " },
      { kind: "tag", name: "br", selfClosing: true, children: [] },
      { kind: "text", value: "c" },
    ]);
    expect(parseMessage("1 < 2 and 3 <4")).toEqual([{ kind: "text", value: "1 < 2 and 3 <4" }]);
    expect(parseMessage("'<b>' is text")).toEqual([{ kind: "text", value: "<b> is text" }]);
    expect(parseMessage("<b>x</b>", { tags: false })).toEqual([
      { kind: "text", value: "<b>x</b>" },
    ]);
  });

  it("[I18N-6] syntax errors carry a code, line, column and a caret excerpt", () => {
    let caught: unknown;
    try {
      parseMessage("line one\nHello {name, plural, one {x}}");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MessageSyntaxError);
    const error = caught as MessageSyntaxError;
    expect(error.syntaxCode).toBe("MISSING_OTHER_CLAUSE");
    expect(error.line).toBe(2);
    expect(error.column).toBe(7);
    expect(error.message).toContain("Hello {name, plural, one {x}}");
    expect(error.message).toContain("^");
    expect(error.code).toBe("SYNTAX");
  });

  it("[I18N-7] each malformed shape has its own code", () => {
    expect(syntaxCode("{")).toBe("UNEXPECTED_END");
    expect(syntaxCode("{name")).toBe("UNEXPECTED_END");
    expect(syntaxCode("{}")).toBe("INVALID_ARGUMENT_NAME");
    expect(syntaxCode("{a b}")).toBe("EXPECT_ARGUMENT_CLOSING_BRACE");
    expect(syntaxCode("{a, foo}")).toBe("INVALID_ARGUMENT_TYPE");
    expect(syntaxCode("}")).toBe("UNMATCHED_CLOSING_BRACE");
    expect(syntaxCode("{n, plural, one {a} one {b} other {c}}")).toBe("DUPLICATE_SELECTOR");
    expect(syntaxCode("{n, plural, few2 {a} other {c}}")).toBe("INVALID_SELECTOR");
    expect(syntaxCode("{n, plural, offset:x other {c}}")).toBe("INVALID_OFFSET");
    expect(syntaxCode("{n, plural, }")).toBe("EXPECT_CASES");
    expect(syntaxCode("{n, plural, one a other {c}}")).toBe("EXPECT_CASE_OPENING_BRACE");
    expect(syntaxCode("{n, plural one {a} other {c}}")).toBe("EXPECT_COMMA");
    expect(syntaxCode("<b>x")).toBe("UNCLOSED_TAG");
    expect(syntaxCode("x</b>")).toBe("UNMATCHED_CLOSING_TAG");
    expect(syntaxCode("<b>x</i>")).toBe("UNMATCHED_CLOSING_TAG");
    expect(syntaxCode("{n, number, ::bogus}")).toBe("INVALID_SKELETON");
    expect(syntaxCode("{n, number, }")).toBe("INVALID_STYLE");
    expect(syntaxCode("{n, number, a{b}}")).toBe("INVALID_STYLE");
    expect(syntaxCode("{n, plural, one {#} other {#}")).toBe("UNEXPECTED_END");
  });

  it("[I18N-8] bounds: length, nesting depth and node count are enforced", () => {
    expect(syntaxCode("a".repeat(PARSE_LIMITS.maxLength + 1))).toBe("MESSAGE_TOO_LONG");
    expect(syntaxCode("a".repeat(PARSE_LIMITS.maxLength))).toBe("OK");
    const deep = (n: number): string => (n === 0 ? "x" : `{a, select, other {${deep(n - 1)}}}`);
    // Each select consumes two levels (argument + case body).
    expect(syntaxCode(deep(16))).toBe("OK");
    expect(syntaxCode(deep(17))).toBe("NESTING_TOO_DEEP");
    expect(syntaxCode(`${"<b>".repeat(40)}x${"</b>".repeat(40)}`)).toBe("NESTING_TOO_DEEP");
    expect(syntaxCode("{a}".repeat(6000))).toBe("TOO_MANY_NODES");
    expect(syntaxCode("{a}{b}{c}", { maxNodes: 2 })).toBe("TOO_MANY_NODES");
  });

  it("[I18N-9] a very long message parses in linear time", () => {
    const source = "word {name} ".repeat(1500);
    const started = performance.now();
    const nodes = parseMessage(source, { maxNodes: 10_000 });
    expect(nodes).toHaveLength(3001);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("[I18N-10] printMessage keeps meaning for tricky text", () => {
    for (const source of [
      "a''b",
      "'{'x'}'",
      "{n, plural, one {'#' #} other {# '{'}}",
      "1 '<'b> <b>x</b>",
      "it''s {a}",
    ]) {
      const first = parseMessage(source);
      expect(parseMessage(printMessage(first))).toEqual(first);
    }
  });
});

describe("parser limits cannot be raised past the ceiling", () => {
  it("[I18N-11] maxDepth above the ceiling is clamped", () => {
    const deep = (n: number): string => (n === 0 ? "x" : `<b>${deep(n - 1)}</b>`);
    expect(
      syntaxCode(deep(PARSE_LIMITS.maxDepthCeiling + 5), {
        maxDepth: 1_000_000,
        maxNodes: 1_000_000,
      }),
    ).toBe("NESTING_TOO_DEEP");
    expect(syntaxCode(deep(100), { maxDepth: 1_000_000 })).toBe("OK");
  });
});
