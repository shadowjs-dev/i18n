/**
 * Finds the message keys a source file uses, with a small hand-written JavaScript/TypeScript/JSX
 * tokenizer (no parser dependency, no regular expressions on source text). It recognizes
 * `t("key")`, `i18n.t("key")`, `t.rich("key", ...)`, `translate("key")` and
 * `<Trans key="key" />`, scoped translators (`scoped("cart")("items")` is `cart.items`), and
 * reports calls whose key is not a literal as dynamic usages.
 *
 * It is a tokenizer, not a type checker: a function named `t` that is not the translator is read as
 * one, and a JSX text containing an apostrophe followed by a quote on the same line can hide a
 * call. Use it to find unused and missing keys in CI, with the typed `t` as the source of truth.
 * @packageDocumentation
 */

/**
 * One literal key found in source by {@link extractMessages}.
 *
 * @example
 * ```ts
 * import { type ExtractedKey, extractMessages } from "@shadow-js/i18n";
 *
 * const found: readonly ExtractedKey[] = extractMessages('t.rich("terms", { b })').keys;
 * console.log(found[0]); // { key: "terms", line: 1, column: 8, kind: "rich" }
 * ```
 * @since 1.0.0
 */
export interface ExtractedKey {
  /** The key, with string escapes decoded. */
  readonly key: string;
  /** 1-based line of the key literal. */
  readonly line: number;
  /** 1-based column of the key literal. */
  readonly column: number;
  /** Which form used it: `t("...")` (`"call"`), `t.rich("...")` (`"rich"`) or `<Trans key="...">` (`"trans"`). */
  readonly kind: "call" | "rich" | "trans";
}

/**
 * A translate call whose key is computed, found by {@link extractMessages}. {@link compareKeys}
 * treats every catalog key that starts with `prefix` as used.
 *
 * @example
 * ```ts
 * import { type DynamicUsage, extractMessages } from "@shadow-js/i18n";
 *
 * const dynamic: readonly DynamicUsage[] = extractMessages("t(`status.${state}`)").dynamic;
 * console.log(dynamic[0]); // { line: 1, column: 3, prefix: "status." }
 * ```
 * @since 1.0.0
 */
export interface DynamicUsage {
  /** 1-based line of the key argument. */
  readonly line: number;
  /** 1-based column of the key argument. */
  readonly column: number;
  /**
   * The literal start of the key: of a template (`items.${n}` gives `"items."`) or of a
   * concatenation (`"items." + n`), or `""` when nothing is known.
   */
  readonly prefix: string;
}

/**
 * Result of {@link extractMessages}. Merge the results of several files by concatenating both
 * lists before {@link compareKeys}.
 *
 * @example
 * ```ts
 * import { type ExtractResult, extractMessages } from "@shadow-js/i18n";
 *
 * const files = ['t("a")', "t(`b.${x}`)"];
 * const results = files.map((source) => extractMessages(source));
 * export const all: ExtractResult = {
 *   keys: results.flatMap((result) => result.keys),
 *   dynamic: results.flatMap((result) => result.dynamic),
 * };
 * ```
 * @since 1.0.0
 */
export interface ExtractResult {
  /** Every literal key use, in source order. */
  readonly keys: readonly ExtractedKey[];
  /** Every translate call or `<Trans key>` whose key is computed, in source order. */
  readonly dynamic: readonly DynamicUsage[];
}

/**
 * Options of {@link extractMessages}.
 *
 * @example
 * ```ts
 * import { type ExtractOptions, extractMessages } from "@shadow-js/i18n";
 *
 * const options: ExtractOptions = { functions: ["t", "tr"], components: ["Trans", "Message"] };
 * const keys = extractMessages('tr("nav.home"); <Message key="nav.about" />', options).keys;
 * console.log(keys.map((entry) => entry.key)); // ["nav.home", "nav.about"]
 * ```
 * @since 1.0.0
 */
export interface ExtractOptions {
  /**
   * Function and method names that translate (`t(...)`, `i18n.t(...)`); `.rich` after one of them
   * is recognized too. Replaces the default list.
   * @default `["t", "translate", "translateRich"]`
   */
  readonly functions?: readonly string[];
  /**
   * Component names whose `key` attribute is a message key. Replaces the default list.
   * @default `["Trans"]`
   */
  readonly components?: readonly string[];
  /**
   * Names of the functions that make a scoped translator: `scoped("cart")` gives a translator whose
   * keys are relative to `cart`. Replaces the default list.
   * @default `["scoped"]`
   */
  readonly scopedFunctions?: readonly string[];
  /**
   * Largest source accepted, in UTF-16 code units; a longer source throws a `RangeError`, and so
   * does a value that is not a number of at least 0.
   * @default `5_000_000`
   */
  readonly maxLength?: number;
}

type Token =
  | { readonly type: "ident"; readonly text: string; readonly start: number }
  | { readonly type: "punct"; readonly text: string; readonly start: number }
  | { readonly type: "string"; readonly text: string; readonly start: number }
  | { readonly type: "template"; readonly text: string; readonly start: number }
  | { readonly type: "other"; readonly text: string; readonly start: number };

/** Line and column of an offset in the source. */
type Locate = (offset: number) => { line: number; column: number };

const REGEX_AFTER: ReadonlySet<string> = new Set([
  "return",
  "typeof",
  "case",
  "in",
  "of",
  "delete",
  "void",
  "throw",
  "new",
  "else",
  "do",
  "yield",
  "await",
  "instanceof",
]);
const MAX_TEMPLATE_DEPTH = 64;
const DEFAULT_MAX_LENGTH = 5_000_000;

function isIdentStart(code: number): boolean {
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95 ||
    code === 36 ||
    code > 127
  );
}

function isIdentPart(code: number): boolean {
  return isIdentStart(code) || (code >= 48 && code <= 57);
}

function isSpace(code: number): boolean {
  return (
    code === 32 ||
    (code >= 9 && code <= 13) ||
    code === 0xa0 ||
    code === 0xfeff ||
    code === 0x2028 ||
    code === 0x2029
  );
}

/** The four line terminators of ECMAScript: LF, CR, LS and PS. */
function isLineTerminator(code: number): boolean {
  return code === 10 || code === 13 || code === 0x2028 || code === 0x2029;
}

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
  v: "\v",
};

function hexValue(code: number): number {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  return -1;
}

/** Reads `count` hex digits at `from`; `-1` when they are not all there. */
function readHex(source: string, from: number, count: number): number {
  let value = 0;
  for (let offset = 0; offset < count; offset += 1) {
    const digit = hexValue(source.charCodeAt(from + offset));
    if (digit === -1) return -1;
    value = value * 16 + digit;
  }
  return value;
}

/**
 * Decodes the escape sequence whose backslash is at `index`: `\n`, `\xHH`, `\uHHHH`, `\u{H...}`, a
 * legacy octal, a line continuation (which is nothing), or the escaped character itself. An
 * invalid escape keeps the escaped character, as the cooked text of a template does.
 */
function readEscape(source: string, index: number): { text: string; end: number } {
  const next = source[index + 1];
  if (next === undefined) return { text: "", end: index + 1 };
  const simple = SIMPLE_ESCAPES[next];
  if (simple !== undefined) return { text: simple, end: index + 2 };
  const code = next.charCodeAt(0);
  if (code >= 48 && code <= 55) {
    // \0 is NUL; \1..\377 are the legacy octal escapes.
    let end = index + 2;
    let value = code - 48;
    const limit = code <= 51 ? 3 : 2;
    while (end - index - 1 < limit) {
      const digit = source.charCodeAt(end) - 48;
      if (digit < 0 || digit > 7) break;
      value = value * 8 + digit;
      end += 1;
    }
    return { text: String.fromCharCode(value), end };
  }
  if (next === "x") {
    const value = readHex(source, index + 2, 2);
    return value === -1
      ? { text: "x", end: index + 2 }
      : { text: String.fromCharCode(value), end: index + 4 };
  }
  if (next === "u") {
    if (source[index + 2] === "{") {
      let cursor = index + 3;
      let value = 0;
      while (
        cursor < source.length &&
        hexValue(source.charCodeAt(cursor)) !== -1 &&
        cursor - index < 12
      ) {
        value = value * 16 + hexValue(source.charCodeAt(cursor));
        cursor += 1;
      }
      if (source[cursor] === "}" && cursor > index + 3 && value <= 0x10ffff) {
        return { text: String.fromCodePoint(value), end: cursor + 1 };
      }
      return { text: "u", end: index + 2 };
    }
    const value = readHex(source, index + 2, 4);
    return value === -1
      ? { text: "u", end: index + 2 }
      : { text: String.fromCharCode(value), end: index + 6 };
  }
  if (next === "\r") return { text: "", end: source[index + 2] === "\n" ? index + 3 : index + 2 };
  if (isLineTerminator(code)) return { text: "", end: index + 2 };
  return { text: next, end: index + 2 };
}

/** Reads a quoted string starting at `start` (the quote). Returns `undefined` when it does not close on the line. */
function readString(source: string, start: number): { value: string; end: number } | undefined {
  const quote = source[start];
  let value = "";
  let index = start + 1;
  while (index < source.length) {
    const character = source[index] ?? "";
    if (character === quote) return { value, end: index + 1 };
    if (character === "\n" || character === "\r") return undefined;
    if (character === "\\") {
      const decoded = readEscape(source, index);
      value += decoded.text;
      index = decoded.end;
      continue;
    }
    value += character;
    index += 1;
  }
  return undefined;
}

/** Line and column of an offset, computed from a table of line starts (LF, CRLF and CR end a line). */
function locator(source: string): Locate {
  // A byte order mark is not a column.
  const starts = [source.charCodeAt(0) === 0xfeff ? 1 : 0];
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (code === 10 || (code === 13 && source.charCodeAt(index + 1) !== 10)) starts.push(index + 1);
  }
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((starts[middle] ?? 0) <= offset) low = middle;
      else high = middle - 1;
    }
    return { line: low + 1, column: offset - (starts[low] ?? 0) + 1 };
  };
}

/** Splits the source into the tokens that matter. */
function tokenize(source: string, where: Locate): Token[] {
  const tokens: Token[] = [];
  const templates: number[] = [];
  let braces = 0;
  let index = 0;

  const readTemplate = (from: number): void => {
    // `from` is just after the opening backtick or the closing brace of a substitution.
    let text = "";
    let cursor = from;
    while (cursor < source.length) {
      const character = source[cursor] ?? "";
      if (character === "`") {
        tokens.push({ type: "string", text, start: from - 1 });
        index = cursor + 1;
        return;
      }
      if (character === "$" && source[cursor + 1] === "{") {
        if (templates.length >= MAX_TEMPLATE_DEPTH) {
          const at = where(cursor);
          throw new RangeError(
            `extractMessages: template literals are nested more than ${MAX_TEMPLATE_DEPTH} deep at line ${at.line}, column ${at.column}.`,
          );
        }
        templates.push(braces);
        braces += 1;
        tokens.push({ type: "template", text, start: from - 1 });
        index = cursor + 2;
        return;
      }
      if (character === "\\") {
        const decoded = readEscape(source, cursor);
        text += decoded.text;
        cursor = decoded.end;
        continue;
      }
      if (character === "\r") {
        // A template's line break is always LF, whatever the file uses.
        text += "\n";
        cursor += source[cursor + 1] === "\n" ? 2 : 1;
        continue;
      }
      text += character;
      cursor += 1;
    }
    index = source.length;
  };

  // A `#!` line at the start is not code.
  if (source.startsWith("#!")) {
    while (index < source.length && !isLineTerminator(source.charCodeAt(index))) index += 1;
  }

  while (index < source.length) {
    const character = source[index] ?? "";
    const code = source.charCodeAt(index);
    if (isSpace(code)) {
      index += 1;
    } else if (character === "/" && source[index + 1] === "/" && !afterScheme(tokens, index)) {
      while (index < source.length && !isLineTerminator(source.charCodeAt(index))) index += 1;
    } else if (character === "/" && source[index + 1] === "*") {
      const close = source.indexOf("*/", index + 2);
      index = close === -1 ? source.length : close + 2;
    } else if (isIdentStart(code)) {
      const start = index;
      while (index < source.length && isIdentPart(source.charCodeAt(index))) index += 1;
      tokens.push({ type: "ident", text: source.slice(start, index), start });
    } else if (character === '"' || character === "'") {
      const read = readString(source, index);
      if (read === undefined) {
        // JSX text such as `Don't`: not a string literal.
        tokens.push({ type: "other", text: character, start: index });
        index += 1;
      } else {
        tokens.push({ type: "string", text: read.value, start: index });
        index = read.end;
      }
    } else if (character === "`") {
      readTemplate(index + 1);
    } else if (character === "{") {
      braces += 1;
      tokens.push({ type: "punct", text: "{", start: index });
      index += 1;
    } else if (character === "}") {
      if (templates.length > 0 && templates[templates.length - 1] === braces - 1) {
        templates.pop();
        braces -= 1;
        readTemplate(index + 1);
      } else {
        braces = Math.max(0, braces - 1);
        tokens.push({ type: "punct", text: "}", start: index });
        index += 1;
      }
    } else if (character === "/") {
      const previous = tokens[tokens.length - 1];
      // `</b>` closes a JSX element; it is never a regular expression.
      const closingTag =
        previous?.type === "punct" && previous.text === "<" && previous.start === index - 1;
      const regexAllowed =
        !closingTag &&
        (previous === undefined ||
          (previous.type === "punct" &&
            previous.text !== ")" &&
            previous.text !== "]" &&
            previous.text !== "}") ||
          (previous.type === "ident" && REGEX_AFTER.has(previous.text)));
      let end = -1;
      if (regexAllowed) {
        let cursor = index + 1;
        let inClass = false;
        while (cursor < source.length) {
          const c = source[cursor] ?? "";
          if (c === "\n" || c === "\r") break;
          if (c === "\\") cursor += 1;
          else if (c === "[") inClass = true;
          else if (c === "]") inClass = false;
          else if (c === "/" && !inClass) {
            end = cursor + 1;
            break;
          }
          cursor += 1;
        }
      }
      if (end === -1) {
        tokens.push({ type: "punct", text: "/", start: index });
        index += 1;
      } else {
        while (end < source.length && isIdentPart(source.charCodeAt(end))) end += 1;
        tokens.push({ type: "other", text: "regex", start: index });
        index = end;
      }
    } else if (code >= 48 && code <= 57) {
      const start = index;
      while (
        index < source.length &&
        (isIdentPart(source.charCodeAt(index)) || source[index] === ".")
      )
        index += 1;
      tokens.push({ type: "other", text: "number", start });
    } else {
      tokens.push({ type: "punct", text: character, start: index });
      index += 1;
    }
  }
  return tokens;
}

/**
 * True for the `//` of `https://` written in JSX text: an identifier directly followed by `:` and
 * `//` with no space. In code that is not a comment; `cond ? a ://comment` is the one spelling it
 * misreads.
 */
function afterScheme(tokens: readonly Token[], offset: number): boolean {
  const colon = tokens[tokens.length - 1];
  const scheme = tokens[tokens.length - 2];
  return (
    colon?.type === "punct" &&
    colon.text === ":" &&
    colon.start === offset - 1 &&
    scheme?.type === "ident" &&
    scheme.start + scheme.text.length === colon.start
  );
}

/** For every `(` token, the index of its `)`; `-1` where there is none. */
function matchParens(tokens: readonly Token[]): number[] {
  const closes = new Array<number>(tokens.length).fill(-1);
  const open: number[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.type !== "punct") continue;
    if (token.text === "(") open.push(index);
    else if (token.text === ")") {
      const start = open.pop();
      if (start !== undefined) closes[start] = index;
    }
  }
  return closes;
}

/** The namespace a scoped translator reads from; `undefined` when `scoped` was given a computed one. */
interface Scope {
  readonly namespace: string | undefined;
}

/** A `const name = scoped("ns")` the scan has seen: it lasts while the block it was declared in is open. */
interface Binding {
  readonly name: string;
  /** `undefined` when the name was declared again as something else (it shadows an outer scoped binding). */
  readonly scope: Scope | undefined;
  readonly depth: number;
}

/**
 * Lists the literal message keys used in a source file and the calls with computed keys.
 *
 * Recognized: `t("key")`, `i18n.t("key")`, `t?.("key")`, `t.rich("key")`, `<Trans key="key" />`
 * (also `key={"key"}` and `<i18n.Trans>`), and scoped translators: `scoped("cart")("items")` and
 * `const cart = i18n.scoped("cart"); cart("items")` both give the key `cart.items`. A `scoped`
 * binding lasts until the end of the block it is declared in (or until the name is declared again);
 * it is matched by name, so a parameter that shadows it is not noticed.
 *
 * Not recognized as uses: a function, method or type signature named like a translate function
 * (`function t(key)`, `{ t(key) {} }`, `t(key: string): string`), a name that is not called, and
 * anything inside a comment, string or regular expression. A literal is only a key when it is the
 * whole argument. Escapes in literals are decoded, so `"caf\u00e9"` is `café`. Lines end at LF,
 * CRLF or CR.
 *
 * @param source JavaScript, TypeScript or JSX text.
 * @param options Names to recognize and a size limit.
 * @returns The keys with positions, and the dynamic usages.
 * @throws RangeError when `source` is longer than `maxLength` (the message starts with
 *   `extractMessages: the source has`), when `maxLength` is not a number of at least 0, or when
 *   template literals are nested more than 64 deep (the message starts with
 *   `extractMessages: template literals are nested`).
 * @example
 * ```ts
 * import { extractMessages } from "@shadow-js/i18n";
 *
 * const result = extractMessages('const a = t("cart.items", { count }); <Trans key="terms" />');
 * console.log(result.keys.map((entry) => entry.key)); // ["cart.items", "terms"]
 * console.log(result.dynamic); // []
 *
 * const scoped = extractMessages('const cart = i18n.scoped("cart"); cart("items"); cart(name);');
 * console.log(scoped.keys[0]?.key, scoped.dynamic[0]?.prefix); // "cart.items" "cart."
 * ```
 * @see {@link compareKeys}
 * @since 1.0.0
 */
export function extractMessages(source: string, options: ExtractOptions = {}): ExtractResult {
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
  if (!(maxLength >= 0)) {
    throw new RangeError(
      `extractMessages: maxLength must be a number of at least 0, got ${String(maxLength)}.`,
    );
  }
  if (source.length > maxLength) {
    throw new RangeError(
      `extractMessages: the source has ${source.length} characters; the limit is ${maxLength}.`,
    );
  }
  const functions = new Set(options.functions ?? ["t", "translate", "translateRich"]);
  const components = new Set(options.components ?? ["Trans"]);
  const scopedFunctions = new Set(options.scopedFunctions ?? ["scoped"]);
  const where = locator(source);
  const tokens = tokenize(source, where);
  const closes = matchParens(tokens);
  const keys: ExtractedKey[] = [];
  const dynamic: DynamicUsage[] = [];
  // Bindings by name (innermost last), and in declaration order for dropping them at a closing brace.
  const byName = new Map<string, Binding[]>();
  const declared: Binding[] = [];
  let depth = 0;

  const isPunct = (token: Token | undefined, text: string): boolean =>
    token?.type === "punct" && token.text === text;
  const isIdent = (token: Token | undefined, text: string): boolean =>
    token?.type === "ident" && token.text === text;

  /**
   * Records the first argument of a translate call. A literal is a key only when it is the whole
   * argument: `t("a" + "b")` or `t("a".trim())` compute a key, so they are dynamic usages whose
   * literal start (`"a"`) is the prefix, not the key `a`. In a scoped translator the namespace is
   * put in front of the key and of the prefix.
   */
  const record = (index: number, kind: ExtractedKey["kind"], scope: Scope | undefined): void => {
    const argument = tokens[index];
    if (argument === undefined || isPunct(argument, ")")) return;
    const prefixed = (text: string): string =>
      scope === undefined ? text : `${scope.namespace ?? ""}.${text}`;
    const unknownNamespace = scope !== undefined && scope.namespace === undefined;
    const addDynamic = (prefix: string): void => {
      dynamic.push({ ...where(argument.start), prefix: unknownNamespace ? "" : prefixed(prefix) });
    };
    if (argument.type === "string") {
      const after = tokens[index + 1];
      const whole = after === undefined || isPunct(after, ",") || isPunct(after, ")");
      if (whole && !unknownNamespace) {
        keys.push({ key: prefixed(argument.text), ...where(argument.start), kind });
      } else if (whole) addDynamic("");
      else {
        // `"items." + n` starts with a literal the key must start with; anything else applied to it
        // (a method call, a cast) changes the text.
        addDynamic(isPunct(after, "+") ? argument.text : "");
      }
    } else if (argument.type === "template") addDynamic(argument.text);
    else addDynamic("");
  };

  /** Where the call parenthesis is after `translate`, `translate.rich`, `translate?.` and `translate.rich?.`. */
  const callAfter = (cursor: number): { open: number; kind: ExtractedKey["kind"] } | undefined => {
    let at = cursor;
    if (isPunct(tokens[at], "(")) return { open: at, kind: "call" };
    if (isPunct(tokens[at], "?") && isPunct(tokens[at + 1], ".")) {
      at += 2;
      if (isPunct(tokens[at], "(")) return { open: at, kind: "call" };
    } else if (isPunct(tokens[at], ".")) at += 1;
    else return undefined;
    if (!isIdent(tokens[at], "rich")) return undefined;
    at += 1;
    if (isPunct(tokens[at], "?") && isPunct(tokens[at + 1], ".")) at += 2;
    return isPunct(tokens[at], "(") ? { open: at, kind: "rich" } : undefined;
  };

  /**
   * True when the parenthesis opens a parameter list, not a call: `t(key) {`, `t(key: string)`,
   * `t(key?: string)`. A call can be followed by `{` in no valid program.
   */
  const declares = (open: number): boolean => {
    const first = tokens[open + 1];
    if (first?.type === "ident") {
      if (isPunct(tokens[open + 2], ":")) return true;
      if (isPunct(tokens[open + 2], "?") && isPunct(tokens[open + 3], ":")) return true;
    }
    const close = closes[open] ?? -1;
    return close !== -1 && isPunct(tokens[close + 1], "{");
  };

  /**
   * Reads `a.b().scoped("ns")` starting at `from`: the chain of member accesses and empty-ish calls
   * that ends in a call of a scoped function. Gives its namespace and the index of its `)`.
   */
  const scopedCall = (from: number): { scope: Scope; end: number } | undefined => {
    let cursor = from;
    for (let step = 0; step < 16; step += 1) {
      const name = tokens[cursor];
      if (name?.type !== "ident") return undefined;
      if (isPunct(tokens[cursor + 1], "(")) {
        const close = closes[cursor + 1] ?? -1;
        if (close === -1) return undefined;
        if (scopedFunctions.has(name.text)) {
          const argument = tokens[cursor + 2];
          const namespace =
            argument?.type === "string" && close === cursor + 3 ? argument.text : undefined;
          return { scope: { namespace }, end: close };
        }
        cursor = close + 1;
      } else cursor += 1;
      if (isPunct(tokens[cursor], "?")) cursor += 1;
      if (!isPunct(tokens[cursor], ".")) return undefined;
      cursor += 1;
    }
    return undefined;
  };

  /** `const name = <scoped call>`: remember the binding, or note that the name is something else now. */
  const declaration = (keyword: number): void => {
    const name = tokens[keyword + 1];
    if (name?.type !== "ident") return;
    let cursor = keyword + 2;
    if (isPunct(tokens[cursor], ":")) {
      // A type annotation: skip to the `=` (not the one of `=>`), within reason.
      cursor += 1;
      for (let step = 0; step < 64 && cursor < tokens.length; step += 1) {
        if (isPunct(tokens[cursor], ";")) return;
        if (isPunct(tokens[cursor], "=") && !isPunct(tokens[cursor + 1], ">")) break;
        cursor += 1;
      }
    }
    if (!isPunct(tokens[cursor], "=")) return;
    cursor += 1;
    if (isIdent(tokens[cursor], "await")) cursor += 1;
    const found = scopedCall(cursor);
    const known = byName.get(name.text);
    // Only a scoped call, or a redeclaration of a scoped name, is worth remembering.
    if (found === undefined && (known === undefined || known.length === 0)) return;
    const made: Binding = { name: name.text, scope: found?.scope, depth };
    declared.push(made);
    if (known === undefined) byName.set(name.text, [made]);
    else known.push(made);
  };

  const binding = (name: string): Scope | undefined => byName.get(name)?.at(-1)?.scope;

  /** Forgets the bindings declared deeper than `level`: their block just closed. */
  const closeBlock = (level: number): void => {
    while ((declared.at(-1)?.depth ?? 0) > level) {
      const gone = declared.pop();
      if (gone !== undefined) byName.get(gone.name)?.pop();
    }
  };

  /** `<Trans`, `<i18n.Trans`: the component name is preceded by `<` (through member accesses). */
  const isComponentTag = (index: number): boolean => {
    let back = index - 1;
    while (isPunct(tokens[back], ".") && tokens[back - 1]?.type === "ident") back -= 2;
    return isPunct(tokens[back], "<");
  };

  /** The value of a `key` attribute: `"a"`, `{"a"}`, or a computed one. */
  const recordTransKey = (at: number): void => {
    const value = tokens[at];
    if (value === undefined) return;
    if (value.type === "string") {
      keys.push({ key: value.text, ...where(value.start), kind: "trans" });
    } else if (isPunct(value, "{")) {
      const inner = tokens[at + 1];
      if (inner === undefined || isPunct(inner, "}")) return;
      if (inner.type === "string" && isPunct(tokens[at + 2], "}")) {
        keys.push({ key: inner.text, ...where(inner.start), kind: "trans" });
      } else {
        dynamic.push({
          ...where(inner.start),
          prefix: inner.type === "template" ? inner.text : "",
        });
      }
    } else if (value.type === "template") {
      dynamic.push({ ...where(value.start), prefix: value.text });
    } else dynamic.push({ ...where(value.start), prefix: "" });
  };

  /** Records the call that follows a name, if there is one and it is not a declaration. */
  const call = (cursor: number, scope: Scope | undefined): void => {
    const found = callAfter(cursor);
    if (found !== undefined && !declares(found.open)) record(found.open + 1, found.kind, scope);
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) continue;
    if (token.type === "punct") {
      if (token.text === "{") depth += 1;
      else if (token.text === "}") {
        depth = Math.max(0, depth - 1);
        closeBlock(depth);
      }
      continue;
    }
    if (token.type !== "ident") continue;
    const previous = tokens[index - 1];
    const member = isPunct(previous, ".");
    if (!member && (token.text === "const" || token.text === "let" || token.text === "var")) {
      declaration(index);
      continue;
    }
    // `function t(` declares a function, `#t(` is a private method: neither is a use.
    if (isIdent(previous, "function") || isPunct(previous, "#")) continue;
    const immediate = scopedFunctions.has(token.text) ? scopedCall(index) : undefined;
    const bound = member ? undefined : binding(token.text);
    if (immediate !== undefined) call(immediate.end + 1, immediate.scope);
    else if (bound !== undefined) call(index + 1, bound);
    else if (functions.has(token.text)) call(index + 1, undefined);
    else if (components.has(token.text) && isComponentTag(index)) {
      // <Trans ... key="..." /> : find `key =` at brace depth 0 before the tag closes.
      let level = 0;
      for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
        const current = tokens[cursor];
        if (current === undefined) break;
        if (isPunct(current, "{")) level += 1;
        else if (isPunct(current, "}")) level = Math.max(0, level - 1);
        else if (level === 0 && isPunct(current, ">")) break;
        else if (level === 0 && isIdent(current, "key") && isPunct(tokens[cursor + 1], "=")) {
          recordTransKey(cursor + 2);
          break;
        }
      }
    }
  }

  return { keys, dynamic };
}

/**
 * Options of {@link compareKeys}.
 *
 * @example
 * ```ts
 * import { type CompareOptions, compareKeys, extractMessages } from "@shadow-js/i18n";
 *
 * const usage = extractMessages('t("a"); t(name)');
 * const options: CompareOptions = { ignoreUnknownDynamic: true };
 * console.log(compareKeys(["a", "b"], usage, options).unused); // ["b"]
 * console.log(compareKeys(["a", "b"], usage).unused); // []
 * ```
 * @since 1.0.0
 */
export interface CompareOptions {
  /**
   * Keep reporting unused keys even when a call has a fully computed key (a dynamic usage with an
   * empty prefix). When `false`, such a call may use any key, so no key is reported unused.
   * @default `false`
   */
  readonly ignoreUnknownDynamic?: boolean;
}

/**
 * Result of {@link compareKeys}.
 *
 * @example
 * ```ts
 * import { compareKeys, extractMessages, type KeyComparison } from "@shadow-js/i18n";
 *
 * const report: KeyComparison = compareKeys(["home", "about"], extractMessages('t("home"); t("contact")'));
 * for (const entry of report.missing) console.error(`missing ${entry.key} at ${entry.line}:${entry.column}`);
 * for (const key of report.unused) console.warn(`unused ${key}`);
 * ```
 * @since 1.0.0
 */
export interface KeyComparison {
  /** Used in code but absent from the catalog. */
  readonly missing: readonly ExtractedKey[];
  /** In the catalog but never used (and not covered by a dynamic prefix). */
  readonly unused: readonly string[];
}

/**
 * Compares the keys found in code with the keys of a catalog. A catalog key counts as used when a
 * literal use names it, or when a dynamic usage has a literal prefix that it starts with.
 *
 * @param catalogKeys The dotted keys, for example `[...flattenCatalog(messages).keys()]`.
 * @param usage Output of {@link extractMessages} (merge several files with `concat`).
 * @param options See {@link CompareOptions}.
 * @returns Missing and unused keys.
 * @example
 * ```ts
 * import { compareKeys, extractMessages, flattenCatalog } from "@shadow-js/i18n";
 *
 * const en = { a: "A", b: "B" };
 * const usage = extractMessages('t("a"); t("c")');
 * const { missing, unused } = compareKeys(flattenCatalog(en).keys(), usage);
 * console.log(missing.map((entry) => entry.key), unused); // ["c"] ["b"]
 * ```
 * @see {@link extractMessages}
 * @since 1.0.0
 */
export function compareKeys(
  catalogKeys: Iterable<string>,
  usage: ExtractResult,
  options: CompareOptions = {},
): KeyComparison {
  const known = new Set(catalogKeys);
  const used = new Set(usage.keys.map((entry) => entry.key));
  const ignoreUnknown = options.ignoreUnknownDynamic === true;
  const prefixes = usage.dynamic
    .map((entry) => entry.prefix)
    .filter((prefix) => !ignoreUnknown || prefix !== "");
  // A call with a fully computed key may use any key, so nothing can be called unused.
  const everythingDynamic = !ignoreUnknown && prefixes.includes("");
  const missing = usage.keys.filter((entry) => !known.has(entry.key));
  const unused = everythingDynamic
    ? []
    : [...known].filter(
        (key) => !used.has(key) && !prefixes.some((prefix) => key.startsWith(prefix)),
      );
  return { missing, unused };
}

/**
 * The keys of one catalog (or file), for {@link findDuplicateKeys}.
 *
 * @example
 * ```ts
 * import { flattenCatalog, type KeySource } from "@shadow-js/i18n";
 *
 * const source: KeySource = {
 *   source: "locales/en/cart.json",
 *   keys: flattenCatalog({ cart: { items: "{n} items" } }).keys(),
 * };
 * console.log(source.source);
 * ```
 * @since 1.0.0
 */
export interface KeySource {
  /** What to call it in the report: a file path or a namespace name. */
  readonly source: string;
  /** The dotted keys it defines. The same key may appear more than once. */
  readonly keys: Iterable<string>;
}

/**
 * A key defined more than once, found by {@link findDuplicateKeys}.
 *
 * @example
 * ```ts
 * import { type DuplicateKey, findDuplicateKeys } from "@shadow-js/i18n";
 *
 * const found: readonly DuplicateKey[] = findDuplicateKeys([
 *   { source: "a.json", keys: ["x", "y"] },
 *   { source: "b.json", keys: ["x"] },
 * ]);
 * console.log(found[0]); // { key: "x", sources: ["a.json", "b.json"] }
 * ```
 * @since 1.0.0
 */
export interface DuplicateKey {
  /** The key. */
  readonly key: string;
  /**
   * One entry per definition, in the order the keys were read: the name of each source that defines
   * it, a source that lists it twice appearing twice.
   */
  readonly sources: readonly string[];
}

/**
 * Finds keys that are defined more than once, across several catalog files (two files that both
 * define `cart.items`) and inside one (a key listed twice, for example read from a JSON file whose
 * object repeats a property, or `a.b` defined both nested and flat). The later definition would
 * silently win in a merged catalog, so tooling should fail on them. Keys are compared as exact
 * strings.
 *
 * @param sources Each file or namespace with the keys it defines (for example
 *   `flattenCatalog(messages).keys()`, or the keys of a scan of the file's text).
 * @returns The duplicated keys, in the order their first definition was read; `[]` when every key
 *   is defined once.
 * @example
 * ```ts
 * import { findDuplicateKeys } from "@shadow-js/i18n";
 *
 * const duplicates = findDuplicateKeys([
 *   { source: "cart.json", keys: ["cart.items", "cart.total", "cart.items"] },
 *   { source: "checkout.json", keys: ["cart.total", "pay"] },
 * ]);
 * console.log(duplicates);
 * // [
 * //   { key: "cart.items", sources: ["cart.json", "cart.json"] },
 * //   { key: "cart.total", sources: ["cart.json", "checkout.json"] },
 * // ]
 * ```
 * @see {@link compareKeys}
 * @since 1.0.0
 */
export function findDuplicateKeys(sources: Iterable<KeySource>): readonly DuplicateKey[] {
  const seen = new Map<string, string[]>();
  for (const entry of sources) {
    for (const key of entry.keys) {
      const known = seen.get(key);
      if (known === undefined) seen.set(key, [entry.source]);
      else known.push(entry.source);
    }
  }
  const out: DuplicateKey[] = [];
  for (const [key, where] of seen) {
    if (where.length > 1) out.push({ key, sources: where });
  }
  return out;
}
