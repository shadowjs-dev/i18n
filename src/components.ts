import { type Accessor, type Context, createContext, untrack, useContext } from "@shadow-js/core";
import { I18nError } from "./errors";
import type { I18nBase, RelativeOptions } from "./i18n-types";
import { firstProviderOf, reporterOf } from "./internal/instances";
import { currentRequestI18n, instanceForRequest } from "./internal/request-context";
import { matchLocale } from "./locale";
import type { RegisteredI18n, RegisteredMessages } from "./register";
import { readI18nState } from "./state";
import type { MessageArgs, MessageAt, MessageKey, MessageTags, RichChunk, RichTag } from "./types";

/**
 * The context behind {@link I18nProvider}: the nearest provided instance, or `null` outside every
 * provider (it never throws). Read it with `useContext` when a component should work with or
 * without an instance; {@link useI18n} is the usual way. Provide through `I18nProvider`, which also
 * swaps in the request's instance on the server.
 *
 * @example
 * ```tsx
 * import { useContext } from "@shadow-js/core";
 * import { I18nContext } from "@shadow-js/i18n";
 *
 * export function LocaleBadge() {
 *   const i18n = useContext(I18nContext);
 *   return <span>{i18n === null ? "no locale" : i18n.locale()}</span>;
 * }
 * ```
 * @since 1.0.0
 */
export const I18nContext: Context<I18nBase | null> = createContext<I18nBase | null>(null, {
  name: "I18n",
});

/**
 * Props of {@link I18nProvider}.
 *
 * @example
 * ```tsx
 * import { createI18n, I18nProvider, type I18nProviderProps } from "@shadow-js/i18n";
 *
 * const i18n = createI18n({ defaultLocale: "en", locales: ["en"], messages: { en: { title: "Home" } } });
 *
 * export function Providers(props: Pick<I18nProviderProps, "children">) {
 *   return <I18nProvider i18n={i18n}>{props.children}</I18nProvider>;
 * }
 * ```
 * @since 1.0.0
 */
export interface I18nProviderProps {
  /**
   * The instance. Pass the app's instance (the one `createI18n` returned): in a Dusk request it
   * is replaced by the request's fork (see {@link tryGetRequestI18n}), so the same component tree
   * serves the browser and every server request. An instance you made with `fork()` is provided
   * as given.
   */
  readonly i18n: I18nBase;
  /** The subtree that sees the instance. */
  readonly children?: unknown;
}

/**
 * Compares the locale the server rendered (the state embedded in the page) with the locale the
 * outermost provider's instance starts in. They differ when the instance was created without the
 * page state (`createI18n({ state: readI18nState() })`): hydration would then render the other
 * locale's text over the server's. In development it warns; in every build it applies the state,
 * so the client renders what the server sent. A page state that is tampered with or invalid is
 * reported through the instance's `onError` and the instance keeps its defaults: rendering never
 * throws because of the page.
 */
function checkHydrationLocale(i18n: I18nBase): void {
  if (typeof Reflect.get(globalThis, "document") !== "object") return;
  if (!firstProviderOf(i18n)) return;
  const report = reporterOf(i18n);
  const state = readI18nState(undefined, { onError: report });
  if (state === undefined) return;
  const current = untrack(i18n.locale);
  if (state.locale === current) return;
  // A locale the instance does not declare is a tampered state, reported below and not a mismatch.
  if (__DEV__ && matchLocale(state.locale, i18n.locales) !== undefined) {
    console.warn(
      `[shadow-i18n] the page was rendered in "${state.locale}" but this instance starts in "${current}": hydration would replace the server's text. Re-reading the page state now; create the instance with createI18n({ state: readI18nState() }) to avoid this.`,
    );
  }
  try {
    i18n.hydrate(state);
  } catch (error) {
    // A state the instance refuses is reported, and the instance keeps its defaults.
    if (error instanceof I18nError) {
      report(error);
      return;
    }
    // Writing a signal is refused while a memo computes (a layout route renders inside one):
    // apply the snapshot right after, before the browser paints.
    queueMicrotask(() => i18n.hydrate(state));
  }
}

/**
 * Makes an instance available to the subtree: `useI18n()`, `<Trans>`, the `Formatted*`
 * components and `<LocaleSwitcher>` read it.
 *
 * In a Dusk request, with `createI18nMiddleware` installed, the instance provided is the
 * request's own fork of `i18n` (already in the locale of the URL, with its catalog loaded), so a
 * root layout is just `<I18nProvider i18n={i18n}>` in the browser and on the server, with no
 * per-request code and no import from `@shadow-js/dusk`. In the browser, the outermost provider
 * also checks that the instance starts in the locale the server rendered (see
 * {@link readI18nState}) and applies the page state when it does not.
 *
 * @param props See {@link I18nProviderProps}.
 * @returns The provided children (an accessor, as every ShadowJS component result).
 * @throws Never for the page state: an invalid one (`INVALID_STATE`, `UNKNOWN_LOCALE`) is reported
 *   through the instance's `onError`, and the instance keeps its locale.
 * @example
 * ```tsx
 * import { createI18n, I18nProvider, useI18n } from "@shadow-js/i18n";
 * import { render } from "@shadow-js/web";
 *
 * const i18n = createI18n({
 *   defaultLocale: "en",
 *   locales: ["en", "fr"],
 *   messages: { en: { title: "Welcome" }, fr: { title: "Bienvenue" } },
 * });
 *
 * function Title() {
 *   const { t } = useI18n<typeof i18n>();
 *   return <h1>{t("title")}</h1>;
 * }
 *
 * const root = document.getElementById("app");
 * if (root !== null) {
 *   render(
 *     () => (
 *       <I18nProvider i18n={i18n}>
 *         <Title />
 *       </I18nProvider>
 *     ),
 *     root,
 *   );
 * }
 * ```
 * @see {@link useI18n}
 * @since 1.0.0
 */
export function I18nProvider(props: I18nProviderProps): unknown {
  const given = props.i18n;
  const instance = instanceForRequest(given);
  if (instance === given && useContext(I18nContext) === null) checkHydrationLocale(given);
  return I18nContext({
    value: instance,
    get children(): unknown {
      return props.children;
    },
  });
}

/**
 * The instance from the nearest {@link I18nProvider}. The type is the registered instance (see
 * {@link Register}) or can be given: `useI18n<typeof i18n>()`. During a Dusk request, a component
 * with no provider above it gets the request's instance (the one `createI18nMiddleware` made).
 * Call it in a component body (or anywhere the owner has the context).
 *
 * @returns The instance.
 * @throws I18nError `INVALID_STATE` when no provider is above and there is no request instance.
 * @example
 * ```tsx
 * import { useI18n } from "@shadow-js/i18n";
 *
 * export function CartSummary(props: { count: number }) {
 *   const { t, setLocale } = useI18n();
 *   return (
 *     <p>
 *       {t("cart.items", { count: props.count })}
 *       <button type="button" onClick={() => void setLocale("fr")}>
 *         Français
 *       </button>
 *     </p>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export function useI18n<I extends I18nBase = RegisteredI18n>(): I {
  const found = useContext(I18nContext);
  if (found !== null) return found as I;
  // In a Dusk request the middleware's instance is there without a provider.
  const request = currentRequestI18n();
  if (request !== undefined) return request as I;
  throw new I18nError("INVALID_STATE", "useI18n() needs an <I18nProvider i18n={...}> above it.");
}

type TransArgs<S> = S extends string
  ? string extends S
    ? {
        readonly values?: Readonly<Record<string, unknown>>;
        readonly components?: Readonly<Record<string, RichTag>>;
      }
    : (keyof MessageArgs<S> extends never
        ? { readonly values?: undefined }
        : { readonly values: MessageArgs<S> }) &
        ([MessageTags<S>] extends [never]
          ? { readonly components?: undefined }
          : { readonly components: { readonly [T in MessageTags<S>]: RichTag } })
  : never;

/**
 * Props of {@link Trans}, typed from the registered catalog (see {@link Register}): `values` is
 * required when the message has arguments, `components` when it has tags, with one
 * {@link RichTag} per tag. Without a registered instance both are loose records.
 *
 * - `values`: the message arguments; accessors keep them reactive.
 * - `components`: one handler per tag of the message.
 *
 * @example
 * ```tsx
 * import { Trans, type TransProps } from "@shadow-js/i18n";
 *
 * // greeting: "Hello, {name}!"
 * const props: TransProps<"greeting"> = { key: "greeting", values: { name: "Ada" } };
 * export const Greeting = () => <Trans {...props} />;
 * ```
 * @since 1.0.0
 */
export type TransProps<K extends string> = {
  /** The message key (a key of the registered catalog). */
  readonly key: K;
  /** Use this instance instead of the provider's. */
  readonly i18n?: I18nBase;
} & TransArgs<MessageAt<RegisteredMessages, K>>;

/**
 * Renders a message with rich-text tags mapped to functions that build elements. The output is a
 * list of text and the handlers' results; message text is never parsed as HTML. A missing key
 * renders the key (or the `onMissing` text) and is reported as `MISSING_KEY`.
 *
 * @param props `key`, `values` and one entry in `components` for every tag of the message.
 * @returns An accessor of the parts (re-runs when the locale or an argument changes).
 * @throws I18nError `INVALID_STATE` when there is no `i18n` prop, no provider and no request instance.
 * @example
 * ```tsx
 * import { Trans } from "@shadow-js/i18n";
 *
 * // terms: "Read the <b>terms</b> and the <a>privacy policy</a>."
 * export function Terms() {
 *   return (
 *     <p>
 *       <Trans
 *         key="terms"
 *         components={{
 *           b: (chunks) => <strong>{chunks}</strong>,
 *           a: (chunks) => <a href="/privacy">{chunks}</a>,
 *         }}
 *       />
 *     </p>
 *   );
 * }
 * ```
 * @see {@link TransProps}
 * @since 1.0.0
 */
export function Trans<K extends MessageKey<RegisteredMessages>>(
  props: TransProps<K>,
): () => RichChunk[] {
  const i18n = props.i18n ?? useI18n();
  return () => {
    const merged = Object.assign(
      Object.create(null) as Record<string, unknown>,
      props.values,
      props.components,
    );
    return i18n.translateRich(props.key, merged);
  };
}

/**
 * Props of {@link FormattedNumber}.
 *
 * @example
 * ```tsx
 * import { FormattedNumber, type FormattedNumberProps } from "@shadow-js/i18n";
 *
 * const share: FormattedNumberProps = { value: 0.42, format: "percent" };
 * export const Share = () => <FormattedNumber {...share} />;
 * ```
 * @since 1.0.0
 */
export interface FormattedNumberProps {
  /** The number to format. */
  readonly value: number | bigint;
  /**
   * A name from `formats.number`, `"percent"`, `"integer"`, or `Intl.NumberFormat` options.
   * Default: the locale's plain number format.
   */
  readonly format?: string | Intl.NumberFormatOptions;
  /** Use this instance instead of the provider's. */
  readonly i18n?: I18nBase;
}

/**
 * Formats a number in the active locale, with `i18n.formatNumber`. Reactive in `value`, `format`
 * and the locale. The instance needs the `formatting` feature (`@shadow-js/i18n/format`).
 *
 * @param props See {@link FormattedNumberProps}.
 * @returns An accessor of the text.
 * @throws I18nError `INVALID_STATE` when there is no `i18n` prop, no provider and no request instance.
 * @throws TypeError, when the text is read, if the instance has no `formatting` feature.
 * @example
 * ```tsx
 * import { FormattedNumber } from "@shadow-js/i18n";
 *
 * export function Price(props: { amount: number }) {
 *   return <FormattedNumber value={props.amount} format={{ style: "currency", currency: "EUR" }} />;
 * }
 * ```
 * @since 1.0.0
 */
export function FormattedNumber(props: FormattedNumberProps): () => string {
  const i18n = props.i18n ?? useI18n();
  return () => i18n.formatNumber(props.value, props.format);
}

/**
 * Props of {@link FormattedDate}.
 *
 * @example
 * ```tsx
 * import { FormattedDate, type FormattedDateProps } from "@shadow-js/i18n";
 *
 * const launch: FormattedDateProps = { value: "2024-01-31T00:00:00Z", format: "full" };
 * export const Launch = () => <FormattedDate {...launch} />;
 * ```
 * @since 1.0.0
 */
export interface FormattedDateProps {
  /** A `Date`, epoch milliseconds or an ISO 8601 string. An invalid date is reported and shown as given. */
  readonly value: Date | number | string;
  /**
   * A name from `formats.date`, `"short"`, `"medium"`, `"long"`, `"full"` (a `dateStyle`), or
   * `Intl.DateTimeFormat` options.
   * @default `{ dateStyle: "medium" }`
   */
  readonly format?: string | Intl.DateTimeFormatOptions;
  /** Use this instance instead of the provider's. */
  readonly i18n?: I18nBase;
}

/**
 * Formats a date in the active locale and the instance time zone, with `i18n.formatDate`.
 * Reactive in `value`, `format` and the locale. The instance needs the `formatting` feature
 * (`@shadow-js/i18n/format`).
 *
 * @param props See {@link FormattedDateProps}.
 * @returns An accessor of the text.
 * @throws I18nError `INVALID_STATE` when there is no `i18n` prop, no provider and no request instance.
 * @throws TypeError, when the text is read, if the instance has no `formatting` feature.
 * @example
 * ```tsx
 * import { FormattedDate } from "@shadow-js/i18n";
 *
 * export function PostDate(props: { createdAt: Date }) {
 *   return <FormattedDate value={props.createdAt} format="long" />;
 * }
 * ```
 * @since 1.0.0
 */
export function FormattedDate(props: FormattedDateProps): () => string {
  const i18n = props.i18n ?? useI18n();
  return () => i18n.formatDate(props.value, props.format);
}

/**
 * Props of {@link FormattedRelative}: the time and the {@link RelativeOptions} (`unit`, `numeric`,
 * `style`, `now`).
 *
 * @example
 * ```tsx
 * import { FormattedRelative, type FormattedRelativeProps } from "@shadow-js/i18n";
 *
 * const props: FormattedRelativeProps = { value: Date.now() - 90_000, style: "short" };
 * export const Posted = () => <FormattedRelative {...props} />;
 * ```
 * @since 1.0.0
 */
export interface FormattedRelativeProps extends RelativeOptions {
  /** The time to describe, as a `Date` or epoch milliseconds. */
  readonly value: Date | number;
  /** Use this instance instead of the provider's. */
  readonly i18n?: I18nBase;
}

/**
 * Formats a time relative to now ("3 hours ago"), with `i18n.formatRelative`. It does not tick by
 * itself: pass a `now` that changes (for example from a signal you update on an interval) to
 * refresh it. The instance needs the `formatting` feature (`@shadow-js/i18n/format`).
 *
 * @param props See {@link FormattedRelativeProps}.
 * @returns An accessor of the text.
 * @throws I18nError `INVALID_STATE` when there is no `i18n` prop, no provider and no request instance.
 * @throws TypeError, when the text is read, if the instance has no `formatting` feature.
 * @example
 * ```tsx
 * import { onCleanup, useSignal } from "@shadow-js/core";
 * import { FormattedRelative } from "@shadow-js/i18n";
 *
 * export function CommentTime(props: { postedAt: Date }) {
 *   const [now, setNow] = useSignal(Date.now());
 *   const timer = setInterval(() => setNow(Date.now()), 60_000);
 *   onCleanup(() => clearInterval(timer));
 *   return <FormattedRelative value={props.postedAt} now={now()} numeric="always" />;
 * }
 * ```
 * @since 1.0.0
 */
export function FormattedRelative(props: FormattedRelativeProps): () => string {
  const i18n = props.i18n ?? useI18n();
  return () =>
    i18n.formatRelative(props.value, {
      ...(props.unit === undefined ? {} : { unit: props.unit }),
      ...(props.numeric === undefined ? {} : { numeric: props.numeric }),
      ...(props.style === undefined ? {} : { style: props.style }),
      ...(props.now === undefined ? {} : { now: props.now }),
    });
}

/**
 * Props of {@link FormattedList}.
 *
 * @example
 * ```tsx
 * import { FormattedList, type FormattedListProps } from "@shadow-js/i18n";
 *
 * const props: FormattedListProps = { value: ["tea", "coffee"], format: { type: "disjunction" } };
 * export const Drinks = () => <FormattedList {...props} />;
 * ```
 * @since 1.0.0
 */
export interface FormattedListProps {
  /** The items, already formatted as text. */
  readonly value: Iterable<string>;
  /**
   * A name from `formats.list` or `Intl.ListFormat` options. Default: the locale's conjunction
   * ("a, b, and c").
   */
  readonly format?: string | Intl.ListFormatOptions;
  /** Use this instance instead of the provider's. */
  readonly i18n?: I18nBase;
}

/**
 * Formats a list in the active locale ("a, b, and c"), with `i18n.formatList`. Reactive in
 * `value`, `format` and the locale. The instance needs the `formatting` feature
 * (`@shadow-js/i18n/format`).
 *
 * @param props See {@link FormattedListProps}.
 * @returns An accessor of the text.
 * @throws I18nError `INVALID_STATE` when there is no `i18n` prop, no provider and no request instance.
 * @throws TypeError, when the text is read, if the instance has no `formatting` feature.
 * @example
 * ```tsx
 * import { FormattedList } from "@shadow-js/i18n";
 *
 * export function Authors(props: { names: string[] }) {
 *   return <FormattedList value={props.names} />;
 * }
 * ```
 * @since 1.0.0
 */
export function FormattedList(props: FormattedListProps): () => string {
  const i18n = props.i18n ?? useI18n();
  return () => i18n.formatList(props.value, props.format);
}

/**
 * One entry of a locale picker, from {@link createLocaleSwitcher}.
 *
 * @example
 * ```tsx
 * import type { LocaleOption } from "@shadow-js/i18n";
 *
 * export function OptionLabel(props: { option: LocaleOption }) {
 *   return (
 *     <span lang={props.option.value} dir={props.option.dir}>
 *       {props.option.label}
 *     </span>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export interface LocaleOption<L extends string = string> {
  /** The locale, as declared in `locales`. */
  readonly value: L;
  /** The language's own name ("Français"), from `Intl.DisplayNames`; the tag when it has none. */
  readonly label: string;
  /** The locale's text direction, for the `dir` attribute of the label. */
  readonly dir: "ltr" | "rtl";
}

/**
 * What {@link createLocaleSwitcher} gives a picker UI.
 *
 * @example
 * ```tsx
 * import { createI18n, createLocaleSwitcher, type LocaleSwitcherApi } from "@shadow-js/i18n";
 * import { localeRouting } from "@shadow-js/i18n/routing";
 * import { For } from "@shadow-js/web";
 *
 * const i18n = createI18n({ defaultLocale: "en", locales: ["en", "fr"], features: [localeRouting] });
 *
 * function LinkSwitcher(props: { api: LocaleSwitcherApi<"en" | "fr">; path: string }) {
 *   return (
 *     <nav aria-busy={props.api.pending() !== undefined}>
 *       <For each={props.api.options}>
 *         {(option) => (
 *           <a href={props.api.href(option.value, props.path)} aria-current={props.api.isActive(option.value)}>
 *             {option.label}
 *           </a>
 *         )}
 *       </For>
 *     </nav>
 *   );
 * }
 *
 * export const Switcher = () => <LinkSwitcher api={createLocaleSwitcher(i18n)} path="/about" />;
 * ```
 * @since 1.0.0
 */
export interface LocaleSwitcherApi<L extends string = string> {
  /** Reactive: the active locale. */
  readonly locale: Accessor<L>;
  /** Reactive: the locale being loaded, or `undefined`. */
  readonly pending: Accessor<L | undefined>;
  /** One entry per locale, in the order of `locales`; computed once. */
  readonly options: readonly LocaleOption<L>[];
  /** Reactive: true when `locale` is the active locale. */
  isActive(locale: L): boolean;
  /**
   * Switches locale with `i18n.setLocale`, then calls `onSelect`; resolves with the locale that
   * ends up active.
   */
  select(locale: L): Promise<L>;
  /**
   * Handler for `<select onChange>` / radio inputs: reads `event.currentTarget.value`, ignores
   * values that are not one of the locales exactly, and calls `select` with the others.
   */
  onChange(event: { readonly currentTarget: { readonly value: string } }): void;
  /**
   * The URL of `path` in `locale` (`i18n.localePath`), for link based switchers. Needs the
   * `localeRouting` feature; without it, calling it throws a `TypeError` that names the feature.
   */
  href(locale: L, path: string): string;
}

/**
 * Options of {@link createLocaleSwitcher}.
 *
 * @example
 * ```ts
 * import { createI18n, createLocaleSwitcher, type LocaleSwitcherOptions } from "@shadow-js/i18n";
 * import { localeRouting } from "@shadow-js/i18n/routing";
 *
 * const i18n = createI18n({
 *   defaultLocale: "en",
 *   locales: ["en", "fr"],
 *   prefix: "always",
 *   features: [localeRouting],
 * });
 * const options: LocaleSwitcherOptions = {
 *   onSelect: (locale) => history.pushState(null, "", i18n.localePath(location.pathname, locale as "en" | "fr")),
 * };
 * export const switcher = createLocaleSwitcher(i18n, options);
 * ```
 * @since 1.0.0
 */
export interface LocaleSwitcherOptions {
  /**
   * Called after `select` settled, with the locale that ended up active (the previous one when the
   * load failed), for example to navigate to `href`.
   */
  readonly onSelect?: (locale: string) => void;
}

/**
 * Headless state for a language picker: the options with native names, the active and pending
 * locale, and `select`. Styling and markup are yours.
 *
 * @param i18n The instance.
 * @param options Callbacks.
 * @returns The picker API.
 * @example
 * ```tsx
 * import { createI18n, createLocaleSwitcher } from "@shadow-js/i18n";
 * import { For } from "@shadow-js/web";
 *
 * const i18n = createI18n({ defaultLocale: "en", locales: ["en", "fr", "ar"] });
 *
 * export function LanguagePicker() {
 *   const switcher = createLocaleSwitcher(i18n);
 *   return (
 *     <select value={switcher.locale()} onChange={switcher.onChange}>
 *       <For each={switcher.options}>{(option) => <option value={option.value}>{option.label}</option>}</For>
 *     </select>
 *   );
 * }
 * ```
 * @see {@link LocaleSwitcher}
 * @since 1.0.0
 */
export function createLocaleSwitcher<L extends string>(
  i18n: I18nBase<L>,
  options: LocaleSwitcherOptions = {},
): LocaleSwitcherApi<L> {
  const list: LocaleOption<L>[] = i18n.locales.map((value) => {
    let label: string = value;
    try {
      label = new Intl.DisplayNames([value], { type: "language" }).of(value) ?? value;
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
    return { value, label, dir: untrack(() => i18n.dir(value)) };
  });
  const known = new Set<string>(i18n.locales);
  const select = async (locale: L): Promise<L> => {
    const result = await i18n.setLocale(locale);
    options.onSelect?.(result);
    return result;
  };
  return {
    locale: i18n.locale,
    pending: i18n.pending,
    options: list,
    isActive: (locale) => i18n.locale() === locale,
    select,
    onChange(event) {
      const value = event.currentTarget.value;
      if (known.has(value)) void select(value as L);
    },
    href: (locale, path) => i18n.localePath(path, locale),
  };
}

/**
 * Props of {@link LocaleSwitcher}: the {@link LocaleSwitcherOptions} plus the render prop.
 *
 * @example
 * ```tsx
 * import { LocaleSwitcher, type LocaleSwitcherProps } from "@shadow-js/i18n";
 *
 * const props: LocaleSwitcherProps = {
 *   onSelect: (locale) => console.log("switched to", locale),
 *   children: (api) => <span>{api.locale()}</span>,
 * };
 * export const CurrentLocale = () => <LocaleSwitcher {...props} />;
 * ```
 * @since 1.0.0
 */
export interface LocaleSwitcherProps extends LocaleSwitcherOptions {
  /** Use this instance instead of the provider's. */
  readonly i18n?: I18nBase;
  /** Render prop that receives the picker API. */
  readonly children: (api: LocaleSwitcherApi) => unknown;
}

/**
 * Headless component form of {@link createLocaleSwitcher}: calls `children` once with the API
 * (outside reactive tracking; the API's accessors stay reactive in your markup).
 *
 * @param props `children` is a function from the API to your markup.
 * @returns Whatever `children` returns.
 * @throws I18nError `INVALID_STATE` when there is no `i18n` prop, no provider and no request instance.
 * @example
 * ```tsx
 * import { LocaleSwitcher } from "@shadow-js/i18n";
 *
 * export function FrenchButton() {
 *   return (
 *     <LocaleSwitcher>
 *       {(api) => (
 *         <button type="button" disabled={api.isActive("fr")} onClick={() => void api.select("fr")}>
 *           Français
 *         </button>
 *       )}
 *     </LocaleSwitcher>
 *   );
 * }
 * ```
 * @since 1.0.0
 */
export function LocaleSwitcher(props: LocaleSwitcherProps): unknown {
  const i18n = props.i18n ?? useI18n();
  const api = createLocaleSwitcher(
    i18n,
    props.onSelect === undefined ? {} : { onSelect: props.onSelect },
  );
  return untrack(() => props.children(api));
}
