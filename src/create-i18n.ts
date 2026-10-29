import {
  batch,
  getOwner,
  isServer,
  SuspenseContext,
  untrack,
  useContext,
  useSignal,
} from "@shadow-js/core";
import { flattenCatalog } from "./catalog";
import { I18nError } from "./errors";
import type {
  AddMessagesOptions,
  BaseCatalog,
  CatalogLoader,
  DocumentLike,
  I18n,
  I18nOptions,
  I18nState,
  StateOptions,
} from "./i18n-types";
import { collectFeatures, featureMissing, type ResolvedPersistence } from "./internal/features";
import type { Formatters } from "./internal/formatters";
import { register } from "./internal/instances";
import {
  bumpLocale,
  chainOf,
  ctxOf,
  firstReport,
  hasCatalog,
  hasSource,
  isChainLoaded,
  loadChain,
  loadLocale,
  lookup,
  releaseHolders,
  resolveLocale,
  type Shared,
  watchChain,
} from "./internal/shared";
import { createIntlCache } from "./intl";
import { localeDirection } from "./locale";
import { BoundedCache } from "./lru";
import type { LocaleRouting } from "./routing";
import type { MessageAt, Messages, NamespaceKey, RichChunk, Translator } from "./types";

/**
 * Creates an i18n instance: the typed `t`, reactive locale switching, lazy catalogs, fallbacks,
 * hydration and `<html lang dir>`. Make one per app (module scope is fine) on the client, and call
 * `fork(locale)` per request on the server (`createI18nMiddleware` does it for Dusk).
 *
 * `t` is typed from the default locale's catalog: declare it `as const` (or pass the object inline)
 * and keys plus ICU arguments are checked at compile time.
 *
 * This core renders plain text only. A text that uses message syntax (`{name}`, plurals, tags)
 * needs the `compile` option: use {@link createI18nWithIcu}, which passes the ICU compiler, or pass
 * `compile` yourself.
 *
 * Everything else is opt-in through the `features` option (see {@link I18nFeature}), so an app
 * bundles only what it lists: `formatting` (`@shadow-js/i18n/format`) for the `format*` methods,
 * `localeRouting` (`@shadow-js/i18n/routing`) for `prefix`, `localePath` and `routing`,
 * `persistence` (`@shadow-js/i18n/persistence`) for `persist`, and `detection`
 * (`@shadow-js/i18n/detect`) for `detect`. `createI18nFull` from `@shadow-js/i18n/full` lists every
 * feature and passes the ICU compiler, for an app that wants everything with one import.
 *
 * @param options Locales, catalogs or loaders, fallbacks, formats, features and their options.
 * @returns The instance. Its `ready` promise settles when the initial locale's chain is loaded.
 * @throws I18nError `UNKNOWN_LOCALE` when `defaultLocale` is not in `locales`, or when `locale` or
 *   `state.locale` matches none of them; `INVALID_CATALOG` when a static catalog (or one in `state`)
 *   is malformed; `INVALID_STATE` when `state` is not a version 1 snapshot; `INVALID_VALUE` for a
 *   `cacheSize` that is not finite and for an invalid cookie name or attribute in `persist` (in the
 *   browser).
 * @throws TypeError when `features` is not a list of features, or when `prefix`, `persist` (other
 *   than `false`), `detect` (other than `false`) or a `"url"` entry of `detect.order` is given
 *   without the feature it needs; the message names the feature and its import.
 * @example
 * ```ts
 * // Minimal: plain-text catalogs, nothing else bundled.
 * import { createI18n } from "@shadow-js/i18n";
 *
 * export const i18n = createI18n({
 *   defaultLocale: "en",
 *   locales: ["en", "fr"],
 *   messages: { en: { nav: { home: "Home", about: "About" } } },
 *   loaders: { fr: () => fetch("/locales/fr.json").then((response) => response.json()) },
 * });
 *
 * console.log(i18n.t("nav.about")); // "About"
 * await i18n.setLocale("fr");
 * ```
 * @example
 * ```ts
 * // Pick the features you use.
 * import { createI18n } from "@shadow-js/i18n";
 * import { formatting } from "@shadow-js/i18n/format";
 * import { persistence } from "@shadow-js/i18n/persistence";
 *
 * export const i18n = createI18n({
 *   defaultLocale: "en",
 *   locales: ["en", "fr"],
 *   messages: { en: { total: "Total" } },
 *   persist: "cookie",
 *   features: [formatting, persistence],
 * });
 *
 * console.log(`${i18n.t("total")}: ${i18n.formatNumber(1234.5)}`); // "Total: 1,234.5"
 * ```
 * @example
 * ```ts
 * // Everything: every feature and the ICU compiler, one import.
 * import { createI18nFull } from "@shadow-js/i18n/full";
 *
 * export const i18n = createI18nFull({
 *   defaultLocale: "en",
 *   locales: ["en", "fr"],
 *   messages: { en: { inbox: "{count, plural, one {# message} other {# messages}}" } },
 *   prefix: "as-needed",
 *   persist: "cookie",
 *   detect: true,
 * });
 *
 * console.log(i18n.t("inbox", { count: 2 }), i18n.localePath("/inbox", "fr")); // "2 messages" "/fr/inbox"
 * ```
 * @see {@link I18nOptions}
 * @see {@link I18nFeature}
 * @see {@link createI18nWithIcu}
 * @since 1.0.0
 */
export function createI18n<
  const L extends string,
  const D extends L,
  const Mg extends Partial<Record<L, Messages>> = Record<never, never>,
  const Ld extends Partial<Record<L, CatalogLoader>> = Record<never, never>,
>(options: I18nOptions<L, D, Mg, Ld>): I18n<L, BaseCatalog<Mg, Ld, D>> {
  const { locales, defaultLocale } = options;
  if (!locales.includes(defaultLocale)) {
    throw new I18nError(
      "UNKNOWN_LOCALE",
      __DEV__ ? `defaultLocale "${defaultLocale}" is not in locales.` : "I18N_DEFAULT",
    );
  }
  // Every option that needs a feature is checked here, before anything is created, on the server
  // and in the browser alike: a missing feature fails the same way everywhere.
  const plugs = collectFeatures(options.features);
  if (options.prefix !== undefined && plugs.routing === undefined) {
    throw featureMissing("routing", "the prefix option");
  }
  if (
    options.persist !== undefined &&
    options.persist !== false &&
    plugs.persistence === undefined
  ) {
    throw featureMissing("persistence", "the persist option");
  }
  const detect = options.detect;
  if (detect !== undefined && detect !== false) {
    if (plugs.detection === undefined) throw featureMissing("detection", "the detect option");
    if (detect !== true && detect.order?.includes("url") === true && plugs.routing === undefined) {
      throw featureMissing("routing", 'the "url" source of detect.order');
    }
  }
  const report = (error: I18nError): void => {
    if (!firstReport(shared, error)) return;
    // User callbacks never subscribe the running computation to their reads.
    if (options.onError === undefined) {
      if (__DEV__) console.warn(error.message);
    } else untrack(() => options.onError?.(error));
  };
  const shared: Shared<L> = {
    locales,
    defaultLocale,
    options: options as unknown as Shared<L>["options"],
    catalogs: new Map(),
    loading: new Map(),
    chains: new Map(),
    compiled: new BoundedCache(options.cacheSize ?? 500),
    intl: createIntlCache(),
    contexts: new Map(),
    plugs,
    routing: plugs.routing?.({
      locales,
      defaultLocale,
      ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
    }),
    versions: new Map(),
    reported: new Set(),
    failed: new Set(),
    partial: new Set(),
    holders: new Set(),
    inflight: 0,
    disposed: false,
    report,
  };
  const staticMessages = options.messages as Partial<Record<L, Messages>> | undefined;
  for (const locale of locales) {
    const catalog =
      staticMessages !== undefined && Object.hasOwn(staticMessages, locale)
        ? staticMessages[locale]
        : undefined;
    if (catalog !== undefined) shared.catalogs.set(locale, flattenCatalog(catalog));
  }
  return makeInstance(shared, undefined, true) as unknown as I18n<L, BaseCatalog<Mg, Ld, D>>;
}

function makeInstance<L extends string>(
  shared: Shared<L>,
  initial: L | undefined,
  primary: boolean,
): I18n<L, Messages> {
  const { options, locales, defaultLocale, plugs } = shared;
  // Only the instance `createI18n` returns remembers the locale, and only in the browser.
  const persist: ResolvedPersistence | undefined =
    primary &&
    !isServer &&
    plugs.persistence !== undefined &&
    options.persist !== undefined &&
    options.persist !== false
      ? plugs.persistence(options.persist, shared.report)
      : undefined;
  const documentTarget: DocumentLike | undefined =
    !primary || options.syncDocument === false
      ? undefined
      : typeof options.syncDocument === "object"
        ? options.syncDocument
        : primary && !isServer && typeof Reflect.get(globalThis, "document") === "object"
          ? (Reflect.get(globalThis, "document") as DocumentLike)
          : undefined;

  // ---- initial locale
  let start: L | undefined = initial;
  if (primary) {
    if (options.state !== undefined) {
      start = resolveLocale(shared, options.state.locale);
    } else if (options.locale !== undefined) {
      start = resolveLocale(shared, options.locale);
    } else if (
      options.detect !== undefined &&
      options.detect !== false &&
      !isServer &&
      plugs.detection !== undefined
    ) {
      start = plugs.detection({
        config: options.detect === true ? {} : options.detect,
        locales,
        routing: shared.routing,
        persistence: persist,
      });
    }
  }
  const [locale, setLocaleSignal] = useSignal<L>(start ?? defaultLocale);
  const [pending, setPending] = useSignal<L | undefined>(undefined);
  let sequence = 0;
  let latest: Promise<L> = Promise.resolve(untrack(locale));

  const applyDocument = (next: L): void => {
    if (documentTarget === undefined) return;
    documentTarget.documentElement.setAttribute("lang", next);
    documentTarget.documentElement.setAttribute("dir", localeDirection(next, shared.intl));
  };

  const addMessages = (target: L, messages: Messages, addOptions?: AddMessagesOptions): void => {
    const target_ = resolveLocale(shared, target);
    const flat = flattenCatalog(messages);
    const existing = shared.catalogs.get(target_);
    if (existing === undefined) {
      shared.catalogs.set(target_, flat);
      // A locale with a loader that has not run is not complete because some text was added:
      // the loader still runs (its text is the base, these additions win), unless the caller
      // says these messages are the whole catalog.
      if (addOptions?.partial !== false && hasSource(shared, target_)) shared.partial.add(target_);
    } else {
      for (const [key, text] of flat) existing.set(key, text);
      if (addOptions?.partial === false) shared.partial.delete(target_);
    }
    bumpLocale(shared, target_);
  };

  const replaceCatalog = (target: L, messages: Messages): void => {
    if (shared.disposed) return;
    const target_ = resolveLocale(shared, target);
    // Flattening throws before anything changes, so a malformed edit leaves the old catalog in place.
    const flat = flattenCatalog(messages);
    shared.catalogs.set(target_, flat);
    shared.partial.delete(target_);
    shared.failed.delete(target_);
    bumpLocale(shared, target_);
  };

  if (primary && options.state !== undefined) {
    applyState(options.state);
  }

  function applyState(state: I18nState<L>): void {
    // A disposed instance takes no state: hydrate is a no-op, like setLocale.
    if (shared.disposed) return;
    if (
      state === null ||
      typeof state !== "object" ||
      state.v !== 1 ||
      typeof state.locale !== "string" ||
      typeof state.messages !== "object" ||
      state.messages === null ||
      Array.isArray(state.messages)
    ) {
      throw new I18nError(
        "INVALID_STATE",
        __DEV__ ? "the hydration state is not a version 1 snapshot." : "I18N_STATE_9",
      );
    }
    const next = resolveLocale(shared, state.locale);
    // Every catalog is checked before the first write, so a malformed snapshot changes nothing.
    const prepared: [L, Map<string, string>][] = [];
    for (const entry of Object.keys(state.messages)) {
      const catalog = Object.getOwnPropertyDescriptor(state.messages, entry)?.value as
        | Messages
        | undefined;
      if (catalog === undefined) continue;
      prepared.push([resolveLocale(shared, entry), flattenCatalog(catalog)]);
    }
    batch(() => {
      for (const [target, flat] of prepared) {
        const existing = shared.catalogs.get(target);
        // Readers of this locale are told only when something changed: a snapshot of what the
        // instance already holds must not rerun the effects of other roots (it may be applied while
        // another root hydrates).
        let changed = false;
        if (existing === undefined) {
          shared.catalogs.set(target, flat);
          changed = true;
        } else {
          for (const [key, text] of flat) {
            if (existing.get(key) === text) continue;
            existing.set(key, text);
            changed = true;
          }
        }
        // The snapshot is what the server had loaded: these catalogs are complete.
        if (shared.partial.delete(target)) changed = true;
        if (changed) bumpLocale(shared, target);
      }
      setLocaleSignal(() => next);
      setPending(() => undefined);
    });
    sequence += 1;
    applyDocument(next);
  }

  // Every failure of `loadChain` is an I18nError (`loadLocale` wraps the loader's throw).
  const initialLoad: Promise<void> = loadChain(shared, untrack(locale)).catch((error: I18nError) =>
    shared.report(error),
  );
  if (primary) applyDocument(untrack(locale));

  const commit = (next: L, remember: boolean): void => {
    batch(() => {
      setLocaleSignal(() => next);
      setPending(() => undefined);
    });
    applyDocument(next);
    if (remember) persist?.write(next);
  };

  function setLocale(requested: L): Promise<L> {
    if (shared.disposed) return Promise.resolve(untrack(locale));
    const next = resolveLocale(shared, requested);
    sequence += 1;
    const mine = sequence;
    // An explicit retry of a locale whose loader failed must try the loader again.
    shared.failed.delete(next);
    if (isChainLoaded(shared, next)) {
      commit(next, true);
      latest = Promise.resolve(next);
      return latest;
    }
    if (options.transition === "suspend") {
      batch(() => {
        setLocaleSignal(() => next);
        setPending(() => next);
      });
      applyDocument(next);
    } else {
      setPending(() => next);
    }
    const result: Promise<L> = loadChain(shared, next).then(
      (): L => {
        // dispose advances the sequence, so a load that settles after it is superseded here.
        if (mine !== sequence) return untrack(locale);
        commit(next, true);
        return next;
      },
      (error: I18nError): L => {
        // After dispose nothing is reported (the work was abandoned). A superseded load's failure is
        // still reported; only the indicator is left to the call that is current.
        if (shared.disposed) return untrack(locale);
        if (mine === sequence) setPending(() => undefined);
        shared.report(error);
        return untrack(locale);
      },
    );
    latest = result;
    // A call that was superseded resolves with whatever the newest call settles on.
    return result.then((value) => (mine === sequence ? value : latest));
  }

  // ---- translate

  const suspendIfLoading = (active: L): boolean => {
    if (isChainLoaded(shared, active)) return false;
    // After dispose no load runs, so nothing would ever release the holder.
    if (!isServer && !shared.disposed && getOwner() !== null) {
      const tracker = useContext(SuspenseContext);
      if (tracker !== null && !shared.holders.has(tracker)) {
        shared.holders.add(tracker);
        tracker.increment();
      }
    }
    return true;
  };

  const missing = (key: string, active: L): string => {
    const chain = chainOf(shared, active);
    shared.report(
      new I18nError(
        "MISSING_KEY",
        `no message "${key}" for ${active} (searched ${chain.join(" > ")}).`,
      ),
    );
    const handler = options.onMissing;
    if (handler === undefined) return key;
    // A callback that throws must not break rendering: the problem is reported (with the thrown
    // value as `cause`) and the key stands in for the text. A result that is not text is the key.
    try {
      const text: unknown = untrack(() => handler({ key, locale: active, chain }));
      return typeof text === "string" ? text : key;
    } catch (error) {
      shared.report(
        new I18nError("INVALID_VALUE", `onMissing threw for "${key}": ${String(error)}`, {
          cause: error,
        }),
      );
      return key;
    }
  };

  const translate = (prefix: string, key: string, values: object | undefined): string => {
    const active = locale();
    watchChain(shared, chainOf(shared, active));
    const full = prefix === "" ? key : `${prefix}.${key}`;
    const found = lookup(shared, full, active);
    if (found === undefined) return suspendIfLoading(active) ? "" : missing(full, active);
    return found.message.format(values, ctxOf(shared, found.locale));
  };

  const translateRich = (prefix: string, key: string, values: object | undefined): RichChunk[] => {
    const active = locale();
    watchChain(shared, chainOf(shared, active));
    const full = prefix === "" ? key : `${prefix}.${key}`;
    const found = lookup(shared, full, active);
    if (found === undefined) return suspendIfLoading(active) ? [] : [missing(full, active)];
    const handlers = values as
      | Readonly<Record<string, (chunks: readonly unknown[]) => unknown>>
      | undefined;
    return found.message.parts(values, handlers, ctxOf(shared, found.locale)) as RichChunk[];
  };

  const makeTranslator = (prefix: string): Translator<Messages> => {
    const call = ((key: string, values?: object) =>
      translate(prefix, key, values)) as Translator<Messages>;
    const rich = (key: string, values?: object): RichChunk[] => translateRich(prefix, key, values);
    const has = (key: string): boolean => {
      const active = locale();
      watchChain(shared, chainOf(shared, active));
      return lookup(shared, prefix === "" ? key : `${prefix}.${key}`, active) !== undefined;
    };
    return Object.assign(call, { rich, has }) as Translator<Messages>;
  };

  // Without the formatting feature each method throws the error that names the feature.
  const absent = (name: string) => (): never => {
    throw featureMissing("formatting", `i18n.${name}`);
  };
  const { formatNumber, formatDate, formatRelative, formatList, formatDisplayName }: Formatters<L> =
    plugs.formatting?.(shared, locale) ?? {
      formatNumber: absent("formatNumber"),
      formatDate: absent("formatDate"),
      formatRelative: absent("formatRelative"),
      formatList: absent("formatList"),
      formatDisplayName: absent("formatDisplayName"),
    };

  const routingOf = (what: string): LocaleRouting<L> => {
    if (shared.routing === undefined) throw featureMissing("routing", what);
    return shared.routing;
  };

  const state = (stateOptions: StateOptions = {}): I18nState<L> => {
    const active = untrack(locale);
    const messages: Record<string, Record<string, string>> = {};
    const wanted = stateOptions.include === "active" ? [active] : chainOf(shared, active);
    for (const entry of wanted) {
      const flat = shared.catalogs.get(entry);
      if (flat !== undefined) messages[entry] = Object.fromEntries(flat);
    }
    return { v: 1, locale: active, messages };
  };

  const members = {
    defaultLocale,
    locales,
    locale,
    pending,
    setLocale,
    t: makeTranslator(""),
    scoped: <N extends NamespaceKey<Messages>>(namespace: N): Translator<MessageAt<Messages, N>> =>
      makeTranslator(namespace) as unknown as Translator<MessageAt<Messages, N>>,
    translate: (key, values) => translate("", key, values),
    translateRich: (key, values) => translateRich("", key, values),
    formatNumber,
    formatDate,
    formatRelative,
    formatList,
    formatDisplayName,
    dir: (target) => localeDirection(target ?? locale(), shared.intl),
    ready: initialLoad,
    load: (target) => loadLocale(shared, resolveLocale(shared, target)),
    isLoaded: (target) => hasCatalog(shared, target),
    addMessages,
    replaceCatalog,
    localePath: (path: string, target?: L) =>
      routingOf("i18n.localePath").localePath(path, target ?? locale()),
    chain: (target) => chainOf(shared, target ?? untrack(locale)),
    state,
    hydrate: applyState,
    fork: (target) =>
      makeInstance(
        shared,
        target === undefined ? untrack(locale) : resolveLocale(shared, target),
        false,
      ),
    dispose: () => {
      sequence += 1;
      // Work in flight never applies, so nothing may still show as loading.
      if (untrack(pending) !== undefined) setPending(() => undefined);
      if (primary) {
        shared.disposed = true;
        shared.compiled.clear();
        shared.intl.clear();
        shared.contexts.clear();
        releaseHolders(shared);
      }
    },
  } satisfies Omit<I18n<L, Messages>, "routing">;
  // `routing` is shared by every fork. Without the routing feature reading it throws the error that
  // names the feature; that accessor is not enumerable, so spreading or printing an instance never
  // reaches it.
  const instance = Object.defineProperty(
    members,
    "routing",
    shared.routing === undefined
      ? { get: () => routingOf("i18n.routing") }
      : { value: shared.routing, enumerable: true },
  ) as I18n<L, Messages>;
  register(instance, shared.report, primary);
  return instance;
}
