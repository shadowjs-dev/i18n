/**
 * Value helpers the formatters share: the plural-free parts of message formatting (number and date
 * options, numeric and date coercion, locale-aware `Intl` calls). Nothing here parses ICU, so the
 * core of `createI18n` can use it without the message compiler.
 * @packageDocumentation
 */
import { I18nError } from "./errors";
import type { IntlCache } from "./intl";

/**
 * Named formats, set with the `formats` option of `createI18n`. Messages use them as
 * `{n, number, name}`, `{d, date, name}` and `{d, time, name}`; the `format*` methods and the
 * `Formatted*` components take the name as their `format`. A name defined here wins over a
 * built-in style of the same name; an unknown name is reported as `FORMAT_FAILED` and the default
 * style is used.
 *
 * @example
 * ```ts
 * import { createI18nWithIcu } from "@shadow-js/i18n";
 * import type { Formats } from "@shadow-js/i18n/icu";
 *
 * const formats: Formats = {
 *   number: { price: { style: "currency", currency: "EUR" } },
 *   date: { day: { weekday: "long", day: "numeric", month: "long" } },
 *   list: { or: { type: "disjunction" } },
 * };
 *
 * const i18n = createI18nWithIcu({
 *   defaultLocale: "en",
 *   locales: ["en"],
 *   messages: { en: { total: "Total: {amount, number, price}" } },
 *   formats,
 *   timeZone: "UTC",
 * });
 *
 * console.log(i18n.t("total", { amount: 12.5 })); // "Total: €12.50"
 * console.log(i18n.formatList(["red", "blue"], "or")); // "red or blue"
 * ```
 * @since 1.0.0
 */
export interface Formats {
  /**
   * `Intl.NumberFormat` options by name, for `{n, number, name}` and `formatNumber`. Built-in
   * names when not defined here: `"integer"` and `"percent"`.
   */
  readonly number?: Readonly<Record<string, Intl.NumberFormatOptions>>;
  /**
   * `Intl.DateTimeFormat` options by name, for `{d, date, name}` and `formatDate`. Built-in names
   * when not defined here: `"short"`, `"medium"`, `"long"` and `"full"` (a `dateStyle`).
   */
  readonly date?: Readonly<Record<string, Intl.DateTimeFormatOptions>>;
  /**
   * `Intl.DateTimeFormat` options by name, for `{d, time, name}`. Built-in names when not defined
   * here: `"short"`, `"medium"`, `"long"` and `"full"` (a `timeStyle`).
   */
  readonly time?: Readonly<Record<string, Intl.DateTimeFormatOptions>>;
  /** `Intl.ListFormat` options by name, for `formatList` and `<FormattedList>`. */
  readonly list?: Readonly<Record<string, Intl.ListFormatOptions>>;
}

/**
 * Everything a format run needs besides the message and its values: what a
 * {@link CompiledMessage} and `formatToString` of `@shadow-js/i18n/icu` receive. An instance builds
 * one per locale from its options.
 *
 * @example
 * ```ts
 * import { createIntlCache, type I18nError } from "@shadow-js/i18n";
 * import { type FormatContext, formatToString, parseMessage } from "@shadow-js/i18n/icu";
 *
 * const ctx: FormatContext = {
 *   locale: "fr",
 *   intl: createIntlCache(),
 *   formats: {},
 *   timeZone: "Europe/Paris",
 *   report: (error: I18nError) => console.warn(error.code, error.message),
 * };
 *
 * console.log(formatToString(parseMessage("{n, number, percent}"), { n: 0.5 }, ctx));
 * ```
 * @since 1.0.0
 */
export interface FormatContext {
  /** The BCP 47 locale the message is formatted in. */
  readonly locale: string;
  /** The cache the `Intl` formatters come from. */
  readonly intl: IntlCache;
  /** Named formats (the `formats` option; `{}` when it is not set). */
  readonly formats: Formats;
  /** IANA zone applied to dates that do not set their own; `undefined` uses the runtime zone. */
  readonly timeZone: string | undefined;
  /** Receives recoverable problems; the output falls back to readable text. */
  readonly report: (error: I18nError) => void;
}

/**
 * A rich-text tag handler as the formatter sees it: receives the formatted children of the tag and
 * returns what replaces it. {@link RichTag} is the same contract with the renderer's types.
 *
 * @example
 * ```ts
 * import { createIntlCache } from "@shadow-js/i18n";
 * import { formatToParts, parseMessage, type TagHandler } from "@shadow-js/i18n/icu";
 *
 * const bold: TagHandler = (chunks) => `**${chunks.join("")}**`;
 * const parts = formatToParts(parseMessage("A <b>bold</b> move"), {}, { b: bold }, {
 *   locale: "en",
 *   intl: createIntlCache(),
 *   formats: {},
 *   timeZone: undefined,
 *   report: (error) => console.warn(error.message),
 * });
 * console.log(parts.join("")); // "A **bold** move"
 * ```
 * @since 1.0.0
 */
export type TagHandler = (chunks: readonly unknown[]) => unknown;

const BUILTIN_DATE: Readonly<Record<string, "short" | "medium" | "long" | "full">> = Object.freeze({
  short: "short",
  medium: "medium",
  long: "long",
  full: "full",
});

/**
 * True for the values that can hold named arguments. A string passed by mistake has own properties
 * (`length`, its indices) that `Object.hasOwn` would find, and `Reflect.get` throws on it: it is
 * treated as no values at all.
 */
function isArgumentBag(values: unknown): values is object {
  return (typeof values === "object" && values !== null) || typeof values === "function";
}

/**
 * Own-property lookup that cannot reach the prototype chain.
 * @internal
 */
export function ownValue(values: object | undefined, name: string): unknown {
  if (!isArgumentBag(values)) return undefined;
  return Object.hasOwn(values, name) ? Reflect.get(values, name) : undefined;
}

/**
 * True when `values` has `name` as an own property.
 * @internal
 */
export function hasOwn(values: object | undefined, name: string): boolean {
  return isArgumentBag(values) && Object.hasOwn(values, name);
}

/**
 * Calls an accessor value (reactive) and returns plain values unchanged.
 * @internal
 */
export function unwrap(value: unknown): unknown {
  return typeof value === "function" ? (value as () => unknown)() : value;
}

/**
 * Number coercion for numeric arguments; `undefined` when it is not a finite-or-infinite number.
 * @internal
 */
export function toNumeric(value: unknown): number | bigint | undefined {
  if (typeof value === "number") return Number.isNaN(value) ? undefined : value;
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

/**
 * Date coercion: a valid `Date`, epoch milliseconds, or a date string `Date` can parse (ISO 8601
 * is the one to rely on); `undefined` for anything else, an invalid date included.
 * @internal
 */
export function toDate(value: unknown): Date | undefined {
  let date: Date | undefined;
  if (value instanceof Date) date = value;
  else if (typeof value === "number") date = new Date(value);
  else if (typeof value === "string") date = new Date(value);
  return date === undefined || Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Options of a named or built-in number style.
 * @internal
 */
export function numberOptions(
  style: string | undefined,
  ctx: FormatContext,
): Intl.NumberFormatOptions | undefined {
  if (style === undefined) return undefined;
  const custom = ctx.formats.number;
  if (custom !== undefined && Object.hasOwn(custom, style)) return custom[style];
  if (style === "integer") return { maximumFractionDigits: 0 };
  if (style === "percent") return { style: "percent" };
  ctx.report(
    new I18nError(
      "FORMAT_FAILED",
      `unknown number format "${style}"; define it in createI18n({ formats: { number } }).`,
    ),
  );
  return undefined;
}

/**
 * Options of a named or built-in date/time style.
 * @internal
 */
export function dateOptions(
  kind: "date" | "time",
  style: string | undefined,
  ctx: FormatContext,
): Intl.DateTimeFormatOptions {
  const key = kind === "date" ? "dateStyle" : "timeStyle";
  const named = kind === "date" ? ctx.formats.date : ctx.formats.time;
  if (style === undefined) return { [key]: "medium" };
  if (named !== undefined && Object.hasOwn(named, style)) return named[style] ?? {};
  const builtin = Object.hasOwn(BUILTIN_DATE, style) ? BUILTIN_DATE[style] : undefined;
  if (builtin !== undefined) return { [key]: builtin };
  ctx.report(
    new I18nError(
      "FORMAT_FAILED",
      `unknown ${kind} format "${style}"; define it in createI18n({ formats: { ${kind} } }).`,
    ),
  );
  return { [key]: "medium" };
}

/**
 * `Intl.NumberFormat` call with the skeleton scale applied; bigint values ignore the scale.
 * @internal
 */
export function formatNumberValue(
  ctx: FormatContext,
  value: number | bigint,
  options: Intl.NumberFormatOptions | undefined,
  scale = 1,
): string {
  const scaled = scale !== 1 && typeof value === "number" ? value * scale : value;
  return ctx.intl.number(ctx.locale, options).format(scaled);
}

/**
 * `Intl.DateTimeFormat` call with the context time zone as default.
 * @internal
 */
export function formatDateValue(
  ctx: FormatContext,
  value: Date,
  options: Intl.DateTimeFormatOptions,
): string {
  const withZone =
    ctx.timeZone !== undefined && options.timeZone === undefined
      ? { ...options, timeZone: ctx.timeZone }
      : options;
  return ctx.intl.date(ctx.locale, withZone).format(value);
}
