import type { I18n } from "./i18n-types";
import type { Messages } from "./types";

/**
 * Augmentable registry. Add an `i18n` member whose type is your instance (`typeof i18n`) once, and
 * `useI18n()`, `<Trans>`, {@link RegisteredI18n} and {@link RegisteredMessages} know its locales,
 * keys and message arguments. Nothing needs registering for the package to work: without it, keys
 * and arguments are loosely typed.
 *
 * @example
 * ```ts
 * import { createI18nWithIcu } from "@shadow-js/i18n";
 *
 * export const i18n = createI18nWithIcu({
 *   defaultLocale: "en",
 *   locales: ["en", "fr"],
 *   messages: {
 *     en: {
 *       title: "Welcome",
 *       greeting: "Hello, {name}!",
 *       terms: "Read the <b>terms</b> and the <a>privacy policy</a>.",
 *       cart: { items: "{count, plural, one {# item} other {# items}}" },
 *     },
 *   },
 *   loaders: { fr: () => ({ title: "Bienvenue" }) },
 * });
 *
 * declare module "@shadow-js/i18n" {
 *   interface Register {
 *     i18n: typeof i18n;
 *   }
 * }
 * ```
 * @since 1.0.0
 */
// biome-ignore lint/suspicious/noEmptyInterface: an empty interface is the augmentation point; a type alias cannot be merged
export interface Register {}

/**
 * The registered instance type (the `i18n` member of {@link Register}), or `I18n<string, Messages>`
 * when nothing is registered. It is the default type of `useI18n()`.
 *
 * @example
 * ```ts
 * import type { RegisteredI18n } from "@shadow-js/i18n";
 *
 * export function title(i18n: RegisteredI18n): string {
 *   return i18n.t("title");
 * }
 * ```
 * @since 1.0.0
 */
export type RegisteredI18n = Register extends { readonly i18n: infer I extends I18n<string, never> }
  ? I
  : I18n<string, Messages>;

/**
 * The catalog type of the registered instance (the default locale's catalog), or `Messages` when
 * nothing is registered. `<Trans>` checks its `key`, `values` and `components` against it.
 *
 * @example
 * ```ts
 * import type { MessageKey, RegisteredMessages } from "@shadow-js/i18n";
 *
 * export const headings: readonly MessageKey<RegisteredMessages>[] = ["title"];
 * ```
 * @since 1.0.0
 */
export type RegisteredMessages = RegisteredI18n extends I18n<string, infer M> ? M : Messages;
