/**
 * A bounded cache of `Intl` formatter objects. Building one is far more expensive than using it, so
 * every instance (and every `fork`) shares one cache; the bound keeps a long-lived server from
 * growing with every distinct option bag.
 * @packageDocumentation
 */
import { I18nError } from "./errors";

/**
 * Default capacity of {@link createIntlCache}: 256 formatters.
 * @internal
 */
export const INTL_CACHE_SIZE = 256;

/**
 * Sorted key of an option bag: equal options give equal keys. Every enumerable property counts,
 * inherited ones too (the `Intl` constructors read them), and `undefined` values do not. Values
 * are keyed by type and text, so `1` and `"1"` differ and nothing here can throw on a value
 * `Intl` itself would accept.
 */
function optionsKey(options: object | undefined): string {
  if (options === undefined) return "";
  const entries: Array<[string, string]> = [];
  for (const name in options) {
    const value: unknown = Reflect.get(options, name);
    if (value !== undefined) entries.push([name, `${typeof value}:${String(value)}`]);
  }
  if (entries.length === 0) return "";
  entries.sort(([a], [b]) => (a < b ? -1 : +(a > b)));
  return JSON.stringify(entries);
}

/**
 * Which `Intl` features this runtime has, as read by {@link intlSupport}. Each field is `true` when
 * the global exists and is callable.
 *
 * @example
 * ```ts
 * import { type IntlSupport, intlSupport } from "@shadow-js/i18n";
 *
 * const support: IntlSupport = intlSupport();
 * if (!support.listFormat) console.warn("lists will be joined with commas");
 * ```
 * @since 1.0.0
 */
export interface IntlSupport {
  /** `Intl.NumberFormat`: numbers, currencies, units, percent. */
  readonly numberFormat: boolean;
  /** `Intl.DateTimeFormat`: dates and times. */
  readonly dateTimeFormat: boolean;
  /** `Intl.PluralRules`: the plural and ordinal categories of ICU messages. */
  readonly pluralRules: boolean;
  /** `Intl.ListFormat`: `formatList`. Without it lists are joined with commas. */
  readonly listFormat: boolean;
  /** `Intl.RelativeTimeFormat`: `formatRelative`. Without it the text is plain English. */
  readonly relativeTimeFormat: boolean;
  /** `Intl.DisplayNames`: `formatDisplayName`. Without it the code is shown. */
  readonly displayNames: boolean;
  /** `Intl.Locale`: text direction by script, `maximize`. */
  readonly locale: boolean;
  /** `Intl.supportedValuesOf`: lists of time zones, calendars, currencies, numbering systems and units. */
  readonly supportedValuesOf: boolean;
}

/**
 * Reports which `Intl` features the runtime has. Nothing is cached, so it reflects the globals at
 * the time of the call (a polyfill loaded later is seen). The formatters of an instance use it to
 * fall back to readable output, and to report that once, instead of throwing.
 *
 * @returns One flag per feature.
 * @example
 * ```ts
 * import { intlSupport } from "@shadow-js/i18n";
 *
 * const { displayNames, relativeTimeFormat } = intlSupport();
 * console.log(displayNames, relativeTimeFormat); // true true
 * ```
 * @since 1.0.0
 */
export function intlSupport(): IntlSupport {
  const has = (name: string): boolean => typeof Reflect.get(Intl, name) === "function";
  return {
    numberFormat: has("NumberFormat"),
    dateTimeFormat: has("DateTimeFormat"),
    pluralRules: has("PluralRules"),
    listFormat: has("ListFormat"),
    relativeTimeFormat: has("RelativeTimeFormat"),
    displayNames: has("DisplayNames"),
    locale: has("Locale"),
    supportedValuesOf: has("supportedValuesOf"),
  };
}

/**
 * Formatter factories backed by a bounded least-recently-used cache. A call with the same locale
 * and equal options (compared by their own properties, ignoring `undefined` values and key order)
 * returns the same object. Every factory throws what its `Intl` constructor throws (a `RangeError`
 * for an invalid locale or option); nothing is cached then.
 *
 * @example
 * ```ts
 * import { createIntlCache, type IntlCache } from "@shadow-js/i18n";
 *
 * const cache: IntlCache = createIntlCache();
 * const price = (value: number): string =>
 *   cache.number("de-DE", { style: "currency", currency: "EUR" }).format(value);
 * console.log(price(5), price(12));
 * ```
 * @since 1.0.0
 */
export interface IntlCache {
  /** A cached `Intl.NumberFormat` for the locale and options. */
  number(locale: string, options?: Intl.NumberFormatOptions): Intl.NumberFormat;
  /** A cached `Intl.DateTimeFormat` for the locale and options. */
  date(locale: string, options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat;
  /** A cached `Intl.PluralRules` of the given type (`"ordinal"` for `selectordinal`). */
  plural(locale: string, type: "cardinal" | "ordinal"): Intl.PluralRules;
  /** A cached `Intl.ListFormat` for the locale and options. */
  list(locale: string, options?: Intl.ListFormatOptions): Intl.ListFormat;
  /** A cached `Intl.RelativeTimeFormat` for the locale and options. */
  relative(locale: string, options?: Intl.RelativeTimeFormatOptions): Intl.RelativeTimeFormat;
  /** A cached `Intl.DisplayNames` for the locale and options (`type` is required by `Intl`). */
  displayNames(locale: string, options: Intl.DisplayNamesOptions): Intl.DisplayNames;
  /** A cached `Intl.Locale` of the tag. */
  locale(tag: string): Intl.Locale;
  /** Number of cached objects, of every kind together; never more than the capacity. */
  readonly size: number;
  /** Drops every cached object. */
  clear(): void;
}

/**
 * Creates an {@link IntlCache}. Every i18n instance makes its own (shared with its forks); make one
 * yourself to format outside an instance without rebuilding `Intl` objects on each call.
 *
 * @param capacity Most objects kept, across all kinds; the least recently used is dropped first.
 *   A whole number from 0 (nothing is kept) up. Default 256.
 * @returns The cache.
 * @throws I18nError `INVALID_VALUE` when `capacity` is not a finite whole number of at least 0.
 * @example
 * ```ts
 * import { createIntlCache } from "@shadow-js/i18n";
 *
 * const cache = createIntlCache(64);
 * const total = cache.number("de", { style: "currency", currency: "EUR" }).format(5);
 * const when = cache.date("de", { dateStyle: "long", timeZone: "UTC" }).format(new Date(0));
 * console.log(total, when, cache.size); // 2
 * ```
 * @since 1.0.0
 */
export function createIntlCache(capacity: number = INTL_CACHE_SIZE): IntlCache {
  if (!Number.isSafeInteger(capacity) || capacity < 0) {
    throw new I18nError(
      "INVALID_VALUE",
      __DEV__
        ? `createIntlCache: the capacity must be a whole number of at least 0, got ${String(capacity)}.`
        : "I18N_CACHE",
    );
  }
  const store = new Map<string, unknown>();
  function get<T>(key: string, make: () => T): T {
    if (store.has(key)) {
      const hit = store.get(key) as T;
      // Re-insert so Map order is recency order.
      store.delete(key);
      store.set(key, hit);
      return hit;
    }
    const made = make();
    store.set(key, made);
    if (store.size > capacity) {
      const oldest = store.keys().next();
      if (oldest.done !== true) store.delete(oldest.value);
    }
    return made;
  }
  return {
    number: (locale, options) =>
      get(`n|${locale}|${optionsKey(options)}`, () => new Intl.NumberFormat(locale, options)),
    date: (locale, options) =>
      get(`d|${locale}|${optionsKey(options)}`, () => new Intl.DateTimeFormat(locale, options)),
    plural: (locale, type) =>
      get(`p|${locale}|${type}`, () => new Intl.PluralRules(locale, { type })),
    list: (locale, options) =>
      get(`l|${locale}|${optionsKey(options)}`, () => new Intl.ListFormat(locale, options)),
    relative: (locale, options) =>
      get(`r|${locale}|${optionsKey(options)}`, () => new Intl.RelativeTimeFormat(locale, options)),
    displayNames: (locale, options) =>
      get(`i|${locale}|${optionsKey(options)}`, () => new Intl.DisplayNames(locale, options)),
    locale: (tag) => get(`o|${tag}`, () => new Intl.Locale(tag)),
    get size() {
      return store.size;
    },
    clear: () => store.clear(),
  };
}
