import type { MessageCase, MessageNode } from "./ast";

/**
 * Options of {@link printMessage}.
 *
 * @example
 * ```ts
 * import { type PrintOptions, parseMessage, printMessage } from "@shadow-js/i18n/icu";
 *
 * const options: PrintOptions = { tags: false };
 * const nodes = parseMessage("a <b> c", { tags: false });
 * console.log(printMessage(nodes, options)); // "a <b> c"
 * ```
 * @since 1.0.0
 */
export interface PrintOptions {
  /**
   * Print for a parser that recognizes tags (`true`) or one that does not (`false`, like
   * `parseMessage(source, { tags: false })`). With `true`, a `<` that could open or close a tag is
   * quoted. With `false`, `<` and `>` are plain text and are never quoted, because the parser
   * would not treat the quote as one. Use the value you parsed with.
   * @default true
   */
  readonly tags?: boolean;
}

/** True when the character at `index` must be quoted to survive a parse. */
function isSpecial(text: string, index: number, inPlural: boolean, tags: boolean): boolean {
  const character = text[index];
  if (character === "{" || character === "}") return true;
  if (character === "#") return inPlural;
  if (character !== "<" || !tags) return false;
  // Only a `<` that could open or close a tag needs the quote.
  const next = text.charCodeAt(index + 1);
  return next === 47 || (next >= 65 && next <= 90) || (next >= 97 && next <= 122);
}

/**
 * Escapes literal text so that parsing the result gives the same text back. A run of special
 * characters is wrapped in one pair of quotes, and apostrophes inside the run are doubled, because
 * closing and reopening the quote around a lone apostrophe would produce `''` and change the meaning.
 */
function escapeText(text: string, inPlural: boolean, tags: boolean): string {
  let out = "";
  let index = 0;
  while (index < text.length) {
    if (isSpecial(text, index, inPlural, tags)) {
      let run = "";
      while (
        index < text.length &&
        (text[index] === "'" || isSpecial(text, index, inPlural, tags))
      ) {
        run += text[index] === "'" ? "''" : text[index];
        index += 1;
      }
      out += `'${run}'`;
    } else if (text[index] === "'") {
      out += "''";
      index += 1;
    } else {
      out += text[index];
      index += 1;
    }
  }
  return out;
}

/** A style as the parser reads it back: an apostrophe doubled, a run of braces quoted. */
function quoteStyle(style: string): string {
  let out = "";
  let index = 0;
  while (index < style.length) {
    const character = style.charAt(index);
    if (character === "'") {
      out += "''";
      index += 1;
    } else if (character === "{" || character === "}") {
      // The whole run of braces goes in one quote, so `'}'` never meets another quote.
      let end = index;
      while (style.charAt(end) === "{" || style.charAt(end) === "}") end += 1;
      out += `'${style.slice(index, end)}'`;
      index = end;
    } else {
      out += character;
      index += 1;
    }
  }
  return out;
}

function printCases(cases: readonly MessageCase[], inPlural: boolean, tags: boolean): string {
  return cases.map((c) => ` ${c.selector} {${printNodes(c.body, inPlural, tags)}}`).join("");
}

function printNodes(nodes: readonly MessageNode[], inPlural: boolean, tags: boolean): string {
  let out = "";
  for (const node of nodes) {
    switch (node.kind) {
      case "text":
        out += escapeText(node.value, inPlural, tags);
        break;
      case "argument":
        out += `{${node.name}}`;
        break;
      case "pound":
        out += "#";
        break;
      case "number":
      case "date":
      case "time":
        out += `{${node.name}, ${node.kind}${node.style === undefined ? "" : `, ${quoteStyle(node.style)}`}}`;
        break;
      case "plural":
        out += `{${node.name}, ${node.ordinal ? "selectordinal" : "plural"},${
          node.offset === 0 ? "" : ` offset:${node.offset}`
        }${printCases(node.cases, true, tags)}}`;
        break;
      case "select":
        out += `{${node.name}, select,${printCases(node.cases, inPlural, tags)}}`;
        break;
      case "tag":
        out += node.selfClosing
          ? `<${node.name}/>`
          : `<${node.name}>${printNodes(node.children, inPlural, tags)}</${node.name}>`;
        break;
    }
  }
  return out;
}

/**
 * Prints a parsed message back to ICU MessageFormat source. The output is normalized (one space
 * after each comma, one space before each clause) and quotes only the characters that need it, so
 * `parseMessage(printMessage(parseMessage(s)))` equals `parseMessage(s)` for every `s` that parses (with
 * the same `tags` option on both sides).
 * Use it to write back a tree you transformed, as {@link pseudoLocalize} does.
 *
 * @param nodes A parsed message, as {@link parseMessage} returns it.
 * @param options Whether the parser that reads the output recognizes tags; use the `tags` value you
 * parsed with so that `<` is quoted exactly when it needs to be.
 * @returns ICU MessageFormat source. An empty array gives `""`.
 * @example
 * ```ts
 * import { parseMessage, printMessage } from "@shadow-js/i18n/icu";
 *
 * console.log(printMessage(parseMessage("{ n ,plural,one{# item}other{# items}}")));
 * // "{n, plural, one {# item} other {# items}}"
 * console.log(printMessage(parseMessage("It''s {n}"))); // "It''s {n}"
 * ```
 * @since 1.0.0
 */
export function printMessage(nodes: readonly MessageNode[], options?: PrintOptions): string {
  return printNodes(nodes, false, options?.tags ?? true);
}
