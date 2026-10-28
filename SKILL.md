---
name: shadowjs-i18n
description: "Work with @shadow-js/i18n. Typed translations with ICU messages, lazy catalogs and server rendering that hydrates cleanly. Use when a project imports it, or when asked to add, configure or debug it."
---

# @shadow-js/i18n

Version 1.0.1. Typed translations with ICU messages, lazy catalogs and server rendering that hydrates cleanly.

## Where to read more

- @shadow-js/i18n: https://i18n.shadowjs.net
- Source and issues: https://github.com/shadowjs-dev/i18n
- The package README is the full reference for options and behavior; read it before changing a configuration.

## Install

```sh
npm install @shadow-js/i18n @shadow-js/core
```

## Peer dependencies

| Package | Range | Required |
| --- | --- | --- |
| `@shadow-js/core` | `^1.0.1` | yes |

## Import paths

Import only from these paths. Never from `dist` or `src`: files that are not listed here are private and change without notice.

- `@shadow-js/i18n`
- `@shadow-js/i18n/server`
- `@shadow-js/i18n/icu`
- `@shadow-js/i18n/format`
- `@shadow-js/i18n/routing`
- `@shadow-js/i18n/persistence`
- `@shadow-js/i18n/detect`
- `@shadow-js/i18n/full`

## Quick start

```ts
export default {
  hello: "Bonjour {name}",
  cart: { items: "{count, plural, =0 {Votre panier est vide} one {# article} other {# articles}}" },
  terms: "Lisez les <b>conditions</b>.",
} as const;
```

## Working rules

- Run `npm run check` before proposing a change; it lints, builds, type-checks and tests.
- Keep a public change documented: TSDoc on every exported symbol, and a CHANGELOG entry.
- To change this repository rather than use the package, read AGENTS.md: the layout, the commands, the rules and how a pull request is reviewed.
