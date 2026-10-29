import type { IntlCache } from "./intl";

/**
 * Text direction of a locale: `"ltr"` (left to right) or `"rtl"` (right to left), the values of the
 * HTML `dir` attribute.
 *
 * @example
 * ```ts
 * import { type Direction, localeDirection } from "@shadow-js/i18n";
 *
 * const dir: Direction = localeDirection("he");
 * document.documentElement.setAttribute("dir", dir);
 * ```
 * @since 1.0.0
 */
export type Direction = "ltr" | "rtl";

/** Shape of a tag: letters, then `-` or `_` separated alphanumeric subtags (validity is `Intl`'s call). */
const TAG = /^[A-Za-z]{1,8}(?:[-_][A-Za-z0-9]{1,8})*$/;

/** Longest tag looked at; anything longer is not a locale and is not handed to `Intl`. */
const MAX_TAG_LENGTH = 256;

/**
 * The irregular grandfathered tags of BCP 47 (RFC 5646 section 2.2.8), which `Intl` rejects as
 * structurally invalid, with their preferred replacement; `""` means the registry gives none, so the
 * tag is not usable as a locale. Keys are lowercase. The regular grandfathered tags (`art-lojban`,
 * `zh-hakka`, ...) are canonicalized by `Intl` itself.
 */
const IRREGULAR_TAGS: ReadonlyMap<string, string> = new Map(
  "en-gb-oed>en-GB-oxendict i-ami>ami i-bnn>bnn i-default> i-enochian> i-hak>hak i-klingon>tlh i-lux>lb i-mingo> i-navajo>nv i-pwn>pwn i-tao>tao i-tay>tay i-tsu>tsu sgn-be-fr>sfb sgn-be-nl>vgt sgn-ch-de>sgg no-bok>nb no-nyn>nn zh-min> zh-min-nan>nan"
    .split(" ")
    .map((entry): [string, string] => {
      const [from = "", to = ""] = entry.split(">");
      return [from, to];
    }),
);

/**
 * Bounds of `Accept-Language` handling, so a hostile header costs a fixed amount of work:
 *
 * - `maxLength` (1024): a header longer than this is ignored entirely by
 *   {@link parseAcceptLanguage}.
 * - `maxEntries` (32): {@link parseAcceptLanguage} keeps at most this many tags (the best ones by
 *   quality), and {@link negotiateLocale} tries at most this many.
 *
 * The object is frozen.
 *
 * @example
 * ```ts
 * import { ACCEPT_LANGUAGE_LIMITS, parseAcceptLanguage } from "@shadow-js/i18n";
 *
 * export function preferredTags(request: Request): string[] {
 *   const header = request.headers.get("accept-language");
 *   if (header !== null && header.length > ACCEPT_LANGUAGE_LIMITS.maxLength) {
 *     console.warn("Accept-Language header ignored: too long");
 *   }
 *   return parseAcceptLanguage(header);
 * }
 * ```
 * @since 1.0.0
 */
export const ACCEPT_LANGUAGE_LIMITS: Readonly<{ maxEntries: number; maxLength: number }> =
  Object.freeze({ maxEntries: 32, maxLength: 1024 });

/**
 * Reads the weight of an `Accept-Language` entry: `0` or `1` with an optional fraction (`1` only
 * with zeros), nothing else. Returns `-1` for anything that is not a weight (`1.5`, `.5`, `1e-1`,
 * `0x1`, `abc`, an empty value).
 */
function parseWeight(text: string): number {
  const dot = text.indexOf(".");
  const whole = dot === -1 ? text : text.slice(0, dot);
  const fraction = dot === -1 ? "" : text.slice(dot + 1);
  if (whole !== "0" && whole !== "1") return -1;
  for (let index = 0; index < fraction.length; index += 1) {
    const digit = fraction.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9 || (whole === "1" && digit !== 0)) return -1;
  }
  return Number(`${whole}.${fraction === "" ? "0" : fraction}`);
}

/**
 * Parses an `Accept-Language` header into language tags ordered by quality (stable for equal
 * quality). A tag that is not a valid BCP 47 tag (see {@link canonicalTag}), the wildcard `*`, an
 * entry with `q=0`, and an entry whose `q` is not a weight from `0` to `1` are dropped. A tag listed
 * more than once (compared in canonical form, so `EN_us` and `en-US` are the same) counts once, at
 * its best weight, spelled as in that entry. Tags keep their spelling. The header and the result
 * are bounded by {@link ACCEPT_LANGUAGE_LIMITS}: the 32 best tags are kept.
 *
 * @param header The raw header value, or `null`/`undefined`.
 * @returns Tags, best first; `[]` for a missing header or one longer than
 *   `ACCEPT_LANGUAGE_LIMITS.maxLength`.
 * @example
 * ```ts
 * import { negotiateLocale, parseAcceptLanguage } from "@shadow-js/i18n";
 *
 * const tags = parseAcceptLanguage("fr-CH, fr;q=0.9, en;q=0.8, *;q=0.5");
 * console.log(tags); // ["fr-CH", "fr", "en"]
 * console.log(negotiateLocale(tags, ["en", "fr"])); // "fr"
 * ```
 * @since 1.0.0
 */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (typeof header !== "string" || header.length > ACCEPT_LANGUAGE_LIMITS.maxLength) {
    return [];
  }
  const best = new Map<string, { tag: string; q: number; index: number }>();
  const parts = header.split(",");
  for (let index = 0; index < parts.length; index += 1) {
    const [rawTag, ...params] = (parts[index] ?? "").split(";");
    const tag = (rawTag ?? "").trim();
    const canonical = canonicalTag(tag);
    if (canonical === undefined) continue;
    let q = 1;
    for (const param of params) {
      const equals = param.indexOf("=");
      if (equals !== -1 && param.slice(0, equals).trim().toLowerCase() === "q") {
        q = parseWeight(param.slice(equals + 1).trim());
      }
    }
    if (q <= 0) continue;
    const key = canonical.toLowerCase();
    const known = best.get(key);
    if (known === undefined || q > known.q) best.set(key, { tag, q, index });
  }
  return [...best.values()]
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .slice(0, ACCEPT_LANGUAGE_LIMITS.maxEntries)
    .map((entry) => entry.tag);
}

/**
 * Canonical BCP 47 form of a tag, or `undefined` when it is not a valid tag. Case is normalized
 * (`zh-hant-tw` -> `zh-Hant-TW`), `_` is read as `-`, deprecated codes are replaced (`iw` -> `he`),
 * and the irregular grandfathered tags map to their preferred value (`i-klingon` -> `tlh`). `-u-`
 * and `-x-` extensions are kept (`EN-us-u-NU-arab` -> `en-US-u-nu-arab`); locale matching removes
 * them, see {@link matchLocale}. A tag longer than 256 characters is not a locale and gives
 * `undefined`. Never throws.
 * @internal
 */
export function canonicalTag(tag: string): string | undefined {
  if (tag.length > MAX_TAG_LENGTH || !TAG.test(tag)) return undefined;
  const hyphenated = tag.replaceAll("_", "-");
  const irregular = IRREGULAR_TAGS.get(hyphenated.toLowerCase());
  if (irregular === "") return undefined;
  try {
    return Intl.getCanonicalLocales(irregular ?? hyphenated)[0];
  } catch (error) {
    if (error instanceof RangeError) return undefined;
    throw error;
  }
}

/** A canonical tag without its `-u-` and `-x-` extensions: the subtags before the first singleton. */
function withoutExtensions(canonical: string): string {
  const parts = canonical.split("-");
  const singleton = parts.findIndex((part, position) => position > 0 && part.length === 1);
  return singleton === -1 ? canonical : parts.slice(0, singleton).join("-");
}

/** The supported locales keyed for matching: by full canonical tag and by the tag without extensions. */
interface LocaleIndex<L extends string> {
  readonly full: ReadonlyMap<string, L>;
  readonly plain: ReadonlyMap<string, L>;
}

/** Keys of `supported`, lowercase; the first of several spellings of one tag wins. */
function indexLocales<L extends string>(supported: readonly L[]): LocaleIndex<L> {
  const full = new Map<string, L>();
  const plain = new Map<string, L>();
  for (const locale of supported) {
    const canonical = canonicalTag(locale);
    const key = (canonical ?? locale).toLowerCase();
    if (!full.has(key)) full.set(key, locale);
    const stripped = canonical === undefined ? key : withoutExtensions(canonical).toLowerCase();
    if (!plain.has(stripped)) plain.set(stripped, locale);
  }
  return { full, plain };
}

function matchIn<L extends string>(index: LocaleIndex<L>, tag: string): L | undefined {
  if (tag === "") return undefined;
  const canonical = canonicalTag(tag);
  if (canonical === undefined) return index.full.get(tag.toLowerCase());
  const exact = index.full.get(canonical.toLowerCase());
  if (exact !== undefined) return exact;
  const parts = withoutExtensions(canonical).toLowerCase().split("-");
  while (parts.length > 0) {
    const key = parts.join("-");
    const hit = index.full.get(key) ?? index.plain.get(key);
    if (hit !== undefined) return hit;
    parts.pop();
  }
  const language = canonical.split("-")[0]?.toLowerCase() ?? "";
  // Several locales may share the language: a request without a script (`zh-TW`) names the script its
  // region implies (Hant), and must not land on whichever of `zh-Hans` and `zh-Hant` comes first.
  const wanted = scriptOf(canonical);
  let first: L | undefined;
  for (const [candidate, locale] of index.plain) {
    if (candidate.split("-")[0] !== language) continue;
    if (wanted !== undefined && scriptOf(candidate) === wanted) return locale;
    first ??= locale;
  }
  return first;
}

/** The script of a tag, written or implied by its language and region (`zh-TW` -> `Hant`); `undefined` when unknown. */
function scriptOf(tag: string): string | undefined {
  try {
    return new Intl.Locale(tag).maximize().script;
  } catch (error) {
    if (error instanceof RangeError) return undefined;
    throw error;
  }
}

/**
 * Finds the supported locale that best matches one tag: exact (case-insensitive, after
 * canonicalizing both, so `en_us`, `EN-US` and `en-US` are the same), then the tag with trailing
 * subtags removed (`zh-Hant-TW` -> `zh-Hant` -> `zh`), then the first supported locale with the same
 * language (`pt` matches `pt-BR`); when several share the language, one of the script the tag
 * writes or implies comes first (`zh-TW` matches `zh-Hant` before `zh-Hans`). `-u-` and `-x-` extensions in the request are ignored once an
 * exact match with them fails (`ar-EG-u-nu-latn` matches `ar-EG`). A tag that is not valid BCP 47
 * matches only a supported entry with the same text, ignoring case. The empty string never matches.
 *
 * @param tag A requested tag.
 * @param supported The locales the app has.
 * @returns The supported locale, spelled as in `supported`, or `undefined`.
 * @example
 * ```ts
 * import { matchLocale } from "@shadow-js/i18n";
 *
 * matchLocale("en-GB", ["en-US", "fr"]); // "en-US"
 * matchLocale("FR-ca", ["en-US", "fr"]); // "fr"
 * matchLocale("ar-EG-u-nu-latn", ["en", "ar-EG"]); // "ar-EG"
 * matchLocale("de", ["en-US", "fr"]); // undefined
 * ```
 * @see {@link negotiateLocale}
 * @since 1.0.0
 */
export function matchLocale<L extends string>(tag: string, supported: readonly L[]): L | undefined {
  return matchIn(indexLocales(supported), tag);
}

/**
 * Picks the supported locale of the first requested tag that matches one (see
 * {@link matchLocale}). At most `ACCEPT_LANGUAGE_LIMITS.maxEntries` tags are tried.
 *
 * @param requested Tags, best first (for example from {@link parseAcceptLanguage} or
 *   `navigator.languages`).
 * @param supported The locales the app has.
 * @returns The supported locale, or `undefined` when none match.
 * @example
 * ```ts
 * import { negotiateLocale } from "@shadow-js/i18n";
 *
 * negotiateLocale(["de-AT", "en"], ["en", "de"]); // "de"
 * negotiateLocale(navigator.languages, ["en", "de"]);
 * ```
 * @since 1.0.0
 */
export function negotiateLocale<L extends string>(
  requested: Iterable<string>,
  supported: readonly L[],
): L | undefined {
  const index = indexLocales(supported);
  let seen = 0;
  for (const tag of requested) {
    seen += 1;
    if (seen > ACCEPT_LANGUAGE_LIMITS.maxEntries) break;
    const hit = matchIn(index, tag);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/**
 * Languages written right to left by default, used only when the runtime cannot say (no
 * `Intl.Locale` text info and no `maximize`). A language that has both a right-to-left and a
 * left-to-right default script (`ku`, `pa`, `ff`, `ha`, `uz`) is not listed: its script subtag decides.
 */
const RTL_LANGUAGES: ReadonlySet<string> = new Set(
  "ar arc arz ary apc azb bgn ckb dv fa glk he iw ks lrc mzn nqo pnb prs ps sd skr syr ug ur yi".split(
    " ",
  ),
);
const RTL_SCRIPTS: ReadonlySet<string> = new Set(
  "Adlm Arab Hebr Hung Mand Mend Nkoo Phnx Rohg Samr Syrc Thaa Yezi".split(" "),
);

/** The part of `Intl.Locale` used for direction; `getTextInfo()` is newer than `textInfo`. */
interface TextInfoLocale {
  readonly textInfo?: { readonly direction?: string };
  readonly script?: string;
  readonly language?: string;
  getTextInfo?(): { readonly direction?: string };
  maximize?(): TextInfoLocale;
}

/**
 * Text direction of a locale, as the HTML `dir` attribute takes it. The script decides when the tag
 * has one (`sd-Arab` is right to left, `ur-Deva` left to right); without a script the language's
 * default script does (`ur`, `ar`, `he`, `fa`, `syr`, `dv`, `nqo` and `ff-Adlm` are right to left).
 * It uses the runtime's `Intl.Locale` text info when it has it, and otherwise the maximized or
 * explicit script of the tag, and last a list of right-to-left languages, so old runtimes still get
 * Arabic, Hebrew and Persian right. `_` is read as `-`. Instances use it for `dir()` and
 * `<html dir>`.
 *
 * @param locale A BCP 47 tag.
 * @param cache Optional formatter cache (avoids rebuilding `Intl.Locale`).
 * @returns `"rtl"` or `"ltr"`; `"ltr"` for a tag that is not valid and for an unknown language.
 * @example
 * ```ts
 * import { localeDirection } from "@shadow-js/i18n";
 *
 * localeDirection("ar-EG"); // "rtl"
 * localeDirection("sd-Arab"); // "rtl"
 * localeDirection("ur-Deva"); // "ltr"
 * localeDirection("fr"); // "ltr"
 * ```
 * @since 1.0.0
 */
export function localeDirection(locale: string, cache?: IntlCache): Direction {
  if (locale.length > MAX_TAG_LENGTH) return "ltr";
  if (typeof Reflect.get(Intl, "Locale") !== "function") {
    const canonical = canonicalTag(locale);
    return canonical === undefined ? "ltr" : directionOfTag(canonical);
  }
  // The tag as written is the common case (and the one the cache has); `ar_EG` and the irregular
  // grandfathered tags only parse in canonical form.
  let parsed = intlLocale(locale, cache);
  if (parsed === undefined) {
    const canonical = canonicalTag(locale);
    if (canonical === undefined || canonical === locale) return "ltr";
    parsed = intlLocale(canonical, cache);
    if (parsed === undefined) return "ltr";
  }
  const info = typeof parsed.getTextInfo === "function" ? parsed.getTextInfo() : parsed.textInfo;
  if (info?.direction === "rtl") return "rtl";
  if (info?.direction === "ltr") return "ltr";
  const script =
    parsed.script ?? (typeof parsed.maximize === "function" ? parsed.maximize().script : undefined);
  if (script !== undefined) return RTL_SCRIPTS.has(script) ? "rtl" : "ltr";
  return RTL_LANGUAGES.has(parsed.language ?? locale.split(/[-_]/)[0]?.toLowerCase() ?? "")
    ? "rtl"
    : "ltr";
}

/** `Intl.Locale` of a tag, or `undefined` when the runtime rejects the tag. */
function intlLocale(tag: string, cache: IntlCache | undefined): TextInfoLocale | undefined {
  try {
    return (cache === undefined ? new Intl.Locale(tag) : cache.locale(tag)) as TextInfoLocale;
  } catch (error) {
    if (error instanceof RangeError) return undefined;
    throw error;
  }
}

/** Direction from the subtags alone, for a runtime without `Intl.Locale`: the script, else the language. */
function directionOfTag(canonical: string): Direction {
  const [language = "", second] = canonical.split("-");
  // A script is the four letters after the language (a four-character variant starts with a digit).
  const script =
    second !== undefined && second.length === 4 && !isDigit(second) ? second : undefined;
  if (script !== undefined) return RTL_SCRIPTS.has(script) ? "rtl" : "ltr";
  return RTL_LANGUAGES.has(language) ? "rtl" : "ltr";
}

function isDigit(text: string): boolean {
  const first = text.charCodeAt(0);
  return first >= 48 && first <= 57;
}
