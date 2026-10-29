import type { I18nBase } from "./i18n-types";
import { canonicalTag } from "./locale";
import { STATE_META_NAME, serializeI18nState } from "./state";

/**
 * A head tag description, structurally the same as `HeadTag` of `@shadow-js/web`, so the result can
 * be passed straight to `useHead`.
 *
 * @example
 * ```ts
 * import { createI18n, type I18nHeadTag, i18nHeadTags } from "@shadow-js/i18n";
 * import { localeRouting } from "@shadow-js/i18n/routing";
 *
 * const i18n = createI18n({ defaultLocale: "en", locales: ["en", "fr"], features: [localeRouting] });
 * const tags: I18nHeadTag[] = i18nHeadTags(i18n, { path: "/", origin: "https://example.com" });
 * const links = tags.filter((tag) => tag.tag === "link").map((tag) => tag.props["href"]);
 * console.log(links);
 * ```
 * @since 1.0.0
 */
export interface I18nHeadTag {
  /** The element: `"link"` (alternates, canonical) or `"meta"` (Open Graph, hydration state). */
  readonly tag: "link" | "meta";
  /** The element's attributes, such as `rel`, `hreflang` and `href`, or `property` and `content`. */
  readonly props: Readonly<Record<string, string>>;
}

/**
 * Options of {@link i18nHeadTags}.
 *
 * @example
 * ```ts
 * import { createI18n, type HeadTagsOptions, i18nHeadTags } from "@shadow-js/i18n";
 * import { localeRouting } from "@shadow-js/i18n/routing";
 *
 * const i18n = createI18n({ defaultLocale: "en", locales: ["en", "fr"], features: [localeRouting] });
 * const options: HeadTagsOptions<"en" | "fr"> = {
 *   path: "/pricing",
 *   origin: "https://example.com",
 *   locale: "fr",
 *   openGraph: true,
 * };
 * export const tags = i18nHeadTags(i18n, options);
 * ```
 * @since 1.0.0
 */
export interface HeadTagsOptions<L extends string> {
  /** The page path without locale prefix, for example `"/about"`. */
  readonly path: string;
  /**
   * Absolute origin used to build absolute URLs: `https://example.com`. Must be an `http:` or
   * `https:` URL; only its origin is used.
   */
  readonly origin: string;
  /** The page's locale. Default: the instance's active locale (reactive inside `useHead(() => ...)`). */
  readonly locale?: L;
  /**
   * Add `<link rel="canonical">` pointing at the page in `locale`.
   * @default `true`
   */
  readonly canonical?: boolean;
  /**
   * Add `og:locale` for `locale` and one `og:locale:alternate` per other locale, written with an
   * underscore (`pt_BR`).
   * @default `false`
   */
  readonly openGraph?: boolean;
  /**
   * Add a `<meta name="shadow-i18n">` with the hydration state (`i18n.state()`), which
   * {@link readI18nState} reads when the page has no state script.
   * @default `false`
   */
  readonly state?: boolean;
}

/**
 * The Open Graph spelling of a locale: the language, and the region after an underscore when there
 * is one (`pt-BR` -> `pt_BR`, `zh-Hant-TW` -> `zh_TW`). Open Graph knows no script, variant or
 * extension subtags, so a tag written with them (`zh_Hant-TW`) is not a locale it accepts.
 */
function openGraphLocale(tag: string): string {
  const parts = tag.split(/[-_]/);
  const language = (parts[0] ?? tag).toLowerCase();
  for (let index = 1; index < parts.length; index += 1) {
    const part = parts[index] ?? "";
    // A singleton starts an extension: no region follows.
    if (part.length === 1) break;
    if (/^(?:[A-Za-z]{2}|[0-9]{3})$/.test(part)) return `${language}_${part.toUpperCase()}`;
  }
  return language;
}

/**
 * `hreflang` alternates, the canonical link and (optionally) Open Graph locales and the hydration
 * state, as head tags: one `<link rel="alternate">` per locale plus an `x-default` one for the
 * default locale, then the canonical link, then the `<meta>` tags. The URLs come from
 * `i18n.routing`, so the instance needs the `localeRouting` feature (`@shadow-js/i18n/routing`).
 *
 * @param i18n The instance.
 * @param options The page path, origin and switches.
 * @returns Tags for `useHead`.
 * @throws I18nError `INVALID_VALUE` when `origin` is not an absolute http(s) URL.
 * @throws TypeError when the instance has no `localeRouting` feature; the message names it.
 * @example
 * ```tsx
 * import { createI18n, i18nHeadTags } from "@shadow-js/i18n";
 * import { localeRouting } from "@shadow-js/i18n/routing";
 * import { useHead } from "@shadow-js/web";
 *
 * const i18n = createI18n({ defaultLocale: "en", locales: ["en", "fr"], features: [localeRouting] });
 *
 * export function AboutPage() {
 *   useHead(() => i18nHeadTags(i18n, { path: "/about", origin: "https://example.com" }));
 *   return <h1>About</h1>;
 * }
 * ```
 * @see {@link HeadTagsOptions}
 * @since 1.0.0
 */
export function i18nHeadTags<L extends string>(
  i18n: I18nBase<L>,
  options: HeadTagsOptions<L>,
): I18nHeadTag[] {
  // Read first: without the routing feature this throws the error that names it.
  const routing = i18n.routing;
  const locale = options.locale ?? i18n.locale();
  const alternates = routing.alternates(options.path, options.origin);
  const tags: I18nHeadTag[] = alternates.map((alternate) => ({
    tag: "link",
    props: { rel: "alternate", hreflang: alternate.hreflang, href: alternate.href },
  }));
  if (options.canonical !== false) {
    const own = alternates.find(
      (alternate) => alternate.hreflang === (canonicalTag(locale) ?? locale),
    );
    if (own !== undefined) tags.push({ tag: "link", props: { rel: "canonical", href: own.href } });
  }
  if (options.openGraph === true) {
    const primary = openGraphLocale(canonicalTag(locale) ?? locale);
    tags.push({ tag: "meta", props: { property: "og:locale", content: primary } });
    // Two locales can share a language and a region (`zh-CN`, `zh-Hans-CN`): one alternate is enough.
    const written = new Set([primary]);
    for (const other of i18n.locales) {
      if (other === locale) continue;
      const content = openGraphLocale(canonicalTag(other) ?? other);
      if (written.has(content)) continue;
      written.add(content);
      tags.push({ tag: "meta", props: { property: "og:locale:alternate", content } });
    }
  }
  if (options.state === true) {
    tags.push({
      tag: "meta",
      props: { name: STATE_META_NAME, content: serializeI18nState(i18n.state()) },
    });
  }
  return tags;
}
