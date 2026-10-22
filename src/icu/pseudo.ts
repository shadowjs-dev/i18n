import { I18nError } from "../errors";
import type { Messages } from "../types";
import type { MessageNode } from "./ast";
import { parseMessage } from "./parse";
import { printMessage } from "./print";

/**
 * Options of {@link pseudoLocalize}.
 *
 * @example
 * ```ts
 * import { type PseudoOptions, pseudoLocalize } from "@shadow-js/i18n/icu";
 *
 * const rtl: PseudoOptions = { mode: "bidi", brackets: false };
 * const messages = pseudoLocalize({ title: "Settings" }, rtl);
 * console.log(messages.title.length); // 11: the 8 letters plus 3 direction marks
 * ```
 * @since 1.0.0
 */
export interface PseudoOptions {
  /**
   * `"accented"` swaps ASCII letters for accented look-alikes and pads each text run with `~` for
   * length. `"bidi"` wraps each non-empty text run in right-to-left embedding marks (U+202B, U+202C,
   * then U+200F) to exercise right-to-left layouts, with no padding.
   * @default "accented"
   */
  readonly mode?: "accented" | "bidi";
  /**
   * Extra length as a fraction of each text run: `Math.ceil(length * expansion)` tildes are added
   * before the run's trailing white space. Runs of only white space are not padded. Ignored in
   * `"bidi"` mode. The value is clamped to `0..10`; `NaN` and negative values mean `0`.
   * @default 0.3
   */
  readonly expansion?: number;
  /**
   * The two strings put around every message, as they are (not escaped), so a hard-coded string
   * without them stands out; `false` for none.
   * @default ["[", "]"]
   */
  readonly brackets?: false | readonly [string, string];
}

const ACCENTS: Readonly<Record<string, string>> = {
  a: "á",
  b: "ƀ",
  c: "ç",
  d: "ð",
  e: "é",
  f: "ƒ",
  g: "ĝ",
  h: "ĥ",
  i: "í",
  j: "ĵ",
  k: "ķ",
  l: "ļ",
  m: "ɱ",
  n: "ñ",
  o: "ó",
  p: "þ",
  q: "ǫ",
  r: "ŕ",
  s: "š",
  t: "ţ",
  u: "ú",
  v: "ṽ",
  w: "ŵ",
  x: "ẋ",
  y: "ý",
  z: "ž",
  A: "Á",
  B: "Ɓ",
  C: "Ç",
  D: "Ð",
  E: "É",
  F: "Ƒ",
  G: "Ĝ",
  H: "Ĥ",
  I: "Í",
  J: "Ĵ",
  K: "Ķ",
  L: "Ļ",
  M: "Ṁ",
  N: "Ñ",
  O: "Ó",
  P: "Þ",
  Q: "Ǫ",
  R: "Ŕ",
  S: "Š",
  T: "Ţ",
  U: "Ú",
  V: "Ṽ",
  W: "Ŵ",
  X: "Ẋ",
  Y: "Ý",
  Z: "Ž",
};
const RLM = "‏";
const RLE = "‫";
const PDF = "‬";

function convertText(text: string, mode: "accented" | "bidi", expansion: number): string {
  if (mode === "bidi") return text === "" ? text : `${RLE}${text}${PDF}${RLM}`;
  let out = "";
  for (const character of text) out += ACCENTS[character] ?? character;
  const extra = Math.ceil(text.length * expansion);
  if (extra === 0 || text.trim() === "") return out;
  // Padding goes before trailing white space so "Hello " stays "Hello~~ " and keeps its separator.
  const trimmed = out.trimEnd();
  return `${trimmed}${"~".repeat(extra)}${out.slice(trimmed.length)}`;
}

function transform(
  nodes: readonly MessageNode[],
  mode: "accented" | "bidi",
  expansion: number,
): MessageNode[] {
  return nodes.map((node): MessageNode => {
    switch (node.kind) {
      case "text":
        return { kind: "text", value: convertText(node.value, mode, expansion) };
      case "plural":
        return {
          ...node,
          cases: node.cases.map((entry) => ({
            selector: entry.selector,
            body: transform(entry.body, mode, expansion),
          })),
        };
      case "select":
        return {
          ...node,
          cases: node.cases.map((entry) => ({
            selector: entry.selector,
            body: transform(entry.body, mode, expansion),
          })),
        };
      case "tag":
        return { ...node, children: transform(node.children, mode, expansion) };
      default:
        return node;
    }
  });
}

/**
 * Pseudo-localizes a catalog for tests and visual checks: literal text becomes accented look-alike
 * letters (still readable) and longer, while arguments, plural and select structure and tags stay
 * intact, so a screen with a hard-coded string stands out and a clipped layout shows up. Every
 * message is parsed and printed back, so with the default brackets the result is valid ICU with the
 * same arguments and tags, and passes {@link validateCatalogs} against the source catalog.
 *
 * @param catalog A nested catalog. Accessor properties are skipped; a `__proto__` key stays an own
 * key.
 * @param options Mode, expansion and brackets.
 * @returns A new catalog with the same keys in the same order. The input is not changed.
 * @throws `MessageSyntaxError` (from `@shadow-js/i18n`) when a message is not valid ICU syntax.
 * @throws `I18nError` with code `"INVALID_CATALOG"` when the catalog is nested deeper than 32
 * levels.
 * @example
 * ```ts
 * import { pseudoLocalize } from "@shadow-js/i18n/icu";
 *
 * const en = {
 *   greet: "Hello {name}",
 *   cart: { items: "{count, plural, one {# item} other {# items}}" },
 * };
 * const pseudo = pseudoLocalize(en);
 * console.log(pseudo.greet); // "[Ĥéļļó~~ {name}]"
 * console.log(pseudo.cart.items); // "[{count, plural, one {# íţéɱ~~} other {# íţéɱš~~}}]"
 * ```
 * @see {@link PseudoOptions}
 * @since 1.0.0
 */
export function pseudoLocalize<M extends Messages>(catalog: M, options: PseudoOptions = {}): M {
  const mode = options.mode ?? "accented";
  const requested = options.expansion ?? 0.3;
  // NaN and negative values mean no padding; the cap keeps a typo from building a huge string.
  const expansion = mode === "accented" && requested > 0 ? Math.min(requested, 10) : 0;
  const brackets = options.brackets === undefined ? (["[", "]"] as const) : options.brackets;
  const convert = (value: string | Messages, depth: number): string | Messages => {
    if (depth > 32) throw new I18nError("INVALID_CATALOG", "the catalog is nested deeper than 32.");
    if (typeof value === "string") {
      const body = printMessage(transform(parseMessage(value), mode, expansion));
      return brackets === false ? body : `${brackets[0]}${body}${brackets[1]}`;
    }
    const out: Record<string, string | Messages> = {};
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) continue;
      // defineProperty so a "__proto__" key stays an own property instead of setting the prototype.
      Object.defineProperty(out, key, {
        value: convert(descriptor.value as string | Messages, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  };
  return convert(catalog, 0) as M;
}
