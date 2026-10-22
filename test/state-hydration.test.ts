import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { CATALOG_LIMITS } from "../src/catalog";
import { I18nError } from "../src/errors";
import type { I18nState } from "../src/i18n-types";
import {
  parseI18nState,
  readI18nState,
  renderI18nStateScript,
  STATE_MAX_LENGTH,
  STATE_META_NAME,
  STATE_SCRIPT_ID,
  type StateDocument,
  serializeI18nState,
} from "../src/state";
import { createI18n } from "./support/full-instance";

const state = (messages: Record<string, string>, locale = "en"): I18nState => ({
  v: 1,
  locale,
  messages: { [locale]: messages },
});

/** A document with a state script and/or meta. */
function pageWith(options: { script?: string | null; meta?: string | null } = {}): StateDocument {
  return {
    getElementById: (id) =>
      id === STATE_SCRIPT_ID && options.script !== undefined
        ? { textContent: options.script }
        : null,
    querySelector: (selector) =>
      selector === `meta[name="${STATE_META_NAME}"]` && options.meta !== undefined
        ? { getAttribute: (name) => (name === "content" ? (options.meta ?? null) : null) }
        : null,
  };
}

function invalidState(action: () => unknown): I18nError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(I18nError);
    expect((error as I18nError).code).toBe("INVALID_STATE");
    return error as I18nError;
  }
  throw new Error("expected INVALID_STATE, but nothing was thrown");
}

describe("hydration state escaping", () => {
  const hostile = [
    "</script><script>alert(1)</script>",
    "</SCRIPT>",
    "<!-- -->",
    "<script>",
    "a b",
    "a b",
    "&amp; & > <",
    "]]>",
    "\u0000\u001f\u007f",
  ];

  it("[I18N-480] values with </script>, U+2028, U+2029, <, > and & are escaped and read back unchanged", () => {
    for (const value of hostile) {
      const json = serializeI18nState(state({ k: value, [value]: "x" }));
      for (const raw of ["<", ">", "&", " ", " "]) expect(json).not.toContain(raw);
      expect(parseI18nState(json)).toEqual(state({ k: value, [value]: "x" }));
    }
  });

  it("[I18N-480] a state script holds exactly one closing tag, whatever the messages contain", () => {
    const html = renderI18nStateScript(state({ a: "</script><img src=x onerror=alert(1)>" }), {
      nonce: "abc123",
    });
    expect(html.match(/<\/script>/gi)).toHaveLength(1);
    expect(
      html.startsWith('<script type="application/json" id="__SHADOW_I18N__" nonce="abc123">'),
    ).toBe(true);
    expect(html).not.toContain("<img");
    const text = html.slice(html.indexOf(">") + 1, html.lastIndexOf("</script>"));
    expect(parseI18nState(text).messages["en"]?.["a"]).toBe(
      "</script><img src=x onerror=alert(1)>",
    );
  });

  it("[I18N-480] keys and the locale are escaped too, and the output is valid JSON", () => {
    const json = serializeI18nState({ v: 1, locale: "en", messages: { en: { "</script>": "x" } } });
    expect(json).not.toContain("<");
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("[I18N-480] nonce and id must be plain tokens", () => {
    for (const nonce of ['"><script>', "a b", "", "x".repeat(201), "é"]) {
      expect(() => renderI18nStateScript(state({}), { nonce })).toThrow(
        expect.objectContaining({ code: "INVALID_VALUE" }),
      );
    }
    for (const id of ['x" onload="1', "", "a>b"]) {
      expect(() => renderI18nStateScript(state({}), { id })).toThrow(
        expect.objectContaining({ code: "INVALID_VALUE" }),
      );
    }
  });
});

describe("hydration state round trip", () => {
  it("[I18N-481] property: the parsed payload equals the serialized one for random messages (fixed seed)", () => {
    const key = fc.string({ minLength: 1, maxLength: 12 }).filter((value) => value !== "__proto__");
    const catalog = fc.dictionary(key, fc.string({ maxLength: 40 }), { maxKeys: 8 });
    const arbitrary = fc.record({
      locale: fc.constantFrom("en", "fr", "ar", "zh-Hant-TW"),
      messages: fc.dictionary(fc.constantFrom("en", "fr", "ar", "zh-Hant-TW"), catalog, {
        maxKeys: 4,
      }),
    });
    fc.assert(
      fc.property(arbitrary, ({ locale, messages }) => {
        const original: I18nState = { v: 1, locale, messages };
        const json = serializeI18nState(original);
        for (const raw of ["<", ">", "&", " ", " "]) expect(json).not.toContain(raw);
        expect(parseI18nState(json)).toEqual(original);
        const html = renderI18nStateScript(original);
        expect(html.match(/<\/script/gi)).toHaveLength(1);
      }),
      { seed: 481, numRuns: 200 },
    );
  });

  it("[I18N-481] property: arbitrary unicode (lone surrogates, controls) survives the round trip", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 60 }), (text) => {
        const original = state({ k: text });
        expect(parseI18nState(serializeI18nState(original))).toEqual(original);
      }),
      { seed: 4810, numRuns: 200 },
    );
  });

  it("[I18N-481] a created instance's state() survives serialize, script embedding and parse, and rebuilds the same text", () => {
    const server = createI18n({
      defaultLocale: "en",
      locales: ["en", "fr"],
      messages: { en: { a: "x </script> {n}" }, fr: { a: "y   {n}" } },
      locale: "fr",
      syncDocument: false,
    });
    const html = renderI18nStateScript(server.state());
    const body = html.slice(html.indexOf(">") + 1, html.lastIndexOf("</script>"));
    const client = createI18n({
      defaultLocale: "en",
      locales: ["en", "fr"],
      state: readI18nState(pageWith({ script: body })) as I18nState<"en" | "fr">,
      syncDocument: false,
    });
    expect(client.locale()).toBe("fr");
    expect(client.translate("a" as never, { n: 2 } as never)).toBe(
      server.translate("a" as never, { n: 2 } as never),
    );
  });
});

describe("hydration state on read", () => {
  it("[I18N-482] a text over STATE_MAX_LENGTH is rejected before it is parsed; exactly STATE_MAX_LENGTH is accepted", () => {
    const parse = vi.spyOn(JSON, "parse");
    const head = '{"v":1,"locale":"en","messages":{}}';
    const exact = head + " ".repeat(STATE_MAX_LENGTH - head.length);
    expect(exact).toHaveLength(STATE_MAX_LENGTH);
    expect(parseI18nState(exact).locale).toBe("en");
    expect(parse).toHaveBeenCalledTimes(1);
    parse.mockClear();
    const error = invalidState(() => parseI18nState(`${exact} `));
    expect(error.message).toContain(String(STATE_MAX_LENGTH));
    expect(parse).not.toHaveBeenCalled();
  });

  it("[I18N-482] readI18nState applies the same limit to the script and to the meta content", () => {
    const head = '{"v":1,"locale":"en","messages":{}}';
    const big = head + " ".repeat(STATE_MAX_LENGTH);
    invalidState(() => readI18nState(pageWith({ script: big })));
    invalidState(() => readI18nState(pageWith({ meta: big })));
  });

  it("[I18N-483] a tampered version falls back: readI18nState reports through onError and returns undefined, and throws without onError", () => {
    for (const v of [2, 0, "1", null, true, [1]]) {
      const text = JSON.stringify({ v, locale: "en", messages: {} });
      invalidState(() => parseI18nState(text));
      invalidState(() => readI18nState(pageWith({ script: text })));
      const reports: I18nError[] = [];
      expect(
        readI18nState(pageWith({ script: text }), { onError: (e) => void reports.push(e) }),
      ).toBeUndefined();
      expect(reports.map((error) => error.code)).toEqual(["INVALID_STATE"]);
    }
  });

  it("[I18N-483] tampered shapes are all INVALID_STATE: wrong types, arrays, nested catalogs, non-string messages", () => {
    const shapes: unknown[] = [
      null,
      7,
      "text",
      [],
      [1, 2],
      {},
      { v: 1 },
      { v: 1, locale: "en" },
      { v: 1, messages: {} },
      { v: 1, locale: 5, messages: {} },
      { v: 1, locale: "en", messages: null },
      { v: 1, locale: "en", messages: [] },
      { v: 1, locale: "en", messages: "x" },
      { v: 1, locale: "en", messages: { en: null } },
      { v: 1, locale: "en", messages: { en: "text" } },
      { v: 1, locale: "en", messages: { en: ["a"] } },
      { v: 1, locale: "en", messages: { en: { a: 1 } } },
      { v: 1, locale: "en", messages: { en: { a: null } } },
      { v: 1, locale: "en", messages: { en: { a: { b: "nested" } } } },
      { v: 1, locale: "en", messages: { en: { a: ["x"] } } },
    ];
    for (const shape of shapes) {
      const text = JSON.stringify(shape);
      invalidState(() => parseI18nState(text));
      const reports: I18nError[] = [];
      expect(
        readI18nState(pageWith({ meta: text }), { onError: (e) => void reports.push(e) }),
      ).toBeUndefined();
      expect(reports).toHaveLength(1);
    }
    for (const text of [
      "",
      "{",
      "not json",
      "undefined",
      "{'v':1}",
      "[",
      '{"v":1,"locale":"en","messages":{}}}',
    ]) {
      invalidState(() => parseI18nState(text));
    }
  });

  it("[I18N-483] property: any JSON text either parses to a valid snapshot or is INVALID_STATE; nothing else is ever thrown", () => {
    fc.assert(
      fc.property(fc.json(), (text) => {
        try {
          const parsed = parseI18nState(text);
          expect(parsed.v).toBe(1);
          expect(typeof parsed.locale).toBe("string");
          for (const catalog of Object.values(parsed.messages)) {
            for (const value of Object.values(catalog)) expect(typeof value).toBe("string");
          }
        } catch (error) {
          expect(error).toBeInstanceOf(I18nError);
          expect((error as I18nError).code).toBe("INVALID_STATE");
        }
      }),
      { seed: 483, numRuns: 400 },
    );
  });

  it("[I18N-483] only v, locale and messages are kept, and __proto__ keys stay plain data", () => {
    const parsed = parseI18nState(
      '{"v":1,"locale":"en","messages":{"en":{"a":"A"}},"extra":{"x":1},"__proto__":{"polluted":true}}',
    );
    expect(Object.keys(parsed)).toEqual(["v", "locale", "messages"]);
    expect(Reflect.get({}, "polluted")).toBeUndefined();
    const nested = parseI18nState('{"v":1,"locale":"en","messages":{"en":{"__proto__":"x"}}}');
    expect(Object.getPrototypeOf(nested.messages["en"])).toBe(Object.prototype);
    expect(Reflect.get({}, "x")).toBeUndefined();
  });

  it("[I18N-483] a catalog over the message limit is rejected by the state parser, not left for hydrate", () => {
    const catalog = Object.fromEntries(
      Array.from({ length: CATALOG_LIMITS.maxKeys + 1 }, (_, index) => [`k${index}`, "x"]),
    );
    invalidState(() =>
      parseI18nState(JSON.stringify({ v: 1, locale: "en", messages: { en: catalog } })),
    );
  });

  it("[I18N-484] an empty page, an empty script and an empty meta all mean: no state, no error", () => {
    expect(readI18nState(pageWith())).toBeUndefined();
    expect(readI18nState(pageWith({ script: "", meta: "" }))).toBeUndefined();
    expect(readI18nState(pageWith({ script: null, meta: null }))).toBeUndefined();
  });

  it("[I18N-484] the script wins over the meta; an invalid script is not rescued by the meta", () => {
    const good = JSON.stringify(state({ a: "A" }, "fr"));
    const other = JSON.stringify(state({ a: "B" }, "en"));
    expect(readI18nState(pageWith({ script: good, meta: other }))?.locale).toBe("fr");
    expect(readI18nState(pageWith({ meta: other }))?.locale).toBe("en");
    const reports: I18nError[] = [];
    expect(
      readI18nState(pageWith({ script: "{", meta: other }), {
        onError: (e) => void reports.push(e),
      }),
    ).toBeUndefined();
    expect(reports).toHaveLength(1);
  });

  it("[I18N-484] without a document (server) readI18nState gives undefined", () => {
    expect(readI18nState()).toBeUndefined();
  });

  it("[I18N-484] createI18n with a state of an unsupported locale or a wrong version throws; hydrate does too and changes nothing", () => {
    const base = {
      defaultLocale: "en",
      locales: ["en", "fr"],
      messages: { en: { a: "A" } },
      syncDocument: false,
    } as const;
    expect(() => createI18n({ ...base, state: state({ a: "X" }, "xx") as never })).toThrow(
      expect.objectContaining({ code: "UNKNOWN_LOCALE" }),
    );
    expect(() =>
      createI18n({ ...base, state: { v: 2, locale: "en", messages: {} } as never }),
    ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    const i18n = createI18n(base);
    expect(() => i18n.hydrate({ v: 2, locale: "fr", messages: {} } as never)).toThrow(
      expect.objectContaining({ code: "INVALID_STATE" }),
    );
    expect(() => i18n.hydrate(state({ a: "X" }, "xx") as never)).toThrow(
      expect.objectContaining({ code: "UNKNOWN_LOCALE" }),
    );
    expect(i18n.locale()).toBe("en");
    expect(i18n.translate("a")).toBe("A");
  });

  it("[I18N-484] a hostile catalog inside a state that the parser accepted is still stopped by hydrate (depth and key bounds)", () => {
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: { a: "A" } },
      syncDocument: false,
    });
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let level = 0; level < CATALOG_LIMITS.maxDepth + 2; level += 1) {
      const next: Record<string, unknown> = {};
      cursor["n"] = next;
      cursor = next;
    }
    expect(() => i18n.hydrate({ v: 1, locale: "en", messages: { en: deep } } as never)).toThrow(
      expect.objectContaining({ code: "INVALID_CATALOG" }),
    );
    expect(i18n.translate("a")).toBe("A");
  });
});
