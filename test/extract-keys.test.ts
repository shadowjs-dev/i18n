import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { flattenCatalog } from "../src/catalog";
import {
  compareKeys,
  type ExtractResult,
  extractMessages,
  findDuplicateKeys,
} from "../src/extract";
import { validateCatalogs } from "../src/icu/validate";

const SEED = { seed: 20261012, numRuns: 200 } as const;

/** Source text with a template placeholder written as §{ so this file has no template-looking strings. */
const src = (text: string): string => text.replaceAll("§{", "$" + "{");

const keysOf = (source: string, options = {}): string[] =>
  extractMessages(source, options).keys.map((entry) => entry.key);
const prefixesOf = (source: string, options = {}): string[] =>
  extractMessages(source, options).dynamic.map((entry) => entry.prefix);

describe("dynamic keys", () => {
  it("[I18N-437] a variable, a template with an expression and a concatenation are dynamic usages", () => {
    const source = [
      "t(key);",
      src("t(`status.§{state}`);"),
      src("t(`§{ns}.title`);"),
      't("items." + n);',
      't("a" + "b");',
      "t(a + b);",
      't("a".trim());',
      "t(obj.key);",
      "t(fn());",
      "t(...parts);",
      "t(cond ? 'x' : 'y');",
      "t(`plain`);",
      't("whole", { n });',
    ].join("\n");
    const result = extractMessages(source);
    expect(result.keys.map((entry) => entry.key)).toEqual(["plain", "whole"]);
    expect(result.dynamic.map((entry) => entry.prefix)).toEqual([
      "",
      "status.",
      "",
      "items.",
      "a",
      "",
      "",
      "",
      "",
      "",
      "",
    ]);
    expect(result.dynamic.map((entry) => entry.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(result.dynamic[1]).toEqual({ line: 2, column: 3, prefix: "status." });
  });

  it("[I18N-437] a dynamic usage never crashes the scan and does not hide later keys", () => {
    const source = src('t(); t(key); t(`a§{b}`); t(k, v); t(\n); t("after");');
    expect(keysOf(source)).toEqual(["after"]);
    expect(prefixesOf(source)).toEqual(["", "a", ""]);
    // Unterminated calls at the end of the file.
    for (const tail of [
      "t(",
      't("abc',
      "t(`abc",
      "t(key",
      't("a" +',
      "t.rich(",
      "<Trans key=",
      "<Trans",
    ]) {
      expect(() => extractMessages(tail), tail).not.toThrow();
    }
  });

  it("[I18N-437] a computed call is dynamic with an empty prefix, a template keeps its start", () => {
    const usage = extractMessages(src("t(key); t(`status.§{s}`)"));
    const compared = compareKeys(["status.open", "other"], usage);
    expect(compared.unused).toEqual([]);
    const onlyTemplate = compareKeys(
      ["status.open", "other"],
      extractMessages(src("t(`status.§{s}`)")),
    );
    expect(onlyTemplate.unused).toEqual(["other"]);
  });
});

describe("scoped translators", () => {
  it("[I18N-438] scoped(ns)(key) and scoped(ns).rich(key) resolve to ns.key", () => {
    const source = [
      'scoped("cart")("items");',
      'i18n.scoped("cart")("total", { n });',
      'i18n.scoped("cart").rich("terms", { b });',
      'useI18n().scoped("checkout")("pay");',
      'scoped("a.b")("c");',
      'i18n?.scoped("cart")?.("maybe");',
    ].join("\n");
    const result = extractMessages(source);
    expect(result.keys.map((entry) => `${entry.key}:${entry.kind}`)).toEqual([
      "cart.items:call",
      "cart.total:call",
      "cart.terms:rich",
      "checkout.pay:call",
      "a.b.c:call",
      "cart.maybe:call",
    ]);
    expect(result.dynamic).toEqual([]);
    // Positions point at the key literal, not at the namespace.
    expect(result.keys[0]).toEqual({ key: "cart.items", line: 1, column: 16, kind: "call" });
  });

  it("[I18N-438] a variable bound to scoped(ns) resolves its calls, in its block only", () => {
    const source = [
      'const cart = i18n.scoped("cart");',
      'cart("items");',
      'cart.rich("terms");',
      "function inner() {",
      '  const t = scoped("deep");',
      '  t("x");',
      "}",
      't("outer");',
      "cart(name);",
      "cart(`a§{b}`);",
    ].join("\n");
    const result = extractMessages(src(source));
    expect(result.keys.map((entry) => entry.key)).toEqual([
      "cart.items",
      "cart.terms",
      "deep.x",
      "outer",
    ]);
    expect(result.dynamic.map((entry) => entry.prefix)).toEqual(["cart.", "cart.a"]);
  });

  it("[I18N-438] bindings: a name declared again, let and var, type annotations, await, other objects", () => {
    expect(
      keysOf(['const t = scoped("a");', 't("x");', "const t = useI18n().t;", 't("y");'].join("\n")),
    ).toEqual(["a.x", "y"]);
    expect(keysOf('let c = scoped("n"); c("k");')).toEqual(["n.k"]);
    expect(keysOf('var c = i18n.scoped("n"); c("k");')).toEqual(["n.k"]);
    expect(keysOf('const c: Translator<Cart> = scoped("n"); c("k");')).toEqual(["n.k"]);
    expect(keysOf('const c: (a: number) => void = x; const d = scoped("n"); d("k");')).toEqual([
      "n.k",
    ]);
    expect(keysOf('const c = await getI18n().scoped("n"); c("k");')).toEqual(["n.k"]);
    // A member call on another object is not the binding.
    expect(keysOf('const cart = scoped("c"); other.cart("k"); cart("j");')).toEqual(["c.j"]);
    // `cart` that is never scoped stays unknown.
    expect(keysOf('const cart = makeCart(); cart("items");')).toEqual([]);
    // A scoped name is not a translate function unless it is also listed as one.
    expect(keysOf('const cart = scoped("c"); cart.other("x");')).toEqual([]);
  });

  it("[I18N-438] a computed namespace makes every call through it dynamic", () => {
    const result = extractMessages(
      'const c = scoped(ns); c("k"); scoped(a + b)("z"); scoped()("q");',
    );
    expect(result.keys).toEqual([]);
    expect(result.dynamic.map((entry) => entry.prefix)).toEqual(["", "", ""]);
  });

  it("[I18N-438] custom scoped function names replace the default", () => {
    const options = { scopedFunctions: ["namespaced"] };
    expect(keysOf('namespaced("cart")("items"); scoped("cart")("zzz")', options)).toEqual([
      "cart.items",
    ]);
    expect(keysOf('scoped("cart")("items")', { scopedFunctions: [] })).toEqual([]);
  });

  it("[I18N-438] compareKeys sees scoped usage as full keys", () => {
    const usage = extractMessages('const c = scoped("cart"); c("items"); c("gone");');
    const compared = compareKeys(["cart.items", "cart.total", "other"], usage);
    expect(compared.missing.map((entry) => entry.key)).toEqual(["cart.gone"]);
    expect(compared.unused).toEqual(["cart.total", "other"]);
    const dynamicUsage = extractMessages("const c = scoped('cart'); c(name);");
    expect(compareKeys(["cart.items", "other"], dynamicUsage).unused).toEqual(["other"]);
  });
});

describe("t.rich, Trans and the shapes of a call", () => {
  it("[I18N-439] t.rich, translateRich and optional calls give keys of the right kind", () => {
    const source = [
      't.rich("terms", { b });',
      'i18n.t.rich("privacy");',
      'translateRich("legal");',
      't?.("maybe");',
      't.rich?.("maybe.rich");',
      't?.rich("also");',
      "i18n?.t('chained');",
      'translate("tr");',
    ].join("\n");
    const result = extractMessages(source);
    expect(result.keys.map((entry) => `${entry.key}:${entry.kind}`)).toEqual([
      "terms:rich",
      "privacy:rich",
      "legal:call",
      "maybe:call",
      "maybe.rich:rich",
      "also:rich",
      "chained:call",
      "tr:call",
    ]);
  });

  it("[I18N-439] <Trans key> in its spellings, and a computed one", () => {
    const source = [
      '<Trans key="a" />;',
      '<Trans key={"b"} components={{ b }} />;',
      "<Trans key={'c'}>text</Trans>;",
      "<Trans key={`d`} />;",
      '<i18n.Trans key="e" />;',
      '<Trans values={{ n: 1 }} components={{ b: (c) => <b>{c}</b> }} key="f" />;',
      src("<Trans key={`g.§{x}`} />;"),
      "<Trans key={name} />;",
      "<Trans key={a + 'b'} />;",
      "<Trans>no key</Trans>;",
      '<Other key="not.a.trans" />;',
      '{/* <Trans key="in.comment" /> */}',
    ].join("\n");
    const result = extractMessages(source);
    expect(result.keys.map((entry) => `${entry.key}:${entry.kind}`)).toEqual([
      "a:trans",
      "b:trans",
      "c:trans",
      "d:trans",
      "e:trans",
      "f:trans",
    ]);
    expect(result.dynamic.map((entry) => entry.prefix)).toEqual(["g.", "", ""]);
    expect(keysOf('<Message key="x" /><Trans key="y" />', { components: ["Message"] })).toEqual([
      "x",
    ]);
  });

  it("[I18N-439] a cast changes the text, so a literal followed by as or satisfies is a dynamic usage", () => {
    const result = extractMessages(
      't("a" as const); t("b" satisfies string, { n }); t("c", { n });',
    );
    expect(result.keys.map((entry) => entry.key)).toEqual(["c"]);
    expect(result.dynamic.map((entry) => entry.prefix)).toEqual(["", ""]);
  });

  it("[I18N-439] custom function and component names replace the defaults", () => {
    const options = { functions: ["tr", "i18n"], components: ["Msg"] };
    expect(keysOf('tr("x"); t("y"); i18n("z"); <Msg key="w" /><Trans key="v" />', options)).toEqual(
      ["x", "z", "w"],
    );
  });
});

describe("what is not a use", () => {
  it("[I18N-440] comments, strings, templates and regular expressions that look like calls", () => {
    const source = [
      '// t("in.comment")',
      '/* t("in.block") */',
      '/**\n * t("in.doc")\n */',
      "const s = \"t('in.string')\";",
      "const q = 't(\"in.single\")';",
      'const r = /t\\("x"\\)/g;',
      'const c = /[/]t("class")/;',
      src('const l = `t("in.template") and §{t("real.nested")}`;'),
      "const d = a / b / c; t('after.division');",
      'const e = x ? /re/ : /re2/; t("after.regex");',
    ].join("\n");
    expect(keysOf(source)).toEqual(["real.nested", "after.division", "after.regex"]);
  });

  it("[I18N-440] declarations, signatures, properties and private methods are not calls", () => {
    const source = [
      "function t(key) { return key; }",
      "function translate(key: string): string { return key; }",
      "const o = { t(key) { return key; }, translate(k = 'x') { return k; } };",
      "class A { t(key) { return key; } #t(key) { return key; } static translate(key) {} }",
      "interface I { t(key: string): string; t(key?: string): string; translate(key: string, n: number): void }",
      "declare function t(key: string): string;",
      "const p = { t: 'not a call', translate: 5 };",
      "const f = obj.t; const g = t; export { t };",
      "this.#t('private');",
      'const real = t("real");',
    ].join("\n");
    const result = extractMessages(source);
    expect(result.keys.map((entry) => entry.key)).toEqual(["real"]);
    expect(result.dynamic).toEqual([]);
  });

  it("[I18N-440] words that merely contain a function name are not functions", () => {
    expect(
      keysOf('const tt = 1; text("a"); st("b"); t2("c"); _t("d"); $t("e"); t_("f"); at("g");'),
    ).toEqual([]);
    expect(keysOf('x.t.y("a"); a.b.t("real"); t["x"]("b");')).toEqual(["real"]);
  });
});

describe("tokenizer limits", () => {
  it("[I18N-441] the source limit is 5 000 000 characters by default and maxLength changes it", () => {
    const exact = " ".repeat(5_000_000);
    expect(() => extractMessages(exact)).not.toThrow();
    expect(() => extractMessages(`${exact} `)).toThrow(RangeError);
    expect(() => extractMessages(`${exact} `)).toThrow(
      /^extractMessages: the source has 5000001 characters/,
    );
    expect(() => extractMessages("x".repeat(20), { maxLength: 10 })).toThrow(RangeError);
    expect(() => extractMessages("x".repeat(10), { maxLength: 10 })).not.toThrow();
    expect(() => extractMessages("", { maxLength: 0 })).not.toThrow();
    expect(() => extractMessages("x", { maxLength: 0 })).toThrow(RangeError);
    expect(() => extractMessages("x", { maxLength: Number.NaN })).toThrow(/maxLength must be/);
    expect(() => extractMessages("x", { maxLength: -1 })).toThrow(/maxLength must be/);
    expect(extractMessages('t("a")', { maxLength: Number.POSITIVE_INFINITY }).keys).toHaveLength(1);
  });

  it("[I18N-441] a large source is scanned in linear time", () => {
    const line = 't("some.key", { n }); const a = `x§{y}z`; /* c */ // d\n';
    const source = src(line.repeat(Math.floor(4_900_000 / line.length)));
    const started = performance.now();
    const result = extractMessages(source);
    expect(result.keys.length).toBeGreaterThan(50_000);
    expect(performance.now() - started).toBeLessThan(5000);
    const hostile = "t(".repeat(1_000_000);
    const startedHostile = performance.now();
    expect(extractMessages(hostile).dynamic.length).toBeGreaterThan(0);
    expect(performance.now() - startedHostile).toBeLessThan(5000);
  });

  it("[I18N-441] template literals may nest 64 deep; one more is a RangeError with a position", () => {
    const nest = (depth: number): string =>
      `${"`§{".repeat(depth)}1${"}`".repeat(depth)}; t("after");`;
    const ok = extractMessages(src(nest(64)));
    expect(ok.keys.map((entry) => entry.key)).toEqual(["after"]);
    expect(() => extractMessages(src(nest(65)))).toThrow(RangeError);
    expect(() => extractMessages(src(nest(65)))).toThrow(
      /^extractMessages: template literals are nested more than 64 deep at line 1, column \d+\.$/,
    );
    expect(() => extractMessages(src(`\n\n  ${nest(100)}`))).toThrow(/at line 3, column/);
    // Templates that follow each other, or nest through other braces, are not nesting.
    const flat = src(`${"`a§{1}` ".repeat(500)}t("flat")`);
    expect(keysOf(flat)).toEqual(["flat"]);
    const braces = src('`§{ {a: `§{ {b: 1}.b }`}.a }`; t("braces")');
    expect(keysOf(braces)).toEqual(["braces"]);
  });

  it("[I18N-441] unbalanced and malformed input is scanned without throwing or hanging", () => {
    for (const source of [
      "}}}}{{{{ ` ' \" /* t('a')",
      "`" + "$" + "{ ` " + "$" + "{",
      "/",
      "//",
      "/*",
      "'",
      '"',
      "`",
      "\\",
      "<",
      "</",
      "<Trans key=",
      ")))((((",
      "\u0000\u0001\ud800",
    ]) {
      expect(() => extractMessages(source), JSON.stringify(source)).not.toThrow();
    }
    expect(keysOf('t("a\\"b")')).toEqual(['a"b']);
  });
});

describe("line endings, positions and escapes", () => {
  it("[I18N-442] CRLF, CR, LF and a byte order mark give the same positions", () => {
    const lines = ['const a = t("one");', '  const b = t("two");', "", '\tt("three");'];
    const expected = [
      { key: "one", line: 1, column: 13, kind: "call" },
      { key: "two", line: 2, column: 15, kind: "call" },
      { key: "three", line: 4, column: 4, kind: "call" },
    ];
    for (const eol of ["\n", "\r\n", "\r"]) {
      expect(extractMessages(lines.join(eol)).keys, JSON.stringify(eol)).toEqual(expected);
    }
    expect(extractMessages(`\ufeff${lines.join("\n")}`).keys).toEqual(expected);
    expect(extractMessages(`${lines.join("\r\n")}\r\n`).keys).toEqual(expected);
  });

  it("[I18N-442] a line comment ends at CR, LS and PS as well as LF, and a hashbang is skipped", () => {
    expect(keysOf('// c\rt("cr")')).toEqual(["cr"]);
    expect(keysOf('// c\r\nt("crlf")')).toEqual(["crlf"]);
    expect(keysOf('// c\u2028t("ls")')).toEqual(["ls"]);
    expect(keysOf('// c\u2029t("ps")')).toEqual(["ps"]);
    expect(keysOf('#!/usr/bin/env node\nt("run")')).toEqual(["run"]);
    expect(extractMessages('#!/usr/bin/env node\nt("run")').keys[0]?.line).toBe(2);
    expect(keysOf('"unterminated\rt("after")')).toEqual(["after"]);
  });

  it("[I18N-442] escapes in literals are decoded", () => {
    expect(
      keysOf(String.raw`t("caf\u00e9"); t("a\x41"); t("\u{1F600}"); t("tab\there"); t("q\"uote");`),
    ).toEqual(["café", "aA", "\u{1F600}", "tab\there", 'q"uote']);
    expect(
      keysOf(
        String.raw`t('it\'s'); t("nul\0"); t("oct\101"); t("bad\xZZ"); t("bad\u12"); t("\q");`,
      ),
    ).toEqual(["it's", "nul\0", "octA", "badxZZ", "badu12", "q"]);
    // A backslash before a line break continues the string.
    expect(keysOf('t("one\\\ntwo")')).toEqual(["onetwo"]);
    expect(keysOf('t("one\\\r\ntwo")')).toEqual(["onetwo"]);
    expect(keysOf("t(`one\r\ntwo`)")).toEqual(["one\ntwo"]);
    expect(keysOf(String.raw`t(\`caf\u00e9\`)`.replaceAll("\\`", "`"))).toEqual(["café"]);
    expect(keysOf("t('a\\")).toEqual([]);
  });
});

describe("JSX", () => {
  it("[I18N-443] a component file with text, attributes, comments and fragments", () => {
    const source = [
      "export function Cart({ items }: Props) {",
      "  const { t } = useI18n();",
      "  const cart = i18n.scoped('cart');",
      "  return (",
      "    <>",
      '      {/* t("in.jsx.comment") */}',
      '      <h1 title={t("cart.title")}>{t("cart.heading")}</h1>',
      "      <p className=\"lead\">Do not wait: {cart('lead')}</p>",
      '      <p>See https://example.com/docs for more, then {t("after.url")}</p>',
      '      <ul>{items.map((item) => <li key={item.id}>{t("item.label", { name: item.name })}</li>)}</ul>',
      '      <li>{t("dense.a")}</li><li>{t("dense.b")}</li><li>{t("dense.c")}</li>',
      '      <Trans key="cart.terms" components={{ a: (c) => <a href="/terms">{c}</a> }} />',
      "      {items.length > 1 && <b>{t.rich('many', { b: (c) => <b>{c}</b> })}</b>}",
      "      <input placeholder={t('search')} disabled />",
      "      <Foo<string> prop={1} />",
      "    </>",
      "  );",
      "}",
    ].join("\n");
    const result = extractMessages(source);
    expect(result.keys.map((entry) => entry.key)).toEqual([
      "cart.title",
      "cart.heading",
      "cart.lead",
      "after.url",
      "item.label",
      "dense.a",
      "dense.b",
      "dense.c",
      "cart.terms",
      "many",
      "search",
    ]);
    expect(result.dynamic).toEqual([]);
  });

  it("[I18N-443] closing tags are not regular expressions", () => {
    expect(keysOf('<b>x</b>{t("one")}<i>y</i>{t("two")}')).toEqual(["one", "two"]);
    expect(keysOf('<a>{t("one")}</a><a>{t("two")}</a><a>{t("three")}</a>')).toEqual([
      "one",
      "two",
      "three",
    ]);
    expect(keysOf('const a = b </re/.test(c); t("x")')).toEqual(["x"]);
  });

  it("[I18N-443] an apostrophe in JSX text hides only what sits between it and the next quote on its line", () => {
    // Documented limit of a tokenizer without a JSX grammar: the text `'t panic, it'` reads as a string.
    expect(keysOf("<p>Don't panic</p>;\nt('next.line')")).toEqual(["next.line"]);
    expect(keysOf("<p>Don't {t('hidden')} it's</p>;\nt('visible')")).toEqual(["visible"]);
  });
});

describe("compareKeys", () => {
  it("[I18N-444] missing and unused across several files, with positions", () => {
    const a = extractMessages('t("a"); t("zzz")');
    const b = extractMessages('\n\nt.rich("b"); <Trans key="gone" />');
    const merged: ExtractResult = {
      keys: [...a.keys, ...b.keys],
      dynamic: [...a.dynamic, ...b.dynamic],
    };
    const result = compareKeys(["a", "b", "c", "d"], merged);
    expect(result.missing.map((entry) => `${entry.key}@${entry.line}:${entry.column}`)).toEqual([
      "zzz@1:11",
      "gone@3:25",
    ]);
    expect(result.unused).toEqual(["c", "d"]);
    expect(compareKeys([], merged).missing).toHaveLength(4);
    expect(compareKeys(["a"], { keys: [], dynamic: [] }).unused).toEqual(["a"]);
    expect(compareKeys([], { keys: [], dynamic: [] })).toEqual({ missing: [], unused: [] });
  });

  it("[I18N-444] a key used twice is used, a catalog key listed twice is reported once", () => {
    const usage = extractMessages('t("a"); t("a");');
    expect(compareKeys(["a", "b", "b"], usage)).toEqual({ missing: [], unused: ["b"] });
    expect(compareKeys(new Set(["b"]).values(), usage).missing).toHaveLength(2);
  });

  it("[I18N-444] property: missing and unused are exactly the set differences", () => {
    const key = fc.constantFrom("a", "b", "c.d", "c.e", "f", "g.h.i", "z");
    fc.assert(
      fc.property(
        fc.array(key, { maxLength: 8 }),
        fc.array(key, { maxLength: 8 }),
        (known, used) => {
          const usage = extractMessages(
            used.map((entry) => `t(${JSON.stringify(entry)});`).join("\n"),
          );
          const { missing, unused } = compareKeys(known, usage);
          expect(missing.map((entry) => entry.key)).toEqual(
            used.filter((entry) => !known.includes(entry)),
          );
          expect(unused).toEqual([...new Set(known)].filter((entry) => !used.includes(entry)));
          return true;
        },
      ),
      SEED,
    );
  });

  it("[I18N-448] property: positions index the key literal in the source, whatever surrounds it", () => {
    const filler = fc.constantFrom(
      " ",
      "\n",
      "\r\n",
      "\t",
      "// note\n",
      "/* t('x') */",
      "const a = 1;",
    );
    const key = fc.stringMatching(/^[a-z]{1,6}(\.[a-z]{1,6}){0,2}$/);
    fc.assert(
      fc.property(
        fc.array(filler, { maxLength: 6 }),
        key,
        fc.array(filler, { maxLength: 4 }),
        (before, name, after) => {
          const source = `${before.join("")}t("${name}");${after.join("")}`;
          const [found, ...rest] = extractMessages(source).keys;
          expect(rest).toEqual([]);
          expect(found?.key).toBe(name);
          const lines = source.split(/\r\n|\r|\n/);
          const line = lines[(found?.line ?? 1) - 1] ?? "";
          expect(
            line.slice((found?.column ?? 1) - 1, (found?.column ?? 1) - 1 + name.length + 2),
          ).toBe(`"${name}"`);
          return true;
        },
      ),
      SEED,
    );
  });

  it("[I18N-448] property: any text is scanned without throwing", () => {
    const piece = fc.constantFrom(
      "t(",
      ")",
      '"',
      "'",
      "`",
      "$" + "{",
      "}",
      "{",
      "/",
      "*",
      "\\",
      "<",
      ">",
      "Trans",
      "key",
      "=",
      "scoped",
      "const ",
      "x",
      " ",
      "\n",
      "rich",
      ".",
      "?",
    );
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 60 }), (parts) => {
        const result = extractMessages(parts.join(""));
        expect(Array.isArray(result.keys) && Array.isArray(result.dynamic)).toBe(true);
        return true;
      }),
      { ...SEED, numRuns: 1000 },
    );
  });
});

describe("duplicate keys and catalog comparison across locales", () => {
  it("[I18N-445] a key defined in two files, or twice in one, is reported with where", () => {
    expect(
      findDuplicateKeys([
        { source: "cart.json", keys: ["cart.items", "cart.total", "cart.items"] },
        { source: "checkout.json", keys: ["cart.total", "pay", "pay"] },
        { source: "misc.json", keys: ["unique"] },
      ]),
    ).toEqual([
      { key: "cart.items", sources: ["cart.json", "cart.json"] },
      { key: "cart.total", sources: ["cart.json", "checkout.json"] },
      { key: "pay", sources: ["checkout.json", "checkout.json"] },
    ]);
    expect(findDuplicateKeys([])).toEqual([]);
    expect(
      findDuplicateKeys([
        { source: "a", keys: ["x", "y"] },
        { source: "b", keys: ["z"] },
      ]),
    ).toEqual([]);
    expect(
      findDuplicateKeys([
        { source: "a", keys: new Set(["x"]) },
        { source: "b", keys: ["x"].values() },
      ]),
    ).toEqual([{ key: "x", sources: ["a", "b"] }]);
    // Keys are exact strings; names from the prototype are plain data.
    expect(
      findDuplicateKeys([
        { source: "a", keys: ["__proto__", "constructor", "A"] },
        { source: "b", keys: ["__proto__", "constructor", "a"] },
      ]),
    ).toEqual([
      { key: "__proto__", sources: ["a", "b"] },
      { key: "constructor", sources: ["a", "b"] },
    ]);
  });

  it("[I18N-445] a catalog that defines one key twice in one object is rejected, and reported by validateCatalogs", () => {
    expect(() => flattenCatalog({ a: { b: "x" }, "a.b": "y" })).toThrow(/defined twice/);
    const result = validateCatalogs({
      en: { a: "x" },
      fr: { a: { b: "x" }, "a.b": "y" } as never,
    });
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => `${issue.kind}:${issue.locale}`)).toEqual([
      "invalid-catalog:fr",
    ]);
    expect(result.issues[0]?.detail).toContain("defined twice");
    // Merging two files that both define a key is what findDuplicateKeys is for.
    const files = [
      { source: "one", keys: flattenCatalog({ cart: { items: "a" } }).keys() },
      { source: "two", keys: flattenCatalog({ cart: { items: "b", total: "c" } }).keys() },
    ];
    expect(findDuplicateKeys(files)).toEqual([{ key: "cart.items", sources: ["one", "two"] }]);
  });

  it("[I18N-446] missing and extra keys per locale, and placeholders that differ between locales", () => {
    const result = validateCatalogs({
      en: {
        greeting: "Hello {name}",
        cart: { items: "{count, plural, one {# item} other {# items}}" },
        only: "en",
      },
      fr: {
        greeting: "Bonjour {nom}",
        cart: { items: "{count, plural, one {# article} other {# articles}}" },
        extra: "x",
      },
      de: {
        greeting: "Hallo {name}",
        cart: { items: "{n, plural, one {# Artikel} other {# Artikel}}" },
        only: "de",
      },
    });
    const byKind = (kind: string): string[] =>
      result.issues
        .filter((issue) => issue.kind === kind)
        .map((issue) => `${issue.locale}:${issue.key}`);
    expect(byKind("missing-key")).toEqual(["fr:only"]);
    expect(byKind("extra-key")).toEqual(["fr:extra"]);
    expect(byKind("argument-mismatch").sort()).toEqual(["de:cart.items", "fr:greeting"]);
    const greeting = result.issues.find(
      (issue) => issue.kind === "argument-mismatch" && issue.key === "greeting",
    );
    expect(greeting?.detail).toContain("name");
    expect(greeting?.detail).toContain("nom");
    expect(result.ok).toBe(false);
    expect(result.byLocale["en"]).toEqual([]);
    expect(result.byLocale["fr"]).toHaveLength(3);
    // The same message with the same placeholders in another order is fine.
    expect(validateCatalogs({ en: { a: "{x} and {y}" }, fr: { a: "{y} et {x}" } }).ok).toBe(true);
  });
});
