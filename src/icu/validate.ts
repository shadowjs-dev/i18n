/**
 * Catalog validation and message signatures: the tooling that reads messages as ICU syntax. It lives
 * in `@shadow-js/i18n/icu` so that the core (`createI18n`) does not load the parser.
 * @packageDocumentation
 */
import { flattenCatalog } from "../catalog";
import { I18nError, MessageSyntaxError } from "../errors";
import type { Messages } from "../types";
import type { MessageNode } from "./ast";
import { parseMessage } from "./parse";

/**
 * The class of value an ICU argument takes, as {@link messageSignature} reports it and
 * {@link validateCatalogs} compares it across locales:
 *
 * - `"text"`: a simple `{name}`.
 * - `"number"`: `{name, number}`, `{name, plural}` and `{name, selectordinal}`.
 * - `"date"`: `{name, date}` and `{name, time}`.
 * - `"select"`: `{name, select}`.
 *
 * Two classes are compatible when they are equal, or when one is `"text"` and the other is
 * `"number"` or `"select"`. `"text"` and `"date"` are not compatible.
 *
 * @example
 * ```ts
 * import { type ArgumentClass, messageSignature, parseMessage } from "@shadow-js/i18n/icu";
 *
 * const signature = messageSignature(parseMessage("{when, date, short}"));
 * const kind: ArgumentClass | undefined = signature.args.get("when");
 * console.log(kind); // "date"
 * ```
 * @since 1.0.0
 */
export type ArgumentClass = "text" | "number" | "date" | "select";

/**
 * What a message needs from its caller: its argument names with their {@link ArgumentClass}, and the
 * names of its rich-text tags. {@link messageSignature} builds it; {@link validateCatalogs} compares
 * them across locales.
 *
 * @example
 * ```ts
 * import { type MessageSignature, messageSignature, parseMessage } from "@shadow-js/i18n/icu";
 *
 * const signature: MessageSignature = messageSignature(parseMessage("Hi <b>{name}</b>"));
 * console.log([...signature.args]); // [["name", "text"]]
 * console.log([...signature.tags]); // ["b"]
 * ```
 * @since 1.0.0
 */
export interface MessageSignature {
  /**
   * Every argument name of the message, at any depth, with its class. A name used both plainly
   * (`{n}`) and with a type (`{n, plural, ...}`) takes the typed class.
   */
  readonly args: ReadonlyMap<string, ArgumentClass>;
  /** Every tag name of the message, at any depth, self-closing tags included. */
  readonly tags: ReadonlySet<string>;
}

/**
 * Collects the argument names (with their {@link ArgumentClass}) and the tag names of a parsed
 * message, through plural and select clauses and tag content. Use it to compare what two messages
 * need, or to type the values a message takes.
 *
 * @param nodes A parsed message, from {@link parseMessage}.
 * @returns The signature, in new collections.
 * @example
 * ```ts
 * import { messageSignature, parseMessage } from "@shadow-js/i18n/icu";
 *
 * const signature = messageSignature(parseMessage("{n, plural, other {# <b>{who}</b>}}"));
 * console.log(Object.fromEntries(signature.args)); // { n: "number", who: "text" }
 * console.log([...signature.tags]); // ["b"]
 * ```
 * @see {@link MessageSignature}
 * @since 1.0.0
 */
export function messageSignature(nodes: readonly MessageNode[]): MessageSignature {
  const args = new Map<string, ArgumentClass>();
  const tags = new Set<string>();
  const stack: Array<readonly MessageNode[]> = [nodes];
  const note = (name: string, kind: ArgumentClass): void => {
    const known = args.get(name);
    // A plural plus a plain use of the same name is one numeric argument.
    if (known === undefined || known === "text") args.set(name, kind);
  };
  while (stack.length > 0) {
    const list = stack.pop();
    if (list === undefined) break;
    for (const node of list) {
      switch (node.kind) {
        case "argument":
          note(node.name, "text");
          break;
        case "number":
          note(node.name, "number");
          break;
        case "date":
        case "time":
          note(node.name, "date");
          break;
        case "plural":
          note(node.name, "number");
          for (const entry of node.cases) stack.push(entry.body);
          break;
        case "select":
          note(node.name, "select");
          for (const entry of node.cases) stack.push(entry.body);
          break;
        case "tag":
          tags.add(node.name);
          stack.push(node.children);
          break;
        case "text":
        case "pound":
          break;
      }
    }
  }
  return { args, tags };
}

/**
 * One problem found by {@link validateCatalogs}.
 *
 * @example
 * ```ts
 * import { type CatalogIssue, validateCatalogs } from "@shadow-js/i18n/icu";
 *
 * const { issues } = validateCatalogs({ en: { a: "Hi", b: "Bye" }, fr: { a: "Salut" } });
 * const first: CatalogIssue | undefined = issues[0];
 * console.log(first?.kind, first?.locale, first?.key); // "missing-key" "fr" "b"
 * ```
 * @since 1.0.0
 */
export interface CatalogIssue {
  /**
   * What is wrong:
   *
   * - `"missing-key"`: the base has the key and this locale does not (unless `allowMissing`).
   * - `"extra-key"`: this locale has the key and the base does not (unless `allowExtra`).
   * - `"syntax-error"`: the message is not valid ICU syntax.
   * - `"argument-mismatch"`: an argument is missing on one side, or its {@link ArgumentClass} is not
   *   compatible with the base message's.
   * - `"tag-mismatch"`: the set of tag names differs from the base message's.
   * - `"invalid-catalog"`: the locale's catalog is not a valid catalog (see `flattenCatalog`), or the
   *   base locale has no catalog.
   */
  readonly kind:
    | "missing-key"
    | "extra-key"
    | "syntax-error"
    | "argument-mismatch"
    | "tag-mismatch"
    | "invalid-catalog";
  /** The locale whose catalog has the problem. */
  readonly locale: string;
  /** The dotted key of the message (`"cart.total"`); `""` for `"invalid-catalog"`. */
  readonly key: string;
  /** A readable explanation; for `"syntax-error"`, the parser's message with line, column and caret. */
  readonly detail: string;
}

/**
 * Result of {@link validateCatalogs}.
 *
 * @example
 * ```ts
 * import { type CatalogValidation, validateCatalogs } from "@shadow-js/i18n/icu";
 *
 * const result: CatalogValidation = validateCatalogs({ en: { a: "Hi" }, de: { a: "Hallo" } });
 * console.log(result.ok, result.base, result.byLocale["de"]); // true "en" []
 * ```
 * @since 1.0.0
 */
export interface CatalogValidation {
  /** `true` when `issues` is empty. */
  readonly ok: boolean;
  /** The locale the others were compared with. */
  readonly base: string;
  /**
   * Every issue: the catalog and syntax problems of all locales first, then the key, argument and tag
   * problems of each locale.
   */
  readonly issues: readonly CatalogIssue[];
  /**
   * The same issues grouped by locale, with an entry (possibly empty) for every locale of the input.
   * The issue of a `base` locale absent from the input is only in `issues`. The object has no
   * prototype.
   */
  readonly byLocale: Readonly<Record<string, readonly CatalogIssue[]>>;
}

/**
 * Options of {@link validateCatalogs}.
 *
 * @example
 * ```ts
 * import { type ValidateOptions, validateCatalogs } from "@shadow-js/i18n/icu";
 *
 * // French may lag behind English: its runtime falls back to English for missing keys.
 * const options: ValidateOptions = { base: "en", allowMissing: true };
 * const result = validateCatalogs({ fr: { a: "Salut" }, en: { a: "Hi", b: "Bye" } }, options);
 * console.log(result.ok); // true
 * ```
 * @since 1.0.0
 */
export interface ValidateOptions {
  /**
   * The reference locale. When it has no valid catalog, the result has an `"invalid-catalog"` issue
   * for it and no key, argument or tag comparisons are made.
   * @default The first key of `catalogs` (`""` when there is none).
   */
  readonly base?: string;
  /**
   * Do not report keys the base has and a locale lacks: use it for partial catalogs that fall back
   * to another locale.
   * @default false
   */
  readonly allowMissing?: boolean;
  /**
   * Do not report keys a locale has and the base lacks.
   * @default false
   */
  readonly allowExtra?: boolean;
}

function compatible(a: ArgumentClass, b: ArgumentClass): boolean {
  if (a === b) return true;
  return (
    (a === "text" && (b === "number" || b === "select")) ||
    (b === "text" && (a === "number" || a === "select"))
  );
}

function describe(signature: MessageSignature): string {
  return [...signature.args]
    .map(([name, kind]) => `${name}:${kind}`)
    .sort()
    .join(", ");
}

/**
 * Checks catalogs against a base locale: the syntax of every message, keys missing from or extra in a
 * locale, and arguments or tags that differ from the base message. Problems are returned as issues,
 * not thrown. Pure (no I/O, no timers), so it runs the same in a unit test and in CI.
 *
 * @param catalogs Nested catalogs by locale.
 * @param options Base locale and which key differences are allowed.
 * @returns The issues, flat and grouped by locale, and `ok` when there are none.
 * @example
 * ```ts
 * import { validateCatalogs } from "@shadow-js/i18n/icu";
 *
 * const result = validateCatalogs({
 *   en: { greet: "Hi {name}", bye: "Bye" },
 *   fr: { greet: "Salut" },
 * });
 * for (const issue of result.issues) console.log(issue.kind, issue.locale, issue.key);
 * // "missing-key" "fr" "bye"
 * // "argument-mismatch" "fr" "greet"
 * ```
 * @see {@link CatalogIssue}
 * @see {@link pseudoLocalize}
 * @since 1.0.0
 */
export function validateCatalogs(
  catalogs: Readonly<Record<string, Messages>>,
  options: ValidateOptions = {},
): CatalogValidation {
  const locales = Object.keys(catalogs);
  const base = options.base ?? locales[0] ?? "";
  const issues: CatalogIssue[] = [];
  const flat = new Map<string, Map<string, string>>();
  const signatures = new Map<string, Map<string, MessageSignature>>();
  for (const locale of locales) {
    let messages: Map<string, string>;
    try {
      messages = flattenCatalog(Object.getOwnPropertyDescriptor(catalogs, locale)?.value);
    } catch (error) {
      if (error instanceof I18nError) {
        issues.push({ kind: "invalid-catalog", locale, key: "", detail: error.message });
        continue;
      }
      throw error;
    }
    flat.set(locale, messages);
    const own = new Map<string, MessageSignature>();
    for (const [key, text] of messages) {
      try {
        own.set(key, messageSignature(parseMessage(text)));
      } catch (error) {
        if (!(error instanceof MessageSyntaxError)) throw error;
        issues.push({ kind: "syntax-error", locale, key, detail: error.message });
      }
    }
    signatures.set(locale, own);
  }
  const baseMessages = flat.get(base);
  const baseSignatures = signatures.get(base);
  if (baseMessages === undefined || baseSignatures === undefined) {
    if (!issues.some((issue) => issue.locale === base)) {
      issues.push({
        kind: "invalid-catalog",
        locale: base,
        key: "",
        detail: `the base locale "${base}" has no catalog.`,
      });
    }
  } else {
    for (const locale of locales) {
      if (locale === base) continue;
      const messages = flat.get(locale);
      const own = signatures.get(locale);
      if (messages === undefined || own === undefined) continue;
      if (options.allowMissing !== true) {
        for (const key of baseMessages.keys()) {
          if (!messages.has(key))
            issues.push({
              kind: "missing-key",
              locale,
              key,
              detail: `"${key}" exists in ${base} but not in ${locale}.`,
            });
        }
      }
      for (const [key, signature] of own) {
        const reference = baseSignatures.get(key);
        if (!baseMessages.has(key)) {
          if (options.allowExtra !== true)
            issues.push({
              kind: "extra-key",
              locale,
              key,
              detail: `"${key}" exists in ${locale} but not in ${base}.`,
            });
          continue;
        }
        if (reference === undefined) continue;
        const names = new Set([...reference.args.keys(), ...signature.args.keys()]);
        const bad = [...names].filter((name) => {
          const a = reference.args.get(name);
          const b = signature.args.get(name);
          return a === undefined || b === undefined || !compatible(a, b);
        });
        if (bad.length > 0) {
          issues.push({
            kind: "argument-mismatch",
            locale,
            key,
            detail: `arguments differ from ${base}: ${bad.sort().join(", ")} (${base}: ${describe(reference) || "none"}; ${locale}: ${describe(signature) || "none"}).`,
          });
        }
        const sameTags =
          reference.tags.size === signature.tags.size &&
          [...reference.tags].every((tag) => signature.tags.has(tag));
        if (!sameTags) {
          issues.push({
            kind: "tag-mismatch",
            locale,
            key,
            detail: `tags differ from ${base}: ${[...reference.tags].sort().join(", ") || "none"} vs ${[...signature.tags].sort().join(", ") || "none"}.`,
          });
        }
      }
    }
  }
  const byLocale: Record<string, CatalogIssue[]> = Object.create(null) as Record<
    string,
    CatalogIssue[]
  >;
  for (const locale of locales) byLocale[locale] = [];
  for (const issue of issues) {
    const list = byLocale[issue.locale];
    if (list !== undefined) list.push(issue);
  }
  return { ok: issues.length === 0, base, issues, byLocale };
}
