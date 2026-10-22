import { describe, expect, it } from "vitest";
import { extractMessages } from "../src/extract";
import { createI18nFull as createI18n } from "../src/full";
import { createLocaleRouting } from "../src/routing";
import { createI18nMiddleware, DEFAULT_I18N_EXCLUDE, getEventI18n } from "../src/server";
import { en, fr } from "./support/catalogs";
import { fakeEvent } from "./support/event";

function lazy(loaded: unknown = fr): { i18n: ReturnType<typeof make>; calls: () => number } {
  let calls = 0;
  const i18n = make(() => {
    calls += 1;
    return loaded;
  });
  return { i18n, calls: () => calls };
}

function make(loader: () => unknown) {
  return createI18n({
    defaultLocale: "en",
    locales: ["en", "fr"],
    messages: { en },
    loaders: { fr: loader as () => typeof fr },
    syncDocument: false,
  });
}

describe("addMessages before the first load", () => {
  it("[I18N-210] a lazy locale stays unloaded: the loader runs, the additions win over its text", async () => {
    const { i18n, calls } = lazy();
    i18n.addMessages("fr", { hello: "Salut {name}", extra: "Extra" });
    expect(i18n.isLoaded("fr")).toBe(false);
    await i18n.load("fr");
    expect(calls()).toBe(1);
    expect(i18n.isLoaded("fr")).toBe(true);
    const french = i18n.fork("fr");
    expect(french.translate("hello", { name: "Ada" })).toBe("Salut Ada");
    expect(french.translate("extra")).toBe("Extra");
    // From the loader, not from the additions.
    expect(french.translate("cart.items", { count: 2 })).toBe("2 articles");
  });

  it("[I18N-210] setLocale on such a locale loads it, and the chain is not 'loaded' before", async () => {
    const { i18n, calls } = lazy();
    i18n.addMessages("fr", { only: "partial" });
    const result = i18n.setLocale("fr");
    expect(i18n.locale()).toBe("en");
    expect(await result).toBe("fr");
    expect(calls()).toBe(1);
    expect(i18n.translate("terms")).toContain("conditions");
  });

  it("[I18N-210] { partial: false } says the messages are the whole catalog: the loader is not needed", async () => {
    const { i18n, calls } = lazy();
    i18n.addMessages("fr", { hello: "Salut {name}" }, { partial: false });
    expect(i18n.isLoaded("fr")).toBe(true);
    await i18n.load("fr");
    expect(calls()).toBe(0);
    // A later partial addition to a complete catalog keeps it complete.
    i18n.addMessages("fr", { more: "Plus" });
    expect(i18n.isLoaded("fr")).toBe(true);
    // A locale without a loader has nothing more to load: an addition is its catalog.
    const eager = createI18n({ defaultLocale: "en", locales: ["en", "fr"], syncDocument: false });
    eager.addMessages("fr", { a: "b" });
    expect(eager.isLoaded("fr")).toBe(true);
  });

  it("[I18N-210] a snapshot from the server marks its catalogs complete", async () => {
    const { i18n, calls } = lazy();
    i18n.addMessages("fr", { only: "partial" });
    i18n.hydrate({ v: 1, locale: "fr", messages: { fr: { hello: "Bonjour {name}" } } });
    expect(i18n.isLoaded("fr")).toBe(true);
    await i18n.load("fr");
    expect(calls()).toBe(0);
  });
});

describe("loader results", () => {
  it("[I18N-211] { default: catalog } is unwrapped, with or without __esModule; a catalog with other keys is not", async () => {
    for (const result of [{ default: fr }, { default: fr, __esModule: true }]) {
      const { i18n } = lazy(result);
      await i18n.load("fr");
      expect(i18n.fork("fr").translate("hello", { name: "Ada" })).toBe("Bonjour Ada");
    }
    // `default` next to other keys is a namespace of the catalog, not a module wrapper.
    const { i18n } = lazy({ default: { a: "namespace" }, hello: "Salut {name}" });
    await i18n.load("fr");
    const french = i18n.fork("fr");
    expect(french.translate("hello", { name: "Ada" })).toBe("Salut Ada");
    expect(french.translate("default.a")).toBe("namespace");
  });

  it("[I18N-211] a promise of a wrapper works; a wrapper whose default is not a catalog is an INVALID_CATALOG error", async () => {
    const { i18n } = lazy(Promise.resolve({ default: fr }));
    await i18n.load("fr");
    expect(i18n.fork("fr").translate("hello", { name: "Ada" })).toBe("Bonjour Ada");
    const { i18n: broken } = lazy({ default: undefined });
    await expect(broken.load("fr")).rejects.toMatchObject({ code: "INVALID_CATALOG" });
  });
});

describe("locale routing: never a protocol-relative path", () => {
  const options = { locales: ["en", "fr"], defaultLocale: "en" } as const;
  const unsafe = (value: string): boolean =>
    value.startsWith("//") ||
    value.startsWith("/\\") ||
    /^\/(?:%2f|%5c)/i.test(value) ||
    !value.startsWith("/");

  const inputs: Array<[string, string]> = [
    ["/fr//evil.example", "/evil.example"],
    ["/fr///evil.example/x", "/evil.example/x"],
    ["/fr/\\evil.example", "/evil.example"],
    ["/fr\\\\evil.example", "/evil.example"],
    ["/fr/%2Fevil.example", "/evil.example"],
    ["/fr/%2f%2fevil.example", "/evil.example"],
    ["/fr/%5Cevil.example", "/evil.example"],
    ["/fr/%2F/%5C/evil.example", "/evil.example"],
    ["//fr//evil.example", "/evil.example"],
    ["/fr/\t/evil.example", "/evil.example"],
    ["/fr//", "/"],
    ["/fr/", "/"],
    ["/fr", "/"],
  ];

  for (const prefix of ["always", "as-needed"] as const) {
    it(`[I18N-212] parse and resolve never return a protocol-relative path (${prefix})`, () => {
      const routing = createLocaleRouting({ ...options, prefix });
      for (const [input, path] of inputs) {
        const parsed = routing.parse(input);
        expect(parsed.locale, input).toBe("fr");
        expect(parsed.path, input).toBe(path);
        const resolved = routing.resolve(input);
        expect(unsafe(resolved.path), `${input} -> ${resolved.path}`).toBe(false);
        expect(resolved.path, input).toBe(path);
        if (resolved.redirectTo !== undefined) {
          expect(unsafe(resolved.redirectTo), `${input} -> ${resolved.redirectTo}`).toBe(false);
        }
        const canonical = routing.canonical(input, "fr");
        if (canonical !== undefined) expect(unsafe(canonical), input).toBe(false);
        expect(unsafe(routing.localePath(input, "fr")), input).toBe(false);
        expect(unsafe(routing.localePath(input, "en")), input).toBe(false);
      }
    });
  }

  it("[I18N-212] paths without a locale are cleaned the same way, and inner slashes are data", () => {
    const routing = createLocaleRouting(options);
    for (const input of [
      "//evil.example",
      "\\\\evil.example",
      "/%2F%2Fevil.example",
      "/\\/evil.example",
    ]) {
      const parsed = routing.parse(input);
      expect(parsed.locale, input).toBeUndefined();
      expect(parsed.path, input).toBe("/evil.example");
      expect(routing.resolve(input).redirectTo, input).toBeUndefined();
    }
    expect(routing.parse("/a//b").path).toBe("/a//b");
    expect(routing.localePath("https://evil.com", "en")).toBe("/https://evil.com");
    // The suffix is kept apart and untouched.
    expect(routing.localePath("//evil.example/x?next=//a#//b", "fr")).toBe(
      "/fr/evil.example/x?next=//a#//b",
    );
  });
});

describe("a prefix that looks like a locale but is not one", () => {
  const always = createLocaleRouting({
    locales: ["en", "fr"],
    defaultLocale: "en",
    prefix: "always",
  });
  const asNeeded = createLocaleRouting({ locales: ["en", "fr"], defaultLocale: "en" });

  it("[I18N-213] is reported as unsupported and never redirected to a prefixed copy that does not exist", () => {
    for (const routing of [always, asNeeded]) {
      expect(routing.parse("/xx/about")).toEqual({
        locale: undefined,
        path: "/xx/about",
        unsupported: "xx",
      });
      expect(routing.parse("/pt-BR/about").unsupported).toBe("pt-BR");
      expect(routing.canonical("/xx/about", "en")).toBeUndefined();
      expect(routing.canonical("/xx/about", "fr")).toBeUndefined();
      expect(routing.resolve("/xx/about")).toEqual({
        locale: "en",
        path: "/xx/about",
        redirectTo: undefined,
        unsupported: "xx",
      });
    }
    // Ordinary unprefixed paths keep their behavior.
    expect(always.canonical("/about", "en")).toBe("/en/about");
    expect(always.parse("/about").unsupported).toBeUndefined();
    expect(always.parse("/faq").unsupported).toBeUndefined();
    expect(asNeeded.canonical("/fr/about", "en")).toBe("/about");
    expect(
      createLocaleRouting({ locales: ["en", "fr"], defaultLocale: "en", prefix: "never" }).parse(
        "/xx/a",
      ).unsupported,
    ).toBeUndefined();
  });

  it("[I18N-213] the middleware answers it in the detected or default locale without redirecting", async () => {
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en", "fr"],
      messages: { en, fr },
      prefix: "always",
      syncDocument: false,
    });
    const middleware = createI18nMiddleware(i18n, {
      strategy: ["url", "accept-language"],
      redirect: true,
    });
    const event = fakeEvent("https://x.test/xx/about", { headers: { "accept-language": "fr" } });
    const response = await middleware(event, () => Promise.resolve(new Response("page")));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(getEventI18n(event).locale()).toBe("fr");
    const unprefixed = await middleware(
      fakeEvent("https://x.test/about", { headers: { "accept-language": "fr" } }),
      () => Promise.resolve(new Response("page")),
    );
    expect(unprefixed.headers.get("location")).toBe("/fr/about");
  });
});

describe("extractMessages: only a whole literal argument is a key", () => {
  const table: Array<[string, { keys: string[]; dynamic: string[] }]> = [
    ['t("a" + "b")', { keys: [], dynamic: ["a"] }],
    ['t("items." + n)', { keys: [], dynamic: ["items."] }],
    ['t("a".trim())', { keys: [], dynamic: [""] }],
    ['t("a" as Key)', { keys: [], dynamic: [""] }],
    ['t("a", { n })', { keys: ["a"], dynamic: [] }],
    ['t("a")', { keys: ["a"], dynamic: [] }],
    ["t(`a`)", { keys: ["a"], dynamic: [] }],
    ["t(`a." + "$" + "{n}`)", { keys: [], dynamic: ["a."] }],
    ['t(cond ? "a" : "b")', { keys: [], dynamic: [""] }],
    ['i18n.t.rich("a" + "b", {})', { keys: [], dynamic: ["a"] }],
    ['translate("a" + b, x)', { keys: [], dynamic: ["a"] }],
  ];
  for (const [source, expected] of table) {
    it(`[I18N-214] ${source}`, () => {
      const result = extractMessages(source);
      expect(result.keys.map((entry) => entry.key)).toEqual(expected.keys);
      expect(result.dynamic.map((entry) => entry.prefix)).toEqual(expected.dynamic);
    });
  }

  it("[I18N-214] a Trans key that is not a plain string is dynamic", () => {
    const result = extractMessages('<Trans key={"a" + "b"} /><Trans key="c" />');
    expect(result.keys.map((entry) => entry.key)).toEqual(["c"]);
    expect(result.dynamic).toHaveLength(1);
  });
});

describe("the middleware path filter", () => {
  function setup(options: Parameters<typeof createI18nMiddleware>[1] = {}) {
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en", "fr"],
      messages: { en, fr },
      prefix: "always",
      syncDocument: false,
    });
    const middleware = createI18nMiddleware(i18n, {
      strategy: ["url", "cookie", "accept-language"],
      redirect: true,
      ...options,
    });
    const run = async (path: string) => {
      const event = fakeEvent(`https://x.test${path}`, { headers: { "accept-language": "fr" } });
      let ran = false;
      const response = await middleware(event, () => {
        ran = true;
        return Promise.resolve(new Response("next"));
      });
      return { event, response, ran };
    };
    return { run };
  }

  it("[I18N-215] by default API routes, Dusk's own endpoints and files go straight on, untouched", async () => {
    const { run } = setup();
    for (const path of [
      "/api/users",
      "/api",
      "/_dusk/fn/abc",
      "/favicon.ico",
      "/assets/app.4f3a.js",
      "/robots.txt",
    ]) {
      const { event, response, ran } = await run(path);
      expect(ran, path).toBe(true);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("location"), path).toBeNull();
      expect(event.sent, path).toEqual([]);
      expect(event.document.lang, path).toBe("en");
      expect(event.headers.get("vary"), path).toBeNull();
      expect(() => getEventI18n(event), path).toThrow(/no i18n instance/);
    }
    // Pages are still handled, also ones with a dot in a directory name or a trailing dot-less name.
    for (const path of ["/about", "/apiary", "/v1.0/about"]) {
      const { response } = await run(path);
      expect(response.status, path).toBe(307);
      expect(response.headers.get("location"), path).toBe(`/fr${path}`);
    }
    expect(DEFAULT_I18N_EXCLUDE).toHaveLength(3);
  });

  it("[I18N-215] exclude replaces the default; strings match at a segment boundary; RegExp and functions work", async () => {
    const { run } = setup({
      exclude: ["/internal", /^\/hooks\//, (pathname) => pathname.endsWith(".json")],
    });
    for (const path of ["/internal", "/internal/x", "/hooks/stripe", "/data.json"]) {
      expect((await run(path)).ran, path).toBe(true);
      expect((await run(path)).response.headers.get("location"), path).toBeNull();
    }
    // `/api` is no longer excluded; `/internal-x` is not under `/internal`.
    expect((await run("/api/users")).response.headers.get("location")).toBe("/fr/api/users");
    expect((await run("/internal-x")).response.headers.get("location")).toBe("/fr/internal-x");
    // `exclude: []` handles everything.
    const all = setup({ exclude: [] });
    expect((await all.run("/favicon.ico")).response.headers.get("location")).toBe(
      "/fr/favicon.ico",
    );
  });

  it("[I18N-215] include limits the middleware to the paths it names", async () => {
    const { run } = setup({ include: ["/shop", /^\/blog\//] });
    expect((await run("/shop/cart")).response.status).toBe(307);
    expect((await run("/blog/post")).response.status).toBe(307);
    const outside = await run("/about");
    expect(outside.response.status).toBe(200);
    expect(outside.response.headers.get("location")).toBeNull();
    // `exclude` still applies inside `include`.
    expect((await run("/shop/logo.svg")).response.headers.get("location")).toBeNull();
  });
});
