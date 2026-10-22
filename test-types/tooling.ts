// Compile-time tests of the locale, Intl and extraction helpers. [I18N-449]

import {
  compareKeys,
  type DuplicateKey,
  type ExtractResult,
  extractMessages,
  findDuplicateKeys,
  type KeyComparison,
} from "../src/extract";
import { createIntlCache, type IntlCache, type IntlSupport, intlSupport } from "../src/intl";
import {
  ACCEPT_LANGUAGE_LIMITS,
  type Direction,
  localeDirection,
  matchLocale,
  negotiateLocale,
  parseAcceptLanguage,
} from "../src/locale";

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// Locale helpers keep the literal union of the supported list.
const supported = ["en", "fr-CA", "zh-Hant"] as const;
const best = matchLocale("fr", supported);
type _best = Expect<Equal<typeof best, "en" | "fr-CA" | "zh-Hant" | undefined>>;
const negotiated = negotiateLocale(parseAcceptLanguage("fr;q=0.8, en"), supported);
type _negotiated = Expect<Equal<typeof negotiated, "en" | "fr-CA" | "zh-Hant" | undefined>>;
const direction: Direction = localeDirection("ar");
type _direction = Expect<Equal<Direction, "ltr" | "rtl">>;
const tags: string[] = parseAcceptLanguage(null);
const maxEntries: number = ACCEPT_LANGUAGE_LIMITS.maxEntries;
negotiateLocale(new Set(["en"]), supported);
negotiateLocale(["en"].values(), supported);
localeDirection("ar", createIntlCache());

// @ts-expect-error a tag is text
matchLocale(5, supported);
// @ts-expect-error the supported locales are text
matchLocale("en", [1, 2]);
// @ts-expect-error the header is text, null or undefined
parseAcceptLanguage(5);
// @ts-expect-error the limits are read-only
ACCEPT_LANGUAGE_LIMITS.maxEntries = 64;
// @ts-expect-error a direction is "ltr" or "rtl"
const wrong: Direction = "auto";

// The Intl cache and feature detection.
const cache: IntlCache = createIntlCache(64);
cache.number("en", { style: "percent" });
cache.date("en", { dateStyle: "long" });
cache.plural("en", "ordinal");
cache.displayNames("en", { type: "region" });
const support: IntlSupport = intlSupport();
const hasLists: boolean = support.listFormat;
// @ts-expect-error `type` is required by Intl.DisplayNames
cache.displayNames("en", {});
// @ts-expect-error a plural type is cardinal or ordinal
cache.plural("en", "other");
// @ts-expect-error the support flags are read-only
support.listFormat = false;

// Extraction.
const found: ExtractResult = extractMessages("t('a')", {
  functions: ["t"],
  components: ["Trans"],
  scopedFunctions: ["scoped"],
  maxLength: 1000,
});
const compared: KeyComparison = compareKeys(["a"], found, { ignoreUnknownDynamic: true });
const duplicates: readonly DuplicateKey[] = findDuplicateKeys([
  { source: "a.json", keys: ["x"] },
  { source: "b.json", keys: new Set(["x"]) },
]);
const kind: "call" | "rich" | "trans" | undefined = found.keys[0]?.kind;
// @ts-expect-error the option names are checked
extractMessages("t('a')", { scoped: ["scoped"] });
// @ts-expect-error the source is text
extractMessages(5);
// @ts-expect-error the result is read-only
found.keys.push();
// @ts-expect-error a key source needs a name
findDuplicateKeys([{ keys: ["x"] }]);

export type { _best, _direction, _negotiated };
export { compared, direction, duplicates, hasLists, kind, maxEntries, tags, wrong };
