/**
 * The syntax tree {@link parseMessage} produces and {@link printMessage}, {@link formatToString} and
 * {@link formatToParts} read. Every node is a plain, readonly object tagged by `kind`.
 * @packageDocumentation
 */
import type { DateSkeleton } from "./date-skeleton";
import type { NumberSkeleton } from "./number-skeleton";

/**
 * Literal text of a message, with ICU quoting already removed (`It''s` is stored as `It's`). The
 * parser merges adjacent text, so a text node is never empty and never follows another text node.
 *
 * @example
 * ```ts
 * import { parseMessage, type TextNode } from "@shadow-js/i18n/icu";
 *
 * const [node] = parseMessage("It''s '{'literal'}'");
 * if (node?.kind === "text") {
 *   const text: TextNode = node;
 *   console.log(text.value); // "It's {literal}"
 * }
 * ```
 * @see {@link MessageNode}
 * @since 1.0.0
 */
export interface TextNode {
  /** Discriminant: always `"text"`. */
  readonly kind: "text";
  /** The unescaped text, printed as it is. */
  readonly value: string;
}

/**
 * A simple argument, `{name}`: the value is inserted as text. Strings print as they are; numbers,
 * bigints and booleans print through `String()` (not locale formatted); a `Date` prints with the
 * medium date style.
 *
 * @example
 * ```ts
 * import { type ArgumentNode, parseMessage } from "@shadow-js/i18n/icu";
 *
 * const [node] = parseMessage("{user}");
 * if (node?.kind === "argument") {
 *   const argument: ArgumentNode = node;
 *   console.log(argument.name); // "user"
 * }
 * ```
 * @see {@link MessageNode}
 * @since 1.0.0
 */
export interface ArgumentNode {
  /** Discriminant: always `"argument"`. */
  readonly kind: "argument";
  /**
   * The argument name: the text after `{` up to white space or one of `{ } , ' < > #`. It is looked
   * up as an own property of the values object.
   */
  readonly name: string;
}

/**
 * A number argument: `{n, number}`, `{n, number, percent}` (a named style) or
 * `{n, number, ::currency/EUR .00}` (a skeleton). It is formatted with `Intl.NumberFormat` for the
 * locale.
 *
 * @example
 * ```ts
 * import { type NumberNode, parseMessage } from "@shadow-js/i18n/icu";
 *
 * const [node] = parseMessage("{price, number, ::currency/EUR .00}");
 * if (node?.kind === "number") {
 *   const number: NumberNode = node;
 *   console.log(number.style); // "::currency/EUR .00"
 *   console.log(number.skeleton?.options.currency); // "EUR"
 * }
 * ```
 * @see {@link parseNumberSkeleton}
 * @since 1.0.0
 */
export interface NumberNode {
  /** Discriminant: always `"number"`. */
  readonly kind: "number";
  /** The argument name. */
  readonly name: string;
  /**
   * The trimmed text after the second comma, unquoted like message text (`'}'` is a brace, `''` an apostrophe, so a
   * style may hold a brace written in quotes): a named style (`integer`, `percent`, or a key of the
   * `number` formats) or a `::` skeleton. `undefined` when the argument has no style, which formats
   * with the locale's default number format.
   */
  readonly style: string | undefined;
  /**
   * The parsed skeleton when `style` starts with `::`; `undefined` otherwise. When it is set, the
   * formatter uses it instead of looking `style` up.
   */
  readonly skeleton: NumberSkeleton | undefined;
}

/**
 * A date or time argument: `{d, date}`, `{d, date, short}`, `{d, time, ::Hm}`. The value may be a
 * `Date`, epoch milliseconds or a string `new Date()` accepts; it is formatted with
 * `Intl.DateTimeFormat`.
 *
 * @example
 * ```ts
 * import { type DateTimeNode, parseMessage } from "@shadow-js/i18n/icu";
 *
 * const [node] = parseMessage("{at, time, ::Hm}");
 * if (node?.kind === "date" || node?.kind === "time") {
 *   const dateTime: DateTimeNode = node;
 *   console.log(dateTime.kind); // "time"
 *   console.log(dateTime.skeleton?.options.hourCycle); // "h23"
 * }
 * ```
 * @see {@link parseDateSkeleton}
 * @since 1.0.0
 */
export interface DateTimeNode {
  /** `"date"` for `{d, date}` and `"time"` for `{d, time}`. */
  readonly kind: "date" | "time";
  /** The argument name. */
  readonly name: string;
  /**
   * The trimmed text after the second comma: `short`, `medium`, `long`, `full`, a key of the `date`
   * or `time` formats, or a `::` skeleton. `undefined` when the argument has no style, which
   * formats with the `medium` date or time style.
   */
  readonly style: string | undefined;
  /** The parsed skeleton when `style` starts with `::`; `undefined` otherwise. */
  readonly skeleton: DateSkeleton | undefined;
}

/**
 * One `selector {body}` clause of a plural, selectordinal or select argument.
 *
 * @example
 * ```ts
 * import { type MessageCase, parseMessage } from "@shadow-js/i18n/icu";
 *
 * const [node] = parseMessage("{n, plural, =0 {none} one {# item} other {# items}}");
 * if (node?.kind === "plural") {
 *   const cases: readonly MessageCase[] = node.cases;
 *   console.log(cases.map((entry) => entry.selector)); // ["=0", "one", "other"]
 * }
 * ```
 * @see {@link PluralNode}
 * @see {@link SelectNode}
 * @since 1.0.0
 */
export interface MessageCase {
  /**
   * The selector as written. In a plural or selectordinal it is `zero`, `one`, `two`, `few`,
   * `many`, `other` or `=N` (an exact value: an optional `-`, then digits with at most one inner `.`, up to 15
   * characters). In a select it is any word without white space or braces.
   */
  readonly selector: string;
  /** The nodes rendered when this clause is chosen. */
  readonly body: readonly MessageNode[];
}

/**
 * A plural argument, `{n, plural, ...}`, or an ordinal one, `{n, selectordinal, ...}`. The formatter
 * first looks for an exact `=N` clause equal to the value, then for the clause of the value's CLDR
 * category (from `Intl.PluralRules` of the locale, applied to the value minus `offset`), then uses
 * `other`.
 *
 * @example
 * ```ts
 * import { type PluralNode, parseMessage } from "@shadow-js/i18n/icu";
 *
 * const [node] = parseMessage(
 *   "{guests, plural, offset:1 =0 {nobody} one {you and # other} other {you and # others}}",
 * );
 * if (node?.kind === "plural") {
 *   const plural: PluralNode = node;
 *   console.log(plural.ordinal, plural.offset); // false 1
 * }
 * ```
 * @see {@link PoundNode}
 * @since 1.0.0
 */
export interface PluralNode {
  /** Discriminant: `"plural"` for both `plural` and `selectordinal`. */
  readonly kind: "plural";
  /** The argument name. Its value must be a finite number (or a numeric string or bigint). */
  readonly name: string;
  /** `true` for `selectordinal` (ordinal rules: 1st, 2nd), `false` for `plural` (cardinal rules). */
  readonly ordinal: boolean;
  /**
   * The `offset:N` value, `0` when there is none: a whole number of at most nine digits. It is
   * subtracted from the value before the category is chosen and before `#` is printed; `=N` clauses
   * compare against the value before the subtraction.
   */
  readonly offset: number;
  /** The clauses in source order. There is always an `other` clause and no selector repeats. */
  readonly cases: readonly MessageCase[];
}

/**
 * A select argument, `{x, select, ...}`: the clause whose selector equals `String(value)` is
 * rendered, and `other` when none does or the value is `null` or `undefined`.
 *
 * @example
 * ```ts
 * import { parseMessage, type SelectNode } from "@shadow-js/i18n/icu";
 *
 * const [node] = parseMessage("{role, select, admin {Admin} other {Member}}");
 * if (node?.kind === "select") {
 *   const select: SelectNode = node;
 *   console.log(select.name, select.cases.length); // "role" 2
 * }
 * ```
 * @see {@link MessageCase}
 * @since 1.0.0
 */
export interface SelectNode {
  /** Discriminant: always `"select"`. */
  readonly kind: "select";
  /** The argument name. */
  readonly name: string;
  /** The clauses in source order. There is always an `other` clause and no selector repeats. */
  readonly cases: readonly MessageCase[];
}

/**
 * `#` inside a plural or selectordinal clause (including a select nested in one): it prints the
 * plural value minus the offset, formatted with the locale's default number format. Outside a plural
 * `#` is literal text and no pound node is produced.
 *
 * @example
 * ```ts
 * import { parseMessage, type PoundNode } from "@shadow-js/i18n/icu";
 *
 * const [node] = parseMessage("{n, plural, other {# items}}");
 * if (node?.kind === "plural") {
 *   const first = node.cases[0]?.body[0];
 *   if (first?.kind === "pound") {
 *     const pound: PoundNode = first;
 *     console.log(pound.kind); // "pound"
 *   }
 * }
 * ```
 * @see {@link PluralNode}
 * @since 1.0.0
 */
export interface PoundNode {
  /** Discriminant: always `"pound"`. */
  readonly kind: "pound";
}

/**
 * A rich-text tag: `<b>chunks</b>` or the self-closing `<br/>`. Tags carry no attributes. They are
 * only recognized when the `tags` parse option is on (the default); a `<` that does not start a
 * well-formed tag is literal text.
 *
 * @example
 * ```ts
 * import { parseMessage, type TagNode } from "@shadow-js/i18n/icu";
 *
 * const [node] = parseMessage("<link>Read the terms</link>");
 * if (node?.kind === "tag") {
 *   const tag: TagNode = node;
 *   console.log(tag.name, tag.selfClosing); // "link" false
 * }
 * ```
 * @see {@link formatToParts}
 * @since 1.0.0
 */
export interface TagNode {
  /** Discriminant: always `"tag"`. */
  readonly kind: "tag";
  /** The tag name: an ASCII letter followed by ASCII letters, digits, `-` or `_`. */
  readonly name: string;
  /** The nodes between the opening and closing tag; empty for a self-closing tag. */
  readonly children: readonly MessageNode[];
  /** `true` for `<name/>`, `false` for `<name>...</name>`. */
  readonly selfClosing: boolean;
}

/**
 * Any node of a parsed message: a union discriminated by `kind`. {@link parseMessage} returns a
 * readonly array of these.
 *
 * @example
 * ```ts
 * import { type MessageNode, parseMessage } from "@shadow-js/i18n/icu";
 *
 * function argumentNames(nodes: readonly MessageNode[]): string[] {
 *   return nodes.flatMap((node) => ("name" in node && node.kind !== "tag" ? [node.name] : []));
 * }
 *
 * console.log(argumentNames(parseMessage("{a} and {b, number}"))); // ["a", "b"]
 * ```
 * @since 1.0.0
 */
export type MessageNode =
  | TextNode
  | ArgumentNode
  | NumberNode
  | DateTimeNode
  | PluralNode
  | SelectNode
  | PoundNode
  | TagNode;
