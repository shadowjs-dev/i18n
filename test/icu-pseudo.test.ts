import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { I18nError, MessageSyntaxError } from "../src/errors";
import type { MessageNode } from "../src/icu/ast";
import { parseMessage } from "../src/icu/parse";
import { printMessage } from "../src/icu/print";
import { type PseudoOptions, pseudoLocalize } from "../src/icu/pseudo";
import { messageSignature } from "../src/icu/validate";
import { ICU_SEED, messageTree, shape } from "./support/icu-arbitraries";

function pseudo(source: string, options: PseudoOptions = {}): string {
  return pseudoLocalize({ k: source }, options).k;
}

const PLAIN: PseudoOptions = { brackets: false, expansion: 0 };

describe("pseudo-localization: accents, expansion, brackets", () => {
  it("[I18N-388] every ASCII letter has its own accented look-alike; other characters stay", () => {
    expect(pseudo("abcdefghijklmnopqrstuvwxyz", PLAIN)).toBe("áƀçðéƒĝĥíĵķļɱñóþǫŕšţúṽŵẋýž");
    expect(pseudo("ABCDEFGHIJKLMNOPQRSTUVWXYZ", PLAIN)).toBe("ÁƁÇÐÉƑĜĤÍĴĶĻṀÑÓÞǪŔŠŢÚṼŴẊÝŽ");
    const symbols = "0123456789 .,;:!?-_()[]/\\@%&*+=|~^$";
    expect(pseudo(symbols, PLAIN)).toBe(symbols);
    // Non-Latin text and emoji pass through untouched, also astral code points.
    expect(pseudo("日本語 مرحبا 😀 é ñ", PLAIN)).toBe("日本語 مرحبا 😀 é ñ");
    // The 52 look-alikes are distinct, none is ASCII, and each is one UTF-16 unit.
    const letters = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"].join("");
    const mapped = [...pseudo(letters, PLAIN)];
    expect(mapped).toHaveLength(52);
    expect(new Set(mapped).size).toBe(52);
    for (const character of mapped) {
      expect(character.length).toBe(1);
      expect(character.charCodeAt(0)).toBeGreaterThan(127);
    }
  });

  it("[I18N-388] expansion pads each text run with tildes before its trailing white space", () => {
    const table: ReadonlyArray<
      readonly [source: string, expansion: number | undefined, out: string]
    > = [
      ["Hello", undefined, "Ĥéļļó~~"],
      ["Hello", 0.3, "Ĥéļļó~~"],
      ["Hello", 0, "Ĥéļļó"],
      ["Hello", 0.5, "Ĥéļļó~~~"],
      ["Hello", 1, "Ĥéļļó~~~~~"],
      ["Hello", 2, `Ĥéļļó${"~".repeat(10)}`],
      ["a", 0.3, "á~"],
      ["Hello ", 0.3, "Ĥéļļó~~ "],
      ["  ", 0.3, "  "],
      ["", 0.3, ""],
      ["Hi {n} there", undefined, "Ĥí~ {n} ţĥéŕé~~"],
      ["<b>Bold</b>", undefined, "<b>Ɓóļð~~</b>"],
      [
        "{n, plural, one {# item} other {# items}}",
        undefined,
        "{n, plural, one {# íţéɱ~~} other {# íţéɱš~~}}",
      ],
      // Out-of-range values: NaN and negative mean none, and a huge value is capped at 10.
      ["Hello", Number.NaN, "Ĥéļļó"],
      ["Hello", -1, "Ĥéļļó"],
      ["Hello", Number.NEGATIVE_INFINITY, "Ĥéļļó"],
      ["Hello", Number.POSITIVE_INFINITY, `Ĥéļļó${"~".repeat(50)}`],
      ["Hello", 1e9, `Ĥéļļó${"~".repeat(50)}`],
    ];
    for (const [source, expansion, out] of table) {
      const options: PseudoOptions =
        expansion === undefined ? { brackets: false } : { brackets: false, expansion };
      expect({ source, expansion, out: pseudo(source, options) }).toEqual({
        source,
        expansion,
        out,
      });
    }
  });

  it("[I18N-388] brackets: [ ] by default, a custom pair as written, or none", () => {
    expect(pseudo("Hi")).toBe("[Ĥí~]");
    expect(pseudo("")).toBe("[]");
    expect(pseudo("Hi", { brackets: ["«", "»"], expansion: 0 })).toBe("«Ĥí»");
    expect(pseudo("Hi", { brackets: ["<<", ">>"], expansion: 0 })).toBe("<<Ĥí>>");
    expect(pseudo("Hi", { brackets: ["", ""], expansion: 0 })).toBe("Ĥí");
    expect(pseudo("Hi", { brackets: false, expansion: 0 })).toBe("Ĥí");
    expect(pseudo("{n}", { expansion: 0 })).toBe("[{n}]");
  });

  it("[I18N-388] bidi mode wraps text runs in embedding marks, with no accents and no padding", () => {
    const RLE = "‫";
    const PDF = "‬";
    const RLM = "‏";
    expect(pseudo("Hello {name}", { mode: "bidi", brackets: false })).toBe(
      `${RLE}Hello ${PDF}${RLM}{name}`,
    );
    expect(pseudo("Hello", { mode: "bidi", brackets: false, expansion: 5 })).toBe(
      `${RLE}Hello${PDF}${RLM}`,
    );
    expect(pseudo("", { mode: "bidi", brackets: false })).toBe("");
    expect(pseudo("<b>x</b>", { mode: "bidi", brackets: false })).toBe(
      `<b>${RLE}x${PDF}${RLM}</b>`,
    );
    expect(pseudo("x", { mode: "bidi" })).toBe(`[${RLE}x${PDF}${RLM}]`);
  });
});

describe("pseudo-localization keeps the ICU syntax", () => {
  const RICH =
    "{count, plural, offset:1 =0 {no files} one {# file} other {# files}} <b>bold {name}</b> {d, date, short} {n, number, ::currency/EUR .00} {g, select, male {he} other {they}} {p, selectordinal, one {#st} other {#th}} <br/>";

  it("[I18N-389] clauses, selectors, offsets, argument types, styles and tag names are never accented", () => {
    const out = pseudo(RICH, { brackets: false });
    for (const fragment of [
      "{count, plural, offset:1 =0 {",
      " one {# ",
      " other {# ",
      "<b>",
      "</b>",
      "<br/>",
      "{name}",
      "{d, date, short}",
      "{n, number, ::currency/EUR .00}",
      "{g, select, male {",
      " other {",
      "{p, selectordinal, one {#",
    ]) {
      expect({ fragment, found: out.includes(fragment) }).toEqual({ fragment, found: true });
    }
    // Only literal text changed: the shape of the tree is the same.
    expect(shape(parseMessage(out))).toEqual(shape(parseMessage(RICH)));
    // The literal words are accented and padded.
    expect(out).toContain("ƒíļéš~~");
    expect(out).toContain("{count, plural");
  });

  it("[I18N-389] the result is valid ICU with the same arguments and tags", () => {
    for (const options of [
      {},
      { mode: "bidi" as const },
      { expansion: 1 },
      { brackets: false as const },
    ]) {
      const out = pseudo(RICH, options);
      const before = messageSignature(parseMessage(RICH));
      const after = messageSignature(parseMessage(out));
      expect([...after.args]).toEqual([...before.args]);
      expect([...after.tags]).toEqual([...before.tags]);
    }
  });

  it("[I18N-389] quoted text keeps its meaning: the apostrophes and braces stay balanced", () => {
    const out = pseudo("It''s '{'ok'}' and '{x}' # {n, plural, other {'#' is #}}", PLAIN);
    expect(parseMessage(out)).toMatchObject([
      { kind: "text", value: "Íţ'š {óķ} áñð {ẋ} # " },
      { kind: "plural" },
    ]);
  });

  it("[I18N-389] property: pseudo(s) keeps every argument name and tag name and every brace pairing", () => {
    const optionSets: readonly PseudoOptions[] = [
      { brackets: false },
      { brackets: false, expansion: 2.5 },
      { brackets: false, mode: "bidi" },
      { brackets: false, expansion: 0 },
    ];
    fc.assert(
      fc.property(messageTree, fc.constantFrom(...optionSets), (tree, options) => {
        const source = printMessage(tree);
        const out = pseudo(source, options);
        const before = parseMessage(source);
        const after = parseMessage(out);
        // The same tree apart from the text values.
        expect(shape(after)).toEqual(shape(before));
        // The same argument names (with their kinds) and tag names.
        const a = messageSignature(before);
        const b = messageSignature(after);
        expect([...b.args]).toEqual([...a.args]);
        expect([...b.tags]).toEqual([...a.tags]);
        // The same sequence of unquoted braces, so every { and } pairs as it did. (A select selector
        // is raw text that a quote scan would misread, so trees with an apostrophe in one are skipped.)
        if (!hasQuoteInSelector(tree)) {
          expect(unquotedBraces(out)).toBe(unquotedBraces(printMessage(before)));
          expect(unquotedBraces(out)).toBe(unquotedBraces(source));
        }
        // With the default brackets the body is the same with one pair of characters around it.
        const bracketed = pseudo(source, { ...options, brackets: ["[", "]"] });
        expect(bracketed).toBe(`[${out}]`);
      }),
      { ...ICU_SEED, numRuns: 500 },
    );
  });
});

function hasQuoteInSelector(list: readonly MessageNode[]): boolean {
  return list.some((node) => {
    if (node.kind === "plural" || node.kind === "select") {
      return node.cases.some(
        (entry) => entry.selector.includes("'") || hasQuoteInSelector(entry.body),
      );
    }
    return node.kind === "tag" && hasQuoteInSelector(node.children);
  });
}

/** The unquoted `{` and `}` of a message in order, found by an independent ICU-style quote scan. */
function unquotedBraces(source: string): string {
  let out = "";
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === "'") {
      const next = source[index + 1];
      if (next === "'") {
        index += 2;
      } else if (next !== undefined && "{}<>#".includes(next)) {
        index += 1;
        for (;;) {
          const close = source.indexOf("'", index);
          if (close === -1) {
            index = source.length;
            break;
          }
          if (source[close + 1] === "'") {
            index = close + 2;
          } else {
            index = close + 1;
            break;
          }
        }
      } else {
        index += 1;
      }
    } else {
      if (character === "{" || character === "}") out += character;
      index += 1;
    }
  }
  return out;
}

describe("pseudo-localization of catalogs", () => {
  it("[I18N-389] nested catalogs keep their keys and order; the input is not changed", () => {
    const catalog = {
      title: "Settings",
      nav: { home: "Home", items: { one: "{n, plural, one {# item} other {# items}}" } },
      empty: "",
    };
    const copy = structuredClone(catalog);
    const out = pseudoLocalize(catalog, { expansion: 0 });
    expect(catalog).toEqual(copy);
    expect(out).toEqual({
      title: "[Šéţţíñĝš]",
      nav: { home: "[Ĥóɱé]", items: { one: "[{n, plural, one {# íţéɱ} other {# íţéɱš}}]" } },
      empty: "[]",
    });
    expect(Object.keys(out)).toEqual(["title", "nav", "empty"]);
    expect(Object.keys(out.nav)).toEqual(["home", "items"]);
  });

  it("[I18N-389] a __proto__ key stays an own key, and accessor properties are skipped", () => {
    const own = JSON.parse('{"__proto__": "Hi", "ok": "Yes"}') as { ok: string };
    const out = pseudoLocalize(own, { brackets: false, expansion: 0 });
    expect(Object.hasOwn(out, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(out, "__proto__")?.value).toBe("Ĥí");
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    const withAccessor = { plain: "Hi" };
    Object.defineProperty(withAccessor, "computed", {
      enumerable: true,
      get() {
        throw new Error("must not be read");
      },
    });
    expect(pseudoLocalize(withAccessor, { brackets: false, expansion: 0 })).toEqual({
      plain: "Ĥí",
    });
  });

  it("[I18N-389] a message that is not valid ICU throws MessageSyntaxError; a too deep catalog throws INVALID_CATALOG", () => {
    expect(() => pseudoLocalize({ bad: "{n, plural, one {x}}" })).toThrow(MessageSyntaxError);
    expect(() => pseudoLocalize({ bad: "}" })).toThrow(MessageSyntaxError);
    let deep: Record<string, unknown> = { leaf: "x" };
    for (let level = 0; level < 40; level += 1) deep = { next: deep };
    try {
      pseudoLocalize(deep as never);
      throw new Error("expected INVALID_CATALOG");
    } catch (error) {
      expect(error).toBeInstanceOf(I18nError);
      expect((error as I18nError).code).toBe("INVALID_CATALOG");
    }
    // Plain text with nothing to parse is fine at depth 32.
    let ok: Record<string, unknown> = { leaf: "x" };
    for (let level = 0; level < 31; level += 1) ok = { next: ok };
    expect(() => pseudoLocalize(ok as never)).not.toThrow();
  });
});
