# AGENTS.md: working on i18n

This file is for anyone who changes this repository, people and coding agents alike. It says how the repository is laid out, how to implement
and test a change, and how a pull request is reviewed. To **use** the released package, read [README.md](README.md) and [SKILL.md](SKILL.md)
instead; to take part in the project, read [CONTRIBUTING.md](CONTRIBUTING.md).

Typed ICU messages, lazy catalogs, locale routing and server rendering without hydration mismatches.

## What is in this repository

| Package | Folder | What it is | Documentation |
| --- | --- | --- | --- |
| `@shadow-js/i18n` | `.` | Typed translations with ICU messages, lazy catalogs and server rendering that hydrates cleanly | https://i18n.shadowjs.net |

The repository is the package: `@shadow-js/i18n`. Source and issues:
https://github.com/shadowjs-dev/i18n. Every package of the project has the same version number.

## Set up

You need Node.js 22.12 or newer and npm (pnpm and Yarn are not used).

```sh
npm install
npm run check   # lint, build, type check and every test
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run lint` | Biome: lint and format check (`npx biome check --write <path>` fixes what it can) |
| `npm run build` | builds the package with tsdown |
| `npm run typecheck` | TypeScript 7 in strict mode, tests included |
| `npm test` | unit, DOM and server tests (Vitest) |
| `npx vitest run <path>` | one test file |
| `npm run test:gc` | memory and leak tests |
| `npm run test:perf` | wall-clock budgets; run alone, never in parallel with other work |
| `npm run check` | all of the above; a change is ready when it passes |

## Layout

- `.github/`: workflows, issue and pull request templates, code owners.
- `build/`: the shared tsdown preset every package build uses.
- `scripts/`: build and release scripts; `release.mjs` is run by the workflows.
- `src/`: the source of the package; one folder per concern, `index.ts` re-exports the public API. Folders: `cli/`, `icu/`, `internal/`.
- `test/`: the tests; one file per behavior, each test named by an invariant id such as `[ROUTER-12]`.
- `test-types/`: type-level tests: what the package promises to the compiler of its users.
- `types/`: ambient declarations shared with the build.
- `CHANGELOG.md`: what each release changed.
- `biome.json`: lint and format rules.
- `package.json`: the manifest; `version` is changed only by a release.
- `tsconfig.json`: type check of the source.
- `tsconfig.test-types.json`: type check of `test-types/`.
- `tsdown.config.mjs`: the build.
- `vitest.config.ts`: the test projects (unit, DOM, server, gc, perf).
- `vitest.setup.ts`: test setup: an unasserted `console.warn` or `console.error` fails a test.

## How to implement a change

1. **Find where the behavior lives.** Search `test/` and `src/` for the name of the behavior or its invariant id, then read the source the tests exercise. The invariants below say what must stay true.
2. **Write the failing test first.** A bug fix reproduces the bug; a feature states the behavior it promises. Name the test with an invariant id in square brackets, the way the neighboring tests do, then the behavior in words. The test asserts what the code does and is never skipped, marked as todo or marked as an expected failure.
3. **Make it pass with the smallest change** that keeps the invariants. Match the code around it.
4. **Keep the surface honest.** A public symbol has TSDoc (summary, parameters, return value, an example and `@since`). An error says what happened and how to fix it. User-visible behavior gets a documentation update and a line under `## Unreleased` in CHANGELOG.md.
5. **Run `npm run check`** and read its output; do not report a change as done without it passing.

### Rules every change keeps

- No `any`, `@ts-ignore` or non-null assertion. Use `unknown` and narrow.
- Compare indices, lengths and counts explicitly (`=== undefined`, `=== -1`, `> 0`), never by truthiness.
- No empty `catch`: every catch rethrows, passes the error to the owner's handler, or reports it. Every "set the current X" register is restored in `finally`.
- User callbacks run untracked unless the API says otherwise. No stack parsing, no `fn.name` sniffing, no flags stamped on user functions.
- Traversals whose depth the user controls are iterative. Caches, queues and recursion are bounded, and a test hits the bound.
- Code meant for development only sits behind `__DEV__`. No import-time side effects and no module-level mutable state beyond the registers the core owns (bounded caches and `WeakMap`s excepted).
- No sleeps in tests (flush the scheduler); a `console.warn` or `console.error` that a test does not assert fails the test. Property tests use `fast-check` with a fixed seed.
- Files are kebab-case, tests are `*.test.ts`, internals live in `src/internal/`. American English in code, comments and documentation. Comments explain why, not what.
- The reactive core and the DOM renderer have no runtime dependencies.

## Pull requests

1. **Open an issue first** for anything that adds or changes public API, behavior, supported platforms or dependencies. A small fix needs no issue.
2. **Fork, then branch from `main`** (`fix/<topic>`, `feat/<topic>`, `docs/<topic>`). One concern per pull request.
3. **Commit in small steps** with a message that says what changed and why: a short type prefix (`fix:`, `feat:`, `docs:`, `test:`, `chore:`), then the subject. Commit under your own identity; do not add trailers or notes about tools.
4. **Open the pull request against `main`** and fill in the template: what changes, why, and the checks you ran. The CI workflow (`.github/workflows/ci.yml`) runs lint, build, type check and all tests; it must be green.
5. **Review.** A maintainer (see `.github/CODEOWNERS`) reviews every pull request. Expect questions about the test, the public surface and the error messages. Push fixes to the same branch; the pull request is squash-merged.
6. **Releases are not part of a pull request.** Do not change `version`, `.github/workflows/release.yml` or `scripts/release.mjs`, and do not create tags or publish. A maintainer releases by renaming `## Unreleased` in the changelog to the version and pushing a version that is not yet on npm to `main`; the workflow publishes it with provenance.

Security problems never go in a public issue or pull request: follow [SECURITY.md](SECURITY.md).

## Architecture and invariants

What each package keeps true. A change that breaks one of these is a bug in the change.

Package rules (each has a test id in `test/`).

### Dependencies and layering
- Runtime dependency: `@shadow-js/core` public exports only (peer). Never import `@shadow-js/web`,
  `@shadow-js/router` or `@shadow-js/dusk` from `src/`. Dusk is reached through structural types
  (`I18nRequestEvent`), proven assignable in `test-types/instance.ts`. Web head tags are structural too.
- Plural rules, numbers, dates, lists, relative time and display names come from `Intl`. The ICU parser,
  printer, skeleton parsers and the source tokenizer are written here; no regular expressions run over
  user messages or source text.
- No import-time side effects, no module-level mutable state. Caches live on the instance and are bounded.
  Two documented exceptions in `src/internal/request-context.ts`: the process-wide `AsyncLocalStorage` that carries
  the request's fork (found through `process.getBuiltinModule`, like Dusk's request event; it holds no state of
  its own), `WeakSet`s of primary instances / checked providers, and a `WeakMap` of each instance's reporter
  (`internal/request-context.ts`, read by the hydration check). [I18N-218, I18N-217]
- The core (`create-i18n.ts`, `components.ts` and what they import at run time) never imports an opt-in
  module: `format.ts`, `internal/formatters.ts`, `values.ts`, `routing.ts`, `route-locale.ts`, `persist.ts`,
  `persistence.ts`, `detect.ts`, `hmr.ts`, `head.ts`, `full.ts`, `with-icu.ts`, `server.ts`, `extract.ts`, `icu/`.
  From `locale.ts` it names only `matchLocale` and `localeDirection` (tag matching for `setLocale`, `<html dir>`).
  Type-only imports are free. [I18N-300, I18N-301]
- Feature modules, one package subpath each, named after the source file (`package.json` `exports` and
  `tsdown.config.mjs` entries stay in step) [I18N-302]:

  | Subpath | Module | Exports | Reaches |
  | --- | --- | --- | --- |
  | `./format` | `format.ts` | `formatting` | `internal/formatters.ts`, `values.ts` |
  | `./routing` | `routing.ts` | `localeRouting`, `createLocaleRouting`, `syncLocaleWithRoute` | `route-locale.ts` |
  | `./persistence` | `persistence.ts` | `persistence`, `cookieStrategy`, `storageStrategy` | `persist.ts` |
  | `./detect` | `detect.ts` | `detection`, `detectLocale`, `readCookie` | `locale.ts` |
  | `./full` | `full.ts` | `createI18nFull`, `allFeatures` | every feature, `with-icu.ts` |

  A feature never imports another feature; what one needs from another arrives through the core
  (detection gets the routing and the resolved persistence in its `DetectionRequest`).

### Message seam (`src/message.ts`, `src/with-icu.ts`)
- The core (`create-i18n.ts` and what it imports) never imports `src/icu/`. A catalog text is plain when it has no `{`, `}`, `<`, `''` or `'>`: plain text is its own message (`plainMessage`), anything else goes to the injected `compile` option, and without one reports `NO_COMPILER`. [I18N-219, I18N-220, I18N-221, I18N-223]
- `createI18nWithIcu` (root), `createI18nFull` (`@shadow-js/i18n/full`, through `createI18nWithIcu`) and `@shadow-js/i18n/icu` (`icuCompile`, `icuCompiler`, parser, printer, formatter, `validateCatalogs`, `messageSignature`, `pseudoLocalize`) are the only ICU entry points. `values.ts` holds the Intl value helpers both sides use.
- `extract.ts` has no imports and stays at the root.

### Messages (`src/icu`)
- `parseMessage` throws only `MessageSyntaxError`, runs in linear time (single forward scan), and is
  bounded: length 20 000, nesting 32 (ceiling 128), nodes 5 000. [I18N-8, I18N-11, I18N-21, I18N-25, I18N-26]
- `printMessage(parseMessage(s))` reparses to the same AST for every `s` that parses. [I18N-20, I18N-21, I18N-23]
- Text and argument values are never interpreted as markup: formatting produces strings and tag
  handler results only. No `innerHTML`, no HTML string building anywhere in `src/`. [I18N-39, I18N-173, I18N-191]
- Argument lookup uses own properties only (`Object.hasOwn`); catalogs are read through own data
  property descriptors and stored in `Map`s, so `__proto__`/`constructor` keys are plain data. [I18N-41, I18N-55, I18N-145]
- A recoverable problem (missing value, bad value, unknown named format, missing tag handler) goes to the
  instance reporter and the output falls back to readable text; `t` never throws for data problems. [I18N-40, I18N-43]
- Tag handlers and user callbacks (`onError`, `onMissing`, loaders, persist strategies) run untracked.
  Argument accessors are called tracked on purpose: that is what makes JSX reactive.

### Instance (`src/create-i18n.ts`, `src/internal`)
- `t` and every formatter read `locale()` and the catalog versions of the fallback chain, nothing else
  (a catalog loading for another locale does not rerun readers). [I18N-60]
- `setLocale`: last call wins, stale loads never apply, loads of one locale are shared, a failed load
  keeps the old locale and is retryable, a call after `dispose()` is a no-op. A superseded load's failure is
  still reported; a failure after `dispose()` is not. [I18N-63..67, I18N-71, I18N-453, I18N-455]
- The instance creates no timers and no event listeners; `dispose()` invalidates pending work, clears
  `pending()`, releases waiting `<Suspense>` boundaries, and makes `hydrate`, `replaceCatalog` and
  `load` no-ops (no loader runs). [I18N-71, I18N-179, I18N-205, I18N-456, I18N-458]
- A throwing `onMissing` is reported as `INVALID_VALUE` (the `cause` is the thrown value) and the key is
  returned; a result that is not a string is the key. [I18N-464]
- An invalid page state is reported through the instance reporter and the instance keeps its locale;
  `<I18nProvider>` never throws for the page state. [I18N-494]
- Server code uses `fork(locale)` per request; the module-level instance is never mutated by a request. [I18N-121]
- Recurring data problems are reported once per message (bounded filter of 500); load and state errors
  are reported every time. [I18N-203, I18N-204]
- Features (`src/internal/features.ts`): a feature is a frozen plain object `{ name, plug }` made in its
  subpath module. `createI18n` reads the `features` option once into slots by name (`shared.plugs`): not an
  array, an entry that is not a feature, or two different features of one name throw a `TypeError`; the same
  object twice counts once; order never matters. Each slot is called at one fixed point: `routing` once per
  `createI18n` (shared by every fork), `persistence` and `detection` once for the primary instance in the
  browser, `formatting` once per instance and per fork. [I18N-315, I18N-317]
- A missing feature throws a `TypeError` from `featureMissing` that names the feature, its import and
  `createI18nFull`: the `prefix`, `persist` (not `false`), `detect` (not `false`) options and a `"url"` entry of
  `detect.order` at creation, on the server too, before anything is created; the `format*` methods,
  `localePath` and reading `routing` when called (a missing `routing` is a non-enumerable accessor, so
  spreading an instance never throws); `createI18nMiddleware` with the `"url"` source or `redirect`,
  `syncLocaleWithRoute` and `i18nHeadTags` synchronously. The instance shape (`I18nBase`) is the same with
  or without features. [I18N-304, I18N-306, I18N-308, I18N-309, I18N-311, I18N-312, I18N-316]
- Persist strategies run through the persistence feature's guard: a strategy that throws is reported as
  `INVALID_STATE` (with the thrown value as `cause`), the other strategies still run, and `setLocale` and
  creation never fail because of persistence. The `detect.input` callback runs untracked. [I18N-310, I18N-313, I18N-314]

### Caches and bounds (each has a test that hits the bound)
compiled messages (`cacheSize`), `Intl` formatter cache (256), catalog depth 32 / 100 000 keys,
Accept-Language 32 entries / 1024 chars, hydration state 8 MB, source tokenizer 5 MB / template depth 64,
once-only reporter 500. [I18N-8, I18N-100, I18N-131, I18N-145, I18N-155, I18N-200..204]

### Security
- Paths built by `localePath`/`alternates` start with exactly one `/` and contain no backslash or control
  character. [I18N-111]
- The hydration payload is escaped for `<script>` and validated on read; nonce and id are plain tokens. [I18N-130..132]
- The middleware redirects only to same-origin paths it built itself, and only for GET/HEAD. [I18N-124]
- A path returned by `parse`/`resolve`/`localePath` starts with exactly one `/`, also when the input used backslashes
  or encoded slashes (`%2F`, `%5C`) after the locale segment. A locale-shaped but unsupported first segment is never
  redirected into a prefixed copy. [I18N-212, I18N-213]
- The middleware's default path filter leaves `/api`, `/_dusk` and files alone. [I18N-215]

### Typing
- `isolatedDeclarations`: every export has an explicit type. `test-types/` proves key and argument
  inference (positive and `@ts-expect-error` cases) and is part of `typecheck`.
- Types mirror the parser for `{x}`, `{n, number|date|time, style}`, `plural`, `selectordinal`, `select`,
  apostrophe quoting and tags. When the parser grammar changes, change `src/types.ts` and its tests together.

## Where to look next

- [README.md](README.md): what the package does and every option.
- [SKILL.md](SKILL.md): how to use the released package (install, import paths, a quick start).
- [CONTRIBUTING.md](CONTRIBUTING.md): the short guide to taking part.
- [CHANGELOG.md](CHANGELOG.md): what each release changed.
- [ShadowJS hub](https://github.com/shadowjs-dev/shadow): every repository of the project.
