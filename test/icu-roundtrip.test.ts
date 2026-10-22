import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MessageSyntaxError } from "../src/errors";
import type { MessageNode } from "../src/icu/ast";
import { type ParseOptions, parseMessage } from "../src/icu/parse";
import { printMessage } from "../src/icu/print";
import { ICU_SEED, messageTree, messageTreeWithoutTags } from "./support/icu-arbitraries";

function parseOrUndefined(
  source: string,
  options?: ParseOptions,
): readonly MessageNode[] | undefined {
  try {
    return parseMessage(source, options);
  } catch (error) {
    if (error instanceof MessageSyntaxError) return undefined;
    throw error;
  }
}

/** Source strings built from the pieces of the grammar, valid or not. */
const piece = fc.constantFrom(
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
  "\n",
  "plural",
  "select",
  "selectordinal",
  "number",
  "date",
  "time",
  "one",
  "other",
  "=1",
  "offset:1",
  "::",
  "percent",
  "a",
  "b",
  "<b>",
  "</b>",
  "{a}",
  "{n, plural, other {x}}",
  "'{'",
);
const soup = fc.array(piece, { maxLength: 30 }).map((parts) => parts.join(""));

describe("print and parse are inverses", () => {
  it("[I18N-390] print then parse gives back every generated tree", () => {
    fc.assert(
      fc.property(messageTree, (tree) => {
        const source = printMessage(tree);
        expect(parseMessage(source)).toEqual(tree);
      }),
      { ...ICU_SEED, numRuns: 600 },
    );
  });

  it("[I18N-390] parse(print(parse(s))) equals parse(s), and printing is idempotent", () => {
    fc.assert(
      fc.property(messageTree, (tree) => {
        const source = printMessage(tree);
        const first = parseMessage(source);
        const printed = printMessage(first);
        expect(printed).toBe(source);
        expect(parseMessage(printed)).toEqual(first);
        expect(printMessage(parseMessage(printed))).toBe(printed);
      }),
      ICU_SEED,
    );
  });

  it("[I18N-391] with tags turned off, print(…, { tags: false }) round-trips through the same parser option", () => {
    const options = { tags: false };
    fc.assert(
      fc.property(messageTreeWithoutTags, (tree) => {
        const source = printMessage(tree, options);
        expect(parseMessage(source, options)).toEqual(tree);
      }),
      { ...ICU_SEED, numRuns: 600 },
    );
    // `<` and `>` are never quoted then: the quote would not be one.
    expect(printMessage([{ kind: "text", value: "a <b> c" }], options)).toBe("a <b> c");
    expect(printMessage([{ kind: "text", value: "a <b> c" }])).toBe("a '<'b> c");
    // The default (with tags) output would not survive a parser with tags off.
    const withTags = printMessage([{ kind: "text", value: "<b>" }]);
    expect(parseMessage(withTags, options)).not.toEqual([{ kind: "text", value: "<b>" }]);
  });

  it("[I18N-392] any text of a text node survives print and parse, in and out of a plural", () => {
    const anyText = fc.oneof(
      fc.string({ minLength: 1, maxLength: 24 }),
      fc.string({ unit: "grapheme", minLength: 1, maxLength: 12 }),
    );
    fc.assert(
      fc.property(anyText, (value) => {
        const node: MessageNode = { kind: "text", value };
        expect(parseMessage(printMessage([node]))).toEqual([node]);
        const plural: MessageNode = {
          kind: "plural",
          name: "n",
          ordinal: false,
          offset: 0,
          cases: [{ selector: "other", body: [node, { kind: "pound" }, node] }],
        };
        expect(parseMessage(printMessage([plural]))).toEqual([plural]);
        const tag: MessageNode = { kind: "tag", name: "b", children: [node], selfClosing: false };
        expect(parseMessage(printMessage([tag]))).toEqual([tag]);
      }),
      { ...ICU_SEED, numRuns: 600 },
    );
  });

  it("[I18N-393] arbitrary strings: a syntax error or a tree that round-trips, also with tags off", () => {
    const source = fc.oneof(
      fc.string({ maxLength: 50 }),
      fc.string({ unit: "grapheme", maxLength: 20 }),
      soup,
    );
    fc.assert(
      fc.property(source, fc.boolean(), (text, tags) => {
        const options = { tags };
        const first = parseOrUndefined(text, options);
        if (first === undefined) return;
        const printed = printMessage(first, options);
        expect(parseMessage(printed, options)).toEqual(first);
        expect(printMessage(parseMessage(printed, options), options)).toBe(printed);
      }),
      { ...ICU_SEED, numRuns: 1500 },
    );
  });

  it("[I18N-394] every accepted message parses to merged, non-empty text and valid nodes", () => {
    const check = (list: readonly MessageNode[], inPlural: boolean): void => {
      let previous: MessageNode | undefined;
      for (const node of list) {
        if (node.kind === "text") {
          expect(node.value).not.toBe("");
          expect(previous?.kind).not.toBe("text");
        }
        if (node.kind === "pound") expect(inPlural).toBe(true);
        if (node.kind === "plural" || node.kind === "select") {
          expect(
            node.cases.at(-1)?.selector === "other" ||
              node.cases.some((c) => c.selector === "other"),
          ).toBe(true);
          expect(new Set(node.cases.map((c) => c.selector)).size).toBe(node.cases.length);
          for (const entry of node.cases) check(entry.body, node.kind === "plural" || inPlural);
        }
        if (node.kind === "tag") {
          if (node.selfClosing) expect(node.children).toEqual([]);
          check(node.children, inPlural);
        }
        previous = node;
      }
    };
    fc.assert(
      fc.property(fc.oneof(soup, fc.string({ maxLength: 40 })), (text) => {
        const parsed = parseOrUndefined(text);
        if (parsed !== undefined) check(parsed, false);
      }),
      { ...ICU_SEED, numRuns: 1500 },
    );
    fc.assert(
      fc.property(messageTree, (tree) => check(parseMessage(printMessage(tree)), false)),
      ICU_SEED,
    );
  });
});
