// Compile-time tests of key, namespace, argument, tag and locale typing. Every `@ts-expect-error`
// must keep failing for the reason named next to it (tsc reports an unused directive otherwise),
// and the lines without one must keep compiling. [I18N-449]
import { createI18nWithIcu as createI18n } from "../src/with-icu";

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

const i18n = createI18n({
  defaultLocale: "en",
  locales: ["en", "fr", "ar"],
  messages: {
    en: {
      hello: "Hello {name}",
      plain: "Plain text",
      cart: {
        items: "{count, plural, =0 {Empty} one {# item} other {# items}}",
        total: "Total {amount, number, ::currency/USD}",
        note: "Read <b>this</b> and <i>that</i>",
      },
      user: {
        name: "Name: {first} {last}",
        seen: "Seen {when, date, short}",
        rank: "{place, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}",
      },
    },
  },
  loaders: { fr: () => ({}), ar: () => ({}) },
});

const { t } = i18n;

// ---- Positive inference ------------------------------------------------------------------------

const hello: string = t("hello", { name: "Ada" });
const plain: string = t("plain");
const items: string = t("cart.items", { count: 3 });
t("cart.total", { amount: 12.5 });
t("user.name", { first: "Ada", last: "Lovelace" });
t("user.seen", { when: new Date(0) });
t("user.seen", { when: 0 });
t("user.rank", { place: 2 });
// An argument may be a number for text and an accessor for reactivity.
t("hello", { name: 42 });
t("hello", { name: () => "later" });
t.rich("cart.note", { b: (chunks) => chunks, i: (chunks) => chunks });
t.rich("hello", { name: "Ada" });
t.rich("plain");

const scoped = i18n.scoped("cart");
scoped("items", { count: 1 });
scoped("total", { amount: 1 });
scoped.rich("note", { b: (chunks) => chunks, i: (chunks) => chunks });
i18n.scoped("user")("name", { first: "A", last: "B" });

void i18n.setLocale("fr");
void i18n.setLocale("ar");
i18n.localePath("/about", "fr");
i18n.localePath("/about");
type _locale = Expect<Equal<ReturnType<typeof i18n.locale>, "en" | "fr" | "ar">>;
type _setLocale = Expect<Equal<ReturnType<typeof i18n.setLocale>, Promise<"en" | "fr" | "ar">>>;

// ---- Keys --------------------------------------------------------------------------------------

// @ts-expect-error unknown key
t("nope");
// @ts-expect-error a typo in a nested key
t("cart.itemz", { count: 1 });
// @ts-expect-error a namespace is not a message
t("cart");
// @ts-expect-error a key of the wrong case
t("Hello", { name: "Ada" });
// @ts-expect-error a leading dot
t(".hello", { name: "Ada" });
// @ts-expect-error a key with a trailing dot
t("hello.", { name: "Ada" });

// ---- Namespaces --------------------------------------------------------------------------------

// @ts-expect-error `name` lives in `user`, not in `cart`
i18n.scoped("cart")("name", { first: "A", last: "B" });
// @ts-expect-error `items` lives in `cart`, not in `user`
i18n.scoped("user")("items", { count: 1 });
// @ts-expect-error keys under `scoped` are relative to the namespace
i18n.scoped("cart")("cart.items", { count: 1 });
// @ts-expect-error unknown namespace
i18n.scoped("nope");
// @ts-expect-error a message is not a namespace
i18n.scoped("hello");
// @ts-expect-error a nested message path is not a namespace
i18n.scoped("cart.items");

// ---- Arguments ---------------------------------------------------------------------------------

// @ts-expect-error the values are missing
t("hello");
// @ts-expect-error the argument is missing
t("hello", {});
// @ts-expect-error one of two arguments is missing
t("user.name", { first: "Ada" });
// @ts-expect-error the argument has another name
t("hello", { nam: "Ada" });
// @ts-expect-error extra argument on a fresh object literal
t("hello", { name: "Ada", extra: 1 });
// @ts-expect-error values on a message that takes none
t("plain", { name: "Ada" });
// @ts-expect-error a plural count is a number, not a string
t("cart.items", { count: "2" });
// @ts-expect-error a plural count is a number, not a boolean
t("cart.items", { count: true });
// @ts-expect-error an ordinal place is a number
t("user.rank", { place: "second" });
// @ts-expect-error a date is a Date or a timestamp, not text
t("user.seen", { when: "yesterday" });
// @ts-expect-error a currency amount is a number
t("cart.total", { amount: "12" });
// @ts-expect-error the same checks apply through `scoped`
i18n.scoped("cart")("items", { count: "2" });
// @ts-expect-error and a missing argument through `scoped`
i18n.scoped("cart")("total");

// ---- Rich text ---------------------------------------------------------------------------------

// @ts-expect-error the tag handlers are required
t.rich("cart.note");
// @ts-expect-error `i` has no handler
t.rich("cart.note", { b: (chunks) => chunks });
// @ts-expect-error `j` is not a tag of the message, and `i` is missing
t.rich("cart.note", { b: (chunks) => chunks, j: (chunks) => chunks });
// @ts-expect-error a tag handler is a function
t.rich("cart.note", { b: "bold", i: (chunks) => chunks });
// @ts-expect-error through `scoped` too
i18n.scoped("cart").rich("note", { b: (chunks) => chunks });
// @ts-expect-error `t.rich` still needs the plain arguments
t.rich("hello");

// ---- Locales -----------------------------------------------------------------------------------

// @ts-expect-error not a supported locale
void i18n.setLocale("de");
// @ts-expect-error the case of a locale is part of its type
void i18n.setLocale("EN");
// @ts-expect-error not a supported locale
i18n.localePath("/about", "de");
// @ts-expect-error not a supported locale
i18n.chain("de");
// @ts-expect-error not a supported locale
i18n.dir("de");

export type { _locale, _setLocale };
export { hello, items, plain };
