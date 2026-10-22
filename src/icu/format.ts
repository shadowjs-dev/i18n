import { untrack } from "@shadow-js/core";
import { I18nError } from "../errors";
import { localeDirection } from "../locale";
import {
  dateOptions,
  type FormatContext,
  formatDateValue,
  formatNumberValue,
  hasOwn,
  numberOptions,
  ownValue,
  type TagHandler,
  toDate,
  toNumeric,
  unwrap,
} from "../values";
import type { MessageCase, MessageNode } from "./ast";

export type { FormatContext, Formats, TagHandler } from "../values";

/** First strong isolate (U+2068) and pop directional isolate (U+2069): they fence an interpolated string. */
const FSI = "\u2068";
const PDI = "\u2069";

/**
 * Options of {@link formatToString} and {@link formatToParts} (and of {@link icuCompile} and
 * {@link icuCompiler}) that do not depend on the locale or the values.
 *
 * @example
 * ```ts
 * import { type FormatOptions, icuCompile } from "@shadow-js/i18n/icu";
 *
 * // Isolate user-supplied strings in every locale, also in left-to-right ones.
 * const options: FormatOptions = { isolation: "always" };
 * const greeting = icuCompile("Hello {name}", undefined, options);
 * console.log(typeof greeting.format); // "function"
 * ```
 * @see {@link formatToString}
 * @since 1.0.0
 */
export interface FormatOptions {
  /**
   * Whether a string value interpolated with a simple argument (`{name}`) is wrapped in a first
   * strong isolate (U+2068) and a pop directional isolate (U+2069), so that its direction cannot
   * reorder the text around it (a Latin name inside Arabic text, or an Arabic name inside English
   * text). The rule:
   *
   * - `"auto"`: wrap when the direction of the message's locale (`FormatContext.locale`, by
   *   `localeDirection`) is right to left, and leave left-to-right output byte for byte unchanged.
   * - `"always"`: wrap in every locale. Use it when left-to-right messages show right-to-left user
   *   content.
   * - `"never"`: never wrap, also in right-to-left locales.
   *
   * Only non-empty strings are wrapped. Numbers, bigints, booleans, dates, `#`, formatted numbers
   * and dates, the `{name}` placeholder shown for a missing value and literal text are never
   * wrapped. An unknown value is treated as `"auto"`.
   * @default "auto"
   */
  readonly isolation?: "auto" | "always" | "never";
}

function placeholder(name: string): string {
  return `{${name}}`;
}

function shouldIsolate(ctx: FormatContext, options: FormatOptions | undefined): boolean {
  const mode = options?.isolation;
  if (mode === "always") return true;
  if (mode === "never") return false;
  return localeDirection(ctx.locale, ctx.intl) === "rtl";
}

/** One level of output being assembled; adjacent strings are merged. */
class Parts {
  readonly items: unknown[] = [];
  push(item: unknown): void {
    if (typeof item === "string") {
      if (item === "") return;
      const last = this.items.length - 1;
      const previous = this.items[last];
      if (typeof previous === "string") this.items[last] = previous + item;
      else this.items.push(item);
    } else {
      this.items.push(item);
    }
  }
  pushAll(items: readonly unknown[]): void {
    for (const item of items) this.push(item);
  }
}

interface Run {
  readonly ctx: FormatContext;
  readonly values: object | undefined;
  readonly handlers: Readonly<Record<string, TagHandler>> | undefined;
  /** Rich mode reports missing handlers; plain mode drops tags silently. */
  readonly rich: boolean;
  /** Wrap interpolated strings in FSI and PDI. */
  readonly isolate: boolean;
}

function selectCase(cases: readonly MessageCase[], key: string): MessageCase | undefined {
  let other: MessageCase | undefined;
  for (const entry of cases) {
    if (entry.selector === key) return entry;
    if (entry.selector === "other") other = entry;
  }
  return other;
}

function pluralCase(
  run: Run,
  cases: readonly MessageCase[],
  value: number,
  offset: number,
  ordinal: boolean,
): MessageCase | undefined {
  for (const entry of cases) {
    if (entry.selector.charCodeAt(0) === 61 && Number(entry.selector.slice(1)) === value) {
      return entry;
    }
  }
  let category: string;
  try {
    category = run.ctx.intl
      .plural(run.ctx.locale, ordinal ? "ordinal" : "cardinal")
      .select(value - offset);
  } catch (error) {
    // `Intl.PluralRules` rejects a malformed locale tag; the `other` clause is always there.
    run.ctx.report(
      new I18nError(
        "FORMAT_FAILED",
        `plural rules for "${run.ctx.locale}": ${(error as Error).message}`,
        {
          cause: error,
        },
      ),
    );
    category = "other";
  }
  return selectCase(cases, category);
}

function formatNodes(
  run: Run,
  nodes: readonly MessageNode[],
  out: Parts,
  pound: string | undefined,
): void {
  const { ctx, values } = run;
  for (const node of nodes) {
    switch (node.kind) {
      case "text":
        out.push(node.value);
        break;
      case "pound":
        out.push(pound ?? "#");
        break;
      case "argument": {
        if (!hasOwn(values, node.name)) {
          ctx.report(new I18nError("MISSING_VALUE", `no value for {${node.name}}.`));
          out.push(placeholder(node.name));
          break;
        }
        const value = unwrap(ownValue(values, node.name));
        if (typeof value === "string") {
          out.push(run.isolate && value !== "" ? `${FSI}${value}${PDI}` : value);
        } else if (
          typeof value === "number" ||
          typeof value === "bigint" ||
          typeof value === "boolean"
        ) {
          out.push(String(value));
        } else if (value instanceof Date) {
          const date = toDate(value);
          if (date === undefined) {
            ctx.report(new I18nError("INVALID_VALUE", `{${node.name}} is an invalid Date.`));
            out.push(placeholder(node.name));
          } else {
            try {
              out.push(formatDateValue(ctx, date, dateOptions("date", undefined, ctx)));
            } catch (error) {
              ctx.report(
                new I18nError("FORMAT_FAILED", `{${node.name}}: ${(error as Error).message}`, {
                  cause: error,
                }),
              );
              out.push(date.toISOString());
            }
          }
        } else {
          ctx.report(
            new I18nError(
              "INVALID_VALUE",
              `{${node.name}} needs a string, number, boolean or Date, got ${value === null ? "null" : typeof value}.`,
            ),
          );
          out.push(placeholder(node.name));
        }
        break;
      }
      case "number": {
        const raw = unwrap(ownValue(values, node.name));
        const value = toNumeric(raw);
        if (value === undefined) {
          ctx.report(
            new I18nError(
              hasOwn(values, node.name) ? "INVALID_VALUE" : "MISSING_VALUE",
              `{${node.name}, number} needs a number.`,
            ),
          );
          out.push(placeholder(node.name));
          break;
        }
        try {
          if (node.skeleton !== undefined) {
            out.push(formatNumberValue(ctx, value, node.skeleton.options, node.skeleton.scale));
          } else {
            out.push(formatNumberValue(ctx, value, numberOptions(node.style, ctx)));
          }
        } catch (error) {
          ctx.report(
            new I18nError("FORMAT_FAILED", `{${node.name}, number}: ${(error as Error).message}`, {
              cause: error,
            }),
          );
          out.push(String(value));
        }
        break;
      }
      case "date":
      case "time": {
        const raw = unwrap(ownValue(values, node.name));
        const date = toDate(raw);
        if (date === undefined) {
          ctx.report(
            new I18nError(
              hasOwn(values, node.name) ? "INVALID_VALUE" : "MISSING_VALUE",
              `{${node.name}, ${node.kind}} needs a Date, a timestamp or an ISO string.`,
            ),
          );
          out.push(placeholder(node.name));
          break;
        }
        try {
          const options =
            node.skeleton === undefined
              ? dateOptions(node.kind, node.style, ctx)
              : node.skeleton.options;
          out.push(formatDateValue(ctx, date, options));
        } catch (error) {
          ctx.report(
            new I18nError(
              "FORMAT_FAILED",
              `{${node.name}, ${node.kind}}: ${(error as Error).message}`,
              { cause: error },
            ),
          );
          out.push(date.toISOString());
        }
        break;
      }
      case "plural": {
        const raw = unwrap(ownValue(values, node.name));
        const value = toNumeric(raw);
        if (value === undefined || !Number.isFinite(Number(value))) {
          ctx.report(
            new I18nError(
              hasOwn(values, node.name) ? "INVALID_VALUE" : "MISSING_VALUE",
              `{${node.name}, plural} needs a finite number.`,
            ),
          );
          out.push(placeholder(node.name));
          break;
        }
        const numeric = Number(value);
        const chosen = pluralCase(run, node.cases, numeric, node.offset, node.ordinal);
        if (chosen === undefined) break;
        // A bigint keeps its digits; `+ 0` turns -0 into 0 so that `#` never shows "-0".
        const remainder: number | bigint =
          typeof value === "bigint" ? value - BigInt(node.offset) : numeric - node.offset + 0;
        let shown: string;
        try {
          shown = formatNumberValue(ctx, remainder, undefined);
        } catch (error) {
          ctx.report(
            new I18nError("FORMAT_FAILED", `{${node.name}, plural}: ${(error as Error).message}`, {
              cause: error,
            }),
          );
          shown = String(remainder);
        }
        formatNodes(run, chosen.body, out, shown);
        break;
      }
      case "select": {
        if (!hasOwn(values, node.name)) {
          ctx.report(new I18nError("MISSING_VALUE", `no value for {${node.name}, select}.`));
        }
        const raw = unwrap(ownValue(values, node.name));
        let key = "other";
        if (typeof raw === "string") key = raw;
        else if (typeof raw === "number" || typeof raw === "bigint" || typeof raw === "boolean") {
          key = String(raw);
        } else if (raw !== undefined && raw !== null) {
          // An object has no reliable text (it may have no `toString`, or one that throws).
          ctx.report(
            new I18nError(
              "INVALID_VALUE",
              `{${node.name}, select} needs a string, number or boolean, got ${typeof raw}.`,
            ),
          );
        }
        const chosen = selectCase(node.cases, key);
        if (chosen !== undefined) formatNodes(run, chosen.body, out, pound);
        break;
      }
      case "tag": {
        const inner = new Parts();
        formatNodes(run, node.children, inner, pound);
        const handler =
          run.handlers !== undefined && Object.hasOwn(run.handlers, node.name)
            ? run.handlers[node.name]
            : undefined;
        if (handler === undefined) {
          if (run.rich) {
            ctx.report(
              new I18nError(
                "MISSING_TAG_HANDLER",
                `no handler for <${node.name}>; its text is shown without markup.`,
              ),
            );
          }
          out.pushAll(inner.items);
        } else {
          out.push(untrack(() => handler(inner.items)));
        }
        break;
      }
    }
  }
}

/**
 * Formats a parsed message to a string for `ctx.locale`. Tags are dropped and their content kept,
 * without a report. Recoverable problems go to `ctx.report` as an `I18nError` and the output stays
 * readable: a missing value (`MISSING_VALUE`) or a value of the wrong type (`INVALID_VALUE`) shows as
 * `{name}`, an unknown named style (`FORMAT_FAILED`) falls back to the default format, and an
 * `Intl` failure (`FORMAT_FAILED`) shows the raw number or the ISO date. An invalid `Date` in a
 * simple argument is `INVALID_VALUE` and shows as `{name}`; an object given to a `select` is
 * `INVALID_VALUE` and selects `other`. Only an exception thrown by your own accessor value or tag
 * handler propagates.
 *
 * @param nodes A parsed message, from {@link parseMessage}.
 * @param values Arguments by name, read as own properties only. A function value is an accessor: it
 * is called and its result is used, so a reactive caller tracks it. `undefined` means no values.
 * @param ctx Locale, `Intl` cache, named formats, time zone and the problem reporter.
 * @param options Bidi isolation of interpolated strings, see {@link FormatOptions}. By default
 * strings are wrapped in U+2068 and U+2069 for a right-to-left locale and left alone otherwise.
 * @returns The formatted text.
 * @example
 * ```ts
 * import { createIntlCache, type I18nError } from "@shadow-js/i18n";
 * import { type FormatContext, formatToString, parseMessage } from "@shadow-js/i18n/icu";
 *
 * const ctx: FormatContext = {
 *   locale: "en",
 *   intl: createIntlCache(),
 *   formats: {},
 *   timeZone: "UTC",
 *   report: (error: I18nError) => console.warn(error.message),
 * };
 *
 * const cats = parseMessage("{n, plural, one {# cat} other {# cats}}");
 * console.log(formatToString(cats, { n: 2 }, ctx)); // "2 cats"
 * console.log(formatToString(parseMessage("Hi {name}"), {}, ctx)); // "Hi {name}", and one report
 * ```
 * @see {@link formatToParts}
 * @see {@link icuCompile}
 * @since 1.0.0
 */
export function formatToString(
  nodes: readonly MessageNode[],
  values: object | undefined,
  ctx: FormatContext,
  options?: FormatOptions,
): string {
  const out = new Parts();
  formatNodes(
    { ctx, values, handlers: undefined, rich: false, isolate: shouldIsolate(ctx, options) },
    nodes,
    out,
    undefined,
  );
  return out.items.join("");
}

/**
 * Formats a parsed message to a list of parts for rich text: strings, and whatever the tag handlers
 * returned. Each handler receives the already formatted parts between its tags and runs untracked.
 * Strings are always plain text, never markup, so pass the list to the renderer as children. A tag
 * without a handler reports `MISSING_TAG_HANDLER` and its content is kept without markup. Other
 * problems are handled as in {@link formatToString}.
 *
 * @param nodes A parsed message, from {@link parseMessage}.
 * @param values Arguments by name, read as own properties only; function values are called.
 * @param handlers Tag handlers by tag name (own properties only); `undefined` for none.
 * @param ctx Locale, `Intl` cache, named formats, time zone and the problem reporter.
 * @param options Bidi isolation of interpolated strings, see {@link FormatOptions}.
 * @returns The parts in order, with adjacent strings merged and empty strings left out.
 * @example
 * ```ts
 * import { createIntlCache, type I18nError } from "@shadow-js/i18n";
 * import { type FormatContext, formatToParts, parseMessage } from "@shadow-js/i18n/icu";
 *
 * const ctx: FormatContext = {
 *   locale: "en",
 *   intl: createIntlCache(),
 *   formats: {},
 *   timeZone: undefined,
 *   report: (error: I18nError) => console.warn(error.message),
 * };
 *
 * const parts = formatToParts(
 *   parseMessage("Hi <b>{name}</b>!"),
 *   { name: "Ada" },
 *   { b: (chunks) => ({ bold: chunks }) },
 *   ctx,
 * );
 * console.log(parts); // ["Hi ", { bold: ["Ada"] }, "!"]
 * ```
 * @see {@link TagHandler}
 * @since 1.0.0
 */
export function formatToParts(
  nodes: readonly MessageNode[],
  values: object | undefined,
  handlers: Readonly<Record<string, TagHandler>> | undefined,
  ctx: FormatContext,
  options?: FormatOptions,
): unknown[] {
  const out = new Parts();
  formatNodes(
    { ctx, values, handlers, rich: true, isolate: shouldIsolate(ctx, options) },
    nodes,
    out,
    undefined,
  );
  return out.items;
}
