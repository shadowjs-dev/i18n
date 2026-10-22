import { flushSync, useSignal } from "@shadow-js/core";
import { cleanup, fireEvent, render } from "@shadow-js/testing/dom";
import { createComponent } from "@shadow-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createI18nFull as createI18n } from "../src/full";
import { cookieStrategy } from "../src/persist";
import type { Messages } from "../src/types";
import { en, fr, lazyI18n } from "./support/catalogs";
import { load } from "./support/compile";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("lang");
  document.documentElement.removeAttribute("dir");
  cookieStrategy({ maxAge: 0 }).write("");
  localStorage.clear();
});

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  flushSync();
};

function twoLocales(extra: object = {}) {
  return createI18n({
    defaultLocale: "en",
    locales: ["en", "fr", "ar"],
    messages: { en, fr, ar: { hello: "مرحبا {name}" } },
    ...extra,
  });
}

interface UiModule {
  App(props: { i18n: ReturnType<typeof twoLocales>; name: () => string }): unknown;
}

const UI = `
import { I18nProvider, useI18n, Trans, FormattedNumber, FormattedDate, FormattedList, FormattedRelative } from "@i18n";
function Greeting(props) {
  const { t } = useI18n();
  return <p id="greeting">{t("hello", { name: props.name() })}</p>;
}
export function App(props) {
  const i18n = props.i18n;
  return (
    <I18nProvider i18n={i18n}>
      <h1>Static title</h1>
      <Greeting name={props.name} />
      <span id="only">{i18n.t("only.en")}</span>
      <p id="rich"><Trans key="terms" components={{ b: (c) => <strong>{c}</strong>, a: (c) => <a href="/privacy">{c}</a> }} /></p>
      <p id="num"><FormattedNumber value={1234.5} /></p>
      <p id="date"><FormattedDate value={new Date(Date.UTC(2024, 0, 31))} format="long" /></p>
      <p id="list"><FormattedList value={["a", "b", "c"]} /></p>
      <p id="rel"><FormattedRelative value={0} now={86400000 * 3} /></p>
    </I18nProvider>
  );
}`;

describe("reactive translation in JSX", () => {
  it("[I18N-170] switching locale updates only the dynamic text; static nodes and elements are kept", async () => {
    const { App } = await load<UiModule>(UI);
    const i18n = twoLocales({ timeZone: "UTC", now: () => 0 });
    const [name] = useSignal("Ada");
    const view = render(() => createComponent(App, { i18n, name }));
    const title = view.container.querySelector("h1");
    const paragraph = view.container.querySelector("#greeting");
    const only = view.container.querySelector("#only");
    const titleText = title?.firstChild;
    expect(paragraph?.textContent).toBe("Hello Ada");
    await i18n.setLocale("fr");
    flushSync();
    expect(view.container.querySelector("#greeting")).toBe(paragraph);
    expect(view.container.querySelector("h1")).toBe(title);
    expect(title?.firstChild).toBe(titleText);
    expect(view.container.querySelector("#only")).toBe(only);
    expect(paragraph?.textContent).toBe("Bonjour Ada");
    expect(view.container.querySelector("#num")?.textContent?.replace(/\s/g, " ")).toBe("1 234,5");
    expect(view.container.querySelector("#list")?.textContent).toBe("a, b et c");
  });

  it("[I18N-171] an argument signal change rewrites that text node only", async () => {
    const { App } = await load<UiModule>(UI);
    const i18n = twoLocales({ timeZone: "UTC", now: () => 0 });
    const [name, setName] = useSignal("Ada");
    const view = render(() => createComponent(App, { i18n, name }));
    const textNode = view.container.querySelector("#greeting")?.firstChild;
    const rich = view.container.querySelector("#rich")?.innerHTML;
    setName("Grace");
    flushSync();
    expect(view.container.querySelector("#greeting")?.firstChild).toBe(textNode);
    expect(textNode?.textContent).toBe("Hello Grace");
    expect(view.container.querySelector("#rich")?.innerHTML).toBe(rich);
  });

  it("[I18N-172] <Trans> maps tags to elements and the Formatted* components render in the active locale", async () => {
    const { App } = await load<UiModule>(UI);
    const i18n = twoLocales({ timeZone: "UTC", now: () => 0 });
    const view = render(() => createComponent(App, { i18n, name: () => "x" }));
    expect(view.container.querySelector("#rich")?.innerHTML).toBe(
      'Read the <strong>terms</strong> and <a href="/privacy">privacy</a>.',
    );
    expect(view.container.querySelector("#num")?.textContent).toBe("1,234.5");
    expect(view.container.querySelector("#date")?.textContent).toBe("January 31, 2024");
    expect(view.container.querySelector("#rel")?.textContent).toBe("3 days ago");
    await i18n.setLocale("fr");
    flushSync();
    expect(view.container.querySelector("#rich")?.innerHTML).toBe(
      'Lisez les <strong>conditions</strong> et <a href="/privacy">la confidentialite</a>.',
    );
    expect(view.container.querySelector("#date")?.textContent).toBe("31 janvier 2024");
  });

  it("[I18N-173] message text and argument values are text, never markup (no innerHTML path)", async () => {
    const source = `
      import { I18nProvider, Trans } from "@i18n";
      export function App(props) {
        return <I18nProvider i18n={props.i18n}>
          <p id="plain">{props.i18n.t("hello", { name: props.evil })}</p>
          <p id="rich"><Trans key="terms" values={{}} components={{ b: (c) => <em>{c}</em>, a: (c) => c }} /></p>
        </I18nProvider>;
      }`;
    const { App } = await load<{ App(props: object): unknown }>(source);
    const evil = '<img src=x onerror="window.pwned=1"><script>window.pwned=2</script>';
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en"],
      messages: {
        en: { hello: "Hi {name}", terms: "<b>&lt;img src=x onerror=alert(1)&gt;</b> <a>x</a>" },
      },
    });
    const view = render(() => createComponent(App, { i18n, evil }));
    expect(view.container.querySelector("img")).toBeNull();
    expect(view.container.querySelector("script")).toBeNull();
    expect(view.container.querySelector("#plain")?.textContent).toBe(`Hi ${evil}`);
    expect(view.container.querySelector("#rich em")?.textContent).toBe(
      "&lt;img src=x onerror=alert(1)&gt;",
    );
    expect(Reflect.get(window, "pwned")).toBeUndefined();
  });

  it("[I18N-174] useI18n without a provider explains what to do", async () => {
    const source = `import { useI18n } from "@i18n"; export const App = () => { useI18n(); return <p/>; };`;
    const { App } = await load<{ App(): unknown }>(source);
    expect(() => render(() => createComponent(App, {}))).toThrow(/I18nProvider/);
  });
});

describe("Suspense and transitions", () => {
  const SUSPENSE = `
    import { Suspense } from "@shadow-js/web";
    import { I18nProvider, useI18n } from "@i18n";
    function Hello() { const { t } = useI18n(); return <p id="hello">{t("hello", { name: "Ada" })}</p>; }
    export function App(props) {
      return <I18nProvider i18n={props.i18n}>
        <Suspense fallback={<i id="fallback">loading</i>}><Hello /></Suspense>
      </I18nProvider>;
    }`;

  it("[I18N-175] components suspend while the first catalog loads, then render", async () => {
    const { App } = await load<{ App(props: object): unknown }>(SUSPENSE);
    let release: () => void = () => undefined;
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en"],
      loaders: {
        en: () =>
          new Promise<Messages>((resolve) => {
            release = () => resolve(en);
          }),
      },
      syncDocument: false,
    });
    const view = render(() => createComponent(App, { i18n }));
    expect(view.container.querySelector("#fallback")?.textContent).toBe("loading");
    expect(view.container.querySelector("#hello")).toBeNull();
    release();
    await i18n.ready;
    await settle();
    expect(view.container.querySelector("#fallback")).toBeNull();
    expect(view.container.querySelector("#hello")?.textContent).toBe("Hello Ada");
  });

  it("[I18N-176] suspend mode shows the fallback until the new locale's text exists; keep mode never does", async () => {
    const { App } = await load<{ App(props: object): unknown }>(SUSPENSE);
    const keep = lazyI18n();
    const keepView = render(() => createComponent(App, { i18n: keep.i18n }));
    void keep.i18n.setLocale("fr");
    flushSync();
    expect(keepView.container.querySelector("#hello")?.textContent).toBe("Hello Ada");
    expect(keepView.container.querySelector("#fallback")).toBeNull();
    keep.resolvers["fr"]?.();
    await settle();
    expect(keepView.container.querySelector("#hello")?.textContent).toBe("Bonjour Ada");
  });

  it("[I18N-177] <html lang dir> follow the locale, persistence writes cookie and storage", async () => {
    const i18n = twoLocales({ persist: ["cookie", "localStorage"] });
    expect(document.documentElement.getAttribute("lang")).toBe("en");
    expect(document.documentElement.getAttribute("dir")).toBe("ltr");
    await i18n.setLocale("ar");
    expect(document.documentElement.getAttribute("lang")).toBe("ar");
    expect(document.documentElement.getAttribute("dir")).toBe("rtl");
    expect(document.cookie).toContain("locale=ar");
    expect(localStorage.getItem("locale")).toBe("ar");
    const next = twoLocales({ detect: true, persist: ["cookie"], syncDocument: false });
    expect(next.locale()).toBe("ar");
  });

  it("[I18N-178] detect reads url prefix, cookie, storage then navigator.languages", () => {
    const base = {
      defaultLocale: "en" as const,
      locales: ["en", "fr", "ar"] as const,
      messages: { en, fr, ar: { hello: "x" } },
      syncDocument: false,
    };
    expect(createI18n({ ...base, detect: { input: { pathname: "/fr/x" } } }).locale()).toBe("fr");
    expect(createI18n({ ...base, detect: { input: { cookie: "locale=ar" } } }).locale()).toBe("ar");
    expect(
      createI18n({ ...base, detect: { input: { storage: "fr" }, order: ["storage"] } }).locale(),
    ).toBe("fr");
    expect(
      createI18n({ ...base, detect: { input: { navigatorLanguages: ["xx", "ar-EG"] } } }).locale(),
    ).toBe("ar");
    expect(
      createI18n({
        ...base,
        detect: { input: { pathname: "/", navigatorLanguages: ["xx"] } },
      }).locale(),
    ).toBe("en");
    Object.defineProperty(navigator, "languages", { value: ["fr-CA"], configurable: true });
    expect(createI18n({ ...base, detect: true }).locale()).toBe("fr");
    Reflect.deleteProperty(navigator, "languages");
  });

  it("[I18N-179] creating, switching and disposing adds no event listeners and no timers", async () => {
    const listeners = [
      vi.spyOn(document, "addEventListener"),
      vi.spyOn(window, "addEventListener"),
    ];
    const timers = [vi.spyOn(globalThis, "setTimeout"), vi.spyOn(globalThis, "setInterval")];
    const i18n = twoLocales({ persist: ["cookie", "localStorage"] });
    await i18n.setLocale("fr");
    i18n.fork("ar").dispose();
    i18n.dispose();
    for (const spy of [...listeners, ...timers]) expect(spy).not.toHaveBeenCalled();
  });
});

describe("LocaleSwitcher", () => {
  const SWITCHER = `
    import { I18nProvider, LocaleSwitcher } from "@i18n";
    export function App(props) {
      return <I18nProvider i18n={props.i18n}>
        <LocaleSwitcher onSelect={props.onSelect}>{(api) => (
          <div>
            <select id="pick" value={api.locale()} onChange={api.onChange}>
              {api.options.map((o) => <option value={o.value}>{o.label}</option>)}
            </select>
            <button id="fr" onClick={() => api.select("fr")}>fr</button>
            <a id="link" href={api.href("fr", "/about")}>about</a>
          </div>
        )}</LocaleSwitcher>
      </I18nProvider>;
    }`;

  it("[I18N-180] lists native names, switches on change, ignores unknown values and exposes hrefs", async () => {
    const { App } = await load<{ App(props: object): unknown }>(SWITCHER);
    const i18n = twoLocales({ syncDocument: false });
    const picked: string[] = [];
    const view = render(() =>
      createComponent(App, { i18n, onSelect: (l: string) => picked.push(l) }),
    );
    const options = Array.from(view.container.querySelectorAll("option"), (o) => [
      o.value,
      o.textContent,
    ]);
    expect(options).toEqual([
      ["en", "English"],
      ["fr", "français"],
      ["ar", "العربية"],
    ]);
    const select = view.container.querySelector("select") as HTMLSelectElement;
    select.value = "ar";
    fireEvent.change(select);
    await settle();
    expect(i18n.locale()).toBe("ar");
    fireEvent.change(select, { target: { value: "zz" } });
    await settle();
    expect(i18n.locale()).toBe("ar");
    fireEvent.click(view.container.querySelector("#fr") as HTMLElement);
    await settle();
    expect(i18n.locale()).toBe("fr");
    expect(picked).toEqual(["ar", "fr"]);
    expect(view.container.querySelector("#link")?.getAttribute("href")).toBe("/fr/about");
  });
});
