/**
 * Locale detection: `detectLocale` (pure, for the browser, the server middleware and tests) and the
 * `detection` feature (subpath `@shadow-js/i18n/detect`), which lets `createI18n` take the
 * `detect` option and reads the browser's `location`, `document.cookie` and `navigator` for it.
 * @packageDocumentation
 */
import { untrack } from "@shadow-js/core";
import type { DetectConfig, I18nFeature } from "./i18n-types";
import type { DetectionRequest, ResolvedPersistence } from "./internal/features";
import { matchLocale, negotiateLocale, parseAcceptLanguage } from "./locale";
import type { LocaleRouting } from "./routing";

/**
 * Where a locale can be read from, as an entry of a detection order:
 *
 * - `"url"`: the locale segment of the path (`/fr/about`), read with `routing.parse`.
 * - `"cookie"`: the locale cookie of a `Cookie` header or `document.cookie`.
 * - `"storage"`: a value remembered in `localStorage` (or by another persist strategy).
 * - `"accept-language"`: the request's `Accept-Language` header.
 * - `"navigator"`: the browser's `navigator.languages`.
 *
 * @example
 * ```ts
 * import { type DetectSource, detectLocale } from "@shadow-js/i18n";
 *
 * const order: DetectSource[] = ["cookie", "accept-language"];
 * const found = detectLocale(
 *   { cookie: "locale=fr", acceptLanguage: "en-US,en;q=0.9" },
 *   { locales: ["en", "fr"], order },
 * );
 * console.log(found?.source); // "cookie"
 * ```
 * @since 1.0.0
 */
export type DetectSource = "url" | "cookie" | "storage" | "accept-language" | "navigator";

/**
 * The request or page facts {@link detectLocale} reads. Every field is optional: a source whose
 * field is missing finds nothing and detection moves on to the next source.
 * @since 1.0.0
 */
export interface DetectInput {
  /** `location.pathname` or the request path, read by the `"url"` source. */
  readonly pathname?: string | undefined;
  /**
   * A `Cookie` header or `document.cookie`, read by the `"cookie"` source. A header longer than
   * 8192 characters is ignored, and only its first 64 cookies are looked at.
   */
  readonly cookie?: string | undefined;
  /** The value remembered in `localStorage` (or by a persist strategy), read by the `"storage"` source. */
  readonly storage?: string | undefined;
  /**
   * The `Accept-Language` header, read by the `"accept-language"` source. Bounded by
   * {@link ACCEPT_LANGUAGE_LIMITS}.
   */
  readonly acceptLanguage?: string | null | undefined;
  /**
   * `navigator.languages`, best first, read by the `"navigator"` source. Only the first 32 entries
   * are tried.
   */
  readonly navigatorLanguages?: readonly string[] | undefined;
}

/**
 * Options of {@link detectLocale}.
 * @since 1.0.0
 */
export interface DetectOptions<L extends string> {
  /**
   * The supported locales. A source's value counts only when it matches one of them (see
   * {@link matchLocale}); the matching supported locale is returned.
   */
  readonly locales: readonly L[];
  /**
   * Which sources to try, in order; the first that names a supported locale wins.
   * @default `["url", "cookie", "storage", "accept-language", "navigator"]` ({@link DEFAULT_DETECT_ORDER})
   */
  readonly order?: readonly DetectSource[];
  /**
   * Name of the locale cookie the `"cookie"` source reads.
   * @default `"locale"`
   */
  readonly cookieName?: string;
  /**
   * The URL scheme the `"url"` source parses (an `i18n.routing` or {@link createLocaleRouting}
   * result). Without it the `"url"` source finds nothing.
   */
  readonly routing?: Pick<LocaleRouting<L>, "parse" | "defaultLocale">;
  /**
   * Treat a path whose first segment is not a supported locale as the default locale (the
   * `"as-needed"` URL scheme), so the URL alone decides and later sources are not read. When
   * `false`, such a path falls through to the next source. Needs `routing`.
   * @default `false`
   */
  readonly unprefixedIsDefault?: boolean;
}

/**
 * The order {@link detectLocale} uses when `order` is not given: `url`, `cookie`, `storage`,
 * `accept-language`, `navigator`. A client instance created with `detect: true` uses it without
 * `"accept-language"` (the browser has no request header). The array is frozen.
 *
 * @example
 * ```ts
 * import { DEFAULT_DETECT_ORDER, detectLocale } from "@shadow-js/i18n";
 *
 * // Ignore the browser language settings, keep the rest of the default order.
 * const order = DEFAULT_DETECT_ORDER.filter((source) => source !== "navigator");
 * const found = detectLocale({ storage: "fr" }, { locales: ["en", "fr"], order });
 * console.log(found); // { locale: "fr", source: "storage" }
 * ```
 * @since 1.0.0
 */
export const DEFAULT_DETECT_ORDER: readonly DetectSource[] = Object.freeze([
  "url",
  "cookie",
  "storage",
  "accept-language",
  "navigator",
]);

/**
 * Reads one cookie from a `Cookie` header (or `document.cookie`) and decodes it. The first cookie
 * with the name wins. The work is bounded: a header longer than 8192 characters gives `undefined`,
 * and only the first 64 entries are looked at.
 *
 * @param header The raw header, or `null`/`undefined` when the request has none.
 * @param name The cookie name, compared exactly.
 * @returns The decoded value, or `undefined` when the cookie is absent, the header is over the
 *   bound, or the value is not valid percent-encoding.
 * @example
 * ```ts
 * import { readCookie } from "@shadow-js/i18n";
 *
 * export function localeFromRequest(request: Request): string | undefined {
 *   return readCookie(request.headers.get("cookie"), "locale");
 * }
 *
 * readCookie("theme=dark; locale=fr", "locale"); // "fr"
 * ```
 * @since 1.0.0
 */
export function readCookie(header: string | undefined | null, name: string): string | undefined {
  if (typeof header !== "string" || header.length > 8192) return undefined;
  // The first 64 cookies only: `split` with a limit keeps the first 64 parts.
  for (const part of header.split(";", 64)) {
    const equals = part.indexOf("=");
    if (equals === -1 || part.slice(0, equals).trim() !== name) continue;
    const raw = part.slice(equals + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch (error) {
      if (error instanceof URIError) return undefined;
      throw error;
    }
  }
  return undefined;
}

/**
 * Chooses a locale from the sources in `order`, returning the first that names a supported
 * locale. Pure: it only reads `input`, so the same function serves the browser, the server
 * middleware and tests.
 *
 * @param input What is known about the request or page.
 * @param options Supported locales, the order of sources, the cookie name and the URL scheme.
 * @returns The supported locale and the source that gave it, or `undefined` when no source names
 *   a supported locale (the caller then uses its default locale).
 * @example
 * ```ts
 * import { detectLocale } from "@shadow-js/i18n";
 *
 * const found = detectLocale(
 *   { acceptLanguage: "fr-CA,fr;q=0.8" },
 *   { locales: ["en", "fr"] },
 * );
 * console.log(found); // { locale: "fr", source: "accept-language" }
 * ```
 * @see {@link DEFAULT_DETECT_ORDER}
 * @since 1.0.0
 */
export function detectLocale<L extends string>(
  input: DetectInput,
  options: DetectOptions<L>,
): { locale: L; source: DetectSource } | undefined {
  const order = options.order ?? DEFAULT_DETECT_ORDER;
  for (const source of order) {
    let locale: L | undefined;
    switch (source) {
      case "url":
        if (input.pathname !== undefined && options.routing !== undefined) {
          locale =
            options.routing.parse(input.pathname).locale ??
            (options.unprefixedIsDefault === true ? options.routing.defaultLocale : undefined);
        }
        break;
      case "cookie": {
        const value = readCookie(input.cookie, options.cookieName ?? "locale");
        if (value !== undefined) locale = matchLocale(value, options.locales);
        break;
      }
      case "storage":
        if (input.storage !== undefined) locale = matchLocale(input.storage, options.locales);
        break;
      case "accept-language":
        locale = negotiateLocale(parseAcceptLanguage(input.acceptLanguage), options.locales);
        break;
      case "navigator":
        if (input.navigatorLanguages !== undefined) {
          locale = negotiateLocale(input.navigatorLanguages, options.locales);
        }
        break;
    }
    if (locale !== undefined) return { locale, source };
  }
  return undefined;
}

/** What is known about the page in the browser: its path, cookies, remembered locale and languages. */
function browserInput(persistence: ResolvedPersistence | undefined): DetectInput {
  const doc = Reflect.get(globalThis, "document") as { cookie?: string } | undefined;
  const location = Reflect.get(globalThis, "location") as { pathname?: string } | undefined;
  const nav = Reflect.get(globalThis, "navigator") as
    | { languages?: readonly string[]; language?: string }
    | undefined;
  return {
    pathname: location?.pathname,
    cookie: doc?.cookie,
    storage: persistence?.read(),
    navigatorLanguages:
      nav?.languages ?? (nav?.language === undefined ? undefined : [nav.language]),
  };
}

/** The initial locale of an instance created with the `detect` option, in the browser. */
function detectInitial<L extends string>(request: DetectionRequest<L>): L | undefined {
  const { config, locales, routing, persistence } = request;
  const given = config.input;
  // A user callback: it must not subscribe whatever computation creates the instance.
  const input = typeof given === "function" ? untrack(given) : (given ?? browserInput(persistence));
  // The browser has no request header, and without the routing feature the URL has no scheme.
  const order =
    config.order ??
    DEFAULT_DETECT_ORDER.filter(
      (source) => source !== "accept-language" && (source !== "url" || routing !== undefined),
    );
  // Under as-needed the URL decides every page but the root: a path without a prefix is the default locale's, as the
  // server renders it (the root negotiates from the cookie and the languages). Without this the browser would start in
  // the cookie's locale and the hydrated page would flip to it and back.
  const found = detectLocale(input, {
    locales,
    order,
    cookieName: config.cookieName ?? persistence?.cookieName ?? "locale",
    ...(routing === undefined
      ? {}
      : {
          routing,
          unprefixedIsDefault: routing.prefix === "as-needed" && input.pathname !== "/",
        }),
  });
  return found?.locale;
}

/**
 * The `detection` feature: lets `createI18n` take the `detect` option, which chooses the initial
 * locale in the browser from the URL (with `localeRouting`), the locale cookie, the value a
 * `persist` strategy remembers (with `persistence`) and `navigator.languages`, in the order of
 * {@link DetectConfig}. Detection runs once, when the instance is created in the browser, and only
 * when neither `state` nor `locale` is given. Without this feature, a `detect` option other than
 * `false` throws a `TypeError` that names it. `detectLocale` itself needs no feature.
 *
 * @example
 * ```ts
 * import { createI18n } from "@shadow-js/i18n";
 * import { detection } from "@shadow-js/i18n/detect";
 *
 * const i18n = createI18n({
 *   defaultLocale: "en",
 *   locales: ["en", "fr"],
 *   detect: { order: ["cookie", "navigator"], input: { cookie: "locale=fr" } },
 *   features: [detection],
 * });
 *
 * console.log(i18n.locale()); // "fr" in the browser, "en" on the server (detection is browser-only)
 * ```
 * @see {@link detectLocale}
 * @since 1.0.0
 */
export const detection: I18nFeature<"detection"> = /* @__PURE__ */ Object.freeze({
  name: "detection",
  plug: detectInitial,
});

export type { DetectConfig };
