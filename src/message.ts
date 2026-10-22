/**
 * The message seam of the core: what a catalog entry becomes once it is read. The core never parses
 * ICU syntax. A text with no syntax (no `{`, `}`, `<`, and no apostrophe the parser would read) is
 * its own message; anything else needs the `compile` option of `createI18n`, which the ICU compiler
 * from `@shadow-js/i18n/icu` provides (`createI18nWithIcu` passes it by default).
 * @packageDocumentation
 */
import type { FormatContext, TagHandler } from "./values";

/**
 * A message ready to render. A {@link MessageCompiler} returns one for each catalog text; the
 * instance caches it (see the `cacheSize` option) and calls `format` for `t` and `parts` for
 * `t.rich` and `<Trans>`.
 *
 * @example
 * ```ts
 * import { type CompiledMessage, createI18n, type MessageCompiler } from "@shadow-js/i18n";
 *
 * // A compiler for `{name}` placeholders only.
 * const compile: MessageCompiler = (source) => {
 *   const fill = (values: object | undefined): string =>
 *     source.replace(/\{(\w+)\}/g, (whole, name: string) => {
 *       const value: unknown = values === undefined ? undefined : Reflect.get(values, name);
 *       return value === undefined ? whole : String(value);
 *     });
 *   const message: CompiledMessage = {
 *     format: (values) => fill(values),
 *     parts: (values) => [fill(values)],
 *   };
 *   return message;
 * };
 *
 * const i18n = createI18n({
 *   defaultLocale: "en",
 *   locales: ["en"],
 *   messages: { en: { greeting: "Hello, {name}!" } },
 *   compile,
 * });
 * console.log(i18n.translate("greeting", { name: "Ada" })); // "Hello, Ada!"
 * ```
 * @since 1.0.0
 */
export interface CompiledMessage {
  /**
   * Renders the message to a string with `values` (the second argument of `t`). It must not throw
   * for bad values: problems go to `ctx.report`, and the output stays readable.
   */
  readonly format: (values: object | undefined, ctx: FormatContext) => string;
  /**
   * Renders the message to chunks: text, and the values that rich-text tags produced. `handlers`
   * maps each tag name to its handler (the same object as `values` for `t.rich`). Text chunks are
   * strings, never markup.
   */
  readonly parts: (
    values: object | undefined,
    handlers: Readonly<Record<string, TagHandler>> | undefined,
    ctx: FormatContext,
  ) => readonly unknown[];
}

/**
 * Turns the text of one catalog entry into a {@link CompiledMessage}; the `compile` option of
 * {@link createI18n}. It is called only for text that uses message syntax (`{`, `}`, `<`, or an
 * apostrophe ICU reads as quoting): plain text renders without it. A syntax error must be thrown
 * as {@link MessageSyntaxError}: the instance then reports a `SYNTAX` error and tries the next
 * locale of the fallback chain. Any other error thrown by the compiler propagates to the caller of
 * `t`. `icuCompiler()` from `@shadow-js/i18n/icu` is the standard one.
 *
 * @example
 * ```ts
 * import { createI18n, type MessageCompiler } from "@shadow-js/i18n";
 * import { icuCompiler } from "@shadow-js/i18n/icu";
 *
 * const compile: MessageCompiler = icuCompiler({ maxLength: 2_000 });
 *
 * export const i18n = createI18n({
 *   defaultLocale: "en",
 *   locales: ["en"],
 *   messages: { en: { inbox: "{count, plural, one {# message} other {# messages}}" } },
 *   compile,
 * });
 * ```
 * @since 1.0.0
 */
export type MessageCompiler = (source: string) => CompiledMessage;

/** Text that needs a compiler: a placeholder or tag opener, or an apostrophe ICU reads as quoting. */
const SYNTAX = /[{}<]|''|'>/;

/**
 * Whether a catalog text is plain text, which the core renders without a compiler.
 * @internal
 */
export function isPlainText(text: string): boolean {
  return !SYNTAX.test(text);
}

/**
 * The message of plain text: it is the text, whatever the values are.
 * @internal
 */
export function plainMessage(text: string): CompiledMessage {
  return {
    format: () => text,
    parts: () => [text],
  };
}
