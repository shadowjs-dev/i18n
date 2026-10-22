import fc from "fast-check";
import type { MessageCase, MessageNode } from "../../src/icu/ast";
import { parseDateSkeleton } from "../../src/icu/date-skeleton";
import { parseNumberSkeleton } from "../../src/icu/number-skeleton";

/** Fixed seed and run count of the ICU property tests. */
export const ICU_SEED = { seed: 20261010, numRuns: 300 } as const;

/** Argument names the generators use, so a values record can supply all of them. */
export const NAMES = ["a", "b", "count", "who", "x1"] as const;

const NAME_CHARS = [..."abcxyzABC019_-.=:/$%@~&*+!?"] as const;
const WEIRD_NAME_CHARS = ["é", "名", "\u{1F600}", "م"] as const;
const TEXT_CHARS = [
  ..."ab1 \n,.=:/-_!?",
  "{",
  "}",
  "'",
  "#",
  "<",
  ">",
  "</",
  "<b>",
  "''",
  "'{",
  "{'",
  "é",
  "\u{1F600}",
  "‎",
  "م",
] as const;

/** An argument name: letters, digits and punctuation that the grammar allows, never syntax. */
export const argumentName: fc.Arbitrary<string> = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom(...NAMES) },
  {
    weight: 2,
    arbitrary: fc
      .array(fc.constantFrom(...NAME_CHARS, ...WEIRD_NAME_CHARS), { minLength: 1, maxLength: 5 })
      .map((chars) => chars.join("")),
  },
);

/** Literal text full of the characters that are hard to print and parse back. */
export const textValue: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...TEXT_CHARS), { minLength: 1, maxLength: 8 })
  .map((chars) => chars.join(""));

const tagName: fc.Arbitrary<string> = fc
  .tuple(fc.constantFrom(..."abBiu"), fc.array(fc.constantFrom(..."ab09-_"), { maxLength: 3 }))
  .map(([first, rest]) => first + rest.join(""));

const PLURAL_KEYWORDS = ["zero", "one", "two", "few", "many"] as const;

const selectSelector: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(..."abz09_-=:,'#<>."), { minLength: 1, maxLength: 4 })
  .map((chars) => chars.join(""))
  .filter((selector) => selector !== "other");

const exactSelector: fc.Arbitrary<string> = fc
  .tuple(fc.integer({ min: 0, max: 999 }), fc.option(fc.integer({ min: 0, max: 99 })))
  .map(([whole, fraction]) => (fraction === null ? `=${whole}` : `=${whole}.${fraction}`));

/** Merges adjacent text nodes, as the parser does. */
export function normalize(nodes: readonly MessageNode[]): MessageNode[] {
  const out: MessageNode[] = [];
  for (const node of nodes) {
    const previous = out[out.length - 1];
    if (node.kind === "text" && previous?.kind === "text") {
      out[out.length - 1] = { kind: "text", value: previous.value + node.value };
    } else {
      out.push(node);
    }
  }
  return out;
}

const numberStyle: fc.Arbitrary<string | undefined> = fc.constantFrom(
  undefined,
  "percent",
  "integer",
  "price",
  "::currency/EUR .00",
  "::compact-short",
  "::percent",
);
const dateStyle: fc.Arbitrary<string | undefined> = fc.constantFrom(
  undefined,
  "short",
  "long",
  "day",
  "::yMMMd",
  "::Hm",
);

function cases(
  depth: number,
  inPlural: boolean,
  selectors: fc.Arbitrary<readonly string[]>,
): fc.Arbitrary<MessageCase[]> {
  return selectors.chain((names) => {
    const all = [...names, "other"];
    return fc
      .array(nodes(depth - 1, inPlural), { minLength: all.length, maxLength: all.length })
      .map((bodies) => all.map((selector, index) => ({ selector, body: bodies[index] ?? [] })));
  });
}

function leaf(inPlural: boolean): fc.Arbitrary<MessageNode> {
  const base: fc.Arbitrary<MessageNode>[] = [
    textValue.map((value): MessageNode => ({ kind: "text", value })),
    argumentName.map((name): MessageNode => ({ kind: "argument", name })),
    fc.tuple(argumentName, numberStyle).map(
      ([name, style]): MessageNode => ({
        kind: "number",
        name,
        style,
        skeleton: style?.startsWith("::") ? parseNumberSkeleton(style.slice(2)) : undefined,
      }),
    ),
    fc.tuple(argumentName, fc.constantFrom("date", "time"), dateStyle).map(
      ([name, kind, style]): MessageNode => ({
        kind,
        name,
        style,
        skeleton: style?.startsWith("::") ? parseDateSkeleton(style.slice(2)) : undefined,
      }),
    ),
    tagName.map((name): MessageNode => ({ kind: "tag", name, children: [], selfClosing: true })),
  ];
  if (inPlural) base.push(fc.constant<MessageNode>({ kind: "pound" }));
  return fc.oneof(...base);
}

/** A list of valid nodes of at most `depth` levels of plural, select and tag nesting. */
export function nodes(depth: number, inPlural: boolean): fc.Arbitrary<MessageNode[]> {
  const items: fc.Arbitrary<MessageNode>[] = [leaf(inPlural), leaf(inPlural)];
  if (depth > 0) {
    items.push(
      fc
        .tuple(
          argumentName,
          fc.boolean(),
          fc.option(fc.integer({ min: 1, max: 999_999_999 }), { nil: 0 }),
          cases(
            depth,
            true,
            fc
              .uniqueArray(fc.oneof(fc.constantFrom(...PLURAL_KEYWORDS), exactSelector), {
                maxLength: 3,
              })
              .map((list) => list),
          ),
        )
        .map(
          ([name, ordinal, offset, entries]): MessageNode => ({
            kind: "plural",
            name,
            ordinal,
            offset,
            cases: entries,
          }),
        ),
      fc
        .tuple(
          argumentName,
          cases(depth, inPlural, fc.uniqueArray(selectSelector, { maxLength: 3 })),
        )
        .map(([name, entries]): MessageNode => ({ kind: "select", name, cases: entries })),
      fc
        .tuple(tagName, nodes(depth - 1, inPlural))
        .filter(([, children]) => children.length > 0)
        .map(
          ([name, children]): MessageNode => ({
            kind: "tag",
            name,
            children,
            selfClosing: false,
          }),
        ),
    );
  }
  return fc.array(fc.oneof(...items), { maxLength: 4 }).map(normalize);
}

/** A whole valid message tree (tags allowed). */
export const messageTree: fc.Arbitrary<MessageNode[]> = nodes(3, false);

/** A whole valid message tree without tag nodes, for parsers run with `tags: false`. */
export const messageTreeWithoutTags: fc.Arbitrary<MessageNode[]> = messageTree.map(stripTags);

function stripTags(list: readonly MessageNode[]): MessageNode[] {
  const out: MessageNode[] = [];
  for (const node of list) {
    if (node.kind === "tag") out.push(...stripTags(node.children));
    else if (node.kind === "plural") {
      out.push({
        ...node,
        cases: node.cases.map((entry) => ({
          selector: entry.selector,
          body: stripTags(entry.body),
        })),
      });
    } else if (node.kind === "select") {
      out.push({
        ...node,
        cases: node.cases.map((entry) => ({
          selector: entry.selector,
          body: stripTags(entry.body),
        })),
      });
    } else out.push(node);
  }
  return normalize(out);
}

/** Replaces text values by `""` so that two trees compare by structure only. */
export function shape(list: readonly MessageNode[]): unknown[] {
  return list.map((node) => {
    switch (node.kind) {
      case "text":
        return { kind: "text" };
      case "plural":
      case "select":
        return {
          ...node,
          cases: node.cases.map((entry) => ({ selector: entry.selector, body: shape(entry.body) })),
        };
      case "tag":
        return { ...node, children: shape(node.children) };
      default:
        return node;
    }
  });
}

/** Values of every kind the formatter has to survive. */
export const anyValue: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 8,
    arbitrary: fc.constantFrom<unknown>(
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -0,
      0,
      1,
      -1,
      1.5,
      2 ** 53,
      1e21,
      1e-7,
      Number.MAX_VALUE,
      1n,
      -5n,
      2n ** 80n,
      new Date(Number.NaN),
      new Date(0),
      new Date(8.64e15),
      null,
      undefined,
      true,
      false,
      "",
      " ",
      "abc",
      "42",
      "1e3",
      "Infinity",
      "2024-01-01",
      "x{y}",
      "<b>x</b>",
      {},
      [],
      [1, 2],
      Object.create(null),
      { toString: () => "toString" },
      Symbol("s"),
      () => 3,
      () => "s",
      () => Number.NaN,
      () => undefined,
    ),
  },
  { weight: 2, arbitrary: fc.string() },
  { weight: 2, arbitrary: fc.double({ noNaN: false }) },
  { weight: 1, arbitrary: fc.bigInt() },
  { weight: 1, arbitrary: fc.date({ noInvalidDate: false }) },
  { weight: 1, arbitrary: fc.anything() },
);

/** A values record for the fixed `NAMES`; any of them may be missing. */
export const valuesRecord: fc.Arbitrary<Record<string, unknown>> = fc.record(
  Object.fromEntries(NAMES.map((name) => [name, anyValue])) as Record<
    string,
    fc.Arbitrary<unknown>
  >,
  { requiredKeys: [] },
);
