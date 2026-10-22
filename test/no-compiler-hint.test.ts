/**
 * The `NO_COMPILER` report tells the reader where the fix lives: `createI18nWithIcu` is exported by
 * the root entry (`@shadow-js/i18n`), not by `@shadow-js/i18n/icu`, so the hint must name the root.
 */
import { describe, expect, it, vi } from "vitest";
import { createI18n } from "../src/create-i18n";
import type { I18nError } from "../src/errors";
import * as icu from "../src/icu/index";
import * as root from "../src/index";

describe("NO_COMPILER hint", () => {
  it("[I18N-224] names the entry that exports createI18nWithIcu", () => {
    expect("createI18nWithIcu" in root).toBe(true);
    expect("createI18nWithIcu" in icu).toBe(false);
    const onError = vi.fn<(error: I18nError) => void>();
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: { greet: "Hello {name}" } },
      onError,
    });
    i18n.t("greet", { name: "Ada" });
    const message = onError.mock.calls.map((call) => call[0]?.message ?? "").join("\n");
    expect(message).toContain("NO_COMPILER");
    expect(message).toContain('createI18nWithIcu from "@shadow-js/i18n"');
    expect(message).not.toContain('createI18nWithIcu from "@shadow-js/i18n/icu"');
  });
});
