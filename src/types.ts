/**
 * Type-level support: message keys from the catalog's object type, and call arguments inferred
 * from the ICU text of each message. Everything here is erased at runtime.
 *
 * The parser below mirrors `parseMessage` for the argument-bearing syntax: `{name}`,
 * `{n, number|date|time[, style]}`, `{n, plural|selectordinal, ...}`, `{x, select, ...}`, quoting
 * with apostrophes and `<tag>` pairs. Messages whose type is plain `string` (a catalog that was
 * not declared `as const`, or JSON imported without literal types) fall back to loose arguments.
 * @packageDocumentation
 */

/**
 * A catalog: nested objects whose leaves are message texts (plain text, or ICU syntax when the
 * instance has a compiler). Nested keys are addressed with dots: `cart.items`. At run time a
 * catalog is checked by {@link flattenCatalog}.
 *
 * @example
 * ```ts
 * import type { Messages } from "@shadow-js/i18n";
 *
 * export const fr = {
 *   title: "Bienvenue",
 *   cart: { items: "{count, plural, one {# article} other {# articles}}" },
 * } satisfies Messages;
 * ```
 * @since 1.0.0
 */
export type Messages = { readonly [key: string]: string | Messages };

/**
 * What a rich-text tag handler may return and what `t.rich` produces: the same shape as the
 * renderer's children (DOM nodes, text, numbers, booleans, `null`/`undefined`, accessors and nested
 * arrays), so the result can be placed in JSX as it is. Strings are text, never markup.
 *
 * @example
 * ```tsx
 * import { createI18nWithIcu, type RichChunk } from "@shadow-js/i18n";
 *
 * const i18n = createI18nWithIcu({
 *   defaultLocale: "en",
 *   locales: ["en"],
 *   messages: { en: { notice: "Press <key>Esc</key> to close." } },
 * });
 *
 * const chunks: RichChunk[] = i18n.t.rich("notice", { key: (c) => <kbd>{c}</kbd> });
 * export const Notice = () => <p>{chunks}</p>;
 * ```
 * @since 1.0.0
 */
export type RichChunk =
  | Node
  | string
  | number
  | boolean
  | null
  | undefined
  | (() => RichChunk)
  | readonly RichChunk[];

/**
 * Handler of one `<tag>` of a rich message: receives the formatted children of the tag and returns
 * what replaces it (usually an element). A self-closing `<tag/>` receives an empty list.
 *
 * @example
 * ```tsx
 * import type { RichTag } from "@shadow-js/i18n";
 *
 * export const bold: RichTag = (chunks) => <strong>{chunks}</strong>;
 * export const link: RichTag = (chunks) => <a href="/privacy">{chunks}</a>;
 * ```
 * @since 1.0.0
 */
export type RichTag = (chunks: readonly RichChunk[]) => RichChunk;

/**
 * A value or an accessor that returns it. Message arguments accept either: an accessor is called
 * while the message renders, so a signal read inside it keeps the text reactive.
 *
 * @example
 * ```ts
 * import { useSignal } from "@shadow-js/core";
 * import type { MaybeAccessor } from "@shadow-js/i18n";
 *
 * const [count] = useSignal(3);
 * export const fixed: MaybeAccessor<number> = 3;
 * export const live: MaybeAccessor<number> = count;
 * ```
 * @since 1.0.0
 */
export type MaybeAccessor<T> = T | (() => T);

// ---------------------------------------------------------------------------------------------
// Keys

/**
 * Every dotted path to a message in `M`: `{ a: { b: "x" } }` gives `"a.b"`. A catalog typed with
 * an index signature (such as `Messages`) gives `string`. `t` and `<Trans>` accept these keys.
 *
 * @example
 * ```ts
 * import type { MessageKey } from "@shadow-js/i18n";
 *
 * const en = { title: "Home", cart: { items: "Items", empty: "Empty" } } as const;
 * export type Key = MessageKey<typeof en>; // "title" | "cart.items" | "cart.empty"
 * export const key: Key = "cart.empty";
 * ```
 * @since 1.0.0
 */
export type MessageKey<M> = M extends string
  ? never
  : string extends keyof M
    ? string
    : {
        [K in keyof M & string]: M[K] extends string ? K : `${K}.${MessageKey<M[K]>}`;
      }[keyof M & string];

/**
 * Dotted paths to the nested objects of `M`: the namespaces `i18n.scoped` accepts. A catalog typed
 * with an index signature gives `string`.
 *
 * @example
 * ```ts
 * import type { NamespaceKey } from "@shadow-js/i18n";
 *
 * const en = { title: "Home", cart: { items: "Items", errors: { empty: "Empty" } } } as const;
 * export type Namespace = NamespaceKey<typeof en>; // "cart" | "cart.errors"
 * export const namespace: Namespace = "cart.errors";
 * ```
 * @since 1.0.0
 */
export type NamespaceKey<M> = M extends string
  ? never
  : string extends keyof M
    ? string
    : {
        [K in keyof M & string]: M[K] extends string ? never : K | `${K}.${NamespaceKey<M[K]>}`;
      }[keyof M & string];

/**
 * The type found at a dotted path of `M`: a message text type for a message key, a nested
 * object type for a namespace, `never` for a path `M` does not have.
 *
 * @example
 * ```ts
 * import type { MessageAt } from "@shadow-js/i18n";
 *
 * const en = { cart: { items: "{count, number} items" } } as const;
 * export type Items = MessageAt<typeof en, "cart.items">; // "{count, number} items"
 * ```
 * @since 1.0.0
 */
export type MessageAt<M, K extends string> = K extends keyof M
  ? M[K]
  : K extends `${infer Head}.${infer Rest}`
    ? Head extends keyof M
      ? MessageAt<M[Head], Rest>
      : never
    : never;

// ---------------------------------------------------------------------------------------------
// Argument inference

type Space = " " | "\n" | "\t" | "\r";
type Trim<S extends string> = S extends `${Space}${infer R}`
  ? Trim<R>
  : S extends `${infer R}${Space}`
    ? Trim<R>
    : S;

/** The text after the closing quote of a quoted section; `''` inside the quote is an apostrophe. */
type SkipQuoted<S extends string> = S extends `${string}'${infer R}`
  ? R extends `'${infer R2}`
    ? SkipQuoted<R2>
    : R
  : "";

/** Removes ICU quoted text and escaped apostrophes, so braces and tags in it are not arguments. */
type StripQuotes<S extends string> = S extends `${infer A}'${infer B}`
  ? B extends `'${infer C}`
    ? `${A}${StripQuotes<C>}`
    : B extends `${"{" | "}" | "<" | ">" | "#"}${string}`
      ? `${A}${StripQuotes<SkipQuoted<B>>}`
      : `${A}'${StripQuotes<B>}`
  : S;

/** Splits `Rest` (the text after a case's `{`) at the matching `}`: `[inner, after]`. */
type Balanced<
  S extends string,
  Depth extends readonly unknown[] = [],
  Acc extends string = "",
> = S extends `${infer A}}${infer B}`
  ? A extends `${infer A1}{${infer A2}`
    ? Balanced<`${A2}}${B}`, [...Depth, 0], `${Acc}${A1}{`>
    : Depth extends readonly [unknown, ...infer Up]
      ? Balanced<B, Up, `${Acc}${A}}`>
      : [`${Acc}${A}`, B]
  : never;

type Textual = string | number | bigint | boolean;
type Numeric = number | bigint;
type Temporal = Date | number;

type TypeFor<Kind extends string, Keys extends string> = Kind extends
  | "number"
  | "plural"
  | "selectordinal"
  ? Numeric
  : Kind extends "date" | "time"
    ? Temporal
    : Kind extends "select"
      ? Keys | (string & Record<never, never>)
      : Textual;

/** Collects the cases of a plural/select; `Body` starts after the type's comma. */
type Cases<
  Name extends string,
  Kind extends string,
  Body extends string,
  Acc,
  Keys extends string,
> = Body extends `${infer Selector}{${infer R}`
  ? Selector extends `${string}}${string}`
    ? FinishCases<Name, Kind, Body, Acc, Keys>
    : Balanced<R> extends [infer Inner extends string, infer After extends string]
      ? Cases<Name, Kind, After, Acc & ParseArgs<Inner>, Keys | Trim<Selector>>
      : Acc
  : FinishCases<Name, Kind, Body, Acc, Keys>;

type FinishCases<
  Name extends string,
  Kind extends string,
  Body extends string,
  Acc,
  Keys extends string,
> = Body extends `${string}}${infer After}`
  ? ParseArgs<After, Acc & { [P in Name]: TypeFor<Kind, Keys> }>
  : Acc;

/** An argument with a type but no style: `{n, number}`; `Tail` starts after the first comma. */
type Typed<Name extends string, Tail extends string, Acc> = Tail extends `${infer T}}${infer After}`
  ? T extends `${string},${string}`
    ? TypedBody<Name, Tail, Acc>
    : ParseArgs<After, Acc & { [P in Name]: TypeFor<Trim<T>, never> }>
  : Acc;

type TypedBody<
  Name extends string,
  Tail extends string,
  Acc,
> = Tail extends `${infer T},${infer Body}`
  ? Trim<T> extends "plural" | "selectordinal" | "select"
    ? Cases<Name, Trim<T>, Body, Acc, never>
    : Body extends `${string}}${infer After}`
      ? ParseArgs<After, Acc & { [P in Name]: TypeFor<Trim<T>, never> }>
      : Acc
  : Acc;

type ParseArg<Rest extends string, Acc> = Rest extends `${infer Name},${infer Tail}`
  ? Name extends `${string}}${string}`
    ? Simple<Rest, Acc>
    : Typed<Trim<Name>, Tail, Acc>
  : Simple<Rest, Acc>;

type Simple<Rest extends string, Acc> = Rest extends `${infer Name}}${infer After}`
  ? ParseArgs<After, Acc & { [P in Trim<Name>]: Textual }>
  : Acc;

type ParseArgs<S extends string, Acc = unknown> = S extends `${string}{${infer Rest}`
  ? ParseArg<Rest, Acc>
  : Acc;

type TagChar =
  | "a"
  | "b"
  | "c"
  | "d"
  | "e"
  | "f"
  | "g"
  | "h"
  | "i"
  | "j"
  | "k"
  | "l"
  | "m"
  | "n"
  | "o"
  | "p"
  | "q"
  | "r"
  | "s"
  | "t"
  | "u"
  | "v"
  | "w"
  | "x"
  | "y"
  | "z"
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H"
  | "I"
  | "J"
  | "K"
  | "L"
  | "M"
  | "N"
  | "O"
  | "P"
  | "Q"
  | "R"
  | "S"
  | "T"
  | "U"
  | "V"
  | "W"
  | "X"
  | "Y"
  | "Z";
type TagTail = TagChar | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "-" | "_";

type TailOk<S extends string> = S extends ""
  ? true
  : S extends `${TagTail}${infer R}`
    ? TailOk<R>
    : false;
type IsTagName<S extends string> = S extends `${TagChar}${infer R}` ? TailOk<R> : false;

/** Names of `<tag>` / `<tag/>` occurrences (closing tags add nothing). */
type TagNames<S extends string, Acc extends string = never> = S extends `${string}<${infer R}`
  ? R extends `${infer N}>${infer After}`
    ? N extends `/${string}`
      ? TagNames<After, Acc>
      : N extends `${infer Self}/`
        ? IsTagName<Self> extends true
          ? TagNames<After, Acc | Self>
          : TagNames<R, Acc>
        : IsTagName<N> extends true
          ? TagNames<After, Acc | N>
          : TagNames<R, Acc>
    : Acc
  : Acc;

type Lift<A> = { [K in keyof A]: MaybeAccessor<A[K]> };

/**
 * Arguments of a message, inferred from its ICU text, as an object type keyed by argument name.
 * `number`, `plural` and `selectordinal` arguments take `number | bigint`; `date` and `time` take
 * `Date | number`; a `select` takes its case names (or any string); a plain `{name}` takes a
 * string, number, bigint or boolean. Every argument may also be an accessor
 * ({@link MaybeAccessor}). A text typed as plain `string` gives a loose record.
 *
 * @example
 * ```ts
 * import type { MessageArgs } from "@shadow-js/i18n";
 *
 * type Args = MessageArgs<"{name} has {count, plural, one {# item} other {# items}}">;
 * export const args: Args = { name: "Ada", count: () => 2 };
 * ```
 * @since 1.0.0
 */
export type MessageArgs<S extends string> = string extends S
  ? Readonly<Record<string, unknown>>
  : Lift<ParseArgs<StripQuotes<S>>>;

/**
 * Names of the rich-text tags of a message (`<b>...</b>` and `<br/>` give `"b" | "br"`). Quoted
 * text is skipped. A text typed as plain `string` gives `string`.
 *
 * @example
 * ```ts
 * import type { MessageTags } from "@shadow-js/i18n";
 *
 * export type Tags = MessageTags<"Read the <b>terms</b> and <a>policy</a>">; // "b" | "a"
 * export const tag: Tags = "a";
 * ```
 * @since 1.0.0
 */
export type MessageTags<S extends string> = string extends S ? string : TagNames<StripQuotes<S>>;

type NoValues = Readonly<Record<string, never>>;

/**
 * The trailing parameter of `t(key, ...)`, as a tuple: required when the message has arguments,
 * optional (and empty) otherwise, loose for a widened `string` message.
 *
 * @example
 * ```ts
 * import type { ValuesParam } from "@shadow-js/i18n";
 *
 * export const withArgs: ValuesParam<"Hello, {name}!"> = [{ name: "Ada" }];
 * export const withoutArgs: ValuesParam<"Hello!"> = [];
 * ```
 * @since 1.0.0
 */
export type ValuesParam<S> = S extends string
  ? string extends S
    ? [values?: Readonly<Record<string, unknown>>]
    : keyof MessageArgs<S> extends never
      ? [values?: NoValues]
      : [values: MessageArgs<S>]
  : [values?: Readonly<Record<string, unknown>>];

/**
 * The trailing parameter of `t.rich(key, ...)`, as a tuple: the message arguments plus one
 * {@link RichTag} per tag, required when the message has either; loose for a widened `string`
 * message.
 *
 * @example
 * ```tsx
 * import type { RichParam } from "@shadow-js/i18n";
 *
 * export const params: RichParam<"Hi {name}, <b>welcome</b>"> = [
 *   { name: "Ada", b: (chunks) => <strong>{chunks}</strong> },
 * ];
 * ```
 * @since 1.0.0
 */
export type RichParam<S> = S extends string
  ? string extends S
    ? [values?: Readonly<Record<string, unknown>>]
    : [keyof MessageArgs<S> | MessageTags<S>] extends [never]
      ? [values?: NoValues]
      : [values: MessageArgs<S> & { readonly [T in MessageTags<S>]: RichTag }]
  : [values?: Readonly<Record<string, unknown>>];

/**
 * A translate function typed from the catalog `M`: `i18n.t`, and what `i18n.scoped` returns. Each
 * call reads the active locale, so inside JSX or an effect it reruns when the locale or the catalog
 * changes.
 *
 * @example
 * ```ts
 * import { createI18nWithIcu, type Translator } from "@shadow-js/i18n";
 *
 * const en = { cart: { items: "{count, plural, one {# item} other {# items}}" } } as const;
 * const i18n = createI18nWithIcu({ defaultLocale: "en", locales: ["en"], messages: { en } });
 *
 * const t: Translator<typeof en> = i18n.t;
 * console.log(t("cart.items", { count: 2 })); // "2 items"
 * console.log(t.has("cart.total")); // false
 * ```
 * @since 1.0.0
 */
export interface Translator<M> {
  /**
   * Translates `key` to text; tags in the message are dropped, their text kept. The key is looked
   * up along the fallback chain. When no locale has it, a `MISSING_KEY` error is reported and the
   * result is the `onMissing` text (default: the key). While the active locale's catalogs are still
   * loading the result is `""`.
   */
  <K extends MessageKey<M>>(key: K, ...values: ValuesParam<MessageAt<M, K>>): string;
  /**
   * Translates `key` to a list of strings and tag-handler results, for JSX. Strings are text, never
   * markup. A missing key gives `[key]` (or the `onMissing` text); a catalog still loading gives `[]`.
   */
  rich<K extends MessageKey<M>>(key: K, ...values: RichParam<MessageAt<M, K>>): RichChunk[];
  /**
   * True when `key` exists in the active locale or its fallback chain (a message that fails to
   * compile does not count). Untyped, so it can test dynamic keys; reactive like the call.
   */
  has(key: string): boolean;
}

/**
 * `M` with every message value widened to `string` and `readonly` removed: the type of a JSON
 * catalog. Use it to type the other locales' catalogs from the default one, so they must have the
 * same keys without repeating its literal texts.
 *
 * @example
 * ```ts
 * import type { WidenMessages } from "@shadow-js/i18n";
 *
 * const en = { title: "Home", cart: { items: "{count, number} items" } } as const;
 * export const fr: WidenMessages<typeof en> = {
 *   title: "Accueil",
 *   cart: { items: "{count, number} articles" },
 * };
 * ```
 * @since 1.0.0
 */
export type WidenMessages<M> = M extends string
  ? string
  : { -readonly [K in keyof M]: WidenMessages<M[K]> };
