import type { I18nError } from "../../src/errors";
import type { CatalogLoader, I18n } from "../../src/i18n-types";
import type { Messages } from "../../src/types";
import { createI18nWithIcu as createI18n } from "../../src/with-icu";

export const en = {
  hello: "Hello {name}",
  cart: {
    items: "{count, plural, =0 {Your cart is empty} one {# item} other {# items}}",
    total: "Total: {amount, number, ::currency/USD}",
  },
  terms: "Read the <b>terms</b> and <a>privacy</a>.",
  only: { en: "English only" },
} as const;

export const fr = {
  hello: "Bonjour {name}",
  cart: { items: "{count, plural, one {# article} other {# articles}}" },
  terms: "Lisez les <b>conditions</b> et <a>la confidentialite</a>.",
} as const;

export const ar = { hello: "مرحبا {name}" } as const;

export interface LazyHarness {
  readonly i18n: I18n<"en" | "fr" | "ar" | "de", typeof en>;
  readonly resolvers: Record<string, () => void>;
  readonly rejecters: Record<string, (reason: unknown) => void>;
  readonly calls: Record<string, number>;
}

/** Instance with static en and lazy fr/ar/de whose resolution the test controls. */
export function lazyI18n(
  options: { transition?: "keep" | "suspend"; onError?: (error: I18nError) => void } = {},
): LazyHarness {
  const resolvers: Record<string, () => void> = {};
  const rejecters: Record<string, (reason: unknown) => void> = {};
  const calls: Record<string, number> = { fr: 0, ar: 0, de: 0 };
  const gate =
    (locale: "fr" | "ar" | "de", catalog: Messages): CatalogLoader =>
    () => {
      calls[locale] = (calls[locale] ?? 0) + 1;
      return new Promise<Messages>((resolve, reject) => {
        resolvers[locale] = () => resolve(catalog);
        rejecters[locale] = reject;
      });
    };
  const i18n = createI18n({
    defaultLocale: "en",
    locales: ["en", "fr", "ar", "de"],
    messages: { en },
    loaders: { fr: gate("fr", fr), ar: gate("ar", ar), de: gate("de", { hello: "Hallo {name}" }) },
    syncDocument: false,
    ...(options.transition === undefined ? {} : { transition: options.transition }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  });
  return { i18n, resolvers, calls, rejecters };
}
