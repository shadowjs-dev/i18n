import { describe, expect, it } from "vitest";
import { MessageSyntaxError, type SyntaxErrorCode } from "../src/errors";
import type { MessageNode } from "../src/icu/ast";
import { formatToString } from "../src/icu/format";
import { type ParseOptions, parseMessage } from "../src/icu/parse";
import { printMessage } from "../src/icu/print";
import { makeCtx } from "./support/ctx";

function text(source: string, options?: ParseOptions): string {
  const nodes = parseMessage(source, options);
  if (nodes.length === 0) return "";
  const [first] = nodes;
  expect(nodes).toHaveLength(1);
  if (first?.kind !== "text") throw new Error(`expected a text node for ${source}`);
  return first.value;
}

function format(source: string, values: object, locale = "en"): string {
  const { ctx, reports } = makeCtx(locale);
  const out = formatToString(parseMessage(source), values, ctx);
  expect(reports).toEqual([]);
  return out;
}

/** Line and column of `offset`, computed independently of the error class. */
function lineColumn(source: string, offset: number): readonly [number, number] {
  const before = source.slice(0, offset);
  const lines = before.split("\n");
  return [lines.length, (lines[lines.length - 1]?.length ?? 0) + 1];
}

function caught(source: string, options?: ParseOptions): MessageSyntaxError {
  try {
    parseMessage(source, options);
  } catch (error) {
    if (error instanceof MessageSyntaxError) return error;
    throw error;
  }
  throw new Error(`expected a MessageSyntaxError for ${JSON.stringify(source)}`);
}

describe("plural offset", () => {
  it("[I18N-359] offset: is supported by plural and selectordinal, and rejected with a position elsewhere", () => {
    // Decision: the grammar supports `offset:N` (ICU's), so types.ts needs no change: the type-level
    // parser already skips everything before the first clause selector of a plural.
    expect(parseMessage("{n, plural, offset:2 other {x}}")[0]).toMatchObject({ offset: 2 });
    expect(parseMessage("{n, selectordinal, offset: 3 other {x}}")[0]).toMatchObject({
      offset: 3,
      ordinal: true,
    });
    expect(parseMessage("{n, plural, other {x}}")[0]).toMatchObject({ offset: 0 });
    // `select` has no offset: the word is read as a selector, so its missing brace is the error.
    expect(caught("{n, select, offset:1 other {c}}").syntaxCode).toBe("EXPECT_CASE_OPENING_BRACE");
    // The offset is printed back, and 0 is not printed.
    expect(printMessage(parseMessage("{n, plural, offset:1 one {a} other {b}}"))).toBe(
      "{n, plural, offset:1 one {a} other {b}}",
    );
    expect(printMessage(parseMessage("{n, plural, offset:0 other {b}}"))).toBe(
      "{n, plural, other {b}}",
    );
  });
});

describe("nesting plural, select and #", () => {
  const nested =
    "{a, plural, offset:1 =0 {none} one {A#:{g, select, f {{b, plural, one {B#} other {B# many}}} other {sel#}}} other {A# others}}";

  it("[I18N-360] plural inside select inside plural: # is the innermost plural minus its offset", () => {
    // a=2: remainder 1 is `one`; the select picks f; the inner plural has no offset.
    expect(format(nested, { a: 2, g: "f", b: 1 })).toBe("A1:B1");
    expect(format(nested, { a: 2, g: "f", b: 7 })).toBe("A1:B7 many");
    // A select without a nested plural keeps the outer plural's number (a - offset).
    expect(format(nested, { a: 2, g: "x", b: 1 })).toBe("A1:sel1");
    expect(format(nested, { a: 11, g: "x", b: 1 })).toBe("A10 others");
    expect(format(nested, { a: 0, g: "f", b: 1 })).toBe("none");
    // An inner offset applies to the inner number only.
    expect(
      format("{a, plural, other {{b, plural, offset:2 other {#/{a}}}}}", { a: 10, b: 5 }),
    ).toBe("3/10");
    // Five levels: plural, select, plural, select, plural, each with its own number.
    const innermost = "{z, plural, offset:1 other {Z#}}";
    const inner = `{y, plural, other {Y#{t, select, q {${innermost}} other {-}}}}`;
    const deep = `{x, plural, other {X#{s, select, p {${inner}} other {-}}}}`;
    expect(format(deep, { x: 4, s: "p", y: 5, t: "q", z: 3 })).toBe("X4Y5Z2");
    expect(format(deep, { x: 4, s: "p", y: 5, t: "r", z: 3 })).toBe("X4Y5-");
  });

  it("[I18N-360] # formats with the locale and the offset applies to the displayed number", () => {
    expect(format("{n, plural, offset:1 other {#}}", { n: 1235 })).toBe("1,234");
    expect(format("{n, plural, offset:1 other {#}}", { n: 1235 }, "de")).toBe("1.234");
    expect(format("{n, plural, other {#}}", { n: 1234.5 }, "fr").replace(/\s/g, " ")).toBe(
      "1 234,5",
    );
    // # inside a tag of a plural clause is still the plural number.
    const { ctx } = makeCtx("en");
    expect(formatToString(parseMessage("{n, plural, other {<b>#</b> items}}"), { n: 3 }, ctx)).toBe(
      "3 items",
    );
  });

  it("[I18N-361] # outside any plural is literal text, also inside select and tags", () => {
    expect(parseMessage("Item #1")).toEqual([{ kind: "text", value: "Item #1" }]);
    expect(parseMessage("{g, select, a {#} other {# #}}")[0]).toMatchObject({
      kind: "select",
      cases: [
        { selector: "a", body: [{ kind: "text", value: "#" }] },
        { selector: "other", body: [{ kind: "text", value: "# #" }] },
      ],
    });
    expect(format("{g, select, a {#} other {# #}}", { g: "a" })).toBe("#");
    expect(format("<b>#</b>", {})).toBe("#");
    // The pound turns into a node only inside the plural, and is text again after it.
    const nodes = parseMessage("# {n, plural, other {#}} #");
    expect(nodes.map((node: MessageNode) => node.kind)).toEqual(["text", "plural", "text"]);
    expect(format("# {n, plural, other {#}} #", { n: 3 })).toBe("# 3 #");
    // A quoted # is literal in a plural, and printing keeps both meanings apart.
    for (const source of [
      "# {n, plural, other {'#' #}} #",
      "{n, plural, other {{g, select, other {#}}}}",
    ]) {
      const first = parseMessage(source);
      expect(parseMessage(printMessage(first))).toEqual(first);
    }
  });
});

describe("apostrophes and escaping (ICU DOUBLE_OPTIONAL)", () => {
  // From the ICU4J MessageFormat documentation ("Apostrophe" section) and its examples.
  const TABLE: ReadonlyArray<readonly [source: string, expected: string]> = [
    ["I don't know", "I don't know"],
    ["I don''t know", "I don't know"],
    ["''", "'"],
    ["''''", "''"],
    ["'", "'"],
    ["a'", "a'"],
    ["'a", "'a"],
    ["'a'", "'a'"],
    ["rock 'n' roll", "rock 'n' roll"],
    ["a''b", "a'b"],
    ["'{'", "{"],
    ["'}'", "}"],
    ["'{}'", "{}"],
    ["'{0}'", "{0}"],
    ["'{{}}'", "{{}}"],
    ["a '{' b", "a { b"],
    ["'{'0'}'", "{0}"],
    ["This '{isn''t}' a placeholder", "This {isn't} a placeholder"],
    ["'''{'", "'{"],
    ["'{'''", "{'"],
    ["'{''}'", "{'}"],
    // # is not special outside a plural, so its quotes stay.
    ["'#'", "'#'"],
    ["#", "#"],
    // An unclosed quote runs to the end of the message.
    ["'{", "{"],
    ["x '{y", "x {y"],
    ["'{a''b", "{a'b"],
    ["'{ line one\nline two", "{ line one\nline two"],
    ["'{} still quoted {x} and '' too", "{} still quoted {x} and ' too"],
    // Tags are an extension: a quote before < or > protects the tag characters.
    ["'<b>'x", "<b>x"],
    ["'>'", ">"],
    ["1 < 2 > 0", "1 < 2 > 0"],
    // Quotes that look like quoting but are not.
    ["don't 'quote' me", "don't 'quote' me"],
  ];

  it("[I18N-362] the ICU4J examples: '' is an apostrophe, quotes start only before a special character", () => {
    for (const [source, expected] of TABLE) {
      expect({ source, text: text(source) }).toEqual({ source, text: expected });
    }
  });

  it("[I18N-362] a lone quote before a non-special character never starts quoting", () => {
    expect(text("a'b")).toBe("a'b");
    expect(text("a'b'c")).toBe("a'b'c");
    expect(text("a'?'")).toBe("a'?'");
  });

  it("[I18N-363] quoting inside a plural arm: '#' and '{' and '}' are literal there", () => {
    const source = "{n, plural, other {'#' is # and '{' is a brace, '}' too, it''s fine}}";
    expect(format(source, { n: 3 })).toBe("# is 3 and { is a brace, } too, it's fine");
    expect(format("{n, plural, one {'#'} other {'#'#}}", { n: 1 })).toBe("#");
    expect(format("{n, plural, one {'#'} other {'#'#}}", { n: 5 })).toBe("#5");
    // Inside a select nested in a plural # is still special, so '#' quotes it.
    expect(format("{n, plural, other {{s, select, other {'#' #}}}}", { n: 2, s: "z" })).toBe("# 2");
    // A quote that spans a closing brace of the arm.
    expect(format("{n, plural, other {'}' closes}}", { n: 2 })).toBe("} closes");
    // A doubled apostrophe in an arm, around an argument.
    expect(format("{n, plural, other {it''s {w} # times}}", { n: 2, w: "Ada" })).toBe(
      "it's Ada 2 times",
    );
    // Outside the plural the same '#' keeps its quotes.
    expect(format("'#' {n, plural, other {'#'}}", { n: 2 })).toBe("'#' #");
  });

  it("[I18N-364] an unclosed quote runs to the end, also past a closing brace of the message", () => {
    expect(text("'{abc")).toBe("{abc");
    expect(text("tail '}")).toBe("tail }");
    // Inside an arm it swallows the arm's own closing brace, so the arm is unfinished.
    const error = caught("{n, plural, other {a '{ b}}");
    expect(error.syntaxCode).toBe("UNEXPECTED_END");
    expect(error.offset).toBe(18);
    // Closed quotes around braces are fine inside the same arm.
    expect(format("{n, plural, other {a '{' b}}", { n: 1 })).toBe("a { b");
  });

  it("[I18N-365] the apostrophe rules follow the tags option", () => {
    expect(text("'<b>'", { tags: false })).toBe("'<b>'");
    expect(text("'<b>'")).toBe("<b>");
    expect(text("a<b>c</b>", { tags: false })).toBe("a<b>c</b>");
    expect(text("'{'<b>", { tags: false })).toBe("{<b>");
  });

  it("[I18N-365] print quotes exactly what needs quoting and round-trips every table row", () => {
    for (const [source] of TABLE) {
      const first = parseMessage(source);
      expect(parseMessage(printMessage(first))).toEqual(first);
    }
    expect(printMessage(parseMessage("It''s '{'ok'}'"))).toBe("It''s '{'ok'}'");
    // A quote closes at the next apostrophe, so this text has no apostrophe left to print.
    expect(printMessage(parseMessage("a '{ b ' c"))).toBe("a '{' b  c");
    expect(printMessage(parseMessage("a '{ b"))).toBe("a '{' b");
    expect(printMessage([{ kind: "text", value: "{'" }])).toBe("'{'''");
  });
});

type Row = readonly [
  source: string,
  code: SyntaxErrorCode,
  offset: number,
  line: number,
  column: number,
];

describe("malformed messages", () => {
  const ROWS: readonly Row[] = [
    // Unclosed constructs: the offset is the opening brace (or the `<` of a tag) that never closes.
    ["{", "UNEXPECTED_END", 0, 1, 1],
    ["Hello {name", "UNEXPECTED_END", 6, 1, 7],
    ["Hello {name, ", "UNEXPECTED_END", 6, 1, 7],
    ["{n, number", "UNEXPECTED_END", 0, 1, 1],
    ["{n, number,", "UNEXPECTED_END", 0, 1, 1],
    ["{n, number, percent", "UNEXPECTED_END", 0, 1, 1],
    ["{n, date, short", "UNEXPECTED_END", 0, 1, 1],
    ["{n, plural", "UNEXPECTED_END", 0, 1, 1],
    ["{n, plural,", "UNEXPECTED_END", 0, 1, 1],
    ["{n, plural, offset", "UNEXPECTED_END", 0, 1, 1],
    ["{n, plural, offset:", "UNEXPECTED_END", 0, 1, 1],
    ["{n, plural, one", "UNEXPECTED_END", 0, 1, 1],
    ["{n, plural, one {x}", "UNEXPECTED_END", 0, 1, 1],
    ["{n, plural, other {x}", "UNEXPECTED_END", 0, 1, 1],
    ["{n, plural, other {x", "UNEXPECTED_END", 18, 1, 19],
    ["{n, select, a {x} other {y", "UNEXPECTED_END", 24, 1, 25],
    ["ab {n, select, other {{m, select, other {z}}", "UNEXPECTED_END", 21, 1, 22],
    ["<b>x", "UNCLOSED_TAG", 0, 1, 1],
    ["ab <i>x <b>y</b>", "UNCLOSED_TAG", 3, 1, 4],
    ["{n, plural, other {<b>x}}", "UNCLOSED_TAG", 19, 1, 20],
    // Unmatched closing brace and tag.
    ["}", "UNMATCHED_CLOSING_BRACE", 0, 1, 1],
    ["a}", "UNMATCHED_CLOSING_BRACE", 1, 1, 2],
    ["x {a} }", "UNMATCHED_CLOSING_BRACE", 6, 1, 7],
    ["{n, plural, other {x}}}", "UNMATCHED_CLOSING_BRACE", 22, 1, 23],
    ["</b>", "UNMATCHED_CLOSING_TAG", 0, 1, 1],
    ["x</b>", "UNMATCHED_CLOSING_TAG", 1, 1, 2],
    ["<b>x</i>", "UNMATCHED_CLOSING_TAG", 4, 1, 5],
    // Unknown argument type.
    ["{a, bogus}", "INVALID_ARGUMENT_TYPE", 4, 1, 5],
    ["{a, Number}", "INVALID_ARGUMENT_TYPE", 4, 1, 5],
    ["{a, 5}", "INVALID_ARGUMENT_TYPE", 4, 1, 5],
    ["{a, plurals, other {x}}", "INVALID_ARGUMENT_TYPE", 4, 1, 5],
    ["{a,b,c}", "INVALID_ARGUMENT_TYPE", 3, 1, 4],
    // A plural or select without `other`, or without any clause.
    ["{n, plural, one {x}}", "MISSING_OTHER_CLAUSE", 0, 1, 1],
    ["{n, select, a {x}}", "MISSING_OTHER_CLAUSE", 0, 1, 1],
    ["{n, selectordinal, one {x}}", "MISSING_OTHER_CLAUSE", 0, 1, 1],
    ["{n, plural, =0 {x} one {y}}", "MISSING_OTHER_CLAUSE", 0, 1, 1],
    ["prefix {n, plural, one {x}}", "MISSING_OTHER_CLAUSE", 7, 1, 8],
    ["{n, plural, other {{m, plural, one {x}}}}", "MISSING_OTHER_CLAUSE", 19, 1, 20],
    ["{n, plural, }", "EXPECT_CASES", 0, 1, 1],
    ["{n, select,}", "EXPECT_CASES", 0, 1, 1],
    // Duplicate arms.
    ["{n, plural, one {a} one {b} other {c}}", "DUPLICATE_SELECTOR", 20, 1, 21],
    ["{n, plural, =1 {a} =1 {b} other {c}}", "DUPLICATE_SELECTOR", 19, 1, 20],
    ["{n, select, a {a} a {b} other {c}}", "DUPLICATE_SELECTOR", 18, 1, 19],
    ["{n, select, other {x} other {y}}", "DUPLICATE_SELECTOR", 22, 1, 23],
    // A bad number or date skeleton.
    ["{n, number, ::bogus}", "INVALID_SKELETON", 12, 1, 13],
    ["{n, number, ::}", "INVALID_SKELETON", 12, 1, 13],
    ["{n, number,::bogus}", "INVALID_SKELETON", 11, 1, 12],
    ["{n, number, ::currency/}", "INVALID_SKELETON", 12, 1, 13],
    ["{n, number, ::currency/EURO}", "INVALID_SKELETON", 12, 1, 13],
    ["{n, number, ::.0x}", "INVALID_SKELETON", 12, 1, 13],
    ["{n, number, ::integer-width/00x}", "INVALID_SKELETON", 12, 1, 13],
    ["{n, number, ::percent unit/}", "INVALID_SKELETON", 12, 1, 13],
    ["{d, date, ::q}", "INVALID_SKELETON", 10, 1, 11],
    ["{d, time, ::SSSS}", "INVALID_SKELETON", 10, 1, 11],
    ["{d, date, ::dddd}", "INVALID_SKELETON", 10, 1, 11],
    ["{d, date, ::}", "INVALID_SKELETON", 10, 1, 11],
    // An empty argument name.
    ["{}", "INVALID_ARGUMENT_NAME", 1, 1, 2],
    ["{ }", "INVALID_ARGUMENT_NAME", 2, 1, 3],
    ["{, number}", "INVALID_ARGUMENT_NAME", 1, 1, 2],
    ["{,}", "INVALID_ARGUMENT_NAME", 1, 1, 2],
    ["Hi {  , x}", "INVALID_ARGUMENT_NAME", 6, 1, 7],
    ["{#}", "INVALID_ARGUMENT_NAME", 1, 1, 2],
    // A bad offset.
    ["{n, plural, offset:x other {c}}", "INVALID_OFFSET", 19, 1, 20],
    ["{n, plural, offset:-1 other {c}}", "INVALID_OFFSET", 19, 1, 20],
    ["{n, plural, offset:1.5 other {c}}", "INVALID_OFFSET", 19, 1, 20],
    ["{n, plural, offset:1x other {c}}", "INVALID_OFFSET", 19, 1, 20],
    ["{n, plural, offset: other {c}}", "INVALID_OFFSET", 20, 1, 21],
    ["{n, plural, offset:1234567890 other {c}}", "INVALID_OFFSET", 19, 1, 20],
    ["{n, plural, offset other {c}}", "INVALID_OFFSET", 12, 1, 13],
    ["{n, selectordinal, offset:x other {c}}", "INVALID_OFFSET", 26, 1, 27],
    // Punctuation where something else is required.
    ["{a b}", "EXPECT_ARGUMENT_CLOSING_BRACE", 3, 1, 4],
    ["{n, number x}", "EXPECT_ARGUMENT_CLOSING_BRACE", 11, 1, 12],
    ["{n, plural other {x}}", "EXPECT_COMMA", 11, 1, 12],
    ["{n, select other {x}}", "EXPECT_COMMA", 11, 1, 12],
    ["{n, plural, one a other {c}}", "EXPECT_CASE_OPENING_BRACE", 16, 1, 17],
    ["{n, select, offset:1 other {c}}", "EXPECT_CASE_OPENING_BRACE", 21, 1, 22],
    // Selectors and styles.
    ["{n, plural, few2 {a} other {c}}", "INVALID_SELECTOR", 12, 1, 13],
    ["{n, plural, =x {a} other {c}}", "INVALID_SELECTOR", 12, 1, 13],
    ["{n, plural, = {a} other {c}}", "INVALID_SELECTOR", 12, 1, 13],
    ["{n, plural, =-1 {a} other {c}}", "INVALID_SELECTOR", 12, 1, 13],
    ["{n, plural, =1.5.5 {a} other {c}}", "INVALID_SELECTOR", 12, 1, 13],
    ["{n, plural, =1234567890123456 {a} other {c}}", "INVALID_SELECTOR", 12, 1, 13],
    ["{n, select, {x} other {y}}", "INVALID_SELECTOR", 12, 1, 13],
    ["{n, number, }", "INVALID_STYLE", 11, 1, 12],
    ["{n, number,}", "INVALID_STYLE", 11, 1, 12],
    ["{n, number, a{b}}", "INVALID_STYLE", 13, 1, 14],
    // Lines, columns and code units.
    ["Hi\n{n, plural,\n one {x}\n}", "MISSING_OTHER_CLAUSE", 3, 2, 1],
    ["line one\nHello {name, plural, one {x}}", "MISSING_OTHER_CLAUSE", 15, 2, 7],
    ["a\r\nb {x, nope}", "INVALID_ARGUMENT_TYPE", 9, 2, 7],
    ["\n\n  }", "UNMATCHED_CLOSING_BRACE", 4, 3, 3],
    ["\u{1F600} {x, nope}", "INVALID_ARGUMENT_TYPE", 7, 1, 8],
  ];

  it("[I18N-366] every malformed shape has a stable code and a position (offset, line, column)", () => {
    for (const [source, code, offset, line, column] of ROWS) {
      const error = caught(source);
      expect({ source, code: error.syntaxCode, offset: error.offset }).toEqual({
        source,
        code,
        offset,
      });
      expect({ source, line: error.line, column: error.column }).toEqual({ source, line, column });
      // The explicit line and column agree with an independent computation from the offset.
      expect(lineColumn(source, offset)).toEqual([line, column]);
    }
  });

  it("[I18N-367] the error object: class, name, code, source, and a message that locates the problem", () => {
    const source = "Dear {name},\nyou have {n, plural, one {a message}}";
    const error = caught(source);
    expect(error).toBeInstanceOf(MessageSyntaxError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("MessageSyntaxError");
    expect(error.code).toBe("SYNTAX");
    expect(error.syntaxCode).toBe("MISSING_OTHER_CLAUSE");
    expect(error.source).toBe(source);
    expect(error.message).toContain("MISSING_OTHER_CLAUSE at 2:10");
    expect(error.message).toContain("you have {n, plural, one {a message}}");
    expect(error.message).toContain("^");
    // The caret sits under the offending column.
    const lines = error.message.split("\n");
    const excerpt = lines[1] ?? "";
    const caret = lines[2] ?? "";
    expect(caret.indexOf("^")).toBe(excerpt.indexOf("{n, plural"));
  });

  it("[I18N-367] a very long line gives a bounded excerpt, and the offset is clamped", () => {
    const source = `${"x".repeat(5000)}}${"y".repeat(5000)}`;
    const error = caught(source);
    expect(error.syntaxCode).toBe("UNMATCHED_CLOSING_BRACE");
    expect(error.offset).toBe(5000);
    expect(error.message.length).toBeLessThan(400);
    const clamped = new MessageSyntaxError("UNEXPECTED_END", "x", "abc", 99);
    expect(clamped.offset).toBe(3);
    expect(new MessageSyntaxError("UNEXPECTED_END", "x", "abc", -4).offset).toBe(0);
  });

  it("[I18N-368] a syntax error is the only thing parseMessage throws, for every row and option set", () => {
    const optionSets: readonly (ParseOptions | undefined)[] = [
      undefined,
      { tags: false },
      { maxDepth: 3, maxNodes: 6 },
      { maxLength: 8 },
    ];
    for (const [source] of ROWS) {
      for (const options of optionSets) {
        try {
          parseMessage(source, options);
        } catch (error) {
          expect(error).toBeInstanceOf(MessageSyntaxError);
        }
      }
    }
  });

  it("[I18N-369] argument names, tags and styles that look odd but are valid", () => {
    expect(parseMessage("{ name }")[0]).toMatchObject({ kind: "argument", name: "name" });
    expect(parseMessage("{0} {1}")).toMatchObject([{ name: "0" }, { kind: "text" }, { name: "1" }]);
    expect(parseMessage("{a-b.c_d}")[0]).toMatchObject({ name: "a-b.c_d" });
    expect(parseMessage("{n,number,percent}")[0]).toMatchObject({
      kind: "number",
      style: "percent",
    });
    expect(parseMessage("{ n , number , percent }")[0]).toMatchObject({ style: "percent" });
    expect(parseMessage("{n,plural,one{#}other{#s}}")[0]).toMatchObject({ kind: "plural" });
    expect(parseMessage("{n, plural,\n  one {#}\n  other {#s}\n}")[0]).toMatchObject({
      kind: "plural",
    });
    // Unicode white space that ICU treats as pattern white space.
    expect(parseMessage("{‎n‎,‎select‎,‎other‎{x}}")[0]).toMatchObject({
      kind: "select",
      name: "n",
    });
  });
});
