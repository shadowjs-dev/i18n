import { describe, expect, it } from "vitest";
import { CATALOG_LIMITS, flattenCatalog } from "../src/catalog";
import { compareKeys, extractMessages } from "../src/extract";
import { parseMessage } from "../src/icu/parse";
import { pseudoLocalize } from "../src/icu/pseudo";
import { messageSignature, validateCatalogs } from "../src/icu/validate";
import { en, fr } from "./support/catalogs";

/** Source text with a template placeholder, written as §{ so the test file stays free of template-looking strings. */
const src = (text: string): string => text.replaceAll("§{", "$" + "{");

describe("validateCatalogs", () => {
  it("[I18N-140] reports missing and extra keys per locale", () => {
    const result = validateCatalogs({ en, fr: { ...fr, extra: "x" } as never });
    const kinds = result.issues.map((issue) => `${issue.kind}:${issue.locale}:${issue.key}`).sort();
    expect(kinds).toEqual([
      "extra-key:fr:extra",
      "missing-key:fr:cart.total",
      "missing-key:fr:only.en",
    ]);
    expect(result.ok).toBe(false);
    expect(result.base).toBe("en");
    expect(result.byLocale["fr"]).toHaveLength(3);
    expect(result.byLocale["en"]).toEqual([]);
  });

  it("[I18N-141] partial catalogs are fine when missing keys are allowed", () => {
    const result = validateCatalogs({ en, fr }, { allowMissing: true });
    expect(result.ok).toBe(true);
    expect(
      validateCatalogs(
        { en, fr: { ...fr, extra: "x" } as never },
        { allowMissing: true, allowExtra: true },
      ).ok,
    ).toBe(true);
  });

  it("[I18N-142] catches argument and tag mismatches between locales", () => {
    const result = validateCatalogs({
      en: {
        a: "Hi {name}",
        b: "{n, plural, one {#} other {#}}",
        c: "<b>x</b>",
        d: "{d, date}",
        e: "{x}",
      },
      de: { a: "Hallo", b: "{n, number}", c: "<i>x</i>", d: "{d}", e: "{x, number}" },
    });
    const byKey = Object.fromEntries(
      result.issues.map((issue) => [`${issue.kind}:${issue.key}`, issue.detail]),
    );
    expect(Object.keys(byKey).sort()).toEqual([
      "argument-mismatch:a",
      "argument-mismatch:d",
      "tag-mismatch:c",
    ]);
    expect(byKey["argument-mismatch:a"]).toContain("name");
  });

  it("[I18N-143] syntax errors and invalid catalogs are issues, not exceptions", () => {
    const result = validateCatalogs({
      en: { a: "ok" },
      fr: { a: "{broken" },
      de: { a: 5 } as never,
    });
    expect(result.issues.map((issue) => `${issue.kind}:${issue.locale}`).sort()).toEqual([
      "invalid-catalog:de",
      "syntax-error:fr",
    ]);
    expect(validateCatalogs({ fr: { a: "x" } }, { base: "en" }).issues[0]?.kind).toBe(
      "invalid-catalog",
    );
  });

  it("[I18N-144] messageSignature lists arguments with classes and tags through nesting", () => {
    const signature = messageSignature(
      parseMessage("{g, select, a {<b>{n, plural, other {# {x}}}</b>} other {{d, time}}}"),
    );
    expect(Object.fromEntries(signature.args)).toEqual({
      g: "select",
      n: "number",
      x: "text",
      d: "date",
    });
    expect([...signature.tags]).toEqual(["b"]);
  });
});

describe("flattenCatalog bounds", () => {
  it("[I18N-145] bounds depth and key count, rejects accessors, arrays and duplicates", () => {
    expect([...flattenCatalog({ a: { b: "x" }, "c.d": "y" }).entries()]).toEqual([
      ["a.b", "x"],
      ["c.d", "y"],
    ]);
    expect(() => flattenCatalog({ a: { b: "x" }, "a.b": "y" })).toThrow(/defined twice/);
    expect(() => flattenCatalog({ a: ["x"] })).toThrow(/an array/);
    expect(() => flattenCatalog({ a: null })).toThrow(/null/);
    expect(() => flattenCatalog({ "": "x" })).toThrow(/empty key/);
    expect(() =>
      flattenCatalog({
        get a(): string {
          return "x";
        },
      }),
    ).toThrow(/accessor/);
    expect(() => flattenCatalog("string")).toThrow(/must be an object/);
    const wide = Object.fromEntries(
      Array.from({ length: CATALOG_LIMITS.maxKeys + 1 }, (_, i) => [`k${i}`, "x"]),
    );
    expect(() => flattenCatalog(wide)).toThrow(/more than/);
  });
});

describe("extractMessages", () => {
  it("[I18N-150] finds t calls, t.rich, member calls and Trans keys with positions", () => {
    const source = [
      'const a = t("cart.items", { count });',
      "const b = i18n.t('hello', { name });",
      "const c = t.rich(`terms`, { b: (x) => x });",
      'const d = <Trans key="footer.note" components={{ b }} />;',
      'const e = i18n.translate("dyn.static");',
    ].join("\n");
    const result = extractMessages(source);
    expect(result.keys.map((k) => `${k.key}@${k.line}:${k.column}:${k.kind}`)).toEqual([
      "cart.items@1:13:call",
      "hello@2:18:call",
      "terms@3:18:rich",
      "footer.note@4:22:trans",
      "dyn.static@5:26:call",
    ]);
    expect(result.dynamic).toEqual([]);
  });

  it("[I18N-151] computed keys are dynamic; a template prefix covers matching catalog keys", () => {
    const result = extractMessages(src("t(`status.§{s}`); t(key); t(a + b); t();"));
    expect(result.dynamic.map((d) => d.prefix)).toEqual(["status.", "", ""]);
    const compared = compareKeys(["status.open", "status.closed", "other"], result);
    expect(compared.unused).toEqual([]);
    const only = compareKeys(["status.open", "other"], extractMessages(src("t(`status.§{s}`)")));
    expect(only.unused).toEqual(["other"]);
    expect(
      compareKeys(["x"], extractMessages("t(key)"), { ignoreUnknownDynamic: true }).unused,
    ).toEqual(["x"]);
  });

  it("[I18N-152] ignores strings, comments, regexes and declarations that merely look like calls", () => {
    const source = [
      '// t("in.comment")',
      '/* t("in.block") */',
      "const s = \"t('in.string')\";",
      'const r = /t\\("x"\\)/;',
      src('const q = `t("in.template") §{t("real.nested")}`;'),
      "function t(key) { return key; }",
      'const text = a / b; const y = t("after.division");',
      '<p>Don\'t panic</p>; t("after.jsx.text");',
    ].join("\n");
    expect(extractMessages(source).keys.map((k) => k.key)).toEqual([
      "real.nested",
      "after.division",
      "after.jsx.text",
    ]);
  });

  it("[I18N-153] compareKeys finds missing and unused keys across several files", () => {
    const a = extractMessages('t("a"); t("zzz")');
    const b = extractMessages('t.rich("b")');
    const merged = { keys: [...a.keys, ...b.keys], dynamic: [...a.dynamic, ...b.dynamic] };
    const result = compareKeys(["a", "b", "c"], merged);
    expect(result.missing.map((k) => k.key)).toEqual(["zzz"]);
    expect(result.unused).toEqual(["c"]);
  });

  it("[I18N-154] custom function names and the size limit", () => {
    expect(
      extractMessages('tr("x"); t("y")', { functions: ["tr"] }).keys.map((k) => k.key),
    ).toEqual(["x"]);
    expect(() => extractMessages("x".repeat(20), { maxLength: 10 })).toThrow(RangeError);
  });

  it("[I18N-155] templates nested past 64 are a RangeError; unbalanced input does not hang or throw", () => {
    const nested = `${"`${".repeat(100)}1${"}`".repeat(100)}`;
    expect(() => extractMessages(nested)).toThrow(RangeError);
    expect(() => extractMessages("}}}}{{{{ ` ' \" /* t('a')")).not.toThrow();
    expect(extractMessages('t("a\\"b")').keys[0]?.key).toBe('a"b');
  });
});

describe("pseudoLocalize", () => {
  it("[I18N-160] keeps keys, arguments, plural structure and tags; changes literal text", () => {
    const pseudo = pseudoLocalize({
      greet: "Hello {name}",
      n: { items: "{count, plural, one {# item} other {# items}}" },
      rich: "Read <b>this</b>",
    });
    expect(pseudo.greet).toBe("[Ĥéļļó~~ {name}]");
    expect(pseudo.n.items).toBe("[{count, plural, one {# íţéɱ~~} other {# íţéɱš~~}}]");
    expect(pseudo.rich).toBe("[Ŕéáð~~ <b>ţĥíš~~</b>]");
    expect(Object.keys(pseudo)).toEqual(["greet", "n", "rich"]);
    expect(
      validateCatalogs({
        en: { greet: "Hello {name}", rich: "Read <b>this</b>" },
        ps: { greet: pseudo.greet, rich: pseudo.rich },
      }).ok,
    ).toBe(true);
  });

  it("[I18N-161] options: bidi mode, brackets off, no expansion; quotes stay valid ICU", () => {
    expect(pseudoLocalize({ a: "Hi" }, { mode: "bidi", brackets: false }).a).toBe(
      "\u202bHi\u202c\u200f",
    );
    expect(pseudoLocalize({ a: "Hi" }, { expansion: 0, brackets: false }).a).toBe("Ĥí");
    const quoted = pseudoLocalize(
      { a: "It''s '{'literal'}'" },
      { expansion: 0, brackets: false },
    ).a;
    expect(parseMessage(quoted)).toEqual([{ kind: "text", value: "Íţ'š {ļíţéŕáļ}" }]);
  });

  it("[I18N-162] __proto__ keys stay data, too-deep catalogs are rejected", () => {
    const evil = JSON.parse('{"__proto__": {"a": "x"}}') as { [key: string]: never };
    const out = pseudoLocalize(evil, { brackets: false, expansion: 0 });
    expect(Object.keys(out)).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    const deep = (n: number): object => (n === 0 ? { a: "x" } : { a: deep(n - 1) });
    expect(() => pseudoLocalize(deep(40) as never)).toThrow(/deeper than 32/);
  });
});
