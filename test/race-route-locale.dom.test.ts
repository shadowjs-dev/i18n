import { flushSync, useSignal } from "@shadow-js/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { I18nError } from "../src/errors";
import { type RouteLocationSource, syncLocaleWithRoute } from "../src/route-locale";
import { drain, gatedLoader } from "./support/deferred";
import { createI18n } from "./support/full-instance";

afterEach(() => {
  document.documentElement.removeAttribute("lang");
  document.documentElement.removeAttribute("dir");
});

/** A router stand-in whose location the test moves; `undefined` is "before the first location". */
function fakeRouter(initial: string | undefined) {
  const [pathname, setPathname] = useSignal<string | undefined>(initial);
  const router: RouteLocationSource = {
    state: {
      location: () => (pathname() === undefined ? undefined : { pathname: pathname() ?? "" }),
    },
  };
  return {
    router,
    navigate(next: string): void {
      setPathname(() => next);
      flushSync();
    },
  };
}

function setup(prefix: "always" | "as-needed", initial: string | undefined) {
  const fr = gatedLoader();
  const de = gatedLoader();
  const errors: I18nError[] = [];
  const i18n = createI18n({
    defaultLocale: "en",
    locales: ["en", "fr", "de"],
    messages: { en: { title: "Welcome" } },
    loaders: { fr: fr.load, de: de.load },
    prefix,
    onError: (error) => errors.push(error),
  });
  const route = fakeRouter(initial);
  const stop = syncLocaleWithRoute(i18n, route.router);
  return { i18n, route, stop, fr, de, errors };
}

describe("syncLocaleWithRoute under races", () => {
  it("[I18N-499] the route location drives the locale: a navigation to another prefix loads and applies it, lang follows", async () => {
    const { i18n, route, fr } = setup("always", "/en/home");
    expect(i18n.locale()).toBe("en");
    route.navigate("/fr/accueil");
    expect(fr.calls).toHaveLength(1);
    expect(i18n.locale()).toBe("en");
    expect(i18n.pending()).toBe("fr");
    fr.calls[0]?.resolve({ title: "Bienvenue" });
    await drain();
    expect(i18n.locale()).toBe("fr");
    expect(i18n.t("title")).toBe("Bienvenue");
    expect(document.documentElement.getAttribute("lang")).toBe("fr");
  });

  it("[I18N-499] a navigation within the same locale prefix does not call setLocale and never reloads a catalog", async () => {
    const { i18n, route, fr } = setup("always", "/en/home");
    route.navigate("/fr/a");
    fr.calls[0]?.resolve({ title: "Bienvenue" });
    await drain();
    const spy = vi.spyOn(i18n, "setLocale");
    for (const path of ["/fr/b", "/fr/c/d", "/fr", "/fr/", "/fr/a?x=1#h"]) route.navigate(path);
    expect(spy).not.toHaveBeenCalled();
    expect(fr.calls).toHaveLength(1);
    expect(i18n.locale()).toBe("fr");
  });

  it("[I18N-499] going to another locale and back loads each catalog once", async () => {
    const { i18n, route, fr, de } = setup("always", "/en");
    route.navigate("/fr");
    fr.calls[0]?.resolve({ title: "F" });
    await drain();
    route.navigate("/de");
    de.calls[0]?.resolve({ title: "D" });
    await drain();
    route.navigate("/fr");
    route.navigate("/de");
    route.navigate("/en");
    await drain();
    expect(fr.calls).toHaveLength(1);
    expect(de.calls).toHaveLength(1);
    expect(i18n.locale()).toBe("en");
  });

  it("[I18N-499] rapid navigation fr, de, fr with the loaders finishing in reverse order: the last URL wins", async () => {
    const { i18n, route, fr, de } = setup("always", "/en");
    route.navigate("/fr");
    route.navigate("/de");
    route.navigate("/fr");
    expect(fr.calls).toHaveLength(1);
    de.calls[0]?.resolve({ title: "D" });
    await drain();
    expect(i18n.locale()).toBe("en");
    fr.calls[0]?.resolve({ title: "F" });
    await drain();
    expect(i18n.locale()).toBe("fr");
    expect(i18n.t("title")).toBe("F");
    expect(i18n.pending()).toBeUndefined();
  });

  it("[I18N-499] an unsupported prefix does not change the locale (always)", async () => {
    const { i18n, route, fr } = setup("always", "/en");
    route.navigate("/fr");
    fr.calls[0]?.resolve({ title: "F" });
    await drain();
    const spy = vi.spyOn(i18n, "setLocale");
    for (const path of ["/xx/about", "/pt-BR/about", "/zz", "/about", "/"]) route.navigate(path);
    expect(spy).not.toHaveBeenCalled();
    expect(i18n.locale()).toBe("fr");
  });

  it("[I18N-499] an unsupported prefix does not change the locale (as-needed), while a path without any prefix is the default locale", async () => {
    const { i18n, route, fr } = setup("as-needed", "/about");
    route.navigate("/fr/about");
    fr.calls[0]?.resolve({ title: "F" });
    await drain();
    const spy = vi.spyOn(i18n, "setLocale");
    for (const path of ["/xx/about", "/pt-BR/about", "/zz"]) route.navigate(path);
    expect(spy).not.toHaveBeenCalled();
    expect(i18n.locale()).toBe("fr");
    route.navigate("/about");
    expect(spy).toHaveBeenCalledWith("en");
    await drain();
    expect(i18n.locale()).toBe("en");
  });

  it("[I18N-499] the first location is read, not synced; a location that arrives later is synced", async () => {
    const { i18n, route, fr } = setup("always", undefined);
    expect(i18n.locale()).toBe("en");
    route.navigate("/fr/x");
    fr.calls[0]?.resolve({ title: "F" });
    await drain();
    expect(i18n.locale()).toBe("fr");

    const second = setup("always", "/fr/start");
    expect(second.i18n.locale()).toBe("en");
    expect(second.fr.calls).toHaveLength(0);
  });

  it("[I18N-499] a locale the app chose with a switcher stays while the URL keeps its locale segment", async () => {
    const { i18n, route, fr } = setup("always", "/en/a");
    const switched = i18n.setLocale("fr");
    fr.calls[0]?.resolve({ title: "F" });
    await switched;
    route.navigate("/en/b");
    route.navigate("/en/c");
    expect(i18n.locale()).toBe("fr");
  });

  it("[I18N-499] a failed catalog load is reported, the old locale stays, and the sync keeps following later navigations", async () => {
    const { i18n, route, fr, de, errors } = setup("always", "/en");
    route.navigate("/fr");
    fr.calls[0]?.reject(new Error("offline"));
    await drain();
    expect(i18n.locale()).toBe("en");
    expect(errors.map((error) => error.code)).toEqual(["LOAD_FAILED"]);
    route.navigate("/de");
    de.calls[0]?.resolve({ title: "D" });
    await drain();
    expect(i18n.locale()).toBe("de");
  });

  it("[I18N-499] stop() ends the sync, and a disposed instance ignores the route", async () => {
    const first = setup("always", "/en");
    first.stop();
    first.route.navigate("/fr");
    expect(first.fr.calls).toHaveLength(0);
    expect(first.i18n.locale()).toBe("en");

    const second = setup("always", "/en");
    second.i18n.dispose();
    second.route.navigate("/fr");
    await drain();
    expect(second.fr.calls).toHaveLength(0);
    expect(second.i18n.locale()).toBe("en");
  });

  it("[I18N-499] a pathname outside the router's base is read as it is", async () => {
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en", "fr"],
      messages: { en: { title: "T" }, fr: { title: "F" } },
      prefix: "always",
    });
    const route = fakeRouter("/app/en");
    syncLocaleWithRoute(i18n, route.router, { base: "/app/" });
    route.navigate("/app/fr");
    expect(i18n.locale()).toBe("fr");
    route.navigate("/application/en");
    expect(i18n.locale()).toBe("fr");
    route.navigate("/app");
    expect(i18n.locale()).toBe("fr");
  });
});
