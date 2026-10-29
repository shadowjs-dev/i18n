import { type Accessor, type SuspenseTracker, untrack, useSignal } from "@shadow-js/core";
import { flattenCatalog } from "../catalog";
import { I18nError, MessageSyntaxError } from "../errors";
import type { CatalogLoader, FallbackConfig, I18nOptions } from "../i18n-types";
import type { IntlCache } from "../intl";
import { matchLocale } from "../locale";
import type { BoundedCache } from "../lru";
import { type CompiledMessage, isPlainText, plainMessage } from "../message";
import type { LocaleRouting } from "../routing";
import type { Messages } from "../types";
import type { FormatContext } from "../values";
import type { Plugs } from "./features";

// ---------------------------------------------------------------------------------------------
// Implementation

/**
 * What compiling a catalog text gives: the message, or the syntax error to report.
 * @internal
 */
export type Compiled = CompiledMessage | MessageSyntaxError;

/**
 * State shared by an instance and all its forks: catalogs, loads, caches and reporting.
 * @internal
 */
export interface Shared<L extends string> {
  readonly locales: readonly L[];
  readonly defaultLocale: L;
  readonly options: I18nOptions<
    L,
    L,
    Partial<Record<L, Messages>>,
    Partial<Record<L, CatalogLoader>>
  >;
  readonly catalogs: Map<L, Map<string, string>>;
  readonly loading: Map<L, Promise<void>>;
  readonly chains: Map<L, readonly L[]>;
  readonly compiled: BoundedCache<string, Compiled>;
  readonly intl: IntlCache;
  readonly contexts: Map<string, FormatContext>;
  /** The features the instance was created with (the `features` option), by name. */
  readonly plugs: Plugs;
  /** The URL helpers, when the routing feature is installed; shared with every fork. */
  readonly routing: LocaleRouting<L> | undefined;
  /** One version cell per locale: a catalog change only reruns readers whose chain includes it. */
  readonly versions: Map<L, [Accessor<number>, (update: (n: number) => number) => void]>;
  /** Messages of data problems already reported (bounded), so a render loop reports each once. */
  readonly reported: Set<string>;
  /** Locales whose loader failed; they count as loaded so fallbacks show instead of blanks. */
  readonly failed: Set<L>;
  /**
   * Locales that have a loader and hold only what `addMessages` put there. They are not loaded:
   * the loader still runs and its text is the base the additions go on top of.
   */
  readonly partial: Set<L>;
  readonly holders: Set<SuspenseTracker>;
  inflight: number;
  disposed: boolean;
  report(error: I18nError): void;
}

/**
 * Unwraps what a loader returns: a catalog, an ES module namespace (`import("./x.json")`), or a
 * module-shaped object `{ default: catalog }` (a bundler's or a CommonJS interop wrapper, or
 * `Promise.resolve({ default })`). A plain object counts as a module when its only keys are
 * `default` (an object) and `__esModule`; a catalog that has one namespace called `default` must
 * be wrapped (`{ default: { default: { ... } } }`) or named differently.
 * @internal
 */
export function catalogOf(module: unknown, locale: string): Messages {
  if (typeof module !== "object" || module === null) {
    throw new I18nError(
      "INVALID_CATALOG",
      __DEV__ ? `the loader for "${locale}" did not return an object.` : "I18N_LOADER_2",
    );
  }
  const namespace = Reflect.get(module, Symbol.toStringTag) === "Module";
  if (namespace || isModuleShaped(module)) {
    const inner = Reflect.get(module, "default");
    if (typeof inner !== "object" || inner === null) {
      throw new I18nError(
        "INVALID_CATALOG",
        __DEV__ ? `the module for "${locale}" has no default export.` : "I18N_LOADER_1",
      );
    }
    return inner as Messages;
  }
  return module as Messages;
}

/** True for `{ default: object }` and `{ default: object, __esModule: true }` and nothing else. */
function isModuleShaped(value: object): boolean {
  const keys = Object.keys(value);
  const inner = Object.getOwnPropertyDescriptor(value, "default")?.value;
  return (
    keys.includes("default") &&
    keys.every((key) => key === "default" || key === "__esModule") &&
    typeof inner === "object" &&
    inner !== null
  );
}

/**
 * The fallback chain of `locale`: itself, its declared parent languages, the configured fallbacks,
 * then the default locale; undeclared and repeated locales are skipped.
 * @internal
 */
export function buildChain<L extends string>(
  locale: L,
  locales: readonly L[],
  defaultLocale: L,
  fallback: FallbackConfig<L> | undefined,
): readonly L[] {
  const out: L[] = [];
  // Adds one locale or a list of them, skipping undeclared and repeated ones.
  const add = (candidate: L | readonly L[] | undefined): void => {
    if (candidate === undefined) return;
    for (const entry of typeof candidate === "string" ? [candidate] : candidate) {
      if (locales.includes(entry) && !out.includes(entry)) out.push(entry);
    }
  };
  add(locale);
  // Regional locales fall back to their language: pt-BR -> pt.
  const parts = locale.split("-");
  while (parts.length > 1) {
    parts.pop();
    add(locales.find((entry) => entry.toLowerCase() === parts.join("-").toLowerCase()));
  }
  if (fallback !== undefined) {
    if (typeof fallback === "string" || Array.isArray(fallback)) {
      add(fallback as L | readonly L[]);
    } else {
      const map = fallback as { readonly [K in L | "default"]?: L | readonly L[] };
      add(Object.hasOwn(map, locale) ? map[locale] : undefined);
      add(map.default);
    }
  }
  add(defaultLocale);
  return out;
}

/**
 * The version signal of a locale, created on first use.
 * @internal
 */
export function versionCell<L extends string>(
  shared: Shared<L>,
  locale: L,
): [Accessor<number>, (update: (n: number) => number) => void] {
  const known = shared.versions.get(locale);
  if (known !== undefined) return known;
  const [read, write] = useSignal(0);
  const made: [Accessor<number>, (update: (n: number) => number) => void] = [read, write];
  shared.versions.set(locale, made);
  return made;
}

/**
 * Subscribes the running computation to catalog changes of every locale in the chain.
 * @internal
 */
export function watchChain<L extends string>(shared: Shared<L>, chain: readonly L[]): void {
  for (const entry of chain) versionCell(shared, entry)[0]();
}

/**
 * Tells the readers of a locale that its catalog changed.
 * @internal
 */
export function bumpLocale<L extends string>(shared: Shared<L>, locale: L): void {
  versionCell(shared, locale)[1]((n) => n + 1);
}

/**
 * The cached fallback chain of a locale.
 * @internal
 */
export function chainOf<L extends string>(shared: Shared<L>, locale: L): readonly L[] {
  const known = shared.chains.get(locale);
  if (known !== undefined) return known;
  const built = buildChain(
    locale,
    shared.locales,
    shared.defaultLocale,
    shared.options.fallbackLocale,
  );
  // `chain(locale)` takes any string at run time: only a declared locale is remembered, so a
  // stream of made-up tags (from a URL, say) cannot grow the map.
  if (shared.locales.includes(locale)) shared.chains.set(locale, built);
  return built;
}

/**
 * The cached format context of a locale.
 * @internal
 */
export function ctxOf<L extends string>(shared: Shared<L>, locale: string): FormatContext {
  const known = shared.contexts.get(locale);
  if (known !== undefined) return known;
  const made: FormatContext = {
    locale,
    intl: shared.intl,
    formats: shared.options.formats ?? {},
    timeZone: shared.options.timeZone,
    report: shared.report,
  };
  shared.contexts.set(locale, made);
  return made;
}

/**
 * Resolves a user-supplied tag to a declared locale, or throws.
 * @internal
 */
export function resolveLocale<L extends string>(shared: Shared<L>, requested: string): L {
  const exact = shared.locales.find((locale) => locale === requested);
  if (exact !== undefined) return exact;
  const matched =
    typeof requested === "string" ? matchLocale(requested, shared.locales) : undefined;
  if (matched === undefined) {
    throw new I18nError(
      "UNKNOWN_LOCALE",
      __DEV__
        ? `"${String(requested)}" is not one of the supported locales (${shared.locales.join(", ")}).`
        : "I18N_LOCALE",
    );
  }
  return matched;
}

/**
 * True when the locale's own catalog is complete: present and not just `addMessages` text.
 * @internal
 */
export function hasCatalog<L extends string>(shared: Shared<L>, locale: L): boolean {
  return shared.catalogs.has(locale) && !shared.partial.has(locale);
}

/**
 * True when every locale of the chain is loaded, failed, or has nothing to load.
 * @internal
 */
export function isChainLoaded<L extends string>(shared: Shared<L>, locale: L): boolean {
  return chainOf(shared, locale).every(
    (entry) => hasCatalog(shared, entry) || shared.failed.has(entry) || !hasSource(shared, entry),
  );
}

/**
 * A locale has something to load when a loader exists and no catalog is present yet.
 * @internal
 */
export function hasSource<L extends string>(shared: Shared<L>, locale: L): boolean {
  return loaderOf(shared, locale) !== undefined;
}

/**
 * The loader of a locale, or `undefined` when it has none (own properties only).
 * @internal
 */
function loaderOf<L extends string>(shared: Shared<L>, locale: L): CatalogLoader | undefined {
  const loaders = shared.options.loaders;
  return loaders !== undefined && Object.hasOwn(loaders, locale) ? loaders[locale] : undefined;
}

/**
 * Releases the waiting boundaries unconditionally (a dispose must not leave one stuck).
 * @internal
 */
export function releaseHolders<L extends string>(shared: Shared<L>): void {
  const held = [...shared.holders];
  shared.holders.clear();
  for (const tracker of held) tracker.decrement();
}

/** Data problems that would otherwise repeat on every render. */
const REPEATING: ReadonlySet<string> = new Set([
  "MISSING_KEY",
  "SYNTAX",
  "MISSING_VALUE",
  "INVALID_VALUE",
  "MISSING_TAG_HANDLER",
  "FORMAT_FAILED",
]);

/**
 * Largest number of distinct problems remembered by the once-only filter.
 * @internal
 */
export const REPORTED_LIMIT = 500;

/**
 * True the first time a repeating problem is seen; always true for one-off problems.
 * @internal
 */
export function firstReport<L extends string>(shared: Shared<L>, error: I18nError): boolean {
  if (!REPEATING.has(error.code)) return true;
  if (shared.reported.has(error.message)) return false;
  if (shared.reported.size >= REPORTED_LIMIT) shared.reported.clear();
  shared.reported.add(error.message);
  return true;
}

/**
 * Loads one locale's catalog once; concurrent calls share the load. After dispose no loader runs
 * and the call resolves at once.
 * @internal
 */
export function loadLocale<L extends string>(shared: Shared<L>, locale: L): Promise<void> {
  if (shared.disposed || hasCatalog(shared, locale)) return Promise.resolve();
  const running = shared.loading.get(locale);
  if (running !== undefined) return running;
  const loader = loaderOf(shared, locale);
  if (loader === undefined) {
    // Declared without a catalog: it is empty until `addMessages`; lookups fall through the chain.
    shared.catalogs.set(locale, new Map());
    return Promise.resolve();
  }
  shared.inflight += 1;
  // `replaceCatalog` installs a new Map; `addMessages` writes into the one there. Comparing the Map tells them apart.
  const before = shared.catalogs.get(locale);
  let settled = false;
  const task = (async (): Promise<void> => {
    try {
      const module = await untrack(() => loader());
      const flat = flattenCatalog(catalogOf(module, locale));
      if (shared.disposed) return;
      const existing = shared.catalogs.get(locale);
      // A catalog replaced while this load was in flight is the whole truth: keys it dropped must not come back.
      if (existing !== undefined && existing !== before && !shared.partial.has(locale)) return;
      if (existing !== undefined) {
        // `addMessages` ran while loading: loaded text is the base, additions win.
        for (const [key, text] of existing) flat.set(key, text);
      }
      shared.catalogs.set(locale, flat);
      shared.partial.delete(locale);
      shared.failed.delete(locale);
      bumpLocale(shared, locale);
    } catch (error) {
      shared.failed.add(locale);
      bumpLocale(shared, locale);
      throw error instanceof I18nError
        ? error
        : new I18nError(
            "LOAD_FAILED",
            `could not load the catalog for "${locale}": ${(error as Error)?.message ?? String(error)}`,
            { cause: error },
          );
    } finally {
      settled = true;
      shared.loading.delete(locale);
      shared.inflight -= 1;
      // Once no load is in flight, every Suspense boundary that waits on a catalog goes.
      if (shared.inflight === 0) releaseHolders(shared);
    }
  })();
  // A loader that throws before its first await settles the task inside the call above, so its `finally` ran before this
  // entry existed: a rejected promise left here would answer every retry without calling the loader again.
  if (!settled) shared.loading.set(locale, task);
  return task;
}

/**
 * Loads the locale and its fallbacks; only the locale itself must succeed.
 * @internal
 */
export async function loadChain<L extends string>(shared: Shared<L>, locale: L): Promise<void> {
  const chain = chainOf(shared, locale);
  const results = await Promise.allSettled(chain.map((entry) => loadLocale(shared, entry)));
  results.forEach((result, index) => {
    // The reason of a rejected load is an I18nError (see loadLocale).
    if (result.status === "rejected" && index > 0) shared.report(result.reason);
  });
  const first = results[0];
  if (first?.status === "rejected") throw first.reason;
}

/**
 * Compiles a catalog text through the bounded cache; plain text needs no compiler.
 * @internal
 */
export function compile<L extends string>(shared: Shared<L>, text: string): Compiled {
  const hit = shared.compiled.get(text);
  if (hit !== undefined) return hit;
  let made: Compiled;
  if (isPlainText(text)) {
    made = plainMessage(text);
  } else if (shared.options.compile === undefined) {
    made = new MessageSyntaxError(
      "NO_COMPILER",
      'the text uses message syntax, but no compiler was given: pass `compile` (or use createI18nWithIcu from "@shadow-js/i18n").',
      text,
      0,
    );
  } else {
    try {
      // A user callback, and its result is cached for every reader: it must not subscribe the first one.
      const compiler = shared.options.compile;
      made = untrack(() => compiler(text));
    } catch (error) {
      if (!(error instanceof MessageSyntaxError)) throw error;
      made = error;
    }
  }
  shared.compiled.set(text, made);
  return made;
}

/**
 * A message found along the chain, and the locale that had it.
 * @internal
 */
export interface Found {
  readonly message: CompiledMessage;
  readonly locale: string;
}

/**
 * The first compilable message of `key` along the fallback chain of `locale`.
 * @internal
 */
export function lookup<L extends string>(
  shared: Shared<L>,
  key: string,
  locale: L,
): Found | undefined {
  for (const entry of chainOf(shared, locale)) {
    const text = shared.catalogs.get(entry)?.get(key);
    if (text === undefined) continue;
    const compiled = compile(shared, text);
    if (compiled instanceof MessageSyntaxError) {
      shared.report(
        new I18nError("SYNTAX", `message "${key}" (${entry}): ${compiled.message}`, {
          cause: compiled,
        }),
      );
      continue;
    }
    return { message: compiled, locale: entry };
  }
  return undefined;
}
