/**
 * The `formatting` feature (subpath `@shadow-js/i18n/format`): the `format*` methods of an
 * instance (numbers, dates, relative times, lists, display names) and so the `Formatted*`
 * components. Without this feature those methods throw a `TypeError` that names it, and the
 * formatting code is not bundled. ICU message arguments (`{n, number}`, `{d, date}`) do not need
 * it: the ICU compiler formats them itself.
 * @packageDocumentation
 */
import type { I18nFeature } from "./i18n-types";
import { createFormatters } from "./internal/formatters";

/**
 * The `formatting` feature: gives an instance (and each of its forks) `formatNumber`,
 * `formatDate`, `formatRelative`, `formatList` and `formatDisplayName`, built on `Intl` with the
 * instance's bounded formatter cache, `formats`, `timeZone` and `now` options. The
 * `FormattedNumber`, `FormattedDate`, `FormattedRelative` and `FormattedList` components call
 * these methods, so they need the feature too. Without it, each method throws a `TypeError` that
 * names the feature.
 *
 * @example
 * ```ts
 * import { createI18n } from "@shadow-js/i18n";
 * import { formatting } from "@shadow-js/i18n/format";
 *
 * const i18n = createI18n({
 *   defaultLocale: "en",
 *   locales: ["en", "de"],
 *   timeZone: "UTC",
 *   features: [formatting],
 * });
 *
 * console.log(i18n.formatNumber(1234.5)); // "1,234.5"
 * console.log(i18n.formatDate(Date.UTC(2024, 0, 31), "long")); // "January 31, 2024"
 * console.log(i18n.fork("de").formatNumber(1234.5)); // "1.234,5"
 * ```
 * @since 1.0.0
 */
export const formatting: I18nFeature<"formatting"> = /* @__PURE__ */ Object.freeze({
  name: "formatting",
  plug: createFormatters,
});
