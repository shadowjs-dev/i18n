import { createRoot, untrack, useEffect } from "@shadow-js/core";
import type { I18n } from "./i18n-types";

/**
 * What the locale sync reads from a router: its live location. A `@shadow-js/router` router (its
 * `state.location()`) satisfies it, so the i18n package names no router type and needs no router
 * dependency.
 *
 * @example
 * ```ts
 * import { useSignal } from "@shadow-js/core";
 * import { createI18n, type RouteLocationSource, syncLocaleWithRoute } from "@shadow-js/i18n";
 * import { localeRouting } from "@shadow-js/i18n/routing";
 *
 * const [location, setLocation] = useSignal({ pathname: "/en" });
 * const source: RouteLocationSource = { state: { location } };
 *
 * const i18n = createI18n({
 *   defaultLocale: "en",
 *   locales: ["en", "fr"],
 *   prefix: "always",
 *   features: [localeRouting],
 * });
 * syncLocaleWithRoute(i18n, source);
 * setLocation({ pathname: "/fr/about" }); // calls i18n.setLocale("fr")
 * ```
 * @since 1.0.0
 */
export interface RouteLocationSource {
  /**
   * The router state. `location()` is read reactively; it returns the current location (whose
   * `pathname` includes the router's `base`), or `undefined` before the first one.
   */
  readonly state: { location(): { readonly pathname: string } | undefined };
}

/**
 * Keeps the i18n locale in step with the locale segment of the URL. A client navigation that changes the segment
 * (`/en/...` to `/ar/...`), and a back or forward traversal across one, calls `setLocale`. `setLocale` then sets the
 * document's `lang` and `dir` (`syncDocument`), so the page's language and direction follow the page on screen (WCAG
 * 3.1.1, 3.1.2).
 *
 * The URL names the locale only with the `"always"` prefix (or `"as-needed"`, where a path without a segment is the
 * default locale). With `"never"` the locale comes from a cookie or header, so the URL says nothing and nothing
 * happens. A navigation that keeps the same locale segment does not call `setLocale`, so a locale the app chose with
 * a switcher stays until the URL's locale changes. A first segment shaped like a locale that is not supported
 * (`/xx/about`) names no locale: it changes nothing, also under `"as-needed"`.
 *
 * The first location is read when the sync starts and is not synced: the initial locale comes from the server's
 * state or detection. Call it once on the client, after the router exists.
 *
 * The router's location keeps its `base` (the mount point, for example `/app`), so pass the same `base` the router was
 * created with: the locale segment is read after it.
 *
 * The locale segment is read with `i18n.routing`, so the instance needs the `localeRouting` feature
 * (`@shadow-js/i18n/routing`, which also exports this function).
 *
 * @param i18n The instance whose locale follows the URL.
 * @param router The router whose location is read (`router.state.location()`).
 * @param options `base`: the router's mount point; trailing slashes are ignored. Default: none.
 * @returns A function that stops the sync.
 * @throws TypeError, synchronously, when the instance has no `localeRouting` feature; the message
 *   names it.
 * @example
 * ```ts
 * import { createI18n } from "@shadow-js/i18n";
 * import { localeRouting, syncLocaleWithRoute } from "@shadow-js/i18n/routing";
 * import { createRouter } from "@shadow-js/router";
 *
 * const i18n = createI18n({
 *   defaultLocale: "en",
 *   locales: ["en", "ar"],
 *   prefix: "always",
 *   features: [localeRouting],
 * });
 * const router = createRouter({ routes: [], base: "/app" });
 *
 * const stop = syncLocaleWithRoute(i18n, router, { base: "/app" });
 * window.addEventListener("pagehide", stop);
 * ```
 * @see {@link RouteLocationSource}
 * @since 1.0.0
 */
export function syncLocaleWithRoute<L extends string, M>(
  i18n: I18n<L, M>,
  router: RouteLocationSource,
  options: { readonly base?: string } = {},
): () => void {
  // Read first: without the routing feature this throws the error that names it.
  const routing = i18n.routing;
  const base = (options.base ?? "").replace(/\/+$/, "");
  // The pathname without the router's base: `/app/ar/about` is `/ar/about`. Other pathnames are returned as they are.
  const withoutBase = (pathname: string): string => {
    if (base === "") return pathname;
    if (pathname === base) return "/";
    return pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : pathname;
  };
  // The locale a pathname names, or undefined when the URL names none.
  const localeOf = (pathname: string | undefined): L | undefined => {
    if (pathname === undefined) return undefined;
    const parsed = routing.parse(withoutBase(pathname));
    if (parsed.locale !== undefined) return parsed.locale;
    // `/xx/about` names a locale that is not supported: it is no page of the default locale either.
    if (parsed.unsupported !== undefined) return undefined;
    return routing.prefix === "as-needed" ? i18n.defaultLocale : undefined;
  };
  return createRoot((dispose) => {
    // The locale the URL named last. Only a change of it sets the locale.
    let shown = localeOf(untrack(() => router.state.location()?.pathname));
    useEffect(
      () => router.state.location()?.pathname,
      (pathname) => {
        const next = localeOf(pathname);
        if (next === undefined || next === shown) return;
        shown = next;
        void i18n.setLocale(next);
      },
    );
    return dispose;
  });
}
