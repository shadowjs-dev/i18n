<p align="center"><img src="https://raw.githubusercontent.com/shadowjs-dev/i18n/main/.github/banner.png" alt="ShadowJS" width="100%"></p>

# @shadow-js/i18n

[![npm](https://img.shields.io/npm/v/@shadow-js/i18n.svg)](https://www.npmjs.com/package/@shadow-js/i18n)
[![CI](https://github.com/shadowjs-dev/i18n/actions/workflows/ci.yml/badge.svg)](https://github.com/shadowjs-dev/i18n/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](https://github.com/shadowjs-dev/i18n/blob/main/LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.12-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-ready-blue.svg)](https://www.typescriptlang.org/)

Internationalization for ShadowJS: typed message keys and arguments, ICU MessageFormat,
fine-grained locale switching, lazy catalogs, server rendering that hydrates without a mismatch,
and a Dusk middleware. Plural rules, numbers, dates, lists, relative time and display names come
from the platform `Intl`; the only dependency is `@shadow-js/core` (a peer).

## Install

```sh
npm install @shadow-js/i18n
```

`@shadow-js/i18n` has no dependency on a renderer: it works with `@shadow-js/web` (or any renderer
that accepts the ShadowJS children shape) through your own app, and with `@shadow-js/dusk` through
a structural middleware type, never an import.

## Quick start

A catalog is a nested object of ICU messages. The default locale's catalog types every key and
argument; other locales are loaded on first use. (The catalogs are TypeScript modules so the
example runs without a bundler; a JSON file works the same, see [Typed catalogs](#typed-catalogs).)

```ts title="src/messages/fr.ts" typecheck
export default {
  hello: "Bonjour {name}",
  cart: { items: "{count, plural, =0 {Votre panier est vide} one {# article} other {# articles}}" },
  terms: "Lisez les <b>conditions</b>.",
} as const;
```

```ts title="src/i18n.ts" typecheck
import { createI18nWithIcu } from "@shadow-js/i18n";

export const i18n = createI18nWithIcu({
  defaultLocale: "en",
  locales: ["en", "fr"],
  messages: {
    en: {
      hello: "Hello {name}",
      cart: { items: "{count, plural, =0 {Your cart is empty} one {# item} other {# items}}" },
      terms: "Read the <b>terms</b>.",
    },
  },
  loaders: { fr: () => import("./messages/fr") },
});
```

`I18nProvider` makes the instance available; `useI18n()` returns it. `t` reads the locale signal,
so `{t("hello", { name })}` in JSX re-runs that one text node when the locale or `name` changes.

```tsx title="src/app.tsx" run mount="Page" text="Hello AdaYour cart is emptyRead the terms."
import { I18nProvider, useI18n } from "@shadow-js/i18n";
import { i18n } from "./i18n";

export function Cart(props: { name: string; count: number }) {
  const { t } = useI18n<typeof i18n>();
  return (
    <section>
      <h1>{t("hello", { name: props.name })}</h1>
      <p>{t("cart.items", { count: props.count })}</p>
      <p>{t.rich("terms", { b: (chunks) => <b>{chunks}</b> })}</p>
    </section>
  );
}

export function Page() {
  return (
    <I18nProvider i18n={i18n}>
      <Cart name="Ada" count={0} />
    </I18nProvider>
  );
}
```

In a test, give each case its own instance with `fork()` and switch the locale like a user would. The
text node is rewritten in place:

```tsx title="src/app.test.tsx" test
import { flushSync } from "@shadow-js/core";
import { I18nProvider } from "@shadow-js/i18n";
import { cleanup, render } from "@shadow-js/testing/dom";
import { afterEach, describe, expect, it } from "vitest";
import { Cart } from "./app";
import { i18n } from "./i18n";

afterEach(cleanup);

describe("the quick start", () => {
  it("switches to French without remounting", async () => {
    const local = i18n.fork();
    const view = render(() => (
      <I18nProvider i18n={local}>
        <Cart name="Ada" count={2} />
      </I18nProvider>
    ));
    const heading = view.container.querySelector("h1");
    const text = heading?.firstChild;
    expect(heading?.textContent).toBe("Hello Ada");

    await local.setLocale("fr");
    flushSync();
    expect(heading?.textContent).toBe("Bonjour Ada");
    expect(view.container.querySelector("p")?.textContent).toBe("2 articles");
    expect(view.container.querySelector("h1")).toBe(heading);
    expect(heading?.firstChild).toBe(text);
  });
});
```

## Optional features

The core `createI18n` (from `@shadow-js/i18n`) holds catalogs, `t`, `setLocale`, lazy loading and the components. Four
capabilities are opt-in features, each in its own subpath, listed in the `features` option:

- `formatting` (`@shadow-js/i18n/format`): `formatNumber`, `formatDate`, `formatRelative`, `formatList`,
  `formatDisplayName` and the `Formatted*` components.
- `localeRouting` (`@shadow-js/i18n/routing`): the `prefix` option, `localePath` and `routing`.
- `persistence` (`@shadow-js/i18n/persistence`): the `persist` option, with `cookieStrategy` and `storageStrategy`.
- `detection` (`@shadow-js/i18n/detect`): the `detect` option, with `detectLocale` and `readCookie`.

`createI18nFull` (`@shadow-js/i18n/full`) is `createI18nWithIcu` with all four features listed; `allFeatures` is the
frozen list it uses. Using an option or method without its feature throws a `TypeError` that names the feature and its
import. ICU arguments and plurals need none of them.

## Typed catalogs

Keys are the dotted paths of the default locale's catalog; the arguments of each message are parsed
out of its ICU text at the type level. Declare the catalog inline (as above) or `as const`.

```ts title="src/typed.ts" typecheck
import { i18n } from "./i18n";

i18n.t("hello", { name: "Ada" });
i18n.t("cart.items", { count: 3 });
i18n.t.rich("terms", { b: (chunks) => chunks });
i18n.scoped("cart")("items", { count: 1 });
void i18n.setLocale("fr");

// @ts-expect-error a message with arguments needs them
i18n.t("hello");
// @ts-expect-error count is a plural, so a number
i18n.t("cart.items", { count: "3" });
// @ts-expect-error no such key
i18n.t("cart.itemz", { count: 1 });
// @ts-expect-error every tag needs a handler
i18n.t.rich("terms", {});
// @ts-expect-error de is not one of the locales
void i18n.setLocale("de");
```

A catalog imported from a JSON file is typed with plain `string` values by TypeScript: its keys are
still checked and its arguments become `Record<string, unknown>`. Declare the data `as const` to get
the full check. To make `useI18n()` and `<Trans>` typed without a type argument, register the instance
once: `declare module "@shadow-js/i18n" { interface Register { i18n: typeof i18n } }`.

## ICU MessageFormat

Arguments, `plural` (`zero one two few many other`, `=N`, `offset:N`, `#`), `selectordinal`, `select`,
`number` and `date`/`time` with named styles or `::` skeletons, nested messages and rich-text tags.

| Syntax | Example |
| --- | --- |
| plural | `{n, plural, =0 {none} one {# item} other {# items}}` |
| ordinal | `{p, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}` |
| select | `{g, select, f {She} m {He} other {They}}` |
| number | `{n, number}`, `{n, number, percent}`, `{n, number, ::currency/EUR .00}` |
| date | `{d, date, short}`, `{d, date, ::yMMMd}`, `{d, time, ::Hm}` |
| tags | `Read <b>this</b>`, `<br/>` |

Escaping follows ICU: `''` is an apostrophe, `'{'` quotes a brace, `'<b>'` quotes a tag, a lone `'` is
literal, `#` is special only inside a plural. A skeleton token that is not supported is a syntax error
with a position, never silently ignored. Message text and argument values are always text: tags map
to functions in `t.rich` and `<Trans>`, and there is no HTML path.

```ts title="src/icu.test.ts" test
import { createI18nWithIcu } from "@shadow-js/i18n";
import { describe, expect, it } from "vitest";

function format(message: string, values: object, locale = "en"): string {
  return createI18nWithIcu({
    defaultLocale: locale,
    locales: [locale],
    messages: { [locale]: { m: message } },
    timeZone: "UTC",
    onError: (error) => {
      throw error;
    },
  }).translate("m", values);
}

describe("ICU", () => {
  it("plural categories follow the locale of the message", () => {
    const six = "{n, plural, zero {zero} one {one} two {two} few {few} many {many} other {other}}";
    expect([0, 1, 2, 3, 11, 100].map((n) => format(six, { n }, "ar"))).toEqual([
      "zero",
      "one",
      "two",
      "few",
      "many",
      "other",
    ]);
    expect([1, 2, 5].map((n) => format(six, { n }, "ru"))).toEqual(["one", "few", "many"]);
  });

  it("numbers, dates and escaping", () => {
    expect(format("{n, number, ::currency/USD}", { n: 5 })).toBe("$5.00");
    expect(format("{d, date, ::yMMMd}", { d: Date.UTC(2024, 2, 5) })).toBe("Mar 5, 2024");
    expect(format("It''s '{'literal'}' and <b>{n}</b>", { n: 2 })).toBe("It's {literal} and 2");
  });
});
```

## Lazy loading, fallbacks and races

`loaders` fetch a catalog at the first `setLocale`, `load` or `ready` that needs it. A key missing from
the active catalog is looked up along the fallback chain (`pt-BR` to `pt`, then `fallbackLocale`, then
the default locale), and is formatted with the rules of the locale it came from. `setLocale` loads
first, then switches, updates `<html lang dir>` and persists; the last call wins, a failed load keeps
the old locale and can be retried, and the promise resolves with the locale that ended up active.
`transition: "suspend"` switches at once instead of waiting; text then shows from the chain until the
catalog arrives. `onMissing` supplies text for a key found nowhere, `onError` receives every recoverable
problem, and `validate: true` checks the static catalogs in development.

## Server rendering with Dusk

On a server, use one `fork(locale)` per request. `createI18nMiddleware` picks the locale (URL prefix,
cookie, `Accept-Language`), loads its catalog, stores the fork for `getEventI18n(event)` in server code,
sets `<html lang dir>`, `Content-Language` and `Vary`, and can write a cookie or redirect to the
canonical URL. It is typed against a structural `I18nRequestEvent` that a Dusk `RequestEvent`
satisfies.

```ts title="src/entry-server.ts" typecheck
import { createI18nMiddleware } from "@shadow-js/i18n";
import type { HandlerOptions } from "@shadow-js/dusk/server";
import { i18n } from "./i18n";

const options: Omit<HandlerOptions, "manifest"> = {
  security: { allowedHosts: ["example.com"] },
  middleware: [
    createI18nMiddleware(i18n, {
      strategy: ["url", "cookie", "accept-language"],
      cookie: { name: "locale" },
      redirect: true,
    }),
  ],
};

export default options;
```

The middleware's path filter (`exclude`, `include`) decides which requests it handles: by default `/api`,
Dusk's `/_dusk` endpoints and paths with a file extension are left alone, so `redirect: true` never
touches them. The rest of the request runs inside an `AsyncLocalStorage` context that carries the fork:
`<I18nProvider i18n={i18n}>` provides the request's fork on the server (and the app instance in the
browser), `useI18n()` finds it without a provider, and `tryGetRequestI18n()` returns it, all without
importing `@shadow-js/dusk/server` (which Dusk's import protection refuses in client code). The
outermost provider in the browser also checks that the instance starts in the locale the server rendered
and re-reads the page state when it does not. To start the
browser in the server's locale with the server's catalogs, embed the snapshot with
`i18nHeadTags(request, { path, origin, state: true })` (or `renderI18nStateScript` in a custom
shell) and read it with `readI18nState()`. `createLocaleRouting` and `i18n.localePath` build
`/fr/about` style URLs (`prefix` is `"as-needed"`, `"always"` or `"never"`).

## Detection, persistence and right-to-left

`detect: true` (the `detection` feature) picks the first locale from the URL prefix, a cookie, storage and
`navigator.languages`; `persist` (the `persistence` feature) takes `"cookie"`, `"localStorage"`, an options object or your
own `{ read, write }`. `createI18nWithIcu` and `createI18nFull` take `format: { isolation }` (`"auto"`, `"always"` or
`"never"`) to wrap interpolated strings in U+2068 and U+2069; `"auto"` wraps only in right-to-left locales. `intlSupport()`
reports which `Intl` constructors the runtime has. `detectLocale`, `parseAcceptLanguage`, `negotiateLocale` and `matchLocale` are pure
functions. `i18n.dir()` and `localeDirection` give `"ltr"` or `"rtl"`, and the primary instance keeps
`<html lang dir>` in step.

## Testing and catalog tooling

Use `fork()` or a fresh `createI18n` per test, inject `timeZone` and `now`, throw from `onError`, and
pseudo-localize to find hard-coded strings. Validation and key extraction are pure functions, so a
test can fail CI, and the `shadow-i18n` command (`check`, `extract`, `export`, `import`) does the same on a folder of catalogs.

```ts title="src/tooling.test.ts" test
import { compareKeys, createI18nWithIcu, extractMessages, flattenCatalog } from "@shadow-js/i18n";
import { pseudoLocalize, validateCatalogs } from "@shadow-js/i18n/icu";
import { describe, expect, it } from "vitest";

const en = { greet: "Hello {name}", bye: "Bye", old: "Old" } as const;
const fr = { greet: "Bonjour {name}", bye: "Au revoir", old: "Vieux" } as const;

describe("catalog tooling", () => {
  it("validateCatalogs compares every locale with the base", () => {
    expect(validateCatalogs({ en, fr }).ok).toBe(true);
    const broken = validateCatalogs({ en, fr: { greet: "Bonjour", bye: "x" } });
    expect(broken.issues.map((issue) => `${issue.kind}:${issue.key}`)).toEqual([
      "missing-key:old",
      "argument-mismatch:greet",
    ]);
  });

  it("extractMessages and compareKeys find missing and unused keys", () => {
    const usage = extractMessages('t("greet", { name }); t("typo");');
    const result = compareKeys(flattenCatalog(en).keys(), usage);
    expect(result.missing.map((key) => key.key)).toEqual(["typo"]);
    expect(result.unused).toEqual(["bye", "old"]);
  });

  it("pseudoLocalize accents text and keeps arguments", () => {
    expect(pseudoLocalize({ greet: "Hello {name}" })).toEqual({ greet: "[Ĥéļļó~~ {name}]" });
    const pseudo = createI18nWithIcu({
      defaultLocale: "en",
      locales: ["en", "en-XA"],
      messages: { en, "en-XA": pseudoLocalize(en) },
      locale: "en-XA",
      syncDocument: false,
    });
    expect(pseudo.translate("bye")).toBe("[Ɓýé~]");
  });
});
```

Use a tag no real language owns for the pseudo locale (`en-XA`): `ps`, for example, is Pashto.

## API

Instance: `createI18n` (plain text; `compile` for syntax), `createI18nWithIcu` (ICU compiler passed), `I18n`, `I18nBase`, `I18nOptions`, `I18nState`, `BaseCatalog`, `CompiledMessage`, `MessageCompiler`, `I18nFeature`, `I18nFeatureName`, `IcuI18nOptions`.
Features: `@shadow-js/i18n/format` (`formatting`), `@shadow-js/i18n/routing` (`localeRouting`), `@shadow-js/i18n/persistence` (`persistence`), `@shadow-js/i18n/detect` (`detection`), `@shadow-js/i18n/full` (`createI18nFull`, `allFeatures`).
Runtime: `intlSupport`, `IntlSupport`, `createIntlCache`, `IntlCache`, `readCookie`, `DEFAULT_DETECT_ORDER`.
Components and hooks: `I18nProvider`, `I18nContext`, `useI18n`, `Trans`, `FormattedNumber`,
`FormattedDate`, `FormattedRelative`, `FormattedList`, `LocaleSwitcher`, `createLocaleSwitcher`, `Register`.
ICU: `parseMessage`, `printMessage`, `formatToString`, `formatToParts`, `parseNumberSkeleton`,
`parseDateSkeleton`, `PARSE_LIMITS`, `MessageSyntaxError`, `I18nError`.
Catalogs and tooling: `validateCatalogs`, `flattenCatalog`, `messageSignature`, `extractMessages`,
`compareKeys`, `findDuplicateKeys`, `KeySource`, `DuplicateKey`, `pseudoLocalize`.
Locale and URLs: `detectLocale`, `parseAcceptLanguage`, `negotiateLocale`, `matchLocale`,
`localeDirection`, `createLocaleRouting`, `cookieStrategy`, `storageStrategy`.
Server: `createI18nMiddleware`, `getEventI18n`, `i18nEventKey`, `i18nHeadTags`, `readI18nState`,
`renderI18nStateScript`, `serializeI18nState`, `parseI18nState`.
Types: `Translator`, `MessageKey`, `MessageArgs`, `MessageTags`, `Messages`, `WidenMessages`, `RichChunk`.

## Links

- [ShadowJS documentation](https://shadowjs.net): guides and the API reference.

## Dependencies

- Runtime: none.
- Peers: `@shadow-js/core` `^1.0.0`: reactive locale state.

## Types

- Names from the root: `CompiledMessage`, `MessageArgs`, `BaseCatalog`, `KeySource`, `DetectOptions`, `I18nErrorCode`.
- Type tests in `test-types/` run with `npm run typecheck`.

## Support

- Node.js `>=22.12.0`. ESM only: use `import`; `require` is not supported.
- Browsers: current evergreen releases.
- Versioning: every `@shadow-js/*` package releases together at one version. Upgrade them as one set.
- Documentation: [ShadowJS documentation](https://shadowjs.net).

## Using, changing and contributing

- **Use the package** (a person or a coding agent that builds with it): this README, and [SKILL.md](SKILL.md), the short page an agent reads first.
- **Change the package** (fix a bug, add a feature): [AGENTS.md](AGENTS.md) says how the repository is laid out, how to implement and test a change, and how a pull request is reviewed. It is written for people and coding agents alike.
- **Take part**: [CONTRIBUTING.md](CONTRIBUTING.md) is the short guide; [SECURITY.md](SECURITY.md) is for vulnerabilities.
