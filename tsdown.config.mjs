import { readFileSync } from "node:fs";
import { defineConfig } from "tsdown";
import { createConfig } from "./build/tsdown-preset.mjs";

// `./server` holds the request-scoped helpers (middleware, request context). It is its own entry, so a
// client that imports `@shadow-js/i18n/server` never names them, and the root re-exports them for
// compatibility (a client that imports only the root keeps them only if it uses them).
// The opt-in features are entries too, one subpath each, named after its source file (see
// `I18nFeature`): `./format` (`formatting`), `./routing` (`localeRouting`), `./persistence`
// (`persistence`), `./detect` (`detection`), and `./full`, the preset with every feature and the ICU
// compiler.
const library = createConfig({
  packageDir: import.meta.dirname,
  entries: {
    index: "src/index.ts",
    server: "src/server.ts",
    icu: "src/icu/index.ts",
    format: "src/format.ts",
    routing: "src/routing.ts",
    persistence: "src/persistence.ts",
    detect: "src/detect.ts",
    full: "src/full.ts",
  },
});

const pkg = JSON.parse(readFileSync(`${import.meta.dirname}/package.json`, "utf8"));

// The `shadow-i18n` command: one Node ESM file with a shebang, no dependency. It bundles the catalog and ICU readers it
// checks with, so it runs without a build of the app.
const cli = {
  entry: { cli: "src/cli/bin.ts" },
  format: "esm",
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: false,
  dts: false,
  sourcemap: false,
  banner: "#!/usr/bin/env node",
  define: {
    __DEV__: "false",
    __SERVER__: "true",
    __TEST__: "false",
    __VERSION__: JSON.stringify(pkg.version),
  },
};

export default defineConfig([...library, cli]);
