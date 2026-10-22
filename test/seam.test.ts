/**
 * The message seam of the core (`createI18n`): plain text needs no compiler, text with syntax needs
 * one (`compile`, or `createI18nWithIcu`), and the root entry does not load the ICU parser or
 * formatter. Node tests: the core does not touch the DOM.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createI18n } from "../src/create-i18n";
import type { I18nError } from "../src/errors";
import type { CompiledMessage } from "../src/message";
import { createI18nWithIcu } from "../src/with-icu";

const SRC = resolve(import.meta.dirname, "../src");

/** Every module reachable from `entry` through relative imports, as absolute paths. */
function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [resolve(SRC, entry)];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/(?:from|import)\s*\(?\s*"(\.{1,2}\/[^"]+)"/g)) {
      const target = match[1];
      if (target === undefined) continue;
      const base = resolve(dirname(file), target);
      const candidate = base.endsWith(".ts") ? base : `${base}.ts`;
      if (existsSync(candidate)) queue.push(candidate);
    }
  }
  return seen;
}

describe("message seam", () => {
  it("[I18N-219] plain text is rendered without a compiler, and nothing is reported", () => {
    const onError = vi.fn<(error: I18nError) => void>();
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: { apostrophe: "Don't stop", brace: "a } alone", hash: "#1 & 2 > 1" } },
      onError,
    });
    expect(i18n.t("apostrophe")).toBe("Don't stop");
    expect(i18n.t("hash")).toBe("#1 & 2 > 1");
    expect(onError).not.toHaveBeenCalled();
  });

  it("[I18N-220] text with syntax and no compiler reports NO_COMPILER and shows the key", () => {
    const onError = vi.fn<(error: I18nError) => void>();
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: { greet: "Hello {name}" } },
      onError,
    });
    expect(i18n.t("greet", { name: "Ada" })).toBe("greet");
    const syntax = onError.mock.calls.map((call) => call[0]?.message ?? "");
    expect(syntax.some((message) => message.includes("NO_COMPILER"))).toBe(true);
  });

  it("[I18N-221] a compiler passed to createI18n renders the text that has syntax", () => {
    const compile = vi.fn(
      (source: string): CompiledMessage => ({
        format: (values) => `${source}|${String((values as { name: string }).name)}`,
        parts: () => ["x"],
      }),
    );
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: { greet: "Hello {name}", plain: "Plain" } },
      compile,
    });
    expect(i18n.t("greet", { name: "Ada" })).toBe("Hello {name}|Ada");
    expect(i18n.t("plain")).toBe("Plain");
    expect(compile).toHaveBeenCalledTimes(1);
  });

  it("[I18N-222] createI18nWithIcu compiles ICU syntax by default", () => {
    const i18n = createI18nWithIcu({
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: { cart: "{count, plural, one {# item} other {# items}}" } },
    });
    expect(i18n.t("cart", { count: 2 })).toBe("2 items");
  });

  it("[I18N-223] the core factory never reaches the ICU parser, printer, formatter or validator", () => {
    const modules = [...reachable("create-i18n.ts")].map((file) => file.slice(SRC.length + 1));
    expect(modules.filter((file) => file.startsWith("icu/"))).toEqual([]);
    // The root barrel reaches ICU only through the convenience factory, which a bundler drops
    // unless an app imports it.
    const root = [...reachable("index.ts")].map((file) => file.slice(SRC.length + 1));
    expect(root).toContain("with-icu.ts");
    expect(reachable("with-icu.ts").has(resolve(SRC, "icu/parse.ts"))).toBe(true);
  });
});
