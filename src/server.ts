import { type DetectSource, detectLocale } from "./detect";
import { I18nError } from "./errors";
import type { I18nBase } from "./i18n-types";
import { currentRequestI18n, runWithRequestI18n } from "./internal/request-context";

/**
 * The part of a Dusk `RequestEvent` this module uses. Declared here so the package does
 * not import Dusk at run time; a Dusk `RequestEvent` is assignable to it, and a test can pass a
 * small object of this shape.
 *
 * @example
 * ```ts
 * import type { RequestEvent } from "@shadow-js/dusk/server";
 * import type { I18nRequestEvent } from "@shadow-js/i18n";
 *
 * export function asI18nEvent(event: RequestEvent): I18nRequestEvent {
 *   return event;
 * }
 * ```
 * @since 1.0.0
 */
export interface I18nRequestEvent {
  /** The incoming request: its `Accept-Language` header and its method are read. */
  readonly request: {
    /** Request headers; `get` returns `null` for an absent header. */
    readonly headers: { get(name: string): string | null };
    /** The HTTP method; only `GET` and `HEAD` are redirected. */
    readonly method: string;
  };
  /** The request URL; its pathname chooses the locale and its search is kept on redirects. */
  readonly url: URL;
  /** The request cookies (`get`) and the response cookies (`set`), for the locale cookie. */
  readonly cookies: {
    /** The decoded value of a request cookie, or `undefined`. */
    get(name: string): string | undefined;
    /** Sets a response cookie with the given attributes (`maxAge` in seconds). */
    set(
      name: string,
      value: string,
      options?: {
        readonly path?: string;
        readonly maxAge?: number;
        readonly httpOnly?: boolean;
        readonly secure?: boolean;
        readonly sameSite?: "lax" | "strict" | "none";
      },
    ): void;
  };
  /** Headers of the response: the middleware sets `Content-Language` and appends `Vary`. */
  readonly responseHeaders: {
    /** Adds a value to a header (used for `Vary`). */
    append(name: string, value: string): void;
    /** Replaces a header (used for `Content-Language`). */
    set(name: string, value: string): void;
  };
  /** Attributes of `<html>`; the middleware sets `lang` and `dir`. */
  readonly document: { lang: string; dir: "ltr" | "rtl" | "auto" | undefined };
  /** Stores a per-request value under a typed key; the middleware stores the instance under {@link i18nEventKey}. */
  set<T>(key: { readonly name: string; readonly type?: T }, value: T): void;
  /** Reads a per-request value, or `undefined` when none was stored. */
  tryGet<T>(key: { readonly name: string; readonly type?: T }): T | undefined;
}

/**
 * `next` of a Dusk middleware: runs the rest of the chain (and renders the page) and resolves
 * with its response.
 *
 * @example
 * ```ts
 * import { createI18n, createI18nMiddleware, type I18nNext, type I18nRequestEvent } from "@shadow-js/i18n";
 * import { localeRouting } from "@shadow-js/i18n/routing";
 *
 * const i18n = createI18n({ defaultLocale: "en", locales: ["en", "fr"], features: [localeRouting] });
 * const localize = createI18nMiddleware(i18n);
 *
 * // Times the middleware and everything after it.
 * export async function timed(event: I18nRequestEvent, next: I18nNext): Promise<Response> {
 *   const started = performance.now();
 *   const response = await localize(event, next);
 *   console.log(`${event.url.pathname}: ${Math.round(performance.now() - started)} ms`);
 *   return response;
 * }
 * ```
 * @since 1.0.0
 */
export type I18nNext = () => Promise<Response>;

/**
 * The typed key under which the middleware stores the per-request instance (`{ name: "shadow-i18n" }`,
 * frozen). {@link getEventI18n} reads it; use it directly only with an event API of your own.
 *
 * @example
 * ```ts
 * import { type I18nBase, type I18nRequestEvent, i18nEventKey } from "@shadow-js/i18n";
 *
 * export function hasI18n(event: Pick<I18nRequestEvent, "tryGet">): boolean {
 *   return event.tryGet<I18nBase>(i18nEventKey) !== undefined;
 * }
 * ```
 * @since 1.0.0
 */
export const i18nEventKey: { readonly name: string; readonly type?: I18nBase } = Object.freeze({
  name: "shadow-i18n",
});

/**
 * Options of {@link createI18nMiddleware}.
 *
 * @example
 * ```ts
 * import { createI18n, createI18nMiddleware, type I18nMiddlewareOptions } from "@shadow-js/i18n";
 * import { localeRouting } from "@shadow-js/i18n/routing";
 *
 * const i18n = createI18n({
 *   defaultLocale: "en",
 *   locales: ["en", "fr"],
 *   prefix: "always",
 *   features: [localeRouting],
 * });
 *
 * const options: I18nMiddlewareOptions = {
 *   strategy: ["url", "cookie", "accept-language"],
 *   cookie: { name: "lang", maxAge: 60 * 60 * 24 * 90, secure: true },
 *   redirect: true,
 *   redirectStatus: 308,
 * };
 * export const localize = createI18nMiddleware(i18n, options);
 * ```
 * @since 1.0.0
 */
export interface I18nMiddlewareOptions {
  /**
   * Where to look for the locale, in order (`"storage"` and `"navigator"` find nothing on the
   * server). When no source names a supported locale, the default locale is used. A path without a
   * locale prefix counts as the default locale under `prefix: "as-needed"`.
   * @default `["url", "cookie", "accept-language"]`
   */
  readonly strategy?: readonly DetectSource[];
  /**
   * Remember the locale in a cookie when the URL chose it and the request's cookie differs. The
   * cookie has `Path=/`, `SameSite=Lax`, is readable by scripts (not `HttpOnly`), and lives `maxAge`
   * seconds (default one year); `name` defaults to `"locale"`, and `secure` adds `Secure` when set.
   * `false` stops writing it; the `"cookie"` source then still reads a cookie named `"locale"`.
   * Default: `{}`, a cookie with those defaults.
   */
  readonly cookie?:
    | false
    | { readonly name?: string; readonly maxAge?: number; readonly secure?: boolean };
  /**
   * Redirect GET/HEAD requests whose path is not the canonical URL of the chosen locale (`/about`
   * to `/fr/about` with `prefix: "always"`). The query string is kept. Never with
   * `prefix: "never"`, and never for a path whose first segment is an unsupported locale tag.
   * @default `false`
   */
  readonly redirect?: boolean;
  /**
   * HTTP status of that redirect.
   * @default `307`
   */
  readonly redirectStatus?: 301 | 302 | 307 | 308;
  /**
   * Set `Content-Language` to the chosen locale on the response.
   * @default `true`
   */
  readonly contentLanguage?: boolean;
  /**
   * Request paths the middleware leaves alone: no locale is chosen, nothing is redirected or set,
   * and the request goes straight on (`getEventI18n` finds no instance). A string matches that
   * path and everything below it (`"/api"` matches `/api` and `/api/users`, not `/apiary`), a
   * `RegExp` is tested against the pathname, a function receives the pathname.
   *
   * Default: `"/api"`, `"/_dusk"` (Dusk's own endpoints: server functions, health) and every path
   * whose last segment has a file extension (`/favicon.ico`, `/assets/app.js`). Passing a list
   * replaces the default; spread {@link DEFAULT_I18N_EXCLUDE} into it to keep it.
   */
  readonly exclude?: readonly PathMatcher[];
  /**
   * When given, only paths that match at least one entry are handled; everything else goes
   * straight on, as with `exclude` (which still applies on top).
   */
  readonly include?: readonly PathMatcher[];
}

/**
 * One way to name request paths, for `exclude` and `include` of {@link I18nMiddlewareOptions}: a
 * string matches that path and everything below it (at a segment boundary), a `RegExp` is tested
 * against the pathname, a function receives the pathname.
 *
 * @example
 * ```ts
 * import { createI18n, createI18nMiddleware, DEFAULT_I18N_EXCLUDE, type PathMatcher } from "@shadow-js/i18n";
 * import { localeRouting } from "@shadow-js/i18n/routing";
 *
 * const i18n = createI18n({ defaultLocale: "en", locales: ["en", "fr"], features: [localeRouting] });
 * const exclude: PathMatcher[] = [
 *   ...DEFAULT_I18N_EXCLUDE,
 *   "/admin",
 *   /^\/webhooks\//,
 *   (pathname) => pathname.endsWith("/feed"),
 * ];
 * export const localize = createI18nMiddleware(i18n, { exclude });
 * ```
 * @since 1.0.0
 */
export type PathMatcher = string | RegExp | ((pathname: string) => boolean);

/** True when the last path segment has a file extension (`/logo.svg`, not `/v1.0/about`). */
function hasFileExtension(pathname: string): boolean {
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  const dot = last.lastIndexOf(".");
  return dot > 0 && dot < last.length - 1;
}

/**
 * The default of {@link I18nMiddlewareOptions.exclude}: API routes (`"/api"`), Dusk's `/_dusk`
 * endpoints and paths whose last segment has a file extension (`/favicon.ico`, not `/v1.0/about`),
 * none of which is a localized page. The array is frozen; spread it into your own list to extend it.
 *
 * @example
 * ```ts
 * import { createI18n, createI18nMiddleware, DEFAULT_I18N_EXCLUDE } from "@shadow-js/i18n";
 * import { localeRouting } from "@shadow-js/i18n/routing";
 *
 * const i18n = createI18n({ defaultLocale: "en", locales: ["en", "fr"], features: [localeRouting] });
 * export const localize = createI18nMiddleware(i18n, {
 *   exclude: [...DEFAULT_I18N_EXCLUDE, "/healthz"],
 * });
 * ```
 * @since 1.0.0
 */
export const DEFAULT_I18N_EXCLUDE: readonly PathMatcher[] = Object.freeze([
  "/api",
  "/_dusk",
  hasFileExtension,
]);

function matches(matcher: PathMatcher, pathname: string): boolean {
  if (typeof matcher === "string") {
    return (
      pathname === matcher || pathname.startsWith(matcher.endsWith("/") ? matcher : `${matcher}/`)
    );
  }
  if (typeof matcher === "function") return matcher(pathname);
  matcher.lastIndex = 0;
  return matcher.test(pathname);
}

/**
 * Dusk middleware: decides the locale of each request, loads its catalogs, gives the request its
 * own instance (`getEventI18n(event)`), sets `<html lang dir>`, `Content-Language` and `Vary`, and
 * optionally remembers the choice in a cookie or redirects to the canonical URL.
 *
 * The request instance is a `fork` of `i18n`, so concurrent requests never share a locale.
 *
 * Contract (structural, no Dusk import): `(event: I18nRequestEvent, next: () => Promise<Response>)
 * => Promise<Response>`; `event.cookies.get/set`, `event.responseHeaders.append/set`,
 * `event.document.lang/dir`, `event.set/tryGet` and `event.url` are used.
 *
 * The `Vary` header gets `Accept-Language` and `Cookie` when those sources are in the strategy,
 * also on a redirect. Excluded paths go straight to `next`.
 *
 * The `"url"` source and `redirect` read `i18n.routing`, so they need an instance created with
 * the `localeRouting` feature (`@shadow-js/i18n/routing`); a strategy of cookies and headers
 * works without it.
 *
 * @param i18n The application instance (with its loaders).
 * @param options Strategy and switches.
 * @returns A middleware for `createHandler({ middleware: [...] })`. It rejects when the chosen
 *   locale's catalog fails to load (the `LOAD_FAILED` error of `i18n.load`).
 * @throws TypeError, when the middleware is created, if the strategy has `"url"` or `redirect` is
 *   `true` and the instance has no `localeRouting` feature; the message names the feature.
 * @example
 * ```ts
 * // src/entry-server.ts
 * import type { HandlerOptions } from "@shadow-js/dusk/server";
 * import { createI18nWithIcu, createI18nMiddleware } from "@shadow-js/i18n";
 * import { localeRouting } from "@shadow-js/i18n/routing";
 *
 * const i18n = createI18nWithIcu({
 *   defaultLocale: "en",
 *   locales: ["en", "fr"],
 *   messages: { en: { title: "Welcome" }, fr: { title: "Bienvenue" } },
 *   prefix: "always",
 *   timeZone: "UTC",
 *   features: [localeRouting],
 * });
 *
 * const options: Omit<HandlerOptions, "manifest"> = {
 *   middleware: [
 *     createI18nMiddleware(i18n, {
 *       strategy: ["url", "cookie", "accept-language"],
 *       redirect: true,
 *     }),
 *   ],
 * };
 *
 * export default options;
 * ```
 * @see {@link I18nMiddlewareOptions}
 * @see {@link getEventI18n}
 * @since 1.0.0
 */
export function createI18nMiddleware<L extends string, I extends I18nBase<L>>(
  i18n: I & { fork(locale?: L): I },
  options: I18nMiddlewareOptions = {},
): (event: I18nRequestEvent, next: I18nNext) => Promise<Response> {
  const strategy = options.strategy ?? ["url", "cookie", "accept-language"];
  const cookie = options.cookie === false ? undefined : (options.cookie ?? {});
  const cookieName = cookie?.name ?? "locale";
  // Only the "url" source and redirects read the URL scheme. Reading it here, when the middleware is
  // made, makes an instance without the routing feature fail at startup with the error that names it.
  const routing = strategy.includes("url") || options.redirect === true ? i18n.routing : undefined;
  const exclude = options.exclude ?? DEFAULT_I18N_EXCLUDE;
  const include = options.include;
  return async (event, next) => {
    const pathname = event.url.pathname;
    if (
      exclude.some((matcher) => matches(matcher, pathname)) ||
      (include !== undefined && !include.some((matcher) => matches(matcher, pathname)))
    ) {
      return next();
    }
    const stored = event.cookies.get(cookieName);
    const found = detectLocale(
      {
        pathname: event.url.pathname,
        cookie: stored === undefined ? undefined : `${cookieName}=${encodeURIComponent(stored)}`,
        acceptLanguage: event.request.headers.get("accept-language"),
      },
      {
        locales: i18n.locales,
        order: strategy,
        cookieName,
        ...(routing === undefined
          ? {}
          : { routing, unprefixedIsDefault: routing.prefix === "as-needed" }),
      },
    );
    const locale = found?.locale ?? i18n.defaultLocale;
    const safeMethod = event.request.method === "GET" || event.request.method === "HEAD";
    if (
      options.redirect === true &&
      safeMethod &&
      routing !== undefined &&
      routing.prefix !== "never"
    ) {
      const target = routing.canonical(event.url.pathname, locale);
      if (target !== undefined) {
        const headers = new Headers({ location: `${target}${event.url.search}` });
        if (strategy.includes("accept-language")) headers.append("vary", "Accept-Language");
        if (strategy.includes("cookie")) headers.append("vary", "Cookie");
        return new Response(null, { status: options.redirectStatus ?? 307, headers });
      }
    }
    await i18n.load(locale);
    const scoped = i18n.fork(locale);
    await scoped.ready;
    event.set(i18nEventKey as { readonly name: string; readonly type?: I }, scoped);
    event.document.lang = locale;
    event.document.dir = scoped.dir();
    if (cookie !== undefined && found?.source === "url" && stored !== locale) {
      event.cookies.set(cookieName, locale, {
        path: "/",
        maxAge: cookie.maxAge ?? 31_536_000,
        httpOnly: false,
        sameSite: "lax",
        ...(cookie.secure === undefined ? {} : { secure: cookie.secure }),
      });
    }
    if (options.contentLanguage !== false) event.responseHeaders.set("content-language", locale);
    if (strategy.includes("accept-language"))
      event.responseHeaders.append("vary", "Accept-Language");
    if (strategy.includes("cookie")) event.responseHeaders.append("vary", "Cookie");
    // The page renders (and streams) inside this call: `useI18n()` and `I18nProvider` find the
    // request's instance there without importing anything from Dusk.
    return runWithRequestI18n(scoped, next);
  };
}

/**
 * The instance of the request being handled: what `createI18nMiddleware` stored, found without the
 * request event. It is safe to import in code that also reaches the browser (it imports nothing
 * from Dusk): in the browser, and on a server that has no `AsyncLocalStorage` or no middleware,
 * it returns `undefined`. `I18nProvider` and `useI18n` use it, so a component tree needs no
 * per-request code of its own.
 *
 * @returns The request's instance, or `undefined`.
 * @example
 * ```ts
 * import { createI18n, tryGetRequestI18n } from "@shadow-js/i18n";
 *
 * const i18n = createI18n({ defaultLocale: "en", locales: ["en", "fr"] });
 *
 * // The request's locale on the server, the app instance's in the browser.
 * export function currentLocale(): "en" | "fr" {
 *   return (tryGetRequestI18n<typeof i18n>() ?? i18n).locale();
 * }
 * ```
 * @since 1.0.0
 */
export function tryGetRequestI18n<I extends I18nBase = I18nBase>(): I | undefined {
  return currentRequestI18n() as I | undefined;
}

/**
 * The per-request instance the middleware stored: a fork of the app instance in the request's
 * locale, with its catalogs loaded. Use it in server code that has the event (a server function,
 * a route handler, a later middleware).
 *
 * @param event The request event.
 * @returns The instance for this request's locale.
 * @throws I18nError `INVALID_STATE` when `createI18nMiddleware` did not run for this request (or
 *   the path was excluded).
 * @example
 * ```ts
 * import { getRequestEvent } from "@shadow-js/dusk/server";
 * import { createI18n, getEventI18n } from "@shadow-js/i18n";
 *
 * const i18n = createI18n({
 *   defaultLocale: "en",
 *   locales: ["en", "fr"],
 *   messages: { en: { saved: "Saved" }, fr: { saved: "Enregistré" } },
 * });
 *
 * export function savedMessage(): string {
 *   return getEventI18n<typeof i18n>(getRequestEvent()).t("saved");
 * }
 * ```
 * @since 1.0.0
 */
export function getEventI18n<I extends I18nBase = I18nBase>(
  event: Pick<I18nRequestEvent, "tryGet">,
): I {
  const found = event.tryGet<I>(i18nEventKey as { readonly name: string; readonly type?: I });
  if (found === undefined) {
    throw new I18nError(
      "INVALID_STATE",
      __DEV__
        ? "no i18n instance on this request; add createI18nMiddleware() to the middleware list."
        : "I18N_NO_1",
    );
  }
  return found;
}
