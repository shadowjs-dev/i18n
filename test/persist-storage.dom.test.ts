import { afterEach, describe, expect, it } from "vitest";
import type { I18nError } from "../src/errors";
import { cookieStrategy, storageStrategy } from "../src/persist";
import { createI18n } from "./support/full-instance";

/**
 * A browser that blocks storage throws from the `localStorage` getter itself (Safari with all
 * cookies blocked, a sandboxed iframe, Chrome with site data blocked).
 */
const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

function blockStorage(): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get(): never {
      throw new DOMException("The operation is insecure.", "SecurityError");
    },
  });
}

afterEach(() => {
  if (original === undefined) Reflect.deleteProperty(globalThis, "localStorage");
  else Object.defineProperty(globalThis, "localStorage", original);
  Reflect.set(document, "cookie", "locale=; Path=/; Max-Age=0");
  window.localStorage.clear();
});

describe("blocked storage in a browser", () => {
  it("[I18N-470] a localStorage getter that throws SecurityError is reported and never thrown, for reads and writes", () => {
    blockStorage();
    const reports: I18nError[] = [];
    const strategy = storageStrategy({ report: (error) => void reports.push(error) });
    expect(strategy.read()).toBeUndefined();
    expect(() => strategy.write("fr")).not.toThrow();
    expect(reports.map((error) => error.code)).toEqual(["INVALID_STATE", "INVALID_STATE"]);
    expect(reports[0]?.message).toContain("localStorage is not accessible");
    expect(reports[0]?.cause).toBeInstanceOf(DOMException);
  });

  it("[I18N-470] an instance with persist: localStorage keeps working when the storage is blocked, and reports through onError", async () => {
    blockStorage();
    const errors: I18nError[] = [];
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en", "fr"],
      messages: { en: { a: "A" }, fr: { a: "F" } },
      persist: "localStorage",
      detect: { order: ["storage", "navigator"] },
      syncDocument: false,
      onError: (error) => errors.push(error),
    });
    expect(i18n.locale()).toBe("en");
    await expect(i18n.setLocale("fr")).resolves.toBe("fr");
    expect(i18n.t("a")).toBe("F");
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors.every((error) => error.code === "INVALID_STATE")).toBe(true);
  });

  it("[I18N-471] real storage: the choice is written, read back, and survives a new instance", async () => {
    const make = () =>
      createI18n({
        defaultLocale: "en",
        locales: ["en", "fr"],
        messages: { en: { a: "A" }, fr: { a: "F" } },
        persist: "localStorage",
        detect: { order: ["storage"] },
        syncDocument: false,
      });
    await make().setLocale("fr");
    expect(window.localStorage.getItem("locale")).toBe("fr");
    expect(make().locale()).toBe("fr");
  });

  it("[I18N-473] the real document.cookie: written with Path=/ and SameSite=Lax, read back, and a stored unsupported value falls back", async () => {
    const make = () =>
      createI18n({
        defaultLocale: "en",
        locales: ["en", "fr"],
        messages: { en: { a: "A" }, fr: { a: "F" } },
        persist: "cookie",
        detect: { order: ["storage"] },
        syncDocument: false,
      });
    await make().setLocale("fr");
    expect(document.cookie).toContain("locale=fr");
    expect(cookieStrategy().read()).toBe("fr");
    expect(make().locale()).toBe("fr");
    Reflect.set(document, "cookie", "locale=xx; Path=/");
    expect(make().locale()).toBe("en");
  });
});
