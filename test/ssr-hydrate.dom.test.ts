import { flushSync } from "@shadow-js/core";
import { cleanup, render } from "@shadow-js/testing/dom";
import { createComponent, hydrate } from "@shadow-js/web";
import { renderToString } from "@shadow-js/web/server";
import { afterEach, describe, expect, it } from "vitest";
import { createI18nFull as createI18n } from "../src/full";
import { createI18nMiddleware, getEventI18n } from "../src/server";
import { parseI18nState, serializeI18nState } from "../src/state";
import { en, fr } from "./support/catalogs";
import { load } from "./support/compile";
import { fakeEvent } from "./support/event";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const PAGE = `
import { I18nProvider, useI18n, Trans, FormattedNumber } from "@i18n";
function Cart(props) {
  const { t } = useI18n();
  return <section>
    <h1>{t("hello", { name: props.name })}</h1>
    <p>{t("cart.items", { count: props.count })}</p>
    <p><Trans key="terms" components={{ b: (c) => <strong>{c}</strong>, a: (c) => <a href="/p">{c}</a> }} /></p>
    <p><FormattedNumber value={props.count * 1000.5} /></p>
  </section>;
}
export function App(props) {
  return <I18nProvider i18n={props.i18n}><Cart name={props.name} count={props.count} /></I18nProvider>;
}`;

interface Page {
  App(props: { i18n: unknown; name: string; count: number }): unknown;
}

function appInstance(extra: object = {}) {
  return createI18n({
    defaultLocale: "en",
    locales: ["en", "fr"],
    loaders: { en: () => en, fr: () => fr },
    syncDocument: false,
    ...extra,
  });
}

function plain(html: string): string {
  return html.replace(/ data-hk="[^"]*"/g, "").replace(/<!--\[-->|<!--\]-->/g, "");
}

describe("SSR and hydration", () => {
  it("[I18N-190] server HTML equals the first client render and hydration keeps every node", async () => {
    const ssr = await load<Page>(PAGE, "ssr");
    const dom = await load<Page>(PAGE, "dom");
    const props = { name: "Ada", count: 1234 };

    // Server: the middleware picks the locale and gives the request its own instance.
    const server = appInstance();
    const event = fakeEvent("https://x.test/fr/panier");
    await createI18nMiddleware(server, { strategy: ["url"] })(
      { ...event, url: new URL("https://x.test/fr/panier") },
      () => Promise.resolve(new Response("")),
    );
    const requestI18n = getEventI18n<typeof server>(event);
    // The default prefix is "as-needed", so "/fr/panier" selects French.
    expect(requestI18n.locale()).toBe("fr");
    const html = renderToString(() => createComponent(ssr.App, { i18n: requestI18n, ...props }));
    const stateText = serializeI18nState(requestI18n.state());

    // Client: state from the page, loaders that must not be needed.
    const client = createI18n({
      defaultLocale: "en",
      locales: ["en", "fr"],
      loaders: {
        en: () => Promise.reject(new Error("no refetch")),
        fr: () => Promise.reject(new Error("no refetch")),
      },
      state: parseI18nState(stateText),
      syncDocument: false,
    });
    expect(client.locale()).toBe("fr");

    const hydratedHost = document.createElement("div");
    hydratedHost.innerHTML = html;
    document.body.append(hydratedHost);
    const serverNodes = [hydratedHost, ...Array.from(hydratedHost.querySelectorAll("*"))];
    hydrate(() => createComponent(dom.App, { i18n: client, ...props }), hydratedHost);

    const fresh = createI18n({
      defaultLocale: "en",
      locales: ["en", "fr"],
      messages: { en, fr },
      locale: "fr",
      syncDocument: false,
    });
    const view = render(() => createComponent(dom.App, { i18n: fresh, ...props }));

    expect(plain(html)).toBe(view.container.innerHTML);
    expect(hydratedHost.innerHTML.replace(/ data-hk="[^"]*"/g, "")).toBe(view.container.innerHTML);
    const after = [hydratedHost, ...Array.from(hydratedHost.querySelectorAll("*"))];
    expect(after).toHaveLength(serverNodes.length);
    for (const [index, node] of serverNodes.entries()) expect(after[index]).toBe(node);
    expect(hydratedHost.querySelector("h1")?.textContent).toBe("Bonjour Ada");
    expect(hydratedHost.querySelector("strong")?.textContent).toBe("conditions");

    // After hydration the page is alive: switching locale rewrites the same elements.
    const h1 = hydratedHost.querySelector("h1");
    await client.setLocale("en");
    flushSync();
    expect(hydratedHost.querySelector("h1")).toBe(h1);
    expect(h1?.textContent).toBe("Hello Ada");
    expect(hydratedHost.querySelector("strong")?.textContent).toBe("terms");
  });

  it("[I18N-191] a hostile catalog or value is escaped in the server HTML", async () => {
    const ssr = await load<{ App(props: object): unknown }>(
      `import { I18nProvider } from "@i18n"; export const App = (p) => <I18nProvider i18n={p.i18n}><p>{p.i18n.t("x", { v: p.v })}</p></I18nProvider>;`,
      "ssr",
    );
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: { x: "'<script>'alert(1)'</script>' {v}", y: "<script>alert(2)</script>" } },
    });
    const html = renderToString(() =>
      createComponent(ssr.App, { i18n, v: '"><img src=x onerror=1>' }),
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    // Unquoted markup in a message is parsed as a rich-text tag: with no handler only its text is kept.
    expect(renderToString(() => i18n.t("y"))).toBe("alert(2)");
  });
});
