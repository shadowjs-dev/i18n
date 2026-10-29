/**
 * `createI18nWithIcu`: `createI18n` with the ICU message compiler passed by default. Use it when the
 * catalogs use message syntax (placeholders, plurals, selects, rich tags). The compiler is the only
 * part of the ICU parser the root entry links, and only when this factory is used.
 * @packageDocumentation
 */

import { untrack } from "@shadow-js/core";
import { createI18n } from "./create-i18n";
import { I18nError } from "./errors";
import type { BaseCatalog, CatalogLoader, I18n, I18nOptions } from "./i18n-types";
import { icuCompiler } from "./icu/compile";
import type { FormatOptions } from "./icu/format";
import type { ParseOptions } from "./icu/parse";
import { type ValidateOptions, validateCatalogs } from "./icu/validate";
import type { Messages } from "./types";

/**
 * Options of {@link createI18nWithIcu}: the options of `createI18n` ({@link I18nOptions}) plus the
 * ICU settings.
 *
 * @example
 * ```ts
 * import { createI18nWithIcu, type IcuI18nOptions } from "@shadow-js/i18n";
 *
 * const en = { inbox: "{count, plural, one {# message} other {# messages}}" } as const;
 * const fr = { inbox: "{count, plural, one {# message} other {# messages}}" } as const;
 *
 * const options: IcuI18nOptions<"en" | "fr", "en", { en: typeof en; fr: typeof fr }, Record<never, never>> = {
 *   defaultLocale: "en",
 *   locales: ["en", "fr"],
 *   messages: { en, fr },
 *   parse: { maxLength: 2_000 },
 *   validate: { allowMissing: false },
 * };
 *
 * export const i18n = createI18nWithIcu(options);
 * ```
 * @since 1.0.0
 */
export interface IcuI18nOptions<
  L extends string,
  D extends L,
  Mg extends Partial<Record<L, Messages>>,
  Ld extends Partial<Record<L, CatalogLoader>>,
> extends I18nOptions<L, D, Mg, Ld> {
  /**
   * Limits of the ICU parser, passed to `icuCompiler` (see `PARSE_LIMITS` of
   * `@shadow-js/i18n/icu`). Ignored when `compile` is given. Default: the parser's limits.
   */
  readonly parse?: ParseOptions;
  /**
   * How interpolated strings are isolated for bidirectional text (see {@link FormatOptions}):
   * `"auto"` (the default) wraps a string in U+2068 and U+2069 only in right-to-left locales, so
   * left-to-right output is unchanged; `"always"` wraps in every locale; `"never"` never wraps.
   * Passed to `icuCompiler`; ignored when `compile` is given.
   * @default `{ isolation: "auto" }`
   */
  readonly format?: FormatOptions;
  /**
   * Development only: check the static `messages` against the default locale's with
   * `validateCatalogs` when the instance is created, and report each issue as an `INVALID_CATALOG`
   * error through `onError` (or `console.warn` without it). Missing keys are allowed (fallbacks
   * exist) unless you pass `{ allowMissing: false }`. Loaded catalogs are not checked, and nothing
   * runs in production builds.
   * @default `false`
   */
  readonly validate?: boolean | Omit<ValidateOptions, "base">;
}

/**
 * Creates an i18n instance whose catalogs may use ICU message syntax: placeholders, `number`,
 * `date` and `time` arguments, plurals, selects and rich-text tags. The same as {@link createI18n},
 * with the ICU compiler of `@shadow-js/i18n/icu`; pass `compile` yourself to replace it. Use
 * `createI18n` when every message is plain text, to leave the compiler out of the bundle. Opt-in
 * features (formatting, routing, persistence, detection) go in `features` as with `createI18n`;
 * `createI18nFull` from `@shadow-js/i18n/full` is this factory with every feature listed.
 *
 * @param options The `createI18n` options, plus `parse` and `validate`.
 * @returns The instance.
 * @throws I18nError as {@link createI18n} does.
 * @example
 * ```ts
 * import { createI18nWithIcu } from "@shadow-js/i18n";
 *
 * const i18n = createI18nWithIcu({
 *   defaultLocale: "en",
 *   locales: ["en"],
 *   messages: {
 *     en: {
 *       cart: "{count, plural, one {# item} other {# items}}",
 *       greeting: "Hello, {name}!",
 *     },
 *   },
 * });
 *
 * console.log(i18n.t("cart", { count: 2 })); // "2 items"
 * console.log(i18n.t("greeting", { name: "Ada" })); // "Hello, Ada!"
 * ```
 * @see {@link IcuI18nOptions}
 * @since 1.0.0
 */
export function createI18nWithIcu<
  const L extends string,
  const D extends L,
  const Mg extends Partial<Record<L, Messages>> = Record<never, never>,
  const Ld extends Partial<Record<L, CatalogLoader>> = Record<never, never>,
>(options: IcuI18nOptions<L, D, Mg, Ld>): I18n<L, BaseCatalog<Mg, Ld, D>> {
  const { parse, format, validate, ...rest } = options;
  if (__DEV__ && validate !== undefined && validate !== false && rest.messages !== undefined) {
    const settings = validate === true ? {} : validate;
    const result = validateCatalogs(rest.messages as Record<string, Messages>, {
      base: rest.defaultLocale,
      allowMissing: true,
      ...settings,
    });
    for (const issue of result.issues) {
      const error = new I18nError(
        "INVALID_CATALOG",
        `${issue.kind} [${issue.locale}] ${issue.key}: ${issue.detail}`,
      );
      // A user callback: it must not subscribe whatever computation creates the instance.
      if (rest.onError !== undefined) untrack(() => rest.onError?.(error));
      else console.warn(error.message);
    }
  }
  return createI18n<L, D, Mg, Ld>({
    ...rest,
    compile: rest.compile ?? icuCompiler(parse, format),
  });
}
