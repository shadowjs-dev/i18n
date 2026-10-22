import { createI18n } from "./create-i18n";
import type { BaseCatalog, CatalogLoader, I18n, I18nOptions } from "./i18n-types";
import type { Messages } from "./types";

/**
 * The part of Vite's `import.meta.hot` that {@link createHotI18n} uses. Pass `import.meta.hot` itself.
 *
 * @example
 * ```ts
 * import { createHotI18n, type HotI18nContext } from "@shadow-js/i18n";
 *
 * export function catalogFor(hot: HotI18nContext | undefined) {
 *   return createHotI18n(hot, {
 *     defaultLocale: "en",
 *     locales: ["en"],
 *     messages: { en: { title: "Home" } },
 *   });
 * }
 * ```
 * @since 1.0.0
 */
export interface HotI18nContext {
  /**
   * Kept across the updates of the module that owns it; the instance is stored under the key
   * `"shadowjs:i18n"`.
   */
  readonly data: Record<string, unknown>;
}

/** The `hot.data` key that holds the instance. */
const INSTANCE_KEY = "shadowjs:i18n";

/**
 * Development only: the i18n instance of a catalog module that Vite hot updates. The first evaluation
 * creates the instance with `createI18n`. Every later evaluation of the same module (an edit) keeps
 * that instance, replaces the catalog of each locale in `messages` with the edited text
 * (`replaceCatalog`) and returns it. Components that read a message update in place and keep their
 * state, because they are not re-evaluated: only the catalog module is.
 *
 * The module must also write the literal call `import.meta.hot?.accept();` (the bundler reads that
 * call to know the module updates itself; a call made only inside this function is not seen). Without
 * it an edit reloads the importers, and their components lose their state.
 *
 * On an edit only `messages` change. Locales, fallbacks, loaders and the other options are read on the
 * first evaluation; an edit to them needs a reload. Without `hot` (production, server) and when
 * `__DEV__` is false this is `createI18n(options)`, and the hot branch is dropped from the bundle.
 *
 * In a Vite module, pass `import.meta.hot` (typed by `vite/client`):
 * `export const i18n = createHotI18n(import.meta.hot, options);`, followed by the literal
 * `import.meta.hot?.accept();`.
 *
 * @param hot The module's `import.meta.hot`, or `undefined`.
 * @param options The `createI18n` options.
 * @returns The instance: the same one for every evaluation of the module in development.
 * @throws I18nError as `createI18n` does (an unknown default locale, a malformed static catalog);
 *   on an edit, `INVALID_CATALOG` from `replaceCatalog` for a malformed edited catalog.
 * @example
 * ```ts
 * import { createHotI18n, type HotI18nContext } from "@shadow-js/i18n";
 *
 * // What `import.meta.hot` keeps across two evaluations of the catalog module.
 * const hot: HotI18nContext = { data: {} };
 *
 * const first = createHotI18n(hot, {
 *   defaultLocale: "en",
 *   locales: ["en"],
 *   messages: { en: { title: "Draft" } },
 * });
 * const second = createHotI18n(hot, {
 *   defaultLocale: "en",
 *   locales: ["en"],
 *   messages: { en: { title: "Final" } },
 * });
 * console.log(first === second, first.t("title")); // true "Final" (in development)
 * ```
 * @see {@link HotI18nContext}
 * @since 1.0.0
 */
export function createHotI18n<
  const L extends string,
  const D extends L,
  const Mg extends Partial<Record<L, Messages>> = Record<never, never>,
  const Ld extends Partial<Record<L, CatalogLoader>> = Record<never, never>,
>(
  hot: HotI18nContext | undefined,
  options: I18nOptions<L, D, Mg, Ld>,
): I18n<L, BaseCatalog<Mg, Ld, D>> {
  if (!__DEV__ || hot === undefined || typeof hot.data !== "object" || hot.data === null) {
    return createI18n(options);
  }
  const kept = hot.data[INSTANCE_KEY];
  // Whatever else sits under the key (another version of this package, a stale shape) is replaced.
  if (
    typeof kept !== "object" ||
    kept === null ||
    typeof Reflect.get(kept, "replaceCatalog") !== "function"
  ) {
    const created = createI18n(options);
    hot.data[INSTANCE_KEY] = created;
    return created;
  }
  const instance = kept as I18n<L, BaseCatalog<Mg, Ld, D>>;
  const messages = options.messages as Partial<Record<L, Messages>> | undefined;
  if (messages !== undefined) {
    for (const locale of options.locales) {
      const catalog = Object.hasOwn(messages, locale) ? messages[locale] : undefined;
      if (catalog !== undefined) instance.replaceCatalog(locale, catalog);
    }
  }
  return instance;
}
