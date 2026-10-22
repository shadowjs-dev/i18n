import type { MessageArgs, MessageKey, MessageTags, Translator, ValuesParam } from "../src/types";

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

const en = {
  hello: "Hello {name}",
  cart: {
    items: "{count, plural, =0 {Empty} one {# item} other {# items}}",
    total: "Total: {amount, number, ::currency/USD}",
    nested: { deep: "x" },
  },
  when: "On {d, date, short} at {d2, time}",
  gender: "{who, select, male {He} female {She} other {They}} said {what}",
  rich: "Read <b>the terms</b> and <a>{n} things</a><br/>",
  escaped: "It''s '{not}' an {arg}",
  nestedPlural: "{n, plural, one {{who} has # cat} other {{who} has {n2} <b>cats</b>}}",
  none: "No args here",
  ord: "{p, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}",
} as const;
type M = typeof en;

type _keys = Expect<
  Equal<
    MessageKey<M>,
    | "hello"
    | "cart.items"
    | "cart.total"
    | "cart.nested.deep"
    | "when"
    | "gender"
    | "rich"
    | "escaped"
    | "nestedPlural"
    | "none"
    | "ord"
  >
>;

type Names<S extends string> = keyof MessageArgs<S>;
type _a1 = Expect<Equal<Names<M["hello"]>, "name">>;
type _a2 = Expect<Equal<Names<M["cart"]["items"]>, "count">>;
type _a3 = Expect<Equal<Names<M["gender"]>, "who" | "what">>;
type _a4 = Expect<Equal<Names<M["when"]>, "d" | "d2">>;
type _a5 = Expect<Equal<Names<M["escaped"]>, "arg">>;
type _a6 = Expect<Equal<Names<M["nestedPlural"]>, "n" | "who" | "n2">>;
type _a7 = Expect<Equal<Names<M["none"]>, never>>;
type _a8 = Expect<Equal<Names<M["rich"]>, "n">>;
type _a9 = Expect<Equal<Names<M["ord"]>, "p">>;
type _t1 = Expect<Equal<MessageTags<M["rich"]>, "b" | "a" | "br">>;
type _t2 = Expect<Equal<MessageTags<M["hello"]>, never>>;
type _t3 = Expect<Equal<MessageTags<"1 < 2 and 3 > 2 <b>x</b>">, "b">>;
type _p1 = Expect<Equal<ValuesParam<"no args">, [values?: Readonly<Record<string, never>>]>>;
type _w1 = Expect<Equal<ValuesParam<string>, [values?: Readonly<Record<string, unknown>>]>>;

declare const t: Translator<M>;

// Valid calls.
t("hello", { name: "Ada" });
t("hello", { name: 5 });
t("hello", { name: () => "reactive" });
t("cart.items", { count: 3 });
t("cart.total", { amount: 4.5 });
t("when", { d: new Date(), d2: 5 });
t("gender", { who: "male", what: "hi" });
t("gender", { who: "anything", what: "hi" });
t("none");
t("cart.nested.deep");
t("escaped", { arg: 1 });
t("nestedPlural", { n: 1, who: "A", n2: 2 });
t("ord", { p: 3 });
t.rich("rich", { n: 3, b: (c) => c, a: (c) => c, br: () => "\n" });
t.rich("none");

// Invalid calls.
// @ts-expect-error missing values
t("hello");
// @ts-expect-error missing argument
t("hello", {});
// @ts-expect-error wrong argument name
t("hello", { nam: "x" });
// @ts-expect-error extra argument
t("hello", { name: "x", extra: 1 });
// @ts-expect-error plural needs a number
t("cart.items", { count: "three" });
// @ts-expect-error unknown key
t("cart.nope", { count: 1 });
// @ts-expect-error partial path is not a message
t("cart");
// @ts-expect-error date needs a date or timestamp
t("when", { d: "yesterday", d2: 1 });
// @ts-expect-error quoted text is not an argument but {arg} is required
t("escaped", {});
// @ts-expect-error values on a message with none
t("none", { a: 1 });
// @ts-expect-error tag handlers are required by rich
t.rich("rich", { n: 1 });
// @ts-expect-error a missing tag handler
t.rich("rich", { n: 1, b: (c) => c, a: (c) => c });
// @ts-expect-error select value must be a string
t("gender", { who: 5, what: "x" });

// A catalog widened to string falls back to loose arguments.
declare const loose: Translator<{ a: { b: string } }>;
loose("a.b");
loose("a.b", { anything: 1 });
// @ts-expect-error still checks keys
loose("a.c");
declare const wide: Translator<Record<string, string>>;
wide("whatever.key", { x: 1 });

export type { _keys };
