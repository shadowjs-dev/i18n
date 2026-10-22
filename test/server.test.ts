import { describe, expect, it } from "vitest";
import { createI18nFull as createI18n } from "../src/full";
import { i18nHeadTags } from "../src/head";
import { createI18nMiddleware, getEventI18n } from "../src/server";
import {
  parseI18nState,
  readI18nState,
  renderI18nStateScript,
  STATE_MAX_LENGTH,
  serializeI18nState,
} from "../src/state";
import { en, fr } from "./support/catalogs";
import { fakeEvent } from "./support/event";

function app(prefix: "always" | "as-needed" | "never" = "as-needed") {
  let frLoads = 0;
  const i18n = createI18n({
    defaultLocale: "en",
    locales: ["en", "fr", "ar"],
    messages: { en },
    loaders: {
      fr: () => {
        frLoads += 1;
        return Promise.resolve(fr);
      },
      ar: () => ({ hello: "مرحبا {name}" }),
    },
    prefix,
    syncDocument: false,
  });
  return { i18n, loads: () => frLoads };
}

describe("createI18nMiddleware", () => {
  it("[I18N-120] picks the locale from the URL, loads its catalog and gives the request its own instance", async () => {
    const { i18n, loads } = app("always");
    const middleware = createI18nMiddleware(i18n, { strategy: ["url"] });
    const event = fakeEvent("https://x.test/fr/about");
    const response = await middleware(event, () => Promise.resolve(new Response("ok")));
    expect(await response.text()).toBe("ok");
    const scoped = getEventI18n<typeof i18n>(event);
    expect(scoped).not.toBe(i18n);
    expect(scoped.locale()).toBe("fr");
    expect(scoped.t("hello", { name: "A" })).toBe("Bonjour A");
    expect(i18n.locale()).toBe("en");
    expect(event.document).toEqual({ lang: "fr", dir: "ltr" });
    expect(event.headers.get("content-language")).toBe("fr");
    expect(loads()).toBe(1);
  });

  it("[I18N-121] concurrent requests never share a locale", async () => {
    const { i18n } = app("always");
    const middleware = createI18nMiddleware(i18n, { strategy: ["url"] });
    const seen: string[] = [];
    const run = async (path: string): Promise<void> => {
      const event = fakeEvent(`https://x.test${path}`);
      await middleware(event, async () => {
        await Promise.resolve();
        seen.push(`${path}=${getEventI18n<typeof i18n>(event).translate("hello", { name: "x" })}`);
        return new Response("ok");
      });
    };
    await Promise.all([run("/fr/a"), run("/en/b"), run("/ar/c"), run("/fr/d")]);
    expect(seen.sort()).toEqual([
      // Arabic is right to left: the value is isolated; the left-to-right lines are unchanged.
      "/ar/c=مرحبا ⁨x⁩",
      "/en/b=Hello x",
      "/fr/a=Bonjour x",
      "/fr/d=Bonjour x",
    ]);
  });

  it("[I18N-122] falls back from URL to cookie to Accept-Language to the default; rtl sets dir", async () => {
    const { i18n } = app("never");
    const middleware = createI18nMiddleware(i18n);
    const next = (): Promise<Response> => Promise.resolve(new Response("ok"));
    const cookie = fakeEvent("https://x.test/p", {
      cookies: { locale: "fr" },
      headers: { "accept-language": "ar" },
    });
    await middleware(cookie, next);
    expect(cookie.document.lang).toBe("fr");
    const accept = fakeEvent("https://x.test/p", {
      headers: { "accept-language": "ar-EG,en;q=0.5" },
    });
    await middleware(accept, next);
    expect(accept.document).toEqual({ lang: "ar", dir: "rtl" });
    const none = fakeEvent("https://x.test/p", { headers: { "accept-language": "ja" } });
    await middleware(none, next);
    expect(none.document.lang).toBe("en");
    expect(none.headers.get("vary")).toBe("Accept-Language, Cookie");
  });

  it("[I18N-123] remembers a URL-chosen locale in a readable cookie, once", async () => {
    const { i18n } = app("always");
    const middleware = createI18nMiddleware(i18n, {
      strategy: ["url", "cookie"],
      cookie: { name: "NEXT_LOCALE", maxAge: 60 },
    });
    const next = (): Promise<Response> => Promise.resolve(new Response("ok"));
    const first = fakeEvent("https://x.test/fr/a");
    await middleware(first, next);
    expect(first.sent).toEqual([
      {
        name: "NEXT_LOCALE",
        value: "fr",
        options: { path: "/", maxAge: 60, httpOnly: false, sameSite: "lax" },
      },
    ]);
    const again = fakeEvent("https://x.test/fr/a", { cookies: { NEXT_LOCALE: "fr" } });
    await middleware(again, next);
    expect(again.sent).toEqual([]);
    const off = createI18nMiddleware(i18n, { strategy: ["url"], cookie: false });
    const quiet = fakeEvent("https://x.test/fr/a");
    await off(quiet, next);
    expect(quiet.sent).toEqual([]);
  });

  it("[I18N-124] redirects to the canonical URL for GET only, never off-site", async () => {
    const { i18n } = app("always");
    // `exclude: []`: `//evil.com` has a file extension, which the default filter would leave alone.
    const middleware = createI18nMiddleware(i18n, {
      strategy: ["url", "accept-language"],
      redirect: true,
      exclude: [],
    });
    let ran = false;
    const next = (): Promise<Response> => {
      ran = true;
      return Promise.resolve(new Response("ok"));
    };
    const moved = await middleware(
      fakeEvent("https://x.test/about?x=1", { headers: { "accept-language": "fr" } }),
      next,
    );
    expect(moved.status).toBe(307);
    expect(moved.headers.get("location")).toBe("/fr/about?x=1");
    expect(moved.headers.get("vary")).toBe("Accept-Language");
    expect(ran).toBe(false);
    const evil = await middleware(
      fakeEvent("https://x.test//evil.com", { headers: { "accept-language": "fr" } }),
      next,
    );
    expect(evil.headers.get("location")).toBe("/fr/evil.com");
    const post = await middleware(
      fakeEvent("https://x.test/about", { method: "POST", headers: { "accept-language": "fr" } }),
      next,
    );
    expect(post.status).toBe(200);
    expect(ran).toBe(true);
  });

  it("[I18N-125] getEventI18n explains a missing middleware", () => {
    expect(() => getEventI18n(fakeEvent("https://x.test/"))).toThrow(/createI18nMiddleware/);
  });
});

describe("hydration state", () => {
  it("[I18N-130] the state round trips through serialize and parse, and escapes script breakers", () => {
    const { i18n } = app();
    const state = i18n.state();
    const text = serializeI18nState({
      ...state,
      messages: { en: { evil: "</script><!-- & \u2028" } },
    });
    expect(text).not.toMatch(/[<>&\u2028]/);
    expect(parseI18nState(text).messages["en"]?.["evil"]).toBe("</script><!-- & \u2028");
    expect(parseI18nState(serializeI18nState(state))).toEqual(state);
  });

  it("[I18N-131] parse rejects oversized, malformed and mis-shaped state", () => {
    expect(() => parseI18nState("x".repeat(STATE_MAX_LENGTH + 1))).toThrow(/larger than/);
    expect(() => parseI18nState("{nope")).toThrow(/not valid JSON/);
    expect(() => parseI18nState("[]")).toThrow(/version 1/);
    expect(() => parseI18nState('{"v":1,"locale":"en","messages":{"en":{"a":1}}}')).toThrow(
      /must be a string/,
    );
    expect(() => parseI18nState('{"v":1,"locale":"en","messages":{"en":"x"}}')).toThrow(
      /must be an object/,
    );
    expect(
      parseI18nState('{"v":1,"locale":"en","messages":{"__proto__":{"a":"b"}}}').messages,
    ).toHaveProperty("__proto__");
    expect(({} as Record<string, unknown>)["a"]).toBeUndefined();
  });

  it("[I18N-132] the script helper only interpolates safe tokens", () => {
    const state = { v: 1 as const, locale: "en", messages: {} };
    expect(renderI18nStateScript(state, { nonce: "abc123==" })).toBe(
      '<script type="application/json" id="__SHADOW_I18N__" nonce="abc123==">{"v":1,"locale":"en","messages":{}}</script>',
    );
    expect(() => renderI18nStateScript(state, { nonce: '"><script>' })).toThrow(/nonce/);
    expect(() => renderI18nStateScript(state, { id: "a b" })).toThrow(/id/);
  });

  it("[I18N-133] readI18nState finds the script, then the meta tag, then nothing", () => {
    const state = { v: 1 as const, locale: "fr", messages: { fr: { a: "b" } } };
    const text = serializeI18nState(state);
    const withScript = {
      getElementById: () => ({ textContent: text }),
      querySelector: () => null,
    };
    expect(readI18nState(withScript)).toEqual(state);
    const withMeta = {
      getElementById: () => null,
      querySelector: (selector: string) =>
        selector.includes("shadow-i18n") ? { getAttribute: () => text } : null,
    };
    expect(readI18nState(withMeta)).toEqual(state);
    expect(
      readI18nState({ getElementById: () => null, querySelector: () => null }),
    ).toBeUndefined();
    expect(readI18nState()).toBeUndefined();
  });
});

describe("head tags", () => {
  it("[I18N-134] hreflang alternates, canonical, og:locale and the optional state meta", () => {
    const { i18n } = app();
    const tags = i18nHeadTags(i18n, {
      path: "/about",
      origin: "https://example.com",
      openGraph: true,
      state: true,
    });
    const links = tags
      .filter((tag) => tag.tag === "link")
      .map((tag) => `${tag.props["rel"]} ${tag.props["hreflang"] ?? "-"} ${tag.props["href"]}`);
    expect(links).toEqual([
      "alternate en https://example.com/about",
      "alternate fr https://example.com/fr/about",
      "alternate ar https://example.com/ar/about",
      "alternate x-default https://example.com/about",
      "canonical - https://example.com/about",
    ]);
    expect(
      tags
        .filter((tag) => tag.tag === "meta")
        .map((tag) => `${tag.props["property"] ?? tag.props["name"]}`),
    ).toEqual(["og:locale", "og:locale:alternate", "og:locale:alternate", "shadow-i18n"]);
    const french = i18nHeadTags(i18n, {
      path: "/",
      origin: "https://example.com",
      locale: "fr",
      canonical: true,
    });
    expect(french.at(-1)?.props["href"]).toBe("https://example.com/fr");
  });
});
