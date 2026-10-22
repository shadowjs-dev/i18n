/**
 * The full preset (subpath `@shadow-js/i18n/full`): `createI18nFull` creates an instance with
 * every opt-in feature and the ICU compiler, for an app that wants everything with one import.
 * It bundles all of them; pick features with `createI18n({ features })` to bundle less.
 * @packageDocumentation
 */
import { detection } from "./detect";
import { formatting } from "./format";
import type { BaseCatalog, CatalogLoader, I18n, I18nFeature } from "./i18n-types";
import { persistence } from "./persistence";
import { localeRouting } from "./routing";
import type { Messages } from "./types";
import { createI18nWithIcu, type IcuI18nOptions } from "./with-icu";

/**
 * Every opt-in feature: `formatting`, `localeRouting`, `persistence` and `detection`, in a frozen
 * list. `createI18nFull` passes them; pass them yourself where a factory takes `features`
 * (`createHotI18n`, `createI18nWithIcu`).
 *
 * @example
 * ```ts
 * import { createHotI18n } from "@shadow-js/i18n";
 * import { allFeatures } from "@shadow-js/i18n/full";
 * import { icuCompiler } from "@shadow-js/i18n/icu";
 *
 * export const i18n = createHotI18n(undefined, {
 *   defaultLocale: "en",
 *   locales: ["en", "fr"],
 *   messages: { en: { total: "Total: {amount, number}" } },
 *   compile: icuCompiler(),
 *   features: allFeatures,
 * });
 * console.log(i18n.formatNumber(3)); // "3"
 * ```
 * @since 1.0.0
 */
export const allFeatures: readonly I18nFeature[] = /* @__PURE__ */ Object.freeze([
  formatting,
  localeRouting,
  persistence,
  detection,
]);

/**
 * Creates an instance with everything: the ICU compiler (as {@link createI18nWithIcu}) and every
 * opt-in feature ({@link allFeatures}), so the `prefix`, `persist` and `detect` options, the
 * `format*` methods, `localePath` and `routing` all work without listing anything. The options are
 * those of `createI18nWithIcu`; features you pass in `features` are added (listing one that is
 * already there is harmless). This bundles every feature: use `createI18n` or
 * `createI18nWithIcu` with the features you need to bundle less.
 *
 * @param options The `createI18nWithIcu` options (locales, catalogs, `prefix`, `persist`,
 *   `detect`, `parse`, `validate`...).
 * @returns The instance.
 * @throws I18nError as `createI18n` does.
 * @throws TypeError when `features` holds something that is not a feature.
 * @example
 * ```ts
 * import { createI18nFull } from "@shadow-js/i18n/full";
 *
 * export const i18n = createI18nFull({
 *   defaultLocale: "en",
 *   locales: ["en", "fr"],
 *   messages: {
 *     en: { cart: "{count, plural, one {# item} other {# items}}" },
 *     fr: { cart: "{count, plural, one {# article} other {# articles}}" },
 *   },
 *   prefix: "as-needed",
 *   persist: "cookie",
 *   detect: true,
 *   timeZone: "UTC",
 * });
 *
 * console.log(i18n.t("cart", { count: 3 })); // "3 items"
 * console.log(i18n.formatNumber(0.5, "percent")); // "50%"
 * console.log(i18n.localePath("/cart", "fr")); // "/fr/cart"
 * ```
 * @see {@link createI18nWithIcu}
 * @since 1.0.0
 */
export function createI18nFull<
  const L extends string,
  const D extends L,
  const Mg extends Partial<Record<L, Messages>> = Record<never, never>,
  const Ld extends Partial<Record<L, CatalogLoader>> = Record<never, never>,
>(options: IcuI18nOptions<L, D, Mg, Ld>): I18n<L, BaseCatalog<Mg, Ld, D>> {
  const extra: unknown = options.features;
  return createI18nWithIcu<L, D, Mg, Ld>({
    ...options,
    // A value that is not a list is passed on as it is, so createI18n reports it.
    features: Array.isArray(extra)
      ? [...allFeatures, ...(extra as readonly I18nFeature[])]
      : extra === undefined
        ? allFeatures
        : (extra as readonly I18nFeature[]),
  });
}
