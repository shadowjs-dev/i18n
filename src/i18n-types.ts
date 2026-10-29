import type { Accessor } from "@shadow-js/core";
import type { DetectInput, DetectSource } from "./detect";
import type { I18nError } from "./errors";
import type { FeaturePlugs } from "./internal/features";
import type { Direction } from "./locale";
import type { MessageCompiler } from "./message";
import type { CookieStrategyOptions, PersistStrategy, StorageStrategyOptions } from "./persist";
import type { LocalePrefix, LocaleRouting } from "./routing";
import type { MessageAt, Messages, NamespaceKey, RichChunk, Translator } from "./types";
import type { Formats } from "./values";

// ---------------------------------------------------------------------------------------------
// Public types

/**
 * The names of the opt-in features of an instance:
 *
 * - `"formatting"`: the `format*` methods and the `Formatted*` components
 *   (`formatting` from `@shadow-js/i18n/format`).
 * - `"routing"`: the `prefix` option, `localePath`, `routing`, and what uses them
 *   (`localeRouting` from `@shadow-js/i18n/routing`).
 * - `"persistence"`: the `persist` option (`persistence` from `@shadow-js/i18n/persistence`).
 * - `"detection"`: the `detect` option (`detection` from `@shadow-js/i18n/detect`).
 *
 * @example
 * ```ts
 * import type { I18nFeatureName } from "@shadow-js/i18n";
 *
 * const needed: I18nFeatureName[] = ["formatting", "routing"];
 * console.log(needed.join(", ")); // "formatting, routing"
 * ```
 * @since 1.0.0
 */
export type I18nFeatureName = "formatting" | "routing" | "persistence" | "detection";

/**
 * An opt-in feature of an instance: an entry of the `features` option of {@link createI18n}. Each
 * feature is a plain object exported by its own subpath module, so an app that does not list it
 * does not bundle its code:
 *
 * | Feature | Import | Adds |
 * | --- | --- | --- |
 * | `formatting` | `@shadow-js/i18n/format` | `formatNumber`, `formatDate`, `formatRelative`, `formatList`, `formatDisplayName`, the `Formatted*` components |
 * | `localeRouting` | `@shadow-js/i18n/routing` | the `prefix` option, `localePath`, `routing`, the `"url"` detection source, and what reads `routing` (`createI18nMiddleware` with the `"url"` source or `redirect`, `syncLocaleWithRoute`, `i18nHeadTags`, `LocaleSwitcher`'s `href`) |
 * | `persistence` | `@shadow-js/i18n/persistence` | the `persist` option |
 * | `detection` | `@shadow-js/i18n/detect` | the `detect` option |
 *
 * Why a list of feature objects: the core holds one slot per feature name and calls each slot at
 * a fixed point (routing when the instance is created, persistence and detection once for the
 * instance `createI18n` returns in the browser, formatting once per instance and per fork), so
 * the order of the list does not matter and listing the same feature twice is harmless. The
 * instance keeps one shape whatever is listed, because components, the middleware and Dusk read
 * it structurally ({@link I18nBase}); a call that needs a missing feature throws a `TypeError`
 * that names the feature and its import (an option at creation, a method when it is called).
 * `createI18nFull` from `@shadow-js/i18n/full` lists every feature and passes the ICU compiler.
 *
 * `plug` is internal: what the feature hands the core. Create features only by importing them.
 *
 * @example
 * ```ts
 * import { createI18n, type I18nFeature } from "@shadow-js/i18n";
 * import { formatting } from "@shadow-js/i18n/format";
 * import { localeRouting } from "@shadow-js/i18n/routing";
 *
 * const features: I18nFeature[] = [formatting, localeRouting];
 * const i18n = createI18n({ defaultLocale: "en", locales: ["en", "fr"], prefix: "always", features });
 * console.log(i18n.formatNumber(1234.5), i18n.localePath("/about")); // "1,234.5" "/en/about"
 * ```
 * @since 1.0.0
 */
export interface I18nFeature<N extends I18nFeatureName = I18nFeatureName> {
  /** The feature's name; an instance holds at most one feature of each name. */
  readonly name: N;
  /** Internal: what the feature plugs into the instance. Not part of the public contract. */
  readonly plug: FeaturePlugs[N];
}

/**
 * What a catalog loader may resolve to: the catalog itself, or a module whose default export is the
 * catalog (what `import("./fr.json")` gives).
 *
 * @example
 * ```ts
 * import type { CatalogModule } from "@shadow-js/i18n";
 *
 * export const asCatalog: CatalogModule = { title: "Bienvenue" };
 * export const asModule: CatalogModule = { default: { title: "Bienvenue" } };
 * ```
 * @since 1.0.0
 */
export type CatalogModule = Messages | { readonly default: Messages };

/**
 * Lazily provides a catalog, for example `() => import("./fr.json")`; an entry of the `loaders`
 * option. It runs the first time the locale (or a locale whose fallback chain includes it) is
 * needed, at most once at a time. A loader that throws or rejects is reported as `LOAD_FAILED`.
 *
 * @example
 * ```ts
 * import { type CatalogLoader, createI18n } from "@shadow-js/i18n";
 *
 * const fr: CatalogLoader = async () => {
 *   const response = await fetch("/locales/fr.json");
 *   return (await response.json()) as { readonly [key: string]: string };
 * };
 *
 * export const i18n = createI18n({
 *   defaultLocale: "en",
 *   locales: ["en", "fr"],
 *   messages: { en: { title: "Welcome" } },
 *   loaders: { fr },
 * });
 * ```
 * @since 1.0.0
 */
export type CatalogLoader = () => CatalogModule | Promise<CatalogModule>;

/**
 * What the `onMissing` option of {@link createI18n} receives when no locale of the fallback chain
 * has a key.
 *
 * @example
 * ```ts
 * import { createI18n, type MissingInfo } from "@shadow-js/i18n";
 *
 * const onMissing = (info: MissingInfo<"en" | "fr">): string =>
 *   `[${info.key} missing in ${info.chain.join(", ")}]`;
 *
 * export const i18n = createI18n({ defaultLocale: "en", locales: ["en", "fr"], onMissing });
 * ```
 * @since 1.0.0
 */
export interface MissingInfo<L extends string> {
  /** The full dotted key that was requested (with the namespace of `scoped`, when there is one). */
  readonly key: string;
  /** The active locale. */
  readonly locale: L;
  /** The locales that were searched, in order (the active locale's fallback chain). */
  readonly chain: readonly L[];
}

/**
 * Fallback locales, searched after the active locale (and its parent languages: `pt-BR` falls back
 * to `pt` when `pt` is declared): one locale, a list, or a list per locale with `"default"` for the
 * locales that have no entry of their own. The default locale is always searched last. Locales
 * that are not declared are skipped, and no locale is searched twice.
 *
 * @example
 * ```ts
 * import { createI18n, type FallbackConfig } from "@shadow-js/i18n";
 *
 * type Locale = "en" | "fr" | "fr-CA" | "es";
 * const fallbackLocale: FallbackConfig<Locale> = { "fr-CA": ["fr"], default: "en" };
 *
 * const i18n = createI18n({
 *   defaultLocale: "en",
 *   locales: ["en", "fr", "fr-CA", "es"],
 *   fallbackLocale,
 * });
 * console.log(i18n.chain("fr-CA")); // ["fr-CA", "fr", "en"]
 * ```
 * @since 1.0.0
 */
export type FallbackConfig<L extends string> =
  | L
  | readonly L[]
  | { readonly [K in L | "default"]?: L | readonly L[] };

/**
 * One way of remembering the locale `setLocale` chose; an entry of the `persist` option.
 * `"cookie"` and `"localStorage"` use {@link cookieStrategy} and {@link storageStrategy} with their
 * defaults; the `{ type, ...options }` forms pass options to them; a {@link PersistStrategy} object
 * is used as it is. Strategies made from a spec report problems to the instance's `onError` unless
 * their options name a `report`. The `persist` option needs the `persistence` feature
 * (`@shadow-js/i18n/persistence`).
 *
 * @example
 * ```ts
 * import { createI18n, type PersistSpec } from "@shadow-js/i18n";
 * import { persistence } from "@shadow-js/i18n/persistence";
 *
 * const persist: PersistSpec[] = [
 *   { type: "cookie", name: "lang", maxAge: 60 * 60 * 24 * 30 },
 *   "localStorage",
 * ];
 *
 * export const i18n = createI18n({
 *   defaultLocale: "en",
 *   locales: ["en", "fr"],
 *   persist,
 *   features: [persistence],
 * });
 * ```
 * @since 1.0.0
 */
export type PersistSpec =
  | "cookie"
  | "localStorage"
  | ({ readonly type: "cookie" } & CookieStrategyOptions)
  | ({ readonly type: "localStorage" } & StorageStrategyOptions)
  | PersistStrategy;

/**
 * The part of `document` that receives `lang` and `dir`; pass one as `syncDocument` to update
 * another document (an iframe's, or a test double).
 *
 * @example
 * ```ts
 * import { createI18n, type DocumentLike } from "@shadow-js/i18n";
 *
 * const attributes = new Map<string, string>();
 * const target: DocumentLike = {
 *   documentElement: { setAttribute: (name, value) => void attributes.set(name, value) },
 * };
 *
 * createI18n({ defaultLocale: "en", locales: ["en"], syncDocument: target });
 * console.log(attributes.get("lang"), attributes.get("dir")); // "en" "ltr"
 * ```
 * @since 1.0.0
 */
export interface DocumentLike {
  /** The root element; `setAttribute("lang", ...)` and `setAttribute("dir", ...)` are called on it. */
  readonly documentElement: { setAttribute(name: string, value: string): void };
}

/**
 * Initial-locale detection settings; the object form of the `detect` option. Detection runs once,
 * when the instance is created in the browser, and only when neither `state` nor `locale` is given.
 * The `detect` option needs the `detection` feature (`@shadow-js/i18n/detect`); the `"url"` source
 * also needs `localeRouting` (`@shadow-js/i18n/routing`), which knows the URL scheme.
 *
 * @example
 * ```ts
 * import { createI18n, type DetectConfig } from "@shadow-js/i18n";
 * import { detection } from "@shadow-js/i18n/detect";
 * import { localeRouting } from "@shadow-js/i18n/routing";
 *
 * const detect: DetectConfig = { order: ["url", "cookie", "navigator"], cookieName: "lang" };
 *
 * export const i18n = createI18n({
 *   defaultLocale: "en",
 *   locales: ["en", "fr"],
 *   detect,
 *   features: [detection, localeRouting],
 * });
 * ```
 * @since 1.0.0
 */
export interface DetectConfig {
  /**
   * The sources to try, in order. Listing `"url"` without the `localeRouting` feature throws a
   * `TypeError` when the instance is created; the default order then leaves `"url"` out.
   * @default `["url", "cookie", "storage", "navigator"]` ({@link DEFAULT_DETECT_ORDER} without `"accept-language"`)
   */
  readonly order?: readonly DetectSource[];
  /**
   * The cookie the `"cookie"` source reads. Default: the name of the cookie `persist` strategy, or
   * `"locale"`.
   */
  readonly cookieName?: string;
  /**
   * Replaces reading the browser globals; pass what is known about the page. A function is called
   * once, when the instance is created. Default: `location.pathname`, `document.cookie`, the first
   * value a `persist` strategy reads (as `storage`) and `navigator.languages`.
   */
  readonly input?: DetectInput | (() => DetectInput);
}

/**
 * Options of `addMessages`.
 *
 * @example
 * ```ts
 * import { type AddMessagesOptions, createI18n } from "@shadow-js/i18n";
 *
 * const i18n = createI18n({
 *   defaultLocale: "en",
 *   locales: ["en", "fr"],
 *   messages: { en: { title: "Welcome" } },
 *   loaders: { fr: () => fetch("/locales/fr.json").then((response) => response.json()) },
 * });
 *
 * const complete: AddMessagesOptions = { partial: false };
 * i18n.addMessages("fr", { title: "Bienvenue" }, complete);
 * console.log(i18n.isLoaded("fr")); // true
 * ```
 * @since 1.0.0
 */
export interface AddMessagesOptions {
  /**
   * Whether the added messages are only part of the locale's catalog. For a locale with a loader
   * that has not run yet, a partial addition leaves the locale unloaded: the loader still runs, its
   * text is the base and the added messages win. Pass `false` to say the messages are the complete
   * catalog, so the loader is not needed.
   * @default `true`
   */
  readonly partial?: boolean;
}

/**
 * Options of `state()`.
 *
 * @example
 * ```ts
 * import { createI18n, type StateOptions } from "@shadow-js/i18n";
 *
 * const i18n = createI18n({
 *   defaultLocale: "en",
 *   locales: ["en", "fr"],
 *   messages: { en: { title: "Welcome" }, fr: { title: "Bienvenue" } },
 *   locale: "fr",
 * });
 *
 * const options: StateOptions = { include: "active" };
 * console.log(Object.keys(i18n.state(options).messages)); // ["fr"]
 * ```
 * @since 1.0.0
 */
export interface StateOptions {
  /**
   * `"chain"` includes the loaded catalogs of the active locale's whole fallback chain; `"active"`
   * only the active locale's.
   * @default `"chain"`
   */
  readonly include?: "chain" | "active";
}

/**
 * Serializable snapshot of an instance, for hydration: what `i18n.state()` returns and what
 * `createI18n({ state })` and `i18n.hydrate()` accept. Embed it with {@link renderI18nStateScript}
 * or {@link i18nHeadTags} and read it back with {@link readI18nState}.
 *
 * @example
 * ```ts
 * import { createI18n, type I18nState } from "@shadow-js/i18n";
 *
 * const state: I18nState<"en" | "fr"> = {
 *   v: 1,
 *   locale: "fr",
 *   messages: { fr: { title: "Bienvenue" } },
 * };
 *
 * const i18n = createI18n({ defaultLocale: "en", locales: ["en", "fr"], state });
 * console.log(i18n.locale(), i18n.translate("title")); // "fr" "Bienvenue"
 * ```
 * @since 1.0.0
 */
export interface I18nState<L extends string = string> {
  /** Format version; always `1`. Any other value is rejected with `INVALID_STATE`. */
  readonly v: 1;
  /** The active locale when the snapshot was taken. */
  readonly locale: L;
  /** Flat (dotted key) catalogs by locale. */
  readonly messages: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/**
 * Options of {@link createI18n} (and, with the ICU settings, of {@link createI18nWithIcu}). The
 * `prefix`, `persist` and `detect` options need the matching entry of `features` (see
 * {@link I18nFeature}); without it, `createI18n` throws a `TypeError` that names the feature.
 *
 * @example
 * ```ts
 * import { createI18n, type I18nOptions } from "@shadow-js/i18n";
 * import { persistence } from "@shadow-js/i18n/persistence";
 *
 * const en = { title: "Welcome" } as const;
 *
 * const options: I18nOptions<"en" | "fr", "en", { en: typeof en }, Record<never, never>> = {
 *   defaultLocale: "en",
 *   locales: ["en", "fr"],
 *   messages: { en },
 *   fallbackLocale: "en",
 *   timeZone: "UTC",
 *   persist: "cookie",
 *   features: [persistence],
 * };
 *
 * export const i18n = createI18n(options);
 * ```
 * @since 1.0.0
 */
export interface I18nOptions<
  L extends string,
  D extends L,
  Mg extends Partial<Record<L, Messages>>,
  Ld extends Partial<Record<L, CatalogLoader>>,
> {
  /**
   * The locale whose catalog types the keys, and the last fallback. It must be one of `locales`:
   * otherwise `createI18n` throws `UNKNOWN_LOCALE`.
   */
  readonly defaultLocale: D;
  /** Every supported locale, as BCP 47 tags. Requests for other tags are matched to these. */
  readonly locales: readonly L[];
  /**
   * Catalogs bundled with the app, by locale. They are checked when the instance is created (a
   * malformed one throws `INVALID_CATALOG`) and count as loaded.
   */
  readonly messages?: Mg;
  /**
   * Catalogs loaded on demand, by locale. A locale with neither a catalog nor a loader starts empty,
   * and its keys come from the fallback chain.
   */
  readonly loaders?: Ld;
  /** Where to look when a key is missing. The default locale is always the last resort. */
  readonly fallbackLocale?: FallbackConfig<L>;
  /**
   * Text to show for a key that no locale of the chain has. Called outside reactive tracking.
   * Default: the key itself.
   */
  readonly onMissing?: (info: MissingInfo<L>) => string;
  /**
   * Receives recoverable problems as {@link I18nError}s: missing keys, values and tag handlers,
   * syntax errors, failed loads, format failures. Problems that repeat on every render are passed
   * once per distinct message. Called outside reactive tracking. Default: `console.warn` of the
   * message in development, nothing in production.
   */
  readonly onError?: (error: I18nError) => void;
  /** Named number, date, time and list formats, for messages and the `format*` methods. */
  readonly formats?: Formats;
  /**
   * IANA time zone for dates that do not set their own (`"Europe/Paris"`). Default: the runtime's
   * zone. Pass it on the server so the output does not depend on the machine.
   */
  readonly timeZone?: string;
  /**
   * Clock for relative time, in epoch milliseconds.
   * @default `Date.now`
   */
  readonly now?: () => number;
  /**
   * Initial locale; matched to `locales` like any requested tag (`UNKNOWN_LOCALE` when nothing
   * matches). Ignored when `state` is given. Default: detected (when `detect` is set and the code runs
   * in the browser), otherwise `defaultLocale`.
   */
  readonly locale?: L;
  /**
   * Detect the initial locale in the browser: `true` for the default settings, or a
   * {@link DetectConfig}. Not used on the server, nor when `state` or `locale` is given. Any value
   * but `false` needs the `detection` feature (`@shadow-js/i18n/detect`); without it
   * `createI18n` throws a `TypeError`, on the server too.
   * @default `false`
   */
  readonly detect?: boolean | DetectConfig;
  /**
   * Remember `setLocale` choices: one {@link PersistSpec} or several (each is written). Only the
   * instance `createI18n` returns persists, only in the browser; forks never do. Any value but
   * `false` needs the `persistence` feature (`@shadow-js/i18n/persistence`); without it `createI18n`
   * throws a `TypeError`, on the server too. A strategy that throws is reported through `onError`
   * as `INVALID_STATE` and never stops `setLocale` or the other strategies.
   * @default `false`
   */
  readonly persist?: false | PersistSpec | readonly PersistSpec[];
  /**
   * What the page shows while `setLocale` loads a catalog. `"keep"`: the old locale stays on
   * screen until the new catalog has loaded. `"suspend"`: switch at once; text that needs the new
   * catalog suspends the nearest `<Suspense>`.
   * @default `"keep"`
   */
  readonly transition?: "keep" | "suspend";
  /**
   * Update `<html lang dir>` when the locale changes: `true` uses `document` in the browser,
   * `false` turns it off, a {@link DocumentLike} is updated instead. Only the instance
   * `createI18n` returns does it; forks never do. Default: `true` in the browser.
   */
  readonly syncDocument?: boolean | DocumentLike;
  /**
   * URL strategy of `localePath` and `routing`. Needs the `localeRouting` feature
   * (`@shadow-js/i18n/routing`); without it `createI18n` throws a `TypeError`.
   * @default `"as-needed"`
   */
  readonly prefix?: LocalePrefix;
  /**
   * The opt-in features of the instance (see {@link I18nFeature}): `formatting`, `localeRouting`,
   * `persistence` and `detection`, each from its own subpath, in any order. The same feature
   * listed twice counts once. A value that is not an array, an entry that is not a feature, or
   * two different features of one name throw a `TypeError`.
   * @default `[]`
   */
  readonly features?: readonly I18nFeature[];
  /**
   * Compiled messages kept, shared by the instance and its forks; the least recently used is
   * dropped first. Rounded down, and at least 1. A value that is not finite (`NaN`, `Infinity`,
   * `-Infinity`) throws an `I18nError` with code `INVALID_VALUE` at creation, because it would leave
   * the cache unbounded.
   * @default `500`
   */
  readonly cacheSize?: number;
  /**
   * Compiles catalog text that uses message syntax (placeholders, plurals, tags). Without it, only
   * plain text works, and a text with syntax reports a `NO_COMPILER` error. `createI18nWithIcu`
   * (from `@shadow-js/i18n`) passes the ICU compiler, and `@shadow-js/i18n/icu` has it on its own.
   */
  readonly compile?: MessageCompiler;
  /**
   * Snapshot from the server (see `readI18nState`); sets the locale and catalogs synchronously, so
   * the first render matches the server's HTML. Takes precedence over `locale` and `detect`.
   * Throws `INVALID_STATE` when it is not a version 1 snapshot.
   */
  readonly state?: I18nState<L>;
}

/**
 * Options of `formatRelative` (and the props of {@link FormattedRelative}), which needs the
 * `formatting` feature.
 *
 * @example
 * ```ts
 * import { createI18n, type RelativeOptions } from "@shadow-js/i18n";
 * import { formatting } from "@shadow-js/i18n/format";
 *
 * const i18n = createI18n({ defaultLocale: "en", locales: ["en"], features: [formatting] });
 * const options: RelativeOptions = { unit: "day", numeric: "always", now: Date.UTC(2024, 0, 3) };
 * console.log(i18n.formatRelative(Date.UTC(2024, 0, 1), options)); // "2 days ago"
 * ```
 * @since 1.0.0
 */
export interface RelativeOptions {
  /**
   * Force a unit (`"day"` and `"days"` both work). Default: the largest unit that fits, from
   * seconds (under a minute) up to years (a year being 365.25 days). The amount is rounded.
   */
  readonly unit?: Intl.RelativeTimeFormatUnit;
  /**
   * `"auto"` says "yesterday"; `"always"` says "1 day ago".
   * @default `"auto"`
   */
  readonly numeric?: "always" | "auto";
  /**
   * Length of the unit names: `"long"` ("3 months ago"), `"short"` ("3 mo. ago") or `"narrow"`.
   * @default `"long"`
   */
  readonly style?: "long" | "short" | "narrow";
  /** The reference time, as a `Date` or epoch milliseconds. Default: the `now` option's clock. */
  readonly now?: Date | number;
}

/**
 * Options of `formatDisplayName` (a method of the `formatting` feature), passed to
 * `Intl.DisplayNames`.
 *
 * @example
 * ```ts
 * import { createI18n, type DisplayNameOptions } from "@shadow-js/i18n";
 * import { formatting } from "@shadow-js/i18n/format";
 *
 * const i18n = createI18n({ defaultLocale: "en", locales: ["en"], features: [formatting] });
 * const region: DisplayNameOptions = { type: "region" };
 * console.log(i18n.formatDisplayName("JP", region)); // "Japan"
 * ```
 * @since 1.0.0
 */
export interface DisplayNameOptions {
  /** What `code` names: a language tag, a region, a script, a currency, a calendar or a date field. */
  readonly type: "language" | "region" | "script" | "currency" | "calendar" | "dateTimeField";
  /** Length of the name. Default: `Intl`'s, `"long"`. */
  readonly style?: "long" | "short" | "narrow";
  /**
   * For `type: "language"`: `"dialect"` names `en-GB` "British English", `"standard"` names it
   * "English (United Kingdom)". Default: `Intl`'s, `"dialect"`.
   */
  readonly languageDisplay?: "dialect" | "standard";
}

/**
 * The parts of an instance that do not depend on the catalog type; components, context and helpers
 * that work with any instance take it. Reads of `locale()`, `t`, `translate`, the `format*` methods
 * and `dir()` are reactive: inside JSX or an effect they rerun when the locale or a catalog of the
 * fallback chain changes.
 *
 * The shape is the same whatever features the instance has. The `format*` methods need the
 * `formatting` feature, and `localePath` and `routing` need `localeRouting` (see
 * {@link I18nFeature}): without it, calling the method (or reading `routing`) throws a `TypeError`
 * that names the feature. A missing `routing` is not enumerable, so spreading or inspecting an
 * instance never throws.
 *
 * @example
 * ```ts
 * import { createI18n, type I18nBase } from "@shadow-js/i18n";
 * import { formatting } from "@shadow-js/i18n/format";
 *
 * export function priceLabel(i18n: I18nBase, amount: number): string {
 *   return `${i18n.translate("price")}: ${i18n.formatNumber(amount, { style: "currency", currency: "EUR" })}`;
 * }
 *
 * const i18n = createI18n({
 *   defaultLocale: "en",
 *   locales: ["en"],
 *   messages: { en: { price: "Price" } },
 *   features: [formatting],
 * });
 * console.log(priceLabel(i18n, 5)); // "Price: €5.00"
 * ```
 * @since 1.0.0
 */
export interface I18nBase<L extends string = string> {
  /** The `defaultLocale` option. */
  readonly defaultLocale: L;
  /** The `locales` option. */
  readonly locales: readonly L[];
  /** Reactive: the active locale. */
  readonly locale: Accessor<L>;
  /**
   * Reactive: the locale `setLocale` is loading, or `undefined`. Use it to show a loading state
   * while the old locale stays on screen (`transition: "keep"`).
   */
  readonly pending: Accessor<L | undefined>;
  /**
   * Switches locale. Loads the catalog first (unless loaded), applies `<html lang dir>`, persists the
   * choice. The last call wins; the promise resolves with the locale that ends up active. A failed
   * load is reported as `LOAD_FAILED` and the promise resolves with the locale that stays active;
   * it does not reject. After `dispose()` nothing changes.
   * @throws I18nError `UNKNOWN_LOCALE`, synchronously, for a locale that matches none of `locales`.
   */
  setLocale(locale: L): Promise<L>;
  /**
   * Untyped translate, for dynamic keys: the same lookup, fallback and missing-key handling as `t`.
   * Prefer `t`.
   */
  translate(key: string, values?: object): string;
  /** Untyped rich translate, for dynamic keys: the same as `t.rich`. `values` also holds the tag handlers. */
  translateRich(key: string, values?: object): RichChunk[];
  /**
   * Formats a number in the active locale. `format` is a name from `formats.number`, `"percent"`,
   * `"integer"`, or `Intl.NumberFormat` options. An unknown name is reported as `FORMAT_FAILED` and
   * the default format is used; a value that is not a number is reported as `INVALID_VALUE` and
   * returned as text.
   * @throws TypeError without the `formatting` feature.
   */
  formatNumber(value: number | bigint, format?: string | Intl.NumberFormatOptions): string;
  /**
   * Formats a date (a `Date`, epoch milliseconds or an ISO string) in the active locale and the
   * `timeZone` option. `format` is a name from `formats.date`, `"short"`, `"medium"`, `"long"`,
   * `"full"` (a `dateStyle`), or `Intl.DateTimeFormat` options; default `{ dateStyle: "medium" }`.
   * An invalid date is reported as `INVALID_VALUE` and returned as text.
   * @throws TypeError without the `formatting` feature.
   */
  formatDate(value: Date | number | string, format?: string | Intl.DateTimeFormatOptions): string;
  /**
   * Formats a time relative to now ("in 3 days", "yesterday"). Non-finite times are reported as
   * `INVALID_VALUE` and returned as text.
   * @throws TypeError without the `formatting` feature.
   */
  formatRelative(value: Date | number, options?: RelativeOptions): string;
  /**
   * Formats a list ("a, b, and c"). `format` is a name from `formats.list` or `Intl.ListFormat`
   * options; an unknown name is reported as `FORMAT_FAILED`.
   * @throws TypeError without the `formatting` feature.
   */
  formatList(values: Iterable<string>, format?: string | Intl.ListFormatOptions): string;
  /**
   * The name of a language, region, script, currency or calendar code in the active locale; `code`
   * when `Intl` has none.
   * @throws TypeError without the `formatting` feature.
   */
  formatDisplayName(code: string, options: DisplayNameOptions): string;
  /** Text direction of `locale`, or (reactively) of the active locale when it is omitted. */
  dir(locale?: L): Direction;
  /** Resolves when the initial locale (and its fallbacks) is loaded. Never rejects: failures are reported. */
  readonly ready: Promise<void>;
  /**
   * Loads one locale's catalog without switching to it (to prefetch). Rejects with `LOAD_FAILED`
   * (or `INVALID_CATALOG` for a malformed catalog).
   * @throws I18nError `UNKNOWN_LOCALE`, synchronously, for a locale that matches none of `locales`.
   */
  load(locale: L): Promise<void>;
  /**
   * True when the locale's catalog is complete. A locale whose loader has not run is not loaded,
   * even after `addMessages` put some text there (see {@link AddMessagesOptions}).
   */
  isLoaded(locale: L): boolean;
  /**
   * Merges messages into a locale's catalog (hot reload, tests, runtime additions). Added text
   * wins over loaded text. Before a lazy locale's first load the addition is partial: the locale
   * stays unloaded and its loader still runs; pass `{ partial: false }` when the messages are the
   * whole catalog.
   * @throws I18nError `UNKNOWN_LOCALE` for an undeclared locale, `INVALID_CATALOG` for a malformed catalog.
   */
  addMessages(locale: L, messages: Messages, options?: AddMessagesOptions): void;
  /**
   * Replaces a locale's whole catalog with `messages` (hot reload of an edited catalog). Keys that
   * `messages` no longer has are removed. Readers of the locale rerun in place; components keep their
   * state. The messages are the complete catalog: a lazy locale's loader is not run afterward, and a load already in
   * flight is discarded when it settles, so a key the new catalog dropped does not come back from it.
   * Does nothing after `dispose()`.
   *
   * @param locale A declared locale.
   * @param messages The new nested catalog. It is checked before anything changes.
   * @throws I18nError `UNKNOWN_LOCALE` for an undeclared locale, `INVALID_CATALOG` for a malformed catalog.
   * @since 1.0.0
   */
  replaceCatalog(locale: L, messages: Messages): void;
  /**
   * Prefixes an app path with a locale (default: the active one, reactively) according to the
   * `prefix` option: `localePath("/about", "fr")` is `"/fr/about"`.
   * @throws TypeError without the `localeRouting` feature.
   */
  localePath(path: string, locale?: L): string;
  /**
   * The URL helpers of the instance's locales and `prefix` (see {@link createLocaleRouting}),
   * shared by the instance and its forks. Reading it without the `localeRouting` feature throws a
   * `TypeError`.
   */
  readonly routing: LocaleRouting<L>;
  /** The fallback chain of a locale (default: the active one): the locale first, the default locale last. */
  chain(locale?: L): readonly L[];
  /** Snapshot of the active locale and its loaded catalogs (the whole fallback chain by default). */
  state(options?: StateOptions): I18nState<L>;
  /**
   * Applies a snapshot (hydration): sets the locale and catalogs synchronously.
   * @throws I18nError `INVALID_STATE` for a snapshot that is not version 1, `UNKNOWN_LOCALE` or
   *   `INVALID_CATALOG` for its content.
   */
  hydrate(state: I18nState<L>): void;
  /**
   * Stops pending `setLocale` calls. On the instance `createI18n` returned it also clears the
   * caches shared with its forks, stops loaded catalogs from being applied and releases waiting
   * `<Suspense>` boundaries. Safe to call twice.
   */
  dispose(): void;
}

/**
 * An i18n instance typed from the catalog `M` (the default locale's catalog): what
 * {@link createI18n} returns.
 *
 * @example
 * ```ts
 * import { createI18nWithIcu, type I18n } from "@shadow-js/i18n";
 *
 * const en = {
 *   cart: { items: "{count, plural, one {# item} other {# items}}", empty: "Your cart is empty" },
 * } as const;
 *
 * const i18n: I18n<"en" | "fr", typeof en> = createI18nWithIcu({
 *   defaultLocale: "en",
 *   locales: ["en", "fr"],
 *   messages: { en },
 * });
 *
 * console.log(i18n.t("cart.items", { count: 3 })); // "3 items"
 * console.log(i18n.scoped("cart")("empty")); // "Your cart is empty"
 * const french = i18n.fork("fr");
 * console.log(french.locale(), i18n.locale()); // "fr" "en"
 * ```
 * @since 1.0.0
 */
export interface I18n<L extends string = string, M = Messages> extends I18nBase<L> {
  /** Typed translate; reads the locale, so it is reactive in JSX. */
  readonly t: Translator<M>;
  /**
   * A translator for one namespace, whose keys are relative to it:
   * `i18n.scoped("cart")("items", { count })` reads `cart.items`.
   */
  scoped<N extends NamespaceKey<M>>(namespace: N): Translator<MessageAt<M, N>>;
  /**
   * An independent instance with its own locale (default: the current one), sharing catalogs and
   * caches. Use one per request on the server so concurrent requests never share a locale. A fork
   * does not detect, persist or update `<html lang dir>`.
   * @throws I18nError `UNKNOWN_LOCALE` for a locale that matches none of `locales`.
   */
  fork(locale?: L): I18n<L, M>;
}

type LoadedMessages<F> = F extends () => infer R
  ? Awaited<R> extends { readonly default: infer Inner }
    ? Inner
    : Awaited<R>
  : never;

/**
 * The catalog type that types `t`: the default locale's static catalog when `messages` has it,
 * otherwise what its loader resolves to (the `default` export of a module), otherwise `Messages`.
 *
 * @example
 * ```ts
 * import type { BaseCatalog } from "@shadow-js/i18n";
 *
 * const en = { title: "Welcome" } as const;
 * export type Catalog = BaseCatalog<{ en: typeof en }, Record<never, never>, "en">; // typeof en
 * export const catalog: Catalog = en;
 * ```
 * @since 1.0.0
 */
export type BaseCatalog<Mg, Ld, D extends string> = D extends keyof Mg
  ? NonNullable<Mg[D]>
  : D extends keyof Ld
    ? LoadedMessages<NonNullable<Ld[D]>>
    : Messages;
