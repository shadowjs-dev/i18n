import { flushSync, useSignal } from "@shadow-js/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../src/create-i18n";
import { syncLocaleWithRoute } from "../src/route-locale";
import { localeRouting } from "../src/routing";

/**
 * The route-to-locale sync: a navigation that changes the locale segment of the URL sets the i18n locale, and the
 * document's lang and dir follow it (WCAG 3.1.1, 3.1.2). The router is stood in for by its live location.
 */

const messages = {
  en: { title: "Welcome" },
  ar: { title: "أهلا" },
} as const;

afterEach(() => {
  document.documentElement.removeAttribute("lang");
  document.documentElement.removeAttribute("dir");
});

/** A router stand-in: `navigate` changes the pathname the way a client navigation does. */
function fakeRouter(initial: string) {
  const [pathname, setPathname] = useSignal<string>(initial);
  return {
    router: { state: { location: () => ({ pathname: pathname() }) } },
    navigate(next: string): void {
      setPathname(() => next);
      flushSync();
    },
  };
}

function setup(prefix: "always" | "as-needed" | "never", initialPath: string) {
  const i18n = createI18n({
    defaultLocale: "en",
    locales: ["en", "ar"],
    messages,
    prefix,
    features: [localeRouting],
  });
  const router = fakeRouter(initialPath);
  const stop = syncLocaleWithRoute(i18n, router.router);
  return { i18n, router, stop };
}

describe("syncLocaleWithRoute", () => {
  it("[I18N-NAV-01] a navigation to the other locale's path sets the locale, the document lang and dir (rtl for ar)", () => {
    const { i18n, router } = setup("always", "/en");
    expect(document.documentElement.getAttribute("lang")).toBe("en");
    router.navigate("/ar");
    expect(i18n.locale()).toBe("ar");
    expect(document.documentElement.getAttribute("lang")).toBe("ar");
    expect(document.documentElement.getAttribute("dir")).toBe("rtl");
    expect(i18n.t("title")).toBe("أهلا");
  });

  it("[I18N-NAV-02] going back to the first locale restores its lang and dir (ltr)", () => {
    const { i18n, router } = setup("always", "/en");
    router.navigate("/ar");
    router.navigate("/en");
    expect(i18n.locale()).toBe("en");
    expect(document.documentElement.getAttribute("lang")).toBe("en");
    expect(document.documentElement.getAttribute("dir")).toBe("ltr");
  });

  it("[I18N-NAV-03] a navigation that keeps the locale segment does not call setLocale", () => {
    const { i18n, router } = setup("always", "/en");
    const spy = vi.spyOn(i18n, "setLocale");
    router.navigate("/en/about");
    router.navigate("/en/contact");
    expect(spy).not.toHaveBeenCalled();
    expect(i18n.locale()).toBe("en");
  });

  it("[I18N-NAV-04] as-needed: a path without a locale segment is the default locale", () => {
    const { i18n, router } = setup("as-needed", "/about");
    expect(i18n.locale()).toBe("en");
    router.navigate("/ar/about");
    expect(i18n.locale()).toBe("ar");
    router.navigate("/about");
    expect(i18n.locale()).toBe("en");
    expect(document.documentElement.getAttribute("dir")).toBe("ltr");
  });

  it("[I18N-NAV-05] prefix never: the URL names no locale, so nothing changes", () => {
    const { i18n, router } = setup("never", "/en");
    const spy = vi.spyOn(i18n, "setLocale");
    router.navigate("/ar");
    expect(spy).not.toHaveBeenCalled();
    expect(i18n.locale()).toBe("en");
  });

  it("[I18N-NAV-07] with the router's base, the locale segment is read after the base (the location keeps the base)", () => {
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en", "ar"],
      messages,
      prefix: "always",
      features: [localeRouting],
    });
    const router = fakeRouter("/app/en");
    syncLocaleWithRoute(i18n, router.router, { base: "/app" });
    router.navigate("/app/ar");
    expect(i18n.locale()).toBe("ar");
    expect(document.documentElement.getAttribute("dir")).toBe("rtl");
    router.navigate("/app/en");
    expect(i18n.locale()).toBe("en");
  });

  it("[I18N-NAV-06] the returned function stops the sync; a later navigation changes nothing", () => {
    const { i18n, router, stop } = setup("always", "/en");
    stop();
    router.navigate("/ar");
    expect(i18n.locale()).toBe("en");
    expect(document.documentElement.getAttribute("lang")).toBe("en");
  });
});
