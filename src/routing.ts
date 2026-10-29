/**
 * Locale-prefixed URLs (`/fr/about`) and the `localeRouting` feature (subpath
 * `@shadow-js/i18n/routing`): the `prefix` option, `i18n.localePath` and `i18n.routing`, which the
 * middleware's `"url"` source, `syncLocaleWithRoute`, `i18nHeadTags` and detection's `"url"`
 * source read. `createLocaleRouting` works on its own, without an instance.
 * @packageDocumentation
 */
import { I18nError } from "./errors";
import type { I18nFeature } from "./i18n-types";
import { canonicalTag } from "./locale";

export type { RouteLocationSource } from "./route-locale";
export { syncLocaleWithRoute } from "./route-locale";

/**
 * How URLs carry the locale: `"always"` (`/en/about`), `"as-needed"` (the default locale has no
 * prefix: `/about`, `/fr/about`) or `"never"` (the locale comes from a cookie or header).
 *
 * @example
 * ```ts
 * import { createLocaleRouting, type LocalePrefix } from "@shadow-js/i18n";
 *
 * const prefix: LocalePrefix = "always";
 * const routing = createLocaleRouting({ locales: ["en", "fr"], defaultLocale: "en", prefix });
 * console.log(routing.localePath("/about", "en")); // "/en/about"
 * ```
 * @since 1.0.0
 */
export type LocalePrefix = "always" | "as-needed" | "never";

/**
 * Options of {@link createLocaleRouting}.
 *
 * @example
 * ```ts
 * import { createLocaleRouting, type LocaleRoutingOptions } from "@shadow-js/i18n";
 *
 * const options: LocaleRoutingOptions<"en" | "fr"> = {
 *   locales: ["en", "fr"],
 *   defaultLocale: "en",
 *   prefix: "as-needed",
 * };
 * export const routing = createLocaleRouting(options);
 * ```
 * @since 1.0.0
 */
export interface LocaleRoutingOptions<L extends string> {
  /** The supported locales; a first path segment is one of them when it matches case-insensitively. */
  readonly locales: readonly L[];
  /** The locale of unprefixed paths under `"as-needed"`, and the `x-default` alternate. Must be in `locales`. */
  readonly defaultLocale: L;
  /**
   * How URLs carry the locale.
   * @default `"as-needed"`
   */
  readonly prefix?: LocalePrefix;
}

/**
 * A path split into its locale prefix and the rest: what `LocaleRouting.parse` returns.
 *
 * @example
 * ```ts
 * import { createLocaleRouting, type ParsedLocalePath } from "@shadow-js/i18n";
 *
 * const routing = createLocaleRouting({ locales: ["en", "fr"], defaultLocale: "en" });
 * const parsed: ParsedLocalePath<"en" | "fr"> = routing.parse("/fr/about");
 * console.log(parsed.locale, parsed.path); // "fr" "/about"
 * ```
 * @since 1.0.0
 */
export interface ParsedLocalePath<L extends string> {
  /**
   * The locale named by the first segment, if it is one of `locales` (spelled as in `locales`).
   * Always `undefined` with `prefix: "never"`.
   */
  readonly locale: L | undefined;
  /** The path without the locale segment and without query or hash; always starts with exactly one `/`. */
  readonly path: string;
  /**
   * The first segment when it looks like a locale tag (two letters, optional `-region`) but is not
   * one of `locales`: `"xx"` for `/xx/about`. The URL is not a page of any supported locale, so
   * `canonical` and `resolve` leave it alone (no redirect to a prefixed copy of a path that does
   * not exist) and the router answers 404. `undefined` otherwise.
   */
  readonly unsupported?: string | undefined;
}

/**
 * Result of `LocaleRouting.resolve`: the locale of a request path, the path without prefix, and
 * where to redirect when the path is not canonical.
 *
 * @example
 * ```ts
 * import { createLocaleRouting, type ResolvedLocalePath } from "@shadow-js/i18n";
 *
 * const routing = createLocaleRouting({ locales: ["en", "fr"], defaultLocale: "en" });
 * const resolved: ResolvedLocalePath<"en" | "fr"> = routing.resolve("/en/about");
 * console.log(resolved.locale, resolved.path, resolved.redirectTo); // "en" "/about" "/about"
 * ```
 * @since 1.0.0
 */
export interface ResolvedLocalePath<L extends string> {
  /** The locale of the path's prefix, else the `preferred` argument, else the default locale. */
  readonly locale: L;
  /** The path without the locale prefix. */
  readonly path: string;
  /**
   * The canonical path to redirect to (without query or hash), or `undefined` when the request
   * path already is canonical. Always a same-origin path.
   */
  readonly redirectTo: string | undefined;
  /** See {@link ParsedLocalePath.unsupported}: set, there is no redirect and the URL should answer 404. */
  readonly unsupported?: string | undefined;
}

/**
 * One `<link rel="alternate" hreflang>` target: what `LocaleRouting.alternates` returns per locale.
 *
 * @example
 * ```ts
 * import { type Alternate, createLocaleRouting } from "@shadow-js/i18n";
 *
 * const routing = createLocaleRouting({ locales: ["en", "fr"], defaultLocale: "en" });
 * const links: Alternate[] = routing.alternates("/about", "https://example.com");
 * const html = links.map((link) => `<link rel="alternate" hreflang="${link.hreflang}" href="${link.href}">`);
 * console.log(html.join("\n"));
 * ```
 * @since 1.0.0
 */
export interface Alternate {
  /** The canonical BCP 47 tag of the locale (`pt-BR`), or `"x-default"` for the default locale's entry. */
  readonly hreflang: string;
  /** The absolute URL of the page in that locale. */
  readonly href: string;
}

/**
 * Plain functions for locale-prefixed URLs (`/:locale/...`), with no router import: what
 * {@link createLocaleRouting} returns and `i18n.routing` holds. Paths are normalized first: a run
 * of leading slashes (also encoded ones, `%2F`) collapses to one, backslashes become slashes and
 * control characters are dropped, so a result can never be a protocol-relative URL.
 *
 * @example
 * ```ts
 * import { createLocaleRouting, type LocaleRouting } from "@shadow-js/i18n";
 *
 * const routing: LocaleRouting<"en" | "fr"> = createLocaleRouting({
 *   locales: ["en", "fr"],
 *   defaultLocale: "en",
 * });
 * console.log(routing.canonical("/en/about", "en")); // "/about"
 * console.log(routing.fromParam("FR")); // "fr"
 * ```
 * @since 1.0.0
 */
export interface LocaleRouting<L extends string> {
  /** The `locales` option. */
  readonly locales: readonly L[];
  /** The `defaultLocale` option. */
  readonly defaultLocale: L;
  /** The URL strategy in effect (`"as-needed"` when the option was omitted). */
  readonly prefix: LocalePrefix;
  /** Route pattern for routers that take a param: `"/:locale"` (use with `prefix: "always"`). */
  readonly pattern: "/:locale";
  /**
   * Adds the locale prefix to an app path according to `prefix`; the query and hash are kept.
   * `localePath("/", "fr")` is `"/fr"` under `"always"`.
   */
  localePath(path: string, locale: L): string;
  /** Splits a pathname into locale and path. */
  parse(pathname: string): ParsedLocalePath<L>;
  /**
   * The canonical URL path for a request path and the chosen locale, or `undefined` when the path
   * already is canonical or names an unsupported locale (use it to redirect `/en/about` to `/about`
   * under `"as-needed"`).
   */
  canonical(pathname: string, locale: L): string | undefined;
  /**
   * Everything a `/:locale/...` route needs in one call: the locale of a pathname (or `preferred`
   * / the default when it has no prefix), the path without prefix, and where to redirect when the
   * pathname is not canonical. Use it in a router's `beforeLoad` to redirect or serve.
   */
  resolve(pathname: string, preferred?: L): ResolvedLocalePath<L>;
  /**
   * The locale named by a `:locale` route param (case-insensitive), or `undefined` for a
   * non-locale (answer 404). Always `undefined` with `prefix: "never"`.
   */
  fromParam(param: string | undefined): L | undefined;
  /**
   * `hreflang` alternates for a path: one per locale, then `x-default` for the default locale.
   * Only the origin of `origin` is used.
   * @throws I18nError `INVALID_VALUE` when `origin` is not an absolute `http:` or `https:` URL.
   */
  alternates(path: string, origin: string): Alternate[];
}

/** True when `text` has an encoded slash (`%2F`, `%5C`, any case) at `index`. */
function encodedSlashAt(text: string, index: number): boolean {
  if (text[index] !== "%") return false;
  const code = text.slice(index + 1, index + 3).toLowerCase();
  return code === "2f" || code === "5c";
}

/**
 * Makes a path start with exactly one `/`: a leading run of slashes collapses, and so does one
 * written with encoded slashes (`/%2F%2Fevil.example`), because a consumer that decodes the path
 * would otherwise see `//evil.example`, a protocol-relative URL. Slashes inside the path are data
 * and stay (`/a//b`).
 */
function tidy(path: string): string {
  let index = 0;
  while (index < path.length) {
    if (path[index] === "/") index += 1;
    else if (encodedSlashAt(path, index)) index += 3;
    else break;
  }
  return `/${path.slice(index)}`;
}

/** True for a segment shaped like a locale tag: two letters, then optional `-` subtags of 2 to 8 letters or digits. */
function looksLikeLocale(segment: string): boolean {
  const parts = segment.split("-");
  const language = parts[0] ?? "";
  if (language.length !== 2) return false;
  for (const character of language.toLowerCase()) {
    if (character < "a" || character > "z") return false;
  }
  return parts.slice(1).every((part) => {
    if (part.length < 2 || part.length > 8) return false;
    for (const character of part.toLowerCase()) {
      const alpha = character >= "a" && character <= "z";
      const digit = character >= "0" && character <= "9";
      if (!alpha && !digit) return false;
    }
    return true;
  });
}

/**
 * Normalizes an application path: one leading slash (so `//evil.com` can never become a
 * protocol-relative URL), forward slashes only, no control characters. The
 * query and hash are returned separately and kept.
 */
function splitPath(input: string): { path: string; suffix: string } {
  let cut = input.length;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === "?" || character === "#") {
      cut = index;
      break;
    }
  }
  let path = "";
  for (const character of input.slice(0, cut)) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) continue;
    path += character === "\\" ? "/" : character;
  }
  return { path: tidy(path), suffix: input.slice(cut) };
}

/**
 * Builds the locale-aware URL helpers for a set of locales and a prefix strategy. An instance has
 * one already (`i18n.routing`); call this directly in code that has no instance, such as a router
 * guard or a sitemap script.
 *
 * @param options Locales, default locale and prefix strategy.
 * @returns The helpers.
 * @throws I18nError `UNKNOWN_LOCALE` when `defaultLocale` is not in `locales`.
 * @example
 * ```ts
 * import { createLocaleRouting } from "@shadow-js/i18n";
 *
 * const routing = createLocaleRouting({ locales: ["en", "fr"], defaultLocale: "en" });
 * console.log(routing.localePath("/about", "fr")); // "/fr/about"
 * console.log(routing.localePath("/about?tab=1", "en")); // "/about?tab=1"
 * console.log(routing.parse("/fr/about").locale); // "fr"
 * ```
 * @see {@link LocaleRouting}
 * @since 1.0.0
 */
export function createLocaleRouting<L extends string>(
  options: LocaleRoutingOptions<L>,
): LocaleRouting<L> {
  const { locales, defaultLocale } = options;
  const prefix = options.prefix ?? "as-needed";
  if (!locales.includes(defaultLocale)) {
    throw new I18nError(
      "UNKNOWN_LOCALE",
      __DEV__ ? `defaultLocale "${defaultLocale}" is not in locales.` : "I18N_DEFAULT",
    );
  }
  const byLower = new Map<string, L>();
  for (const locale of locales) byLower.set(locale.toLowerCase(), locale);

  const localePath = (path: string, locale: L): string => {
    const { path: clean, suffix } = splitPath(path);
    if (prefix === "never" || (prefix === "as-needed" && locale === defaultLocale)) {
      return clean + suffix;
    }
    return `/${locale}${clean === "/" ? "" : clean}${suffix}`;
  };

  // The canonical path of a request, or `undefined` when it already is canonical or names an
  // unsupported locale (no redirect to a prefixed copy of a page that does not exist).
  const redirectOf = (
    pathname: string,
    parsed: ParsedLocalePath<L>,
    locale: L,
  ): string | undefined => {
    if (parsed.unsupported !== undefined) return undefined;
    const wanted = localePath(parsed.path, locale);
    return wanted === splitPath(pathname).path ? undefined : wanted;
  };
  const parse = (pathname: string): ParsedLocalePath<L> => {
    const { path } = splitPath(pathname);
    const end = path.indexOf("/", 1);
    const segment = path.slice(1, end === -1 ? path.length : end);
    const locale = prefix === "never" ? undefined : byLower.get(segment.toLowerCase());
    if (locale === undefined) {
      const unsupported = prefix !== "never" && looksLikeLocale(segment) ? segment : undefined;
      return unsupported === undefined
        ? { locale: undefined, path }
        : { locale, path, unsupported };
    }
    // The rest is tidied again: `/fr//evil.example` must not leave `//evil.example` behind.
    return { locale, path: end === -1 ? "/" : tidy(path.slice(end)) };
  };

  return {
    locales,
    defaultLocale,
    prefix,
    pattern: "/:locale",
    localePath,
    parse,
    resolve(pathname, preferred) {
      const parsed = parse(pathname);
      const locale = parsed.locale ?? preferred ?? defaultLocale;
      const redirectTo = redirectOf(pathname, parsed, locale);
      if (parsed.unsupported !== undefined) {
        return { locale, path: parsed.path, redirectTo, unsupported: parsed.unsupported };
      }
      return { locale, path: parsed.path, redirectTo };
    },
    fromParam(param) {
      return param === undefined || prefix === "never"
        ? undefined
        : byLower.get(param.toLowerCase());
    },
    canonical: (pathname, locale) => redirectOf(pathname, parse(pathname), locale),
    alternates(path, origin) {
      let base: URL;
      try {
        base = new URL(origin);
      } catch (error) {
        if (error instanceof TypeError) {
          throw new I18nError(
            "INVALID_VALUE",
            __DEV__ ? `"${origin}" is not an absolute URL.` : "I18N_ORIGIN_2",
            {
              cause: error,
            },
          );
        }
        throw error;
      }
      if (base.protocol !== "http:" && base.protocol !== "https:") {
        throw new I18nError(
          "INVALID_VALUE",
          __DEV__ ? `"${origin}" must be an http(s) URL.` : "I18N_ORIGIN_1",
        );
      }
      const root = base.origin;
      const list: Alternate[] = locales.map((locale) => ({
        hreflang: canonicalTag(locale) ?? locale,
        href: root + localePath(path, locale),
      }));
      list.push({ hreflang: "x-default", href: root + localePath(path, defaultLocale) });
      return list;
    },
  };
}

/**
 * The `localeRouting` feature: gives an instance a URL scheme. With it, `createI18n` takes the
 * `prefix` option, builds `i18n.routing` once (shared with every fork, see
 * {@link createLocaleRouting}) and `i18n.localePath`, detection can read the `"url"` source, and
 * what reads `i18n.routing` works: `createI18nMiddleware` with the `"url"` source or `redirect`,
 * `syncLocaleWithRoute`, `i18nHeadTags` and the `href` of `createLocaleSwitcher`. Without it,
 * the `prefix` option throws a `TypeError` that names the feature, and so do `localePath`, reading
 * `routing`, and the helpers above.
 *
 * @example
 * ```ts
 * import { createI18n } from "@shadow-js/i18n";
 * import { localeRouting } from "@shadow-js/i18n/routing";
 *
 * const i18n = createI18n({
 *   defaultLocale: "en",
 *   locales: ["en", "fr"],
 *   prefix: "as-needed",
 *   features: [localeRouting],
 * });
 *
 * console.log(i18n.localePath("/about", "fr")); // "/fr/about"
 * console.log(i18n.routing.parse("/fr/about").locale); // "fr"
 * ```
 * @since 1.0.0
 */
export const localeRouting: I18nFeature<"routing"> = /* @__PURE__ */ Object.freeze({
  name: "routing",
  plug: createLocaleRouting,
});
