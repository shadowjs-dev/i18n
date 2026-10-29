import { MessageSyntaxError, type SyntaxErrorCode } from "../errors";
import type { MessageCase, MessageNode } from "./ast";
import { DateSkeletonError, parseDateSkeleton } from "./date-skeleton";
import { parseNumberSkeleton, SkeletonError } from "./number-skeleton";

/**
 * Options of {@link parseMessage} (and of {@link icuCompile} and {@link icuCompiler}): the limits that
 * keep parsing linear and bounded, and whether tags are recognized. Every limit hit throws
 * `MessageSyntaxError`. A limit that is `NaN` counts as not given (it would otherwise switch the limit off).
 *
 * @example
 * ```ts
 * import { type ParseOptions, parseMessage } from "@shadow-js/i18n/icu";
 *
 * const strict: ParseOptions = { maxLength: 500, maxDepth: 8, maxNodes: 200, tags: false };
 * const nodes = parseMessage("1 <b>2</b>", strict);
 * console.log(nodes); // [{ kind: "text", value: "1 <b>2</b>" }]
 * ```
 * @see {@link PARSE_LIMITS}
 * @since 1.0.0
 */
export interface ParseOptions {
  /**
   * Longest accepted source, in UTF-16 code units (`source.length`). A longer source throws with
   * `syntaxCode` `"MESSAGE_TOO_LONG"` before any parsing.
   * @default 20_000
   */
  readonly maxLength?: number;
  /**
   * Deepest accepted nesting. A simple or formatted argument and a tag with content each take one
   * level; a plural, selectordinal or select takes two (the argument and its clause body). Deeper
   * nesting throws with `syntaxCode` `"NESTING_TOO_DEEP"`. A value above
   * `PARSE_LIMITS.maxDepthCeiling` (128) is lowered to it.
   * @default 32
   */
  readonly maxDepth?: number;
  /**
   * Most nodes one message may produce. Each text run, argument, `#`, tag and plural or select clause
   * counts as one. More throws with `syntaxCode` `"TOO_MANY_NODES"`.
   * @default 5_000
   */
  readonly maxNodes?: number;
  /**
   * Recognize rich-text tags (`<b>...</b>`, `<br/>`). With `false`, `<` and `>` are plain text and an
   * apostrophe before them does not start a quote.
   * @default true
   */
  readonly tags?: boolean;
}

/**
 * The default limits of {@link ParseOptions}, plus the ceiling `maxDepth` cannot exceed. The object
 * is frozen.
 *
 * @example
 * ```ts
 * import { PARSE_LIMITS, parseMessage } from "@shadow-js/i18n/icu";
 *
 * console.log(PARSE_LIMITS.maxLength); // 20000
 * // Allow twice the default length for one long legal text.
 * const nodes = parseMessage("Terms of service", { maxLength: PARSE_LIMITS.maxLength * 2 });
 * console.log(nodes.length); // 1
 * ```
 * @since 1.0.0
 */
export const PARSE_LIMITS: Readonly<{
  /** Default `maxLength`: 20 000 UTF-16 code units. */
  maxLength: number;
  /** Default `maxDepth`: 32 nesting levels. */
  maxDepth: number;
  /** Default `maxNodes`: 5 000 nodes per message. */
  maxNodes: number;
  /** The highest effective `maxDepth`: 128. A larger `maxDepth` is lowered to this value. */
  maxDepthCeiling: number;
}> = Object.freeze({ maxLength: 20_000, maxDepth: 32, maxNodes: 5_000, maxDepthCeiling: 128 });

const PLURAL_KEYWORDS: ReadonlySet<string> = new Set([
  "zero",
  "one",
  "two",
  "few",
  "many",
  "other",
]);

/** ICU Pattern_White_Space. */
function isSpace(code: number): boolean {
  return (
    code === 32 ||
    (code >= 9 && code <= 13) ||
    code === 0x85 ||
    code === 0x200e ||
    code === 0x200f ||
    code === 0x2028 ||
    code === 0x2029
  );
}

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isTagNameChar(code: number): boolean {
  return isAsciiLetter(code) || (code >= 48 && code <= 57) || code === 45 || code === 95;
}

type Mode = "root" | "case" | "tag";

class Parser {
  readonly src: string;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly tags: boolean;
  pos = 0;
  nodes = 0;

  constructor(src: string, maxDepth: number, maxNodes: number, tags: boolean) {
    this.src = src;
    this.maxDepth = maxDepth;
    this.maxNodes = maxNodes;
    this.tags = tags;
  }

  fail(code: SyntaxErrorCode, detail: string, offset: number = this.pos): never {
    throw new MessageSyntaxError(code, detail, this.src, offset);
  }

  count(): void {
    this.nodes += 1;
    if (this.nodes > this.maxNodes) {
      this.fail(
        "TOO_MANY_NODES",
        __DEV__ ? `the message has more than ${this.maxNodes} parts.` : "",
      );
    }
  }

  skipSpace(): void {
    while (this.pos < this.src.length && isSpace(this.src.charCodeAt(this.pos))) this.pos += 1;
  }

  /** Reads an argument name: everything up to white space or pattern syntax. */
  readName(): string {
    const start = this.pos;
    while (this.pos < this.src.length) {
      const character = this.src[this.pos] ?? "";
      if (isSpace(character.charCodeAt(0)) || "{},'<>#".includes(character)) break;
      this.pos += 1;
    }
    return this.src.slice(start, this.pos);
  }

  /**
   * Parses a sequence of nodes until the end of the current construct. `openAt` is the offset of the
   * `{` of a clause body or of the `<` of a tag: where an unfinished construct is reported.
   */
  parseNodes(
    depth: number,
    inPlural: boolean,
    mode: Mode,
    tagName: string,
    openAt: number,
  ): MessageNode[] {
    const out: MessageNode[] = [];
    let text = "";
    const flush = (): void => {
      if (text !== "") {
        this.count();
        out.push({ kind: "text", value: text });
        text = "";
      }
    };
    const src = this.src;
    while (this.pos < src.length) {
      const character = src[this.pos] ?? "";
      if (character === "{") {
        flush();
        out.push(this.parseArgument(depth, inPlural));
      } else if (character === "}") {
        if (mode === "case") break;
        if (mode === "tag") {
          this.fail(
            "UNCLOSED_TAG",
            __DEV__ ? `the tag <${tagName}> is not closed before this "}".` : "",
            openAt,
          );
        }
        this.fail(
          "UNMATCHED_CLOSING_BRACE",
          __DEV__ ? "unexpected \"}\"; write '}' to print a brace." : "",
        );
      } else if (character === "<" && this.tags) {
        const handled = this.parseTag(depth, inPlural, mode, tagName);
        if (handled === "literal") {
          text += "<";
          this.pos += 1;
        } else if (handled === "close") {
          break;
        } else {
          flush();
          out.push(handled);
        }
      } else if (character === "#" && inPlural) {
        flush();
        this.count();
        out.push({ kind: "pound" });
        this.pos += 1;
      } else if (character === "'") {
        text += this.readApostrophe(inPlural);
      } else {
        // A run of plain characters is copied with one slice instead of one concatenation each.
        const from = this.pos;
        let end = from + 1;
        while (end < src.length) {
          const code = src.charCodeAt(end);
          if (code === 123 || code === 125 || code === 39) break;
          if ((code === 60 && this.tags) || (code === 35 && inPlural)) break;
          end += 1;
        }
        text += src.slice(from, end);
        this.pos = end;
      }
    }
    flush();
    if (this.pos >= src.length) {
      if (mode === "case") {
        this.fail(
          "UNEXPECTED_END",
          __DEV__ ? 'the message ends before the closing "}" of this clause.' : "",
          openAt,
        );
      }
      if (mode === "tag") {
        this.fail("UNCLOSED_TAG", __DEV__ ? `the tag <${tagName}> is never closed.` : "", openAt);
      }
    }
    return out;
  }

  /** `'` rules of ICU's DOUBLE_OPTIONAL mode; returns the text produced and advances. */
  readApostrophe(inPlural: boolean): string {
    const src = this.src;
    const next = src[this.pos + 1];
    if (next === "'") {
      this.pos += 2;
      return "'";
    }
    const starts =
      next === "{" ||
      next === "}" ||
      (this.tags && (next === "<" || next === ">")) ||
      (inPlural && next === "#");
    if (!starts) {
      this.pos += 1;
      return "'";
    }
    this.pos += 1;
    let quoted = "";
    for (;;) {
      const close = src.indexOf("'", this.pos);
      if (close === -1) {
        // An unclosed quote runs to the end of the message.
        quoted += src.slice(this.pos);
        this.pos = src.length;
        break;
      }
      quoted += src.slice(this.pos, close);
      if (src[close + 1] === "'") {
        quoted += "'";
        this.pos = close + 2;
        continue;
      }
      this.pos = close + 1;
      break;
    }
    return quoted;
  }

  /**
   * At a `<`: returns a tag node, `"close"` when this is the closing tag of the enclosing tag
   * (position left at the `<`), or `"literal"` when it is just a less-than sign.
   */
  parseTag(
    depth: number,
    inPlural: boolean,
    mode: Mode,
    tagName: string,
  ): MessageNode | "close" | "literal" {
    const src = this.src;
    const start = this.pos;
    const closing = src[start + 1] === "/";
    let cursor = start + (closing ? 2 : 1);
    if (!isAsciiLetter(src.charCodeAt(cursor))) return "literal";
    const nameStart = cursor;
    while (cursor < src.length && isTagNameChar(src.charCodeAt(cursor))) cursor += 1;
    const name = src.slice(nameStart, cursor);
    if (closing) {
      if (src[cursor] !== ">") return "literal";
      if (mode === "tag" && name === tagName) return "close";
      this.fail(
        "UNMATCHED_CLOSING_TAG",
        __DEV__
          ? mode === "tag"
            ? `found </${name}> but <${tagName}> is still open.`
            : `found </${name}> without a matching <${name}>.`
          : "",
        start,
      );
    }
    let selfClosing = false;
    if (src[cursor] === "/" && src[cursor + 1] === ">") {
      selfClosing = true;
      cursor += 2;
    } else if (src[cursor] === ">") {
      cursor += 1;
    } else {
      return "literal";
    }
    this.count();
    if (selfClosing) {
      this.pos = cursor;
      return { kind: "tag", name, children: [], selfClosing: true };
    }
    if (depth + 1 > this.maxDepth) {
      this.fail(
        "NESTING_TOO_DEEP",
        __DEV__ ? `nesting is deeper than ${this.maxDepth}.` : "",
        start,
      );
    }
    this.pos = cursor;
    const children = this.parseNodes(depth + 1, inPlural, "tag", name, start);
    // parseNodes only returns here at the matching closing tag.
    this.pos += name.length + 3;
    return { kind: "tag", name, children, selfClosing: false };
  }

  parseArgument(depth: number, inPlural: boolean): MessageNode {
    const src = this.src;
    const open = this.pos;
    if (depth + 1 > this.maxDepth) {
      this.fail(
        "NESTING_TOO_DEEP",
        __DEV__ ? `nesting is deeper than ${this.maxDepth}.` : "",
        open,
      );
    }
    this.count();
    this.pos += 1;
    this.skipSpace();
    const nameAt = this.pos;
    const name = this.readName();
    if (name === "" && this.pos >= src.length) {
      this.fail("UNEXPECTED_END", __DEV__ ? "the argument is never closed." : "", open);
    }
    if (name === "")
      this.fail("INVALID_ARGUMENT_NAME", __DEV__ ? "an argument needs a name." : "", nameAt);
    this.skipSpace();
    if (this.pos >= src.length)
      this.fail("UNEXPECTED_END", __DEV__ ? "the argument is never closed." : "", open);
    if (src[this.pos] === "}") {
      this.pos += 1;
      return { kind: "argument", name };
    }
    if (src[this.pos] !== ",") {
      this.fail(
        "EXPECT_ARGUMENT_CLOSING_BRACE",
        __DEV__ ? 'expected "," or "}" after the argument name.' : "",
      );
    }
    this.pos += 1;
    this.skipSpace();
    const typeAt = this.pos;
    while (this.pos < src.length && isAsciiLetter(src.charCodeAt(this.pos))) this.pos += 1;
    const type = src.slice(typeAt, this.pos);
    this.skipSpace();
    if (type === "" && this.pos >= src.length) {
      this.fail("UNEXPECTED_END", __DEV__ ? "the argument is never closed." : "", open);
    }
    switch (type) {
      case "number":
      case "date":
      case "time":
        return this.parseFormatted(type, name, open);
      case "plural":
      case "selectordinal":
        return this.parseCases(depth, inPlural, name, type, open);
      case "select":
        return this.parseCases(depth, inPlural, name, "select", open);
      default:
        return this.fail(
          "INVALID_ARGUMENT_TYPE",
          __DEV__
            ? `"${type}" is not a supported argument type (number, date, time, plural, selectordinal, select).`
            : "",
          typeAt,
        );
    }
  }

  parseFormatted(type: "number" | "date" | "time", name: string, open: number): MessageNode {
    const src = this.src;
    if (this.pos >= src.length)
      this.fail("UNEXPECTED_END", __DEV__ ? "the argument is never closed." : "", open);
    let style: string | undefined;
    let skeleton:
      | ReturnType<typeof parseNumberSkeleton>
      | ReturnType<typeof parseDateSkeleton>
      | undefined;
    if (src[this.pos] === ",") {
      this.pos += 1;
      const styleAt = this.pos;
      // The style is unquoted as it is read, like message text: `'}'` is a brace, `''` an apostrophe.
      let unquoted = "";
      while (this.pos < src.length && src[this.pos] !== "}") {
        if (src[this.pos] === "{") {
          this.fail("INVALID_STYLE", __DEV__ ? "a style cannot contain braces." : "");
        }
        const next = src[this.pos + 1];
        if (src[this.pos] === "'" && (next === "'" || next === "{" || next === "}")) {
          unquoted += this.readApostrophe(false);
        } else {
          unquoted += src[this.pos];
          this.pos += 1;
        }
      }
      if (this.pos >= src.length) {
        this.fail("UNEXPECTED_END", __DEV__ ? "the argument is never closed." : "", open);
      }
      const rawStyle = src.slice(styleAt, this.pos);
      style = unquoted.trim();
      if (style === "") this.fail("INVALID_STYLE", __DEV__ ? "the style is empty." : "", styleAt);
      // Errors point at the first character of the style, not at the white space before it.
      const styleStart = styleAt + (rawStyle.length - rawStyle.trimStart().length);
      if (style.startsWith("::")) {
        try {
          skeleton =
            type === "number"
              ? parseNumberSkeleton(style.slice(2))
              : parseDateSkeleton(style.slice(2));
        } catch (error) {
          if (error instanceof SkeletonError || error instanceof DateSkeletonError) {
            this.fail("INVALID_SKELETON", error.message, styleStart);
          }
          throw error;
        }
      }
    }
    if (src[this.pos] !== "}") {
      this.fail(
        "EXPECT_ARGUMENT_CLOSING_BRACE",
        __DEV__ ? 'expected "}" to close the argument.' : "",
      );
    }
    this.pos += 1;
    if (type === "number") {
      return {
        kind: "number",
        name,
        style,
        skeleton:
          skeleton === undefined ? undefined : (skeleton as ReturnType<typeof parseNumberSkeleton>),
      };
    }
    return {
      kind: type,
      name,
      style,
      skeleton:
        skeleton === undefined ? undefined : (skeleton as ReturnType<typeof parseDateSkeleton>),
    };
  }

  parseCases(
    depth: number,
    inPlural: boolean,
    name: string,
    type: "plural" | "selectordinal" | "select",
    open: number,
  ): MessageNode {
    const src = this.src;
    if (this.pos >= src.length)
      this.fail("UNEXPECTED_END", __DEV__ ? `the ${type} is never closed.` : "", open);
    if (src[this.pos] !== ",")
      this.fail("EXPECT_COMMA", __DEV__ ? `expected "," after "${type}".` : "");
    this.pos += 1;
    this.skipSpace();
    let offset = 0;
    if (type !== "select" && src.startsWith("offset", this.pos)) {
      const offsetAt = this.pos;
      this.pos += 6;
      this.skipSpace();
      if (this.pos >= src.length) {
        this.fail("UNEXPECTED_END", __DEV__ ? `the ${type} is never closed.` : "", open);
      }
      if (src[this.pos] !== ":") {
        this.fail(
          "INVALID_OFFSET",
          __DEV__ ? 'expected "offset:" followed by a number.' : "",
          offsetAt,
        );
      }
      this.pos += 1;
      this.skipSpace();
      const digitsAt = this.pos;
      while (
        this.pos < src.length &&
        src.charCodeAt(this.pos) >= 48 &&
        src.charCodeAt(this.pos) <= 57
      ) {
        this.pos += 1;
      }
      if (this.pos === digitsAt && this.pos >= src.length) {
        this.fail("UNEXPECTED_END", __DEV__ ? `the ${type} is never closed.` : "", open);
      }
      if (
        this.pos === digitsAt ||
        this.pos - digitsAt > 9 ||
        (this.pos < src.length && !isSpace(src.charCodeAt(this.pos)))
      ) {
        this.fail(
          "INVALID_OFFSET",
          __DEV__ ? "the offset must be a whole number of at most 9 digits." : "",
          digitsAt,
        );
      }
      offset = Number(src.slice(digitsAt, this.pos));
    }
    const cases: MessageCase[] = [];
    const seen = new Set<string>();
    const bodyPlural = inPlural || type !== "select";
    for (;;) {
      this.skipSpace();
      if (this.pos >= src.length)
        this.fail("UNEXPECTED_END", __DEV__ ? `the ${type} is never closed.` : "", open);
      if (src[this.pos] === "}") break;
      const selectorAt = this.pos;
      while (this.pos < src.length) {
        const character = src[this.pos] ?? "";
        if (isSpace(character.charCodeAt(0)) || character === "{" || character === "}") break;
        this.pos += 1;
      }
      const selector = src.slice(selectorAt, this.pos);
      if (selector === "")
        this.fail(
          "INVALID_SELECTOR",
          __DEV__ ? "expected a selector such as one, other or =0." : "",
          selectorAt,
        );
      if (type !== "select") this.checkPluralSelector(selector, selectorAt);
      if (seen.has(selector))
        this.fail("DUPLICATE_SELECTOR", __DEV__ ? `"${selector}" appears twice.` : "", selectorAt);
      seen.add(selector);
      this.skipSpace();
      if (this.pos >= src.length) {
        this.fail("UNEXPECTED_END", __DEV__ ? `the ${type} is never closed.` : "", open);
      }
      if (src[this.pos] !== "{") {
        this.fail(
          "EXPECT_CASE_OPENING_BRACE",
          __DEV__ ? `expected "{" after the selector "${selector}".` : "",
        );
      }
      this.count();
      if (depth + 2 > this.maxDepth) {
        this.fail("NESTING_TOO_DEEP", __DEV__ ? `nesting is deeper than ${this.maxDepth}.` : "");
      }
      this.pos += 1;
      const body = this.parseNodes(depth + 2, bodyPlural, "case", "", this.pos - 1);
      this.pos += 1;
      cases.push({ selector, body });
    }
    this.pos += 1;
    if (cases.length === 0)
      this.fail("EXPECT_CASES", __DEV__ ? `the ${type} needs at least an "other" case.` : "", open);
    if (!seen.has("other"))
      this.fail("MISSING_OTHER_CLAUSE", __DEV__ ? `the ${type} needs an "other" case.` : "", open);
    if (type === "select") return { kind: "select", name, cases };
    return { kind: "plural", name, ordinal: type === "selectordinal", offset, cases };
  }

  checkPluralSelector(selector: string, at: number): void {
    if (PLURAL_KEYWORDS.has(selector)) return;
    if (selector.startsWith("=")) {
      // ICU allows a negative value (`=-1`); the sign is not one of the 15 digits.
      const digits = selector.startsWith("=-") ? selector.slice(2) : selector.slice(1);
      let dot = -1;
      let valid = digits.length > 0 && digits.length <= 15;
      for (let index = 0; valid && index < digits.length; index += 1) {
        const code = digits.charCodeAt(index);
        if (code === 46 && dot === -1 && index > 0 && index < digits.length - 1) dot = index;
        else if (code < 48 || code > 57) valid = false;
      }
      if (valid) return;
    }
    this.fail(
      "INVALID_SELECTOR",
      __DEV__
        ? `"${selector}" is not a plural selector (zero, one, two, few, many, other or =N).`
        : "",
      at,
    );
  }
}

/**
 * A limit from the options. `NaN` (an unparsed environment variable, say) makes every comparison
 * with it false, which would turn the limit off; it means the default instead.
 */
function limitOf(given: number | undefined, fallback: number): number {
  return given === undefined || Number.isNaN(given) ? fallback : given;
}

/**
 * Parses an ICU MessageFormat string into a tree of {@link MessageNode}. Supported arguments are
 * `{name}`, `number`, `date`, `time` (each with an optional named style or `::` skeleton), `plural`
 * and `selectordinal` (with an optional `offset:N`, clauses `zero`, `one`, `two`, `few`, `many`,
 * `other` and `=N`), and `select`; every plural and select needs an `other` clause. Apostrophes
 * follow ICU's default `DOUBLE_OPTIONAL` mode: `''` is an apostrophe, `'{'` quotes a brace (and `'#'`
 * a pound inside a plural, `'<'` a tag opener), and a lone `'` is literal. The parser is a single
 * forward scan with no backtracking, bounded by {@link ParseOptions}.
 *
 * @param source The message text.
 * @param options Limits and tag handling. Omitted fields use {@link PARSE_LIMITS} and `tags: true`.
 * @returns The nodes in source order. Adjacent text is merged, so
 * `parseMessage(printMessage(parseMessage(s)))` equals `parseMessage(s)`. An empty source gives `[]`.
 * @throws `MessageSyntaxError` (from `@shadow-js/i18n`, `code` `"SYNTAX"`) for malformed syntax or a
 * limit hit; no other error is thrown. Its `syntaxCode` names the problem (for example
 * `"MISSING_OTHER_CLAUSE"`, `"INVALID_ARGUMENT_TYPE"`, `"UNCLOSED_TAG"`, `"INVALID_SKELETON"`), and
 * `offset`, `line` and `column` (1-based, in UTF-16 code units) locate it. When the message ends inside
 * an argument, a clause body or a tag, the position is the opening `{` or `<` that is never closed
 * (`"UNEXPECTED_END"`, `"UNCLOSED_TAG"`); for a bad skeleton it is the first character of the style;
 * a missing `other` clause is reported at the opening `{` of the plural or select. An unclosed quote
 * is not an error: it runs to the end of the message.
 * @example
 * ```ts
 * import { MessageSyntaxError } from "@shadow-js/i18n";
 * import { parseMessage } from "@shadow-js/i18n/icu";
 *
 * const nodes = parseMessage(
 *   "Hello {name}, you have {n, plural, one {# message} other {# messages}}",
 * );
 * console.log(nodes.map((node) => node.kind)); // ["text", "argument", "text", "plural"]
 *
 * try {
 *   parseMessage("{count, plural, one {# item}}");
 * } catch (error) {
 *   if (error instanceof MessageSyntaxError) {
 *     console.log(error.syntaxCode, error.line, error.column); // "MISSING_OTHER_CLAUSE" 1 1
 *   }
 * }
 * ```
 * @see {@link printMessage}
 * @see {@link icuCompile}
 * @since 1.0.0
 */
export function parseMessage(source: string, options: ParseOptions = {}): readonly MessageNode[] {
  const maxLength = limitOf(options.maxLength, PARSE_LIMITS.maxLength);
  if (source.length > maxLength) {
    throw new MessageSyntaxError(
      "MESSAGE_TOO_LONG",
      __DEV__ ? `the message has ${source.length} characters; the limit is ${maxLength}.` : "",
      source.slice(0, 80),
      0,
    );
  }
  const parser = new Parser(
    source,
    // The parser recurses once per nesting level; the ceiling keeps the stack small whatever is asked.
    Math.min(limitOf(options.maxDepth, PARSE_LIMITS.maxDepth), PARSE_LIMITS.maxDepthCeiling),
    limitOf(options.maxNodes, PARSE_LIMITS.maxNodes),
    options.tags ?? true,
  );
  return parser.parseNodes(0, false, "root", "", 0);
}
