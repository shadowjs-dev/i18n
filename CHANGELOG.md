# Changelog

## 1.0.3

### Fixed

- A catalog loader that throws before its first await no longer leaves a rejected load behind: the next `load` calls the loader again.
- `createI18nMiddleware` under `prefix: "as-needed"` negotiates the root path from the cookie and `Accept-Language` like the browser's detection, so hydration no longer flips the locale.
- `formatRelative` chooses the unit after rounding: 59.6 seconds is "in 1 minute", not "in 60 seconds" (same for hours, days, weeks, months and years).

## 1.0.2

### Fixed

- `i18nHeadTags` writes `og:locale` as language and region (`zh_TW` for `zh-Hant-TW`) and skips duplicate alternates; it used to keep the script (`zh_Hant-TW`).
- `matchLocale` and `negotiateLocale` prefer the supported locale of the script a request implies (`zh-TW` gets `zh-Hant`, not the first `zh-*`).
- A string passed as the values of a message, or a plain value under a rich-text tag's name, no longer throws (`MISSING_VALUE` / `MISSING_TAG_HANDLER` instead).
- `hydrate` with a snapshot whose `messages` is not an object throws `INVALID_STATE`, not a `TypeError`.
- A `NaN` parse limit (`maxDepth`, `maxNodes`, `maxLength`) means the default, not no limit, so deep input cannot overflow the stack.
- `formatNumber`, `formatDate` and `formatRelative` no longer throw for an object with no usable `toString`.
- `chain()` of an undeclared tag is no longer cached, the `compile` option and the `onError` callback used for catalog validation run untracked.
- The CLI: `readXliff` no longer recurses per near-miss element name, and `import` keeps a `__proto__` key as data.
- After `dispose()`, `t()` inside a `Suspense` boundary on a locale that never loaded no longer registers a holder that nothing releases.
- A custom `PersistStrategy` `read` and `write` run untracked, so calling `setLocale` or creating the instance inside a computation no longer subscribes it to what the strategy reads.
- `replaceCatalog` while a loader is in flight discards that load's result: keys the new catalog dropped no longer come back.
- ICU: `=-1` (a negative exact plural selector) is accepted, and a brace written in quotes (`'}'`) inside a `number`, `date` or `time` style no longer ends the argument; the style is unquoted like message text.
- The XLIFF reader finds the end of a start tag outside quoted attribute values, so a raw `>` in an attribute no longer breaks the unit.
- `shadow-i18n` reads catalogs into an object without a prototype, so `--base constructor` (or `--locale toString`) is a missing locale, not a member of `Object.prototype`.

## 1.0.1

### Changed

- Released at 1.0.1 with the other packages, which share one version. No change to this package.

## 1.0.0

### Added

- Typed message catalogs, translation parameters and reactive locale changes.
- Optional ICU messages, formatting, detection, persistence, routing and server hydration.
- Locale direction and bidirectional text support.
- `shadow-i18n` command: `check` (catalogs against each other and against the code), `extract`, and `export`/`import` of XLIFF 1.2 for translators, with `--json` output.
