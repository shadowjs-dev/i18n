import { describe, expect, it } from "vitest";
import { createI18nFull as createI18n } from "../src/full";
import { createI18nMiddleware } from "../src/server";
import { en, fr } from "./support/catalogs";
import { fakeEvent } from "./support/event";

const NOW = Date.UTC(2024, 5, 15, 12, 0, 0);

describe("a loader that throws before its first await", () => {
  it("[I18N-R7-1] a failed load is not remembered: the next load calls the loader again", async () => {
    let calls = 0;
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en", "fr"],
      messages: { en },
      loaders: {
        fr: () => {
          calls += 1;
          if (calls === 1) throw new Error("offline");
          return fr;
        },
      },
      onError: () => undefined,
      syncDocument: false,
    });
    await expect(i18n.load("fr")).rejects.toThrow(/could not load/);
    await i18n.load("fr");
    expect(calls).toBe(2);
    expect(i18n.isLoaded("fr")).toBe(true);
  });
});

describe("the middleware at the root under as-needed", () => {
  it("[I18N-R7-2] the root negotiates from the cookie like the browser; other unprefixed paths stay default", async () => {
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en", "fr"],
      messages: { en, fr },
      prefix: "as-needed",
      syncDocument: false,
    });
    const middleware = createI18nMiddleware(i18n, {
      strategy: ["url", "cookie", "accept-language"],
    });
    const lang = async (path: string): Promise<string> => {
      const event = fakeEvent(`https://x.test${path}`, {
        headers: { "accept-language": "fr" },
        cookies: { locale: "fr" },
      });
      await middleware(event, () => Promise.resolve(new Response("ok")));
      return event.document.lang;
    };
    expect(await lang("/")).toBe("fr");
    expect(await lang("/about")).toBe("en");
  });
});

describe("formatRelative picks the unit after rounding", () => {
  const i18n = createI18n({
    defaultLocale: "en",
    locales: ["en"],
    messages: { en },
    now: () => NOW,
    syncDocument: false,
  });
  const at = (seconds: number, numeric: "always" | "auto" = "always"): string =>
    i18n.formatRelative(NOW + seconds * 1000, { numeric });

  it("[I18N-R7-3] a distance that rounds to the next unit reads in that unit", () => {
    expect(at(59.6)).toBe("in 1 minute");
    expect(at(3599.6)).toBe("in 1 hour");
    expect(at(86_399.6)).toBe("in 1 day");
    expect(at(86_399.6, "auto")).toBe("tomorrow");
    expect(at(604_799.6)).toBe("in 1 week");
    expect(at(31_557_599.6)).toBe("in 1 year");
    expect(at(-59.6)).toBe("1 minute ago");
    expect(at(-31_557_599.6)).toBe("1 year ago");
  });

  it("[I18N-R7-4] distances inside a unit keep it", () => {
    expect(at(59.4)).toBe("in 59 seconds");
    expect(at(3500)).toBe("in 58 minutes");
    expect(at(80_000)).toBe("in 22 hours");
    expect(at(2 * 86_400)).toBe("in 2 days");
  });
});
