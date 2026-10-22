/**
 * The split of `createI18n`: the minimal core imports none of the opt-in modules, each feature works
 * when it is listed and fails with a `TypeError` that names it when it is not, and the full preset
 * wires everything. Invariants [I18N-300]..[I18N-319].
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRoot, useSignal } from "@shadow-js/core";
import { describe, expect, it } from "vitest";
import {
  FormattedDate,
  FormattedList,
  FormattedNumber,
  FormattedRelative,
} from "../src/components";
import { createI18n } from "../src/create-i18n";
import { DEFAULT_DETECT_ORDER, detection } from "../src/detect";
import type { I18nError } from "../src/errors";
import { formatting } from "../src/format";
import { allFeatures, createI18nFull } from "../src/full";
import { i18nHeadTags } from "../src/head";
import { createHotI18n } from "../src/hmr";
import type { I18nFeature } from "../src/i18n-types";
import type { CookieDocument, PersistStrategy } from "../src/persist";
import { cookieStrategy, persistence } from "../src/persistence";
import { createLocaleRouting, localeRouting, syncLocaleWithRoute } from "../src/routing";
import { createI18nMiddleware } from "../src/server";
import { createI18nWithIcu } from "../src/with-icu";
import { fakeEvent } from "./support/event";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");

/** Modules only an opt-in feature, the preset or an explicit helper may import. */
const OPT_IN = [
  "format.ts",
  "internal/formatters.ts",
  "values.ts",
  "routing.ts",
  "route-locale.ts",
  "persist.ts",
  "persistence.ts",
  "detect.ts",
  "hmr.ts",
  "head.ts",
  "full.ts",
  "with-icu.ts",
  "server.ts",
  "extract.ts",
];

interface RuntimeImport {
  /** The imported module, relative to `src`. */
  readonly module: string;
  /** The names imported, or `undefined` for `export *` and namespace imports. */
  readonly names: readonly string[] | undefined;
}

/** The runtime (not `import type`) relative imports and re-exports of one module. */
function runtimeImports(file: string): RuntimeImport[] {
  const text = readFileSync(file, "utf8");
  const found: RuntimeImport[] = [];
  const pattern = /^\s*(?:import|export)\s+(?!type\b)([^;]*?)\s*\bfrom\s+"(\.[^"]+)";/gm;
  for (const match of text.matchAll(pattern)) {
    const clause = match[1] ?? "";
    const spec = match[2] ?? "";
    const base = resolve(dirname(file), spec);
    const target = [`${base}.ts`, join(base, "index.ts")].find((candidate) =>
      existsSync(candidate),
    );
    if (target === undefined) continue;
    const open = clause.indexOf("{");
    const names =
      open === -1
        ? undefined
        : clause
            .slice(open + 1, clause.lastIndexOf("}"))
            .split(",")
            .map((name) => name.trim())
            .filter((name) => name !== "" && !name.startsWith("type "))
            .map((name) => name.split(" as ")[0] ?? name);
    found.push({ module: target.slice(src.length + 1), names });
  }
  return found;
}

/** Every module reachable through runtime imports from `entries`, as paths relative to `src`. */
function reachable(entries: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...entries];
  for (let file = stack.pop(); file !== undefined; file = stack.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    for (const next of runtimeImports(join(src, file))) stack.push(next.module);
  }
  return seen;
}

const base = { defaultLocale: "en", locales: ["en", "fr"] } as const;

/** A cookie jar that behaves like `document.cookie` for one cookie per name. */
function jar(): CookieDocument {
  const cookies = new Map<string, string>();
  return {
    get cookie(): string {
      return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    },
    set cookie(line: string) {
      const first = line.split(";")[0] ?? "";
      const equals = first.indexOf("=");
      cookies.set(first.slice(0, equals), first.slice(equals + 1));
    },
  };
}

describe("the minimal core", () => {
  it("[I18N-300] createI18n, the components and the request context reach no opt-in module through runtime imports", () => {
    // The root barrel re-exports the helpers too; tree shaking drops the ones an app does not use.
    // The strict check starts from what a minimal app imports: createI18n and the components.
    const minimal = reachable(["create-i18n.ts", "components.ts"]);
    expect(OPT_IN.filter((name) => minimal.has(name))).toEqual([]);
    expect([...minimal].filter((name) => name.startsWith("icu/"))).toEqual([]);
  });

  it("[I18N-301] of the locale utilities the core names only tag matching and text direction", () => {
    // `locale.ts` is shared with detection: the core imports two functions, so the Accept-Language
    // parser, the negotiation and the limits are dropped by the bundler in a minimal app.
    const minimal = reachable(["create-i18n.ts", "components.ts"]);
    const names = new Set<string>();
    for (const file of minimal) {
      for (const entry of runtimeImports(join(src, file))) {
        if (entry.module !== "locale.ts") continue;
        expect(entry.names, `${file} imports locale.ts whole`).toBeDefined();
        for (const name of entry.names ?? []) names.add(name);
      }
    }
    expect([...names].sort()).toEqual(["localeDirection", "matchLocale"]);
  });

  it("[I18N-302] each feature reaches only its own modules, and every feature is a built subpath", () => {
    const own: Record<string, readonly string[]> = {
      "format.ts": ["internal/formatters.ts"],
      "routing.ts": ["route-locale.ts"],
      "persistence.ts": ["persist.ts"],
      "detect.ts": [],
    };
    for (const [entry, allowed] of Object.entries(own)) {
      const graph = reachable([entry]);
      const foreign = OPT_IN.filter(
        (name) => graph.has(name) && name !== entry && !allowed.includes(name),
      );
      // The formatting feature formats values with the shared value helpers.
      expect(
        foreign.filter((name) => !(entry === "format.ts" && name === "values.ts")),
        entry,
      ).toEqual([]);
    }
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      exports: Record<string, { types: string; development: string; default: string }>;
    };
    const config = readFileSync(join(root, "tsdown.config.mjs"), "utf8");
    const subpaths: Record<string, string> = {
      "./format": "format",
      "./routing": "routing",
      "./persistence": "persistence",
      "./detect": "detect",
      "./full": "full",
    };
    for (const [subpath, name] of Object.entries(subpaths)) {
      expect(pkg.exports[subpath], subpath).toEqual({
        types: `./dist/dev/${name}.d.ts`,
        development: `./dist/dev/${name}.js`,
        default: `./dist/prod/${name}.js`,
      });
      expect(config, name).toContain(`${name}: "src/${name}.ts"`);
    }
  });

  it("[I18N-303] translation, switching, fallbacks, hydration and <html lang dir> work with no feature", async () => {
    const attributes = new Map<string, string>();
    const i18n = createI18n({
      defaultLocale: "en",
      locales: ["en", "ar"],
      messages: { en: { hello: "Hello", only: "English" }, ar: { hello: "مرحبا" } },
      syncDocument: {
        documentElement: { setAttribute: (name, value) => attributes.set(name, value) },
      },
    });
    expect(i18n.t("hello")).toBe("Hello");
    await expect(i18n.setLocale("ar")).resolves.toBe("ar");
    expect(i18n.t("hello")).toBe("مرحبا");
    expect(i18n.t("only")).toBe("English");
    expect(i18n.dir()).toBe("rtl");
    expect([attributes.get("lang"), attributes.get("dir")]).toEqual(["ar", "rtl"]);
    expect(i18n.state().locale).toBe("ar");
    expect(i18n.fork("en").t("hello")).toBe("Hello");
  });
});

describe("formatting", () => {
  it("[I18N-304] without the feature every format method and Formatted component throws a TypeError naming it", () => {
    const i18n = createI18n(base);
    const calls: Array<[string, () => unknown]> = [
      ["formatNumber", () => i18n.formatNumber(1)],
      ["formatDate", () => i18n.formatDate(0)],
      ["formatRelative", () => i18n.formatRelative(0)],
      ["formatList", () => i18n.formatList(["a"])],
      ["formatDisplayName", () => i18n.formatDisplayName("FR", { type: "region" })],
      ["formatNumber", () => FormattedNumber({ value: 1, i18n })()],
      ["formatDate", () => FormattedDate({ value: 0, i18n })()],
      ["formatRelative", () => FormattedRelative({ value: 0, i18n })()],
      ["formatList", () => FormattedList({ value: ["a"], i18n })()],
    ];
    for (const [name, call] of calls) {
      expect(call, name).toThrow(TypeError);
      expect(call, name).toThrow(`i18n.${name} needs the formatting feature`);
      expect(call, name).toThrow('from "@shadow-js/i18n/format"');
    }
    // The forks of an instance without the feature have none either.
    expect(() => i18n.fork("fr").formatNumber(1)).toThrow(/formatting feature/);
  });

  it("[I18N-305] with the feature the instance and each fork format in their own locale", () => {
    const i18n = createI18n({ ...base, timeZone: "UTC", features: [formatting] });
    expect(i18n.formatNumber(1234.5)).toBe("1,234.5");
    expect(i18n.formatDate(Date.UTC(2024, 0, 31), "long")).toBe("January 31, 2024");
    expect(i18n.formatList(["a", "b", "c"])).toBe("a, b, and c");
    expect(i18n.formatDisplayName("FR", { type: "region" })).toBe("France");
    expect(i18n.formatRelative(-86_400_000, { now: 0, numeric: "always" })).toBe("1 day ago");
    expect(i18n.fork("fr").formatNumber(1234.5)).toBe("1 234,5");
    expect(FormattedNumber({ value: 0.5, format: "percent", i18n })()).toBe("50%");
  });
});

describe("locale routing", () => {
  it("[I18N-306] without the feature: prefix throws at creation, localePath and routing throw, and nothing that reads routing works", () => {
    expect(() => createI18n({ ...base, prefix: "always" })).toThrow(TypeError);
    expect(() => createI18n({ ...base, prefix: "always" })).toThrow(
      'the prefix option needs the localeRouting feature: import { localeRouting } from "@shadow-js/i18n/routing"',
    );
    const i18n = createI18n(base);
    expect(() => i18n.localePath("/about")).toThrow(
      "i18n.localePath needs the localeRouting feature",
    );
    expect(() => i18n.routing).toThrow("i18n.routing needs the localeRouting feature");
    expect(() => i18n.fork("fr").routing).toThrow(TypeError);
    expect(() => i18nHeadTags(i18n, { path: "/", origin: "https://example.com" })).toThrow(
      /localeRouting feature/,
    );
    const [location] = useSignal({ pathname: "/en" });
    expect(() => syncLocaleWithRoute(i18n, { state: { location } })).toThrow(/localeRouting/);
    // The missing accessor is not enumerable: spreading or listing an instance never throws.
    expect(Object.keys(i18n)).not.toContain("routing");
    expect(() => ({ ...i18n })).not.toThrow();
  });

  it("[I18N-307] with the feature: prefix, localePath and one routing shared with every fork", () => {
    const i18n = createI18n({ ...base, prefix: "always", features: [localeRouting] });
    expect(i18n.localePath("/about")).toBe("/en/about");
    expect(i18n.localePath("/about", "fr")).toBe("/fr/about");
    expect(i18n.routing.prefix).toBe("always");
    expect(i18n.fork("fr").routing).toBe(i18n.routing);
    expect(Object.keys(i18n)).toContain("routing");
    const tags = i18nHeadTags(i18n, { path: "/about", origin: "https://example.com" });
    expect(tags.map((tag) => tag.props["href"])).toContain("https://example.com/fr/about");
    // Without `prefix` the default scheme is "as-needed", as createLocaleRouting's.
    const plain = createI18n({ ...base, features: [localeRouting] });
    expect(plain.routing.prefix).toBe(createLocaleRouting(base).prefix);
  });

  it("[I18N-308] the middleware needs routing only for the url source and redirects", async () => {
    const plain = createI18nWithIcu({
      ...base,
      messages: { en: { hi: "Hi" }, fr: { hi: "Salut" } },
    });
    expect(() => createI18nMiddleware(plain)).toThrow(/localeRouting feature/);
    expect(() => createI18nMiddleware(plain, { strategy: ["cookie"], redirect: true })).toThrow(
      /localeRouting feature/,
    );
    const headers = createI18nMiddleware(plain, { strategy: ["cookie", "accept-language"] });
    const event = fakeEvent("https://example.com/about", {
      headers: { "accept-language": "fr-CA,fr;q=0.9" },
    });
    await headers(event, async () => new Response("ok"));
    expect(event.document.lang).toBe("fr");

    const routed = createI18nWithIcu({
      ...base,
      prefix: "always",
      messages: { en: { hi: "Hi" }, fr: { hi: "Salut" } },
      features: [localeRouting],
    });
    const middleware = createI18nMiddleware(routed, { redirect: true });
    const redirected = await middleware(
      fakeEvent("https://example.com/about?x=1", { headers: { "accept-language": "fr" } }),
      async () => new Response("ok"),
    );
    expect(redirected.headers.get("location")).toBe("/fr/about?x=1");
  });
});

describe("persistence", () => {
  it("[I18N-309] without the feature any persist option but false throws a TypeError naming it", () => {
    for (const persist of [
      "cookie",
      "localStorage",
      [],
      { read: () => undefined, write: () => undefined },
    ] as const) {
      expect(() => createI18n({ ...base, persist }), JSON.stringify(persist)).toThrow(
        'the persist option needs the persistence feature: import { persistence } from "@shadow-js/i18n/persistence"',
      );
    }
    expect(createI18n({ ...base, persist: false }).locale()).toBe("en");
  });

  it("[I18N-310] with the feature the chosen locale is written; a throwing strategy is reported and the others still run", async () => {
    const document = jar();
    const errors: I18nError[] = [];
    const boom = new Error("strategy write exploded");
    const broken: PersistStrategy = {
      read: () => undefined,
      write: () => {
        throw boom;
      },
    };
    const i18n = createI18n({
      ...base,
      persist: [broken, { type: "cookie", name: "lang", document, secure: false }],
      features: [persistence],
      onError: (error) => errors.push(error),
    });
    await expect(i18n.setLocale("fr")).resolves.toBe("fr");
    expect(document.cookie).toBe("lang=fr");
    expect(errors.map((error) => [error.code, error.cause])).toEqual([["INVALID_STATE", boom]]);
    // The strategies of the subpath are the root's.
    expect(cookieStrategy({ document: jar() }).read()).toBeUndefined();
  });
});

describe("detection", () => {
  it("[I18N-311] without the feature any detect option but false throws a TypeError naming it", () => {
    expect(() => createI18n({ ...base, detect: true })).toThrow(
      'the detect option needs the detection feature: import { detection } from "@shadow-js/i18n/detect"',
    );
    expect(() => createI18n({ ...base, detect: { order: ["navigator"] } })).toThrow(TypeError);
    expect(createI18n({ ...base, detect: false }).locale()).toBe("en");
  });

  it("[I18N-312] with the feature the initial locale is detected; the url source needs routing", () => {
    const cookie = createI18n({
      ...base,
      detect: { input: { cookie: "locale=fr" } },
      features: [detection],
    });
    expect(cookie.locale()).toBe("fr");
    expect(() =>
      createI18n({ ...base, detect: { order: ["url"] }, features: [detection] }),
    ).toThrow('the "url" source of detect.order needs the localeRouting feature');
    // The default order leaves the URL out without routing and reads it with routing.
    const input = { pathname: "/fr/about", navigatorLanguages: ["en-US"] };
    expect(createI18n({ ...base, detect: { input }, features: [detection] }).locale()).toBe("en");
    expect(
      createI18n({
        ...base,
        prefix: "always",
        detect: { input },
        features: [detection, localeRouting],
      }).locale(),
    ).toBe("fr");
    expect(DEFAULT_DETECT_ORDER[0]).toBe("url");
  });

  it("[I18N-501] the browser's first detection follows the server under as-needed: a page without a locale prefix is the default locale's, whatever the cookie or the navigator says; the root still negotiates", () => {
    const cookie = { cookie: "locale=fr" };
    const start = (pathname: string, prefix: "as-needed" | "always", input: object) =>
      createI18n({
        ...base,
        prefix,
        detect: { input: { pathname, ...input } },
        features: [detection, localeRouting],
      }).locale();
    // The server answers /about with the default locale (I18N-520); the browser must start in the same locale.
    expect(start("/about", "as-needed", cookie)).toBe("en");
    expect(start("/about", "as-needed", { navigatorLanguages: ["fr-FR"] })).toBe("en");
    expect(start("/fr/about", "as-needed", { cookie: "locale=en" })).toBe("fr");
    // The root is not decided by the URL: the cookie answers it, as on the server.
    expect(start("/", "as-needed", cookie)).toBe("fr");
    // Under always an unprefixed path is not a page of any locale: the other sources decide, as before.
    expect(start("/about", "always", cookie)).toBe("fr");
  });

  it("[I18N-313] detection reads the persisted value as the storage source; a throwing read is reported", () => {
    const errors: I18nError[] = [];
    const boom = new Error("strategy read exploded");
    const remembered = createI18n({
      ...base,
      persist: { read: () => "fr", write: () => undefined },
      detect: { order: ["storage"] },
      features: [detection, persistence],
    });
    expect(remembered.locale()).toBe("fr");
    const broken = createI18n({
      ...base,
      persist: [
        {
          read: () => {
            throw boom;
          },
          write: () => undefined,
        },
        { read: () => "fr", write: () => undefined },
      ],
      detect: { order: ["storage"] },
      features: [detection, persistence],
      onError: (error) => errors.push(error),
    });
    expect(broken.locale()).toBe("fr");
    expect(errors.map((error) => error.cause)).toEqual([boom]);
  });

  it("[I18N-314] a detect input callback runs untracked", () => {
    const [source, setSource] = useSignal("locale=fr");
    let runs = 0;
    createRoot((dispose) => {
      // An effect-like computation that creates the instance must not depend on what the callback reads.
      const i18n = createI18n({
        ...base,
        detect: {
          input: () => {
            runs += 1;
            return { cookie: source() };
          },
        },
        features: [detection],
      });
      expect(i18n.locale()).toBe("fr");
      dispose();
    });
    setSource("locale=en");
    expect(runs).toBe(1);
  });
});

describe("the features option", () => {
  it("[I18N-315] rejects what is not a list of features, and two different features of one name", () => {
    expect(() =>
      createI18n({ ...base, features: formatting as unknown as readonly I18nFeature[] }),
    ).toThrow("the features option must be an array");
    expect(() =>
      createI18n({ ...base, features: [{ name: "formatting" } as unknown as I18nFeature] }),
    ).toThrow("features[0] is not an i18n feature");
    expect(() => createI18n({ ...base, features: [null as unknown as I18nFeature] })).toThrow(
      TypeError,
    );
    const impostor = { name: "formatting", plug: formatting.plug } as I18nFeature;
    expect(() => createI18n({ ...base, features: [formatting, impostor] })).toThrow(
      'two different "formatting" features',
    );
    // The same feature twice counts once, in any order.
    const twice = createI18n({ ...base, features: [localeRouting, formatting, formatting] });
    expect(twice.formatNumber(2)).toBe("2");
    expect(twice.localePath("/a", "fr")).toBe("/fr/a");
  });

  it("[I18N-316] a creation that fails for a missing feature changes nothing (no document write)", () => {
    const attributes = new Map<string, string>();
    const target = {
      documentElement: {
        setAttribute: (name: string, value: string) => attributes.set(name, value),
      },
    };
    expect(() =>
      createI18n({ ...base, syncDocument: target, persist: "cookie", detect: true }),
    ).toThrow(TypeError);
    expect(attributes.size).toBe(0);
  });

  it("[I18N-317] the features are frozen plain objects with stable names", () => {
    expect(allFeatures.map((feature) => feature.name)).toEqual([
      "formatting",
      "routing",
      "persistence",
      "detection",
    ]);
    for (const feature of [formatting, localeRouting, persistence, detection]) {
      expect(Object.isFrozen(feature)).toBe(true);
      expect(Object.getPrototypeOf(feature)).toBe(Object.prototype);
    }
    expect(Object.isFrozen(allFeatures)).toBe(true);
  });
});

describe("the full preset", () => {
  it("[I18N-318] createI18nFull wires every feature and the ICU compiler", async () => {
    const document = jar();
    const i18n = createI18nFull({
      ...base,
      messages: {
        en: { cart: "{count, plural, one {# item} other {# items}}" },
        fr: { cart: "{count, plural, one {# article} other {# articles}}" },
      },
      prefix: "as-needed",
      persist: { type: "cookie", document, secure: false },
      detect: { input: { cookie: "locale=fr" } },
      timeZone: "UTC",
      features: [formatting],
    });
    expect(i18n.locale()).toBe("fr");
    expect(i18n.t("cart", { count: 3 })).toBe("3 articles");
    expect(i18n.formatNumber(0.5, "percent")).toBe("50 %");
    expect(i18n.localePath("/cart", "en")).toBe("/cart");
    await i18n.setLocale("en");
    expect(document.cookie).toBe("locale=en");
    expect(i18n.t("cart", { count: 1 })).toBe("1 item");
    // A value that is not a list still reaches createI18n's check.
    expect(() =>
      createI18nFull({ ...base, features: "all" as unknown as readonly I18nFeature[] }),
    ).toThrow("the features option must be an array");
  });

  it("[I18N-319] createHotI18n and createI18nWithIcu take the same features", () => {
    const hot = createHotI18n(undefined, { ...base, features: allFeatures, prefix: "always" });
    expect(hot.localePath("/x", "fr")).toBe("/fr/x");
    const icu = createI18nWithIcu({
      ...base,
      messages: { en: { n: "{n, number}" } },
      features: [formatting],
    });
    expect(icu.t("n", { n: 1000 })).toBe("1,000");
    expect(icu.formatList(["a", "b"])).toBe("a and b");
  });
});
