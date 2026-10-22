/**
 * The ICU message compiler: parses the MessageFormat syntax once per catalog text and renders the
 * tree. It is the default `compile` of `createI18nWithIcu`; `createI18n` takes it as an option and
 * does not load it.
 * @packageDocumentation
 */
import type { CompiledMessage, MessageCompiler } from "../message";
import { type FormatOptions, formatToParts, formatToString } from "./format";
import { type ParseOptions, parseMessage } from "./parse";

/**
 * Parses `source` as ICU MessageFormat and returns a message that renders the parsed tree. The text
 * is parsed once, here; each `format` call runs {@link formatToString} and each `parts` call runs
 * {@link formatToParts} on the same tree. Use it to compile one message outside an i18n instance;
 * inside one, pass {@link icuCompiler} as `compile`.
 *
 * @param source The catalog text.
 * @param parse Limits and tag handling of the parser. Omitted fields use {@link PARSE_LIMITS}.
 * @param format Bidi isolation of interpolated strings, see {@link FormatOptions}. Omitted: strings
 * are isolated in right-to-left locales only.
 * @returns The compiled message.
 * @throws `MessageSyntaxError` (from `@shadow-js/i18n`, `code` `"SYNTAX"`, with a `syntaxCode` such
 * as `"MISSING_OTHER_CLAUSE"`) when the text is not valid ICU syntax or exceeds a parse limit.
 * @example
 * ```ts
 * import { createIntlCache, type I18nError } from "@shadow-js/i18n";
 * import { type FormatContext, icuCompile } from "@shadow-js/i18n/icu";
 *
 * const ctx: FormatContext = {
 *   locale: "en",
 *   intl: createIntlCache(),
 *   formats: {},
 *   timeZone: "UTC",
 *   report: (error: I18nError) => console.warn(error.message),
 * };
 *
 * const items = icuCompile("{count, plural, one {# item} other {# items}}");
 * console.log(items.format({ count: 1 }, ctx)); // "1 item"
 * console.log(items.format({ count: 2 }, ctx)); // "2 items"
 * ```
 * @see {@link parseMessage}
 * @since 1.0.0
 */
export function icuCompile(
  source: string,
  parse?: ParseOptions,
  format?: FormatOptions,
): CompiledMessage {
  const nodes = parseMessage(source, parse);
  return {
    format: (values, ctx) => formatToString(nodes, values, ctx, format),
    parts: (values, handlers, ctx) => formatToParts(nodes, values, handlers, ctx, format),
  };
}

/**
 * Creates a `MessageCompiler` (the `compile` option of `createI18n`) that runs {@link icuCompile}
 * with the given parser limits. Use it to give `createI18n` ICU syntax, or to change the limits;
 * `createI18nWithIcu` already passes one built from its `parse` option.
 *
 * @param parse Limits and tag handling of the parser, applied to every message the compiler
 * receives. Omitted fields use {@link PARSE_LIMITS}.
 * @param format Bidi isolation of interpolated strings, see {@link FormatOptions}.
 * @returns The compiler. It throws `MessageSyntaxError` for invalid text; the i18n instance catches
 * that error and reports it through `onError` as an `I18nError` with code `"SYNTAX"`.
 * @example
 * ```ts
 * import { createI18n } from "@shadow-js/i18n";
 * import { icuCompiler } from "@shadow-js/i18n/icu";
 *
 * const i18n = createI18n({
 *   defaultLocale: "en",
 *   locales: ["en"],
 *   messages: { en: { inbox: "{count, plural, one {# message} other {# messages}}" } },
 *   compile: icuCompiler({ maxLength: 2_000, tags: false }),
 * });
 *
 * console.log(i18n.t("inbox", { count: 3 })); // "3 messages"
 * ```
 * @see {@link icuCompile}
 * @since 1.0.0
 */
export function icuCompiler(parse?: ParseOptions, format?: FormatOptions): MessageCompiler {
  return (source) => icuCompile(source, parse, format);
}
