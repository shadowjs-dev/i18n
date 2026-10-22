import { describe, expect, it } from "vitest";
import type { I18nError } from "../src/errors";
import { createHotI18n, type HotI18nContext } from "../src/hmr";
import { drain, gatedLoader } from "./support/deferred";

describe("hot catalog edits", () => {
  it("[I18N-457] an edit while a lazy switch is pending changes the text now, and the switch still lands afterward", async () => {
    const fr = gatedLoader();
    const hot: HotI18nContext = { data: {} };
    const options = (title: string) => ({
      defaultLocale: "en",
      locales: ["en", "fr"],
      messages: { en: { title } },
      loaders: { fr: fr.load },
      syncDocument: false,
    });
    const first = createHotI18n(hot, options("Draft"));
    const switching = first.setLocale("fr");
    const second = createHotI18n(hot, options("Final"));
    expect(second).toBe(first);
    expect(first.translate("title")).toBe("Final");
    fr.calls[0]?.resolve({ title: "Brouillon" });
    await expect(switching).resolves.toBe("fr");
    expect(first.translate("title")).toBe("Brouillon");
    expect(fr.calls).toHaveLength(1);
  });

  it("[I18N-457] an edit that is malformed while a switch is pending is thrown to the caller and leaves the old text and the switch alone", async () => {
    const fr = gatedLoader();
    const errors: I18nError[] = [];
    const hot: HotI18nContext = { data: {} };
    const base = {
      defaultLocale: "en",
      locales: ["en", "fr"],
      loaders: { fr: fr.load },
      syncDocument: false,
      onError: (error: I18nError) => errors.push(error),
    } as const;
    const instance = createHotI18n(hot, { ...base, messages: { en: { title: "Draft" } } });
    const switching = instance.setLocale("fr");
    expect(() => createHotI18n(hot, { ...base, messages: { en: { title: 3 as never } } })).toThrow(
      expect.objectContaining({ code: "INVALID_CATALOG" }),
    );
    expect(instance.translate("title")).toBe("Draft");
    fr.calls[0]?.resolve({ title: "Brouillon" });
    await switching;
    await drain();
    expect(instance.locale()).toBe("fr");
    expect(errors).toEqual([]);
  });

  it("[I18N-457] something else under the instance key (a stale shape from another version) is replaced, not called", () => {
    for (const stale of ["text", 42, null, {}, { replaceCatalog: 1 }, []]) {
      const hot: HotI18nContext = { data: { "shadowjs:i18n": stale } };
      const instance = createHotI18n(hot, {
        defaultLocale: "en",
        locales: ["en"],
        messages: { en: { title: "Hello" } },
      });
      expect(instance.translate("title")).toBe("Hello");
      expect(hot.data["shadowjs:i18n"]).toBe(instance);
    }
  });

  it("[I18N-457] a hot context without a data object is ignored and gives a plain instance", () => {
    const options = {
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: { title: "T" } },
    } as const;
    const broken = { data: null } as unknown as HotI18nContext;
    expect(createHotI18n(broken, options).translate("title")).toBe("T");
    expect(createHotI18n(undefined, options).translate("title")).toBe("T");
  });
});
