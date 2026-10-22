import { flushSync } from "@shadow-js/core";
import { cleanup, render } from "@shadow-js/testing/dom";
import { createComponent, hydrate } from "@shadow-js/web";
import { renderToString } from "@shadow-js/web/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { I18nError } from "../src/errors";
import type { I18nState } from "../src/i18n-types";
import { readI18nState, renderI18nStateScript } from "../src/state";
import { en, fr } from "./support/catalogs";
import { load } from "./support/compile";
import { createI18n } from "./support/full-instance";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const ar = {
  ...en,
  hello: "مرحبا {name}",
  cart: { ...en.cart, items: "{count, plural, other {# عناصر}}" },
};
const CATALOGS = { en, fr, ar } as const;
type Locale = keyof typeof CATALOGS;

const PAGE = `
import { I18nProvider, useI18n, Trans, FormattedNumber, FormattedDate } from "@i18n";
function Body(props) {
  const { t, locale, dir } = useI18n();
  return <main lang={locale()} dir={dir()}>
    <h1>{t("hello", { name: props.name })}</h1>
    <p>{t("cart.items", { count: props.count })}</p>
    <p><Trans key="terms" components={{ b: (c) => <strong>{c}</strong>, a: (c) => <a href="/p">{c}</a> }} /></p>
    <p><FormattedNumber value={props.count * 1000.5} /></p>
    <p><FormattedDate value={new Date(Date.UTC(2024, 4, 17))} options={{ dateStyle: "long", timeZone: "UTC" }} /></p>
  </main>;
}
export function App(props) {
  return <I18nProvider i18n={props.i18n}><Body name={props.name} count={props.count} /></I18nProvider>;
}`;

interface Page {
  App(props: { i18n: unknown; name: string; count: number }): unknown;
}

const make = (extra: object = {}) =>
  createI18n({
    defaultLocale: "en",
    locales: ["en", "fr", "ar"],
    syncDocument: false,
    ...extra,
  });

const strip = (html: string): string =>
  html.replace(/ data-hk="[^"]*"/g, "").replace(/<!--\[-->|<!--\]-->/g, "");

const consoleOutput = (): string[] =>
  [...vi.mocked(console.warn).mock.calls, ...vi.mocked(console.error).mock.calls].map((call) =>
    call.join(" "),
  );

describe("server markup and the first client render", () => {
  it.each(["en", "fr", "ar"] as const)(
    "[I18N-493] %s: the server's markup equals the first client render, hydration keeps every node and reports nothing",
    async (locale: Locale) => {
      const ssr = await load<Page>(PAGE, "ssr");
      const dom = await load<Page>(PAGE, "dom");
      const props = { name: "Ada", count: 1234 };

      // Server: a request's fork in the locale, its state embedded in the page.
      const server = make({ messages: CATALOGS });
      const request = server.fork(locale);
      const html = renderToString(() => createComponent(ssr.App, { i18n: request, ...props }));
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.append(host);
      document.body.insertAdjacentHTML("beforeend", renderI18nStateScript(request.state()));

      // Client: no messages of its own and loaders that must not run, only the page state.
      const reject = (): Promise<never> => Promise.reject(new Error("no refetch"));
      const client = make({
        loaders: { en: reject, fr: reject, ar: reject },
        state: readI18nState() as I18nState<Locale>,
      });
      expect(client.locale()).toBe(locale);
      const before = [host, ...Array.from(host.querySelectorAll("*"))];
      hydrate(() => createComponent(dom.App, { i18n: client, ...props }), host);
      flushSync();

      const fresh = make({ messages: CATALOGS, locale });
      const view = render(() => createComponent(dom.App, { i18n: fresh, ...props }));
      expect(strip(html)).toBe(view.container.innerHTML);
      expect(host.innerHTML.replace(/ data-hk="[^"]*"/g, "")).toBe(view.container.innerHTML);
      const after = [host, ...Array.from(host.querySelectorAll("*"))];
      expect(after).toHaveLength(before.length);
      for (const [index, node] of before.entries()) expect(after[index]).toBe(node);
      expect(host.querySelector("main")?.getAttribute("lang")).toBe(locale);
      expect(host.querySelector("main")?.getAttribute("dir")).toBe(locale === "ar" ? "rtl" : "ltr");
      expect(consoleOutput()).toEqual([]);
    },
  );

  it("[I18N-493] the server render of a locale does not change the module instance, and a second request in another locale renders its own markup", async () => {
    const ssr = await load<Page>(PAGE, "ssr");
    const server = make({ messages: CATALOGS });
    const props = { name: "Ada", count: 2 };
    const french = renderToString(() =>
      createComponent(ssr.App, { i18n: server.fork("fr"), ...props }),
    );
    const arabic = renderToString(() =>
      createComponent(ssr.App, { i18n: server.fork("ar"), ...props }),
    );
    const english = renderToString(() => createComponent(ssr.App, { i18n: server, ...props }));
    expect(french).toContain("Bonjour");
    expect(arabic).toContain("مرحبا");
    expect(english).toContain("Hello");
    expect(english).not.toContain("Bonjour");
    expect(server.locale()).toBe("en");
  });
});

describe("a tampered page state", () => {
  const instance = (errors: I18nError[]) =>
    make({ messages: CATALOGS, onError: (error: I18nError) => errors.push(error) });

  it("[I18N-494] a tampered version in the page is reported and the app starts with its defaults, it does not crash", async () => {
    const dom = await load<Page>(PAGE, "dom");
    document.body.insertAdjacentHTML(
      "beforeend",
      '<script type="application/json" id="__SHADOW_I18N__">{"v":2,"locale":"fr","messages":{}}</script>',
    );
    const errors: I18nError[] = [];
    const client = instance(errors);
    let view: ReturnType<typeof render> | undefined;
    expect(() => {
      view = render(() => createComponent(dom.App, { i18n: client, name: "Ada", count: 1 }));
    }).not.toThrow();
    expect(client.locale()).toBe("en");
    expect(view?.container.querySelector("h1")?.textContent).toBe("Hello Ada");
    expect(errors.map((error) => error.code)).toEqual(["INVALID_STATE"]);
  });

  it("[I18N-494] a tampered shape and unparsable JSON get the same treatment", async () => {
    const dom = await load<Page>(PAGE, "dom");
    for (const text of [
      '{"v":1,"locale":"fr","messages":{"fr":{"hello":3}}}',
      "{not json",
      '{"v":1,"locale":"xx","messages":{}}',
    ]) {
      document.body.innerHTML = `<script type="application/json" id="__SHADOW_I18N__">${text}</script>`;
      const errors: I18nError[] = [];
      const client = instance(errors);
      expect(() =>
        render(() => createComponent(dom.App, { i18n: client, name: "Ada", count: 1 })),
      ).not.toThrow();
      expect(client.locale()).toBe("en");
      expect(errors).toHaveLength(1);
      expect(["INVALID_STATE", "UNKNOWN_LOCALE"]).toContain(errors[0]?.code);
      cleanup();
    }
  });

  it("[I18N-494] readI18nState on the real document reports through onError and hands back undefined", () => {
    document.body.innerHTML =
      '<script type="application/json" id="__SHADOW_I18N__">{"v":9,"locale":"en","messages":{}}</script>';
    const errors: I18nError[] = [];
    expect(
      readI18nState(undefined, { onError: (error) => void errors.push(error) }),
    ).toBeUndefined();
    expect(errors.map((error) => error.code)).toEqual(["INVALID_STATE"]);
    expect(() => readI18nState()).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
  });
});
