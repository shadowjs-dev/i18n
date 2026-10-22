import { flushSync, useMemo } from "@shadow-js/core";
import { cleanup, render } from "@shadow-js/testing/dom";
import { createComponent, hydrate } from "@shadow-js/web";
import { renderToString } from "@shadow-js/web/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createI18nFull as createI18n } from "../src/full";
import { renderI18nStateScript } from "../src/state";
import { en, fr } from "./support/catalogs";
import { load } from "./support/compile";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const PAGE = `
import { I18nProvider, useI18n, Trans, FormattedNumber } from "@i18n";
function Greeting() {
  const { t } = useI18n();
  return <section>
    <h1>{t("hello", { name: "Ada" })}</h1>
    <p>{t("cart.items", { count: 2 })}</p>
    <p><Trans key="terms" components={{ b: (c) => <strong>{c}</strong>, a: (c) => <a href="/privacy">{c}</a> }} /></p>
    <p><FormattedNumber value={1234.5} /></p>
  </section>;
}
export function App(props) {
  return <I18nProvider i18n={props.i18n}><Greeting /></I18nProvider>;
}
export function Nested(props) {
  return <I18nProvider i18n={props.i18n}><section><I18nProvider i18n={props.inner}><Greeting /></I18nProvider></section></I18nProvider>;
}`;

interface Page {
  App(props: { i18n: unknown }): unknown;
  Nested(props: { i18n: unknown; inner: unknown }): unknown;
}

function instance(extra: object = {}) {
  return createI18n({
    defaultLocale: "en",
    locales: ["en", "fr"],
    messages: { en, fr },
    syncDocument: false,
    ...extra,
  });
}

/** The server's page: French HTML plus the state script, in the document. */
async function serverPage(): Promise<{ host: HTMLElement; ssr: Page; dom: Page }> {
  const ssr = await load<Page>(PAGE, "ssr");
  const dom = await load<Page>(PAGE, "dom");
  const request = instance().fork("fr");
  const html = renderToString(() => createComponent(ssr.App, { i18n: request }));
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  document.body.insertAdjacentHTML("beforeend", renderI18nStateScript(request.state()));
  return { host, ssr, dom };
}

const warnings = (): string[] => vi.mocked(console.warn).mock.calls.map((call) => String(call[0]));

describe("hydrating in another locale than the server's", () => {
  it("[I18N-217] warns in development and re-reads the page state, so the server's text is kept", async () => {
    const { host, dom } = await serverPage();
    const heading = host.querySelector("h1");
    expect(heading?.textContent).toBe("Bonjour Ada");
    // An instance created without the page state starts in English.
    const client = instance();
    expect(client.locale()).toBe("en");
    hydrate(() => createComponent(dom.App, { i18n: client }), host);
    flushSync();
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain('rendered in "fr"');
    expect(warnings()[0]).toContain('starts in "en"');
    vi.mocked(console.warn).mockClear();
    expect(client.locale()).toBe("fr");
    expect(host.querySelector("h1")).toBe(heading);
    expect(heading?.textContent).toBe("Bonjour Ada");
  });

  it("[I18N-217] says nothing when the instance started from the page state", async () => {
    const { host, dom } = await serverPage();
    const state = JSON.parse(document.getElementById("__SHADOW_I18N__")?.textContent ?? "{}");
    const client = instance({ state });
    hydrate(() => createComponent(dom.App, { i18n: client }), host);
    flushSync();
    expect(warnings()).toEqual([]);
    expect(client.locale()).toBe("fr");
  });

  it("[I18N-217] a page without state is left alone: a client-only app starts wherever it likes", async () => {
    const dom = await load<Page>(PAGE, "dom");
    const client = instance({ locale: "fr" });
    const view = render(() => createComponent(dom.App, { i18n: client }));
    expect(warnings()).toEqual([]);
    expect(view.container.querySelector("h1")?.textContent).toBe("Bonjour Ada");
  });

  it("[I18N-217] only the outermost provider of an instance checks: a fork in a nested provider keeps its locale, and a later mount does not undo a switch", async () => {
    const { host, dom } = await serverPage();
    host.remove();
    const client = instance({
      state: JSON.parse(document.getElementById("__SHADOW_I18N__")?.textContent ?? "{}"),
    });
    const english = client.fork("en");
    const view = render(() => createComponent(dom.Nested, { i18n: client, inner: english }));
    expect(view.container.querySelector("h1")?.textContent).toBe("Hello Ada");
    expect(warnings()).toEqual([]);
    cleanup();
    // The user switched to English; a provider mounted afterward must not drag it back to French.
    await client.setLocale("en");
    const again = render(() => createComponent(dom.App, { i18n: client }));
    expect(warnings()).toEqual([]);
    expect(client.locale()).toBe("en");
    expect(again.container.querySelector("h1")?.textContent).toBe("Hello Ada");
  });

  it("[I18N-217] inside a memo (a layout route), where a signal write is refused, the state is applied right after", async () => {
    const { host, dom } = await serverPage();
    host.remove();
    const client = instance();
    const view = render(() => {
      const rendered = useMemo(() => createComponent(dom.App, { i18n: client }));
      return rendered;
    });
    expect(warnings()).toHaveLength(1);
    vi.mocked(console.warn).mockClear();
    await Promise.resolve();
    flushSync();
    expect(client.locale()).toBe("fr");
    expect(view.container.querySelector("h1")?.textContent).toBe("Bonjour Ada");
  });
});
