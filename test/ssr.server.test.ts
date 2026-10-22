import { createComponent } from "@shadow-js/web";
import { renderToString } from "@shadow-js/web/server";
import { describe, expect, it } from "vitest";
import { createI18nFull as createI18n } from "../src/full";
import { en, fr } from "./support/catalogs";
import { load } from "./support/compile";

describe("server build", () => {
  it("[I18N-195] with server constants: no document access, inert persistence, per-request forks render concurrently", async () => {
    const { App } = await load<{ App(props: object): unknown }>(
      `import { I18nProvider, useI18n } from "@i18n";
       function Hello() { const { t, locale } = useI18n(); return <p data-l={locale()}>{t("hello", { name: "Ada" })}</p>; }
       export const App = (p) => <I18nProvider i18n={p.i18n}><Hello /></I18nProvider>;`,
      "ssr",
    );
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en", "fr"],
      messages: { en, fr },
      persist: ["cookie", "localStorage"],
    });
    const a = i18n.fork("fr");
    const b = i18n.fork("en");
    const htmlA = renderToString(() => createComponent(App, { i18n: a }));
    const htmlB = renderToString(() => createComponent(App, { i18n: b }));
    expect(htmlA).toContain("Bonjour Ada");
    expect(htmlA).toContain('data-l="fr"');
    expect(htmlB).toContain("Hello Ada");
    expect(i18n.locale()).toBe("en");
    await a.setLocale("en");
    expect(a.locale()).toBe("en");
    expect(Reflect.get(globalThis, "document")).toBeUndefined();
  });
});
