/**
 * Stable codes of {@link I18nError}. Branch on the code, not on the message text.
 *
 * - `SYNTAX`: a catalog text could not be compiled (the `cause` is the {@link MessageSyntaxError});
 *   the key falls through to the next locale of the fallback chain.
 * - `UNKNOWN_LOCALE`: a locale that is not in `locales` (and matches none of them).
 * - `LOAD_FAILED`: a catalog loader threw or rejected.
 * - `MISSING_KEY`: no locale of the fallback chain has the key; `onMissing` decides the text.
 * - `MISSING_VALUE`: a message argument has no value.
 * - `MISSING_TAG_HANDLER`: a rich-text tag has no handler.
 * - `INVALID_VALUE`: a value of the wrong kind (a non-number for a number, an invalid date, a bad
 *   cookie name or origin).
 * - `FORMAT_FAILED`: an unknown named format, or `Intl` rejected the options.
 * - `INVALID_CATALOG`: a catalog that is not nested string data, or one over {@link CATALOG_LIMITS}.
 * - `INVALID_STATE`: a malformed hydration state, no instance where one is needed, or storage that
 *   cannot be read.
 *
 * @example
 * ```ts
 * import { createI18n, type I18nErrorCode } from "@shadow-js/i18n";
 *
 * const ignored: ReadonlySet<I18nErrorCode> = new Set(["MISSING_KEY"]);
 *
 * export const i18n = createI18n({
 *   defaultLocale: "en",
 *   locales: ["en", "fr"],
 *   messages: { en: { title: "Home" } },
 *   onError(error) {
 *     if (!ignored.has(error.code)) console.error(error.message);
 *   },
 * });
 * ```
 * @since 1.0.0
 */
export type I18nErrorCode =
  | "SYNTAX"
  | "UNKNOWN_LOCALE"
  | "LOAD_FAILED"
  | "MISSING_KEY"
  | "MISSING_VALUE"
  | "MISSING_TAG_HANDLER"
  | "INVALID_VALUE"
  | "FORMAT_FAILED"
  | "INVALID_CATALOG"
  | "INVALID_STATE";

/**
 * Every error this package raises or reports. `code` is stable; `message` starts with
 * `[shadow-i18n CODE]` and says what to change. Problems found while rendering (a missing key, a
 * bad value) are not thrown: they go to the `onError` option of {@link createI18n}.
 *
 * @example
 * ```ts
 * import { createI18n, I18nError } from "@shadow-js/i18n";
 *
 * const i18n = createI18n({ defaultLocale: "en", locales: ["en", "fr"] });
 *
 * function switchTo(requested: string): void {
 *   try {
 *     void i18n.setLocale(requested as "en" | "fr");
 *   } catch (error) {
 *     if (error instanceof I18nError && error.code === "UNKNOWN_LOCALE") {
 *       console.warn(error.message);
 *       return;
 *     }
 *     throw error;
 *   }
 * }
 *
 * switchTo("de");
 * ```
 * @see {@link I18nErrorCode}
 * @since 1.0.0
 */
export class I18nError extends Error {
  /** The stable code of the problem. */
  readonly code: I18nErrorCode;

  /**
   * Creates an error whose `name` is `"I18nError"` and whose message is
   * `[shadow-i18n CODE] message`.
   *
   * @param code A stable code.
   * @param message What happened and what to do.
   * @param options Standard `cause`.
   */
  constructor(code: I18nErrorCode, message: string, options?: ErrorOptions) {
    super(`[shadow-i18n ${code}] ${message}`, options);
    this.name = "I18nError";
    this.code = code;
  }
}

/**
 * Why an ICU message could not be parsed; the `syntaxCode` of a {@link MessageSyntaxError}.
 *
 * @example
 * ```ts
 * import { MessageSyntaxError, type SyntaxErrorCode } from "@shadow-js/i18n";
 * import { parseMessage } from "@shadow-js/i18n/icu";
 *
 * function syntaxCodeOf(text: string): SyntaxErrorCode | undefined {
 *   try {
 *     parseMessage(text);
 *     return undefined;
 *   } catch (error) {
 *     if (error instanceof MessageSyntaxError) return error.syntaxCode;
 *     throw error;
 *   }
 * }
 *
 * syntaxCodeOf("{count, plural, one {# item}}"); // "MISSING_OTHER_CLAUSE"
 * ```
 * @since 1.0.0
 */
export type SyntaxErrorCode =
  /** The text uses message syntax and the instance was created without a `compile` option. */
  | "NO_COMPILER"
  /** The message is longer than the parser's `maxLength` (see `PARSE_LIMITS`). */
  | "MESSAGE_TOO_LONG"
  /** Arguments, cases or tags are nested deeper than the parser's `maxDepth`. */
  | "NESTING_TOO_DEEP"
  /** The message has more parts than the parser's `maxNodes`. */
  | "TOO_MANY_NODES"
  /** The message ends inside an argument, a plural or a select. */
  | "UNEXPECTED_END"
  /** An argument is not followed by `,` or `}` where one is required. */
  | "EXPECT_ARGUMENT_CLOSING_BRACE"
  /** An argument has no name: `{}` or `{, number}`. */
  | "INVALID_ARGUMENT_NAME"
  /** The type is not one of `number`, `date`, `time`, `plural`, `selectordinal` or `select`. */
  | "INVALID_ARGUMENT_TYPE"
  /** A `plural`, `selectordinal` or `select` type is not followed by `,`. */
  | "EXPECT_COMMA"
  /** A selector is not followed by `{`. */
  | "EXPECT_CASE_OPENING_BRACE"
  /** A number, date or time style is empty or contains a brace. */
  | "INVALID_STYLE"
  /** A `::` skeleton of a number, date or time argument is not valid. */
  | "INVALID_SKELETON"
  /** A plural selector is not `zero`, `one`, `two`, `few`, `many`, `other` or `=N`. */
  | "INVALID_SELECTOR"
  /** The same selector appears twice in one plural or select. */
  | "DUPLICATE_SELECTOR"
  /** `offset:` is not followed by a whole number of at most 9 digits. */
  | "INVALID_OFFSET"
  /** A plural or select has no `other` case. */
  | "MISSING_OTHER_CLAUSE"
  /** A plural or select has no cases at all. */
  | "EXPECT_CASES"
  /** A `}` that closes nothing. */
  | "UNMATCHED_CLOSING_BRACE"
  /** A `<tag>` that is never closed. */
  | "UNCLOSED_TAG"
  /** A `</tag>` that does not close the open tag. */
  | "UNMATCHED_CLOSING_TAG";

/**
 * Thrown by `parseMessage` of `@shadow-js/i18n/icu` (and by the ICU compiler) for malformed ICU
 * syntax. It is the only error the parser throws. Its `code` is `"SYNTAX"`; `syntaxCode` says what
 * is wrong, `offset`, `line` and `column` locate it, and `message` shows the line with a caret.
 * An instance does not throw it while rendering: it reports it as an {@link I18nError} with code
 * `SYNTAX` and tries the next locale of the fallback chain.
 *
 * @example
 * ```ts
 * import { MessageSyntaxError } from "@shadow-js/i18n";
 * import { parseMessage } from "@shadow-js/i18n/icu";
 *
 * try {
 *   parseMessage("{count, plural, one {# item}}");
 * } catch (error) {
 *   if (error instanceof MessageSyntaxError) {
 *     console.log(error.syntaxCode, error.line, error.column); // "MISSING_OTHER_CLAUSE" 1 1
 *   }
 * }
 * ```
 * @see {@link SyntaxErrorCode}
 * @since 1.0.0
 */
export class MessageSyntaxError extends I18nError {
  /** What is wrong with the message. */
  readonly syntaxCode: SyntaxErrorCode;
  /** The message text that was parsed. */
  readonly source: string;
  /** UTF-16 offset of the problem in `source`, clamped to `0..source.length`. */
  readonly offset: number;
  /** 1-based line of `offset`. */
  readonly line: number;
  /** 1-based column of `offset` within its line, in UTF-16 code units. */
  readonly column: number;

  /**
   * Creates the error and computes `line` and `column` from `offset`. The message holds up to 40
   * characters on each side of the problem.
   *
   * @param syntaxCode What is wrong.
   * @param detail Human description.
   * @param source The message being parsed.
   * @param offset UTF-16 offset of the problem.
   */
  constructor(syntaxCode: SyntaxErrorCode, detail: string, source: string, offset: number) {
    const at = Math.max(0, Math.min(offset, source.length));
    const before = source.slice(0, at);
    const line = before.split("\n").length;
    const lineStart = before.lastIndexOf("\n") + 1;
    const column = at - lineStart + 1;
    let lineEnd = source.indexOf("\n", at);
    if (lineEnd === -1) lineEnd = source.length;
    // A bounded excerpt keeps the message readable for very long lines.
    const from = Math.max(lineStart, at - 40);
    const to = Math.min(lineEnd, at + 40);
    const excerpt = source.slice(from, to);
    const caret = `${" ".repeat(at - from)}^`;
    super("SYNTAX", `${syntaxCode} at ${line}:${column}: ${detail}\n  ${excerpt}\n  ${caret}`);
    this.name = "MessageSyntaxError";
    this.syntaxCode = syntaxCode;
    this.source = source;
    this.offset = at;
    this.line = line;
    this.column = column;
  }
}
