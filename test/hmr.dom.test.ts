import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { flushSync } from "@shadow-js/core";
import { cleanup, fireEvent, render } from "@shadow-js/testing/dom";
import { createComponent } from "@shadow-js/web";
import { rolldown } from "rolldown";
import { afterEach, describe, expect, it } from "vitest";
import type { I18nError } from "../src/errors";
import { createHotI18n, type HotI18nContext } from "../src/hmr";
import type { Messages } from "../src/types";
import { load } from "./support/compile";

/** A component that reads a message reactively and has its own counter. */
const READER = `
import { useStore } from "@shadow-js/core";
export function Reader(props) {
  const [count, setCount] = useStore(0);
  return (
    <div>
      <p id="text">{props.i18n.t("message")}</p>
      <button id="button" onClick={() => setCount(count() + 1)}>{"count " + count()}</button>
    </div>
  );
}`;

interface ReaderModule {
  Reader(props: { i18n: unknown }): unknown;
}

/** A stand-in for Vite's `import.meta.hot` that survives "module reloads" (the `data` bag is shared). */
function makeHot(data: Record<string, unknown>): HotI18nContext {
  return { data };
}

afterEach(() => {
  cleanup();
});

describe("createHotI18n: catalog edits in development", () => {
  it("[I18N-HMR-01] an edited catalog changes the text of the component that reads it, in place; the component keeps its state", async () => {
    const { Reader } = await load<ReaderModule>(READER);
    const data: Record<string, unknown> = {};
    const first = makeHot(data);
    const i18n = createHotI18n(first, {
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: { message: "catalog v1" } },
    });
    const view = render(() => createComponent(Reader, { i18n }));
    const button = view.container.querySelector("#button") as HTMLElement;
    fireEvent.click(button);
    fireEvent.click(button);
    flushSync();
    const paragraph = view.container.querySelector("#text");
    expect(paragraph?.textContent).toBe("catalog v1");
    expect(view.container.querySelector("#button")?.textContent).toBe("count 2");

    // The edit: the catalog module runs again and returns the instance the component reads.
    const second = makeHot(data);
    const edited = createHotI18n(second, {
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: { message: "catalog v2" } },
    });
    expect(edited).toBe(i18n);
    flushSync();

    expect(view.container.querySelector("#text")).toBe(paragraph);
    expect(view.container.querySelector("#text")?.textContent).toBe("catalog v2");
    expect(view.container.querySelector("#button")?.textContent).toBe("count 2");
  });

  it("[I18N-HMR-02] an edit replaces the whole catalog: removed keys are gone, and a malformed edit keeps the old text", () => {
    const data: Record<string, unknown> = {};
    const reported: I18nError[] = [];
    const first = makeHot(data);
    const i18n = createHotI18n(first, {
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: { message: "catalog v1", removed: "soon gone" } },
      onError: (error) => {
        reported.push(error);
      },
    });
    expect(i18n.translate("removed")).toBe("soon gone");

    createHotI18n(makeHot(data), {
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: { message: "catalog v2" } },
    });
    expect(i18n.translate("message")).toBe("catalog v2");
    expect(i18n.translate("removed")).toBe("removed");
    expect(reported.map((error) => error.code)).toEqual(["MISSING_KEY"]);

    expect(() => i18n.replaceCatalog("en", { message: 5 } as never)).toThrow(/INVALID_CATALOG/);
    expect(i18n.translate("message")).toBe("catalog v2");
  });

  it("[I18N-HMR-03] without hot (server, or a bundler without HMR) every call creates its own instance and nothing is kept", () => {
    const options = {
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: { message: "catalog v1" } },
    } as const;
    const a = createHotI18n(undefined, options);
    const b = createHotI18n(undefined, options);
    expect(a).not.toBe(b);
    expect(a.translate("message")).toBe("catalog v1");
  });

  it("[I18N-HMR-04] a replaced catalog is a no-op after dispose()", () => {
    const i18n = createHotI18n(undefined, {
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: { message: "catalog v1" } },
    });
    i18n.dispose();
    i18n.replaceCatalog("en", { message: "catalog v2" } as Messages);
    expect(i18n.translate("message")).toBe("catalog v1");
  });
});

/** Bundles the helper the way a build does, with `__DEV__` set to `dev`, and returns the output. */
async function bundle(dev: boolean): Promise<{ code: string; file: string }> {
  const dir = join(import.meta.dirname, ".generated");
  mkdirSync(dir, { recursive: true });
  const name = dev ? "hmr-dev" : "hmr-prod";
  const entry = join(dir, `${name}-entry.ts`);
  const source = join(import.meta.dirname, "..", "src", "hmr.ts");
  writeFileSync(entry, `export { createHotI18n } from ${JSON.stringify(source)};\n`);
  const build = await rolldown({
    input: entry,
    external: [/^@shadow-js\//],
    transform: {
      define: {
        __DEV__: String(dev),
        __SERVER__: "false",
        __TEST__: "false",
        __VERSION__: '"0.0.0"',
      },
    },
    // The packages declare `"sideEffects": false`, so a bundler drops what nothing uses.
    treeshake: { moduleSideEffects: false },
    logLevel: "silent",
  });
  const { output } = await build.generate({ format: "esm", minify: !dev });
  await build.close();
  const first = output[0];
  if (first === undefined) throw new Error("no output");
  const file = join(dir, `${name}.mjs`);
  writeFileSync(file, first.code);
  return { code: first.code, file };
}

describe("createHotI18n: production builds", () => {
  it("[I18N-HMR-05] with __DEV__ false the hot branch is not in the bundle, and the helper is createI18n", async () => {
    const dev = await bundle(true);
    const prod = await bundle(false);
    expect(dev.code, "the development bundle keeps the hot branch").toContain("shadowjs:i18n");
    expect(prod.code, "the production bundle drops the hot branch").not.toContain("shadowjs:i18n");

    const { createHotI18n: helper } = (await import(/* @vite-ignore */ prod.file)) as {
      createHotI18n: typeof createHotI18n;
    };
    const data: Record<string, unknown> = {};
    const hot = makeHot(data);
    const options = {
      defaultLocale: "en",
      locales: ["en"],
      messages: { en: { message: "catalog v1" } },
    } as const;
    const a = helper(hot, options);
    const b = helper(hot, options);
    expect(a).not.toBe(b);
    expect(Object.keys(data), "production keeps nothing between evaluations").toEqual([]);
  });
});
