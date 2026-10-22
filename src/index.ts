/**
 * `@shadow-js/i18n`: typed translation, reactive locale switching, lazy catalogs, hydration and
 * the components. The core (`createI18n`) is small; everything optional is a feature in its own
 * subpath, listed in `features` only by the apps that use it:
 *
 * - `@shadow-js/i18n/format`: `formatting` (the `format*` methods, the `Formatted*` components).
 * - `@shadow-js/i18n/routing`: `localeRouting` (`prefix`, `localePath`, `routing`) and the URL helpers.
 * - `@shadow-js/i18n/persistence`: `persistence` (the `persist` option) and the persist strategies.
 * - `@shadow-js/i18n/detect`: `detection` (the `detect` option) and `detectLocale`.
 * - `@shadow-js/i18n/full`: `createI18nFull`, every feature and the ICU compiler in one call.
 * - `@shadow-js/i18n/icu`: the ICU compiler, parser and catalog tools.
 * - `@shadow-js/i18n/server`: the Dusk middleware and the request helpers.
 *
 * The helpers that need no instance (`createLocaleRouting`, `detectLocale`, `cookieStrategy`,
 * `matchLocale`, `i18nHeadTags`, `createHotI18n`...) are also exported here; a bundler keeps only
 * the ones an app imports.
 * @packageDocumentation
 */
export { CATALOG_LIMITS, flattenCatalog } from "./catalog";
export type {
  FormattedDateProps,
  FormattedListProps,
  FormattedNumberProps,
  FormattedRelativeProps,
  I18nProviderProps,
  LocaleOption,
  LocaleSwitcherApi,
  LocaleSwitcherOptions,
  LocaleSwitcherProps,
  TransProps,
} from "./components";
export {
  createLocaleSwitcher,
  FormattedDate,
  FormattedList,
  FormattedNumber,
  FormattedRelative,
  I18nContext,
  I18nProvider,
  LocaleSwitcher,
  Trans,
  useI18n,
} from "./components";
export { createI18n } from "./create-i18n";
export type { DetectInput, DetectOptions, DetectSource } from "./detect";
export { DEFAULT_DETECT_ORDER, detectLocale, readCookie } from "./detect";
export type { I18nErrorCode, SyntaxErrorCode } from "./errors";
export { I18nError, MessageSyntaxError } from "./errors";
export type {
  CompareOptions,
  DuplicateKey,
  DynamicUsage,
  ExtractedKey,
  ExtractOptions,
  ExtractResult,
  KeyComparison,
  KeySource,
} from "./extract";
export { compareKeys, extractMessages, findDuplicateKeys } from "./extract";
export type { HeadTagsOptions, I18nHeadTag } from "./head";
export { i18nHeadTags } from "./head";
export type { HotI18nContext } from "./hmr";
export { createHotI18n } from "./hmr";
export type {
  AddMessagesOptions,
  BaseCatalog,
  CatalogLoader,
  CatalogModule,
  DetectConfig,
  DisplayNameOptions,
  DocumentLike,
  FallbackConfig,
  I18n,
  I18nBase,
  I18nFeature,
  I18nFeatureName,
  I18nOptions,
  I18nState,
  MissingInfo,
  PersistSpec,
  RelativeOptions,
  StateOptions,
} from "./i18n-types";
export type { FormatOptions } from "./icu/format";
export type { IntlCache, IntlSupport } from "./intl";
export { createIntlCache, intlSupport } from "./intl";
export type { Direction } from "./locale";
export {
  ACCEPT_LANGUAGE_LIMITS,
  localeDirection,
  matchLocale,
  negotiateLocale,
  parseAcceptLanguage,
} from "./locale";
export type { CompiledMessage, MessageCompiler } from "./message";
export type {
  CookieDocument,
  CookieStrategyOptions,
  PersistStrategy,
  StorageLike,
  StorageStrategyOptions,
} from "./persist";
export { cookieStrategy, storageStrategy } from "./persist";
export type { Register, RegisteredI18n, RegisteredMessages } from "./register";
export type { RouteLocationSource } from "./route-locale";
export { syncLocaleWithRoute } from "./route-locale";
export type {
  Alternate,
  LocalePrefix,
  LocaleRouting,
  LocaleRoutingOptions,
  ParsedLocalePath,
  ResolvedLocalePath,
} from "./routing";
export { createLocaleRouting } from "./routing";
export type { I18nMiddlewareOptions, I18nNext, I18nRequestEvent, PathMatcher } from "./server";
export {
  createI18nMiddleware,
  DEFAULT_I18N_EXCLUDE,
  getEventI18n,
  i18nEventKey,
  tryGetRequestI18n,
} from "./server";
export type { ReadStateOptions, StateDocument, StateScriptOptions } from "./state";
export {
  parseI18nState,
  readI18nState,
  renderI18nStateScript,
  STATE_MAX_LENGTH,
  STATE_META_NAME,
  STATE_SCRIPT_ID,
  serializeI18nState,
} from "./state";
export type {
  MaybeAccessor,
  MessageArgs,
  MessageAt,
  MessageKey,
  Messages,
  MessageTags,
  NamespaceKey,
  RichChunk,
  RichParam,
  RichTag,
  Translator,
  ValuesParam,
  WidenMessages,
} from "./types";
export type { IcuI18nOptions } from "./with-icu";
export { createI18nWithIcu } from "./with-icu";
