import {
  createRoot,
  flushSync,
  SuspenseContext,
  type SuspenseTracker,
  useEffect,
  useSignal,
} from "@shadow-js/core";
import { createTestRoot } from "@shadow-js/testing";
import { describe, expect, it, vi } from "vitest";
import { readXliff } from "../src/cli/xliff";
import { MessageSyntaxError } from "../src/errors";
import { formatToString } from "../src/icu/format";
import { parseMessage } from "../src/icu/parse";
import { printMessage } from "../src/icu/print";
import type { PersistStrategy } from "../src/persist";
import type { Messages } from "../src/types";
import { makeCtx } from "./support/ctx";
import { drain, gatedLoader } from "./support/deferred";
import { createI18n } from "./support/full-instance";

/** Review round two. */

/** Translates a key the typed catalog does not declare (the catalogs of these tests come from loaders). */
const text = (i18n: { translate(key: never): string }, key: string): string =>
  i18n.translate(key as never);

describe("dispose and Suspense", () => {
  it("[I18N-R2-6] t() in a boundary after dispose, on a locale that never loaded, holds nothing", () => {
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en", "fr"],
      messages: { en: { a: "A" } },
      loaders: { fr: () => new Promise<Messages>(() => undefined) },
      locale: "fr",
      syncDocument: false,
    });
    let held = 0;
    const tracker: SuspenseTracker = {
      increment: () => {
        held += 1;
      },
      decrement: () => {
        held -= 1;
      },
    };
    i18n.dispose();
    createTestRoot(() => {
      SuspenseContext({
        value: tracker,
        get children() {
          return i18n.translate("only.in.fr");
        },
      });
    });
    // Nothing will ever load again, so nothing may wait for it: a holder registered now is never released.
    expect(held).toBe(0);
  });
});

describe("persist strategies run untracked", () => {
  it("[I18N-R2-7] write() of a custom strategy does not subscribe the computation that calls setLocale", () => {
    const [source, setSource] = useSignal(0);
    const strategy: PersistStrategy = {
      read: () => undefined,
      write: () => {
        source();
      },
    };
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en", "fr"],
      messages: { en: { a: "A" }, fr: { a: "B" } },
      persist: strategy,
      syncDocument: false,
    });
    let runs = 0;
    createRoot(() => {
      useEffect(() => {
        runs += 1;
        void i18n.setLocale("fr");
      });
    });
    flushSync();
    expect(runs).toBe(1);
    setSource(1);
    flushSync();
    expect(runs).toBe(1);
  });

  it("[I18N-R2-7] read() of a custom strategy does not subscribe the computation that creates the instance", () => {
    const [source, setSource] = useSignal(0);
    const strategy: PersistStrategy = {
      read: () => {
        source();
        return undefined;
      },
      write: () => undefined,
    };
    let runs = 0;
    createRoot(() => {
      useEffect(() => {
        runs += 1;
        createI18n({
          defaultLocale: "en",
          locales: ["en", "fr"],
          messages: { en: { a: "A" } },
          persist: strategy,
          detect: { order: ["storage"] },
          syncDocument: false,
        });
      });
    });
    flushSync();
    setSource(1);
    flushSync();
    expect(runs).toBe(1);
  });
});

describe("replaceCatalog while a loader is in flight", () => {
  it("[I18N-R2-8] the new catalog wins: keys it dropped do not come back from the loader", async () => {
    const gate = gatedLoader();
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en", "fr"],
      messages: { en: { a: "A" } },
      loaders: { fr: gate.load },
      syncDocument: false,
    });
    const switched = i18n.setLocale("fr");
    await drain();
    i18n.replaceCatalog("fr", { keep: "garder" });
    gate.calls[0]?.resolve({ keep: "old", dropped: "supprime" });
    await switched;
    expect(text(i18n, "keep")).toBe("garder");
    // "dropped" is in no catalog now: the key is shown as a missing key.
    expect(text(i18n, "dropped")).toBe("dropped");
    vi.mocked(console.warn).mockClear();
  });

  it("[I18N-R2-8] addMessages during the load still keeps the loader as the base", async () => {
    const gate = gatedLoader();
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en", "fr"],
      messages: { en: { a: "A" } },
      loaders: { fr: gate.load },
      syncDocument: false,
    });
    const switched = i18n.setLocale("fr");
    await drain();
    i18n.addMessages("fr", { extra: "plus" });
    gate.calls[0]?.resolve({ base: "socle", extra: "old" });
    await switched;
    expect(text(i18n, "base")).toBe("socle");
    expect(text(i18n, "extra")).toBe("plus");
  });
});

describe("ICU parser", () => {
  const { ctx } = makeCtx();

  it("[I18N-R2-9] an exact selector may be negative: =-1", () => {
    const nodes = parseMessage("{n, plural, =-1 {minus one} =0 {zero} other {many}}");
    expect(formatToString(nodes, { n: -1 }, ctx)).toBe("minus one");
    expect(formatToString(nodes, { n: 0 }, ctx)).toBe("zero");
    expect(formatToString(nodes, { n: -2 }, ctx)).toBe("many");
    expect(printMessage(nodes)).toBe(printMessage(parseMessage(printMessage(nodes))));
  });

  it("[I18N-R2-9] a sign alone, or a sign after the digits, is still not a selector", () => {
    for (const selector of ["=-", "=1-", "=--1", "=-.5", "=+1"]) {
      expect(() => parseMessage(`{n, plural, ${selector} {x} other {y}}`)).toThrow(
        MessageSyntaxError,
      );
    }
  });

  it("[I18N-R2-9] a quoted brace inside a number or date style does not end the argument", () => {
    const [node] = parseMessage("{n, number, a'}'b}");
    expect(node).toMatchObject({ kind: "number", style: "a}b" });
    const [date] = parseMessage("{d, date, '{'x'}'}");
    expect(date).toMatchObject({ kind: "date", style: "{x}" });
    expect(printMessage(parseMessage("{n, number, a'}'b}"))).toBe("{n, number, a'}'b}");
    expect(parseMessage(printMessage(parseMessage("{d, date, it''s'{'}")))).toEqual(
      parseMessage("{d, date, it''s'{'}"),
    );
  });

  it("[I18N-R2-9] an unquoted brace in a style is still refused", () => {
    expect(() => parseMessage("{n, number, a{b}}")).toThrow(MessageSyntaxError);
  });
});

describe("XLIFF start tags", () => {
  it("[I18N-R2-10] a raw > inside a quoted attribute does not end the start tag", () => {
    const xml = `<?xml version="1.0"?><xliff version="1.2"><file source-language="en" original="a>b">
<body><trans-unit id="k" note='x > y'><source>Hello</source><target>Bonjour</target></trans-unit>
<trans-unit id="a>b"><source>S</source></trans-unit></body></file></xliff>`;
    const read = readXliff(xml);
    expect(read.source).toBe("en");
    expect(read.units).toEqual([
      { key: "k", source: "Hello", target: "Bonjour" },
      { key: "a>b", source: "S" },
    ]);
  });

  it("[I18N-R2-10] an unclosed quote in a start tag skips that element without a hang", () => {
    const xml = `<xliff><file><trans-unit id="k><source>S</source></trans-unit></file></xliff>`;
    expect(readXliff(xml).units).toEqual([]);
  });
});
