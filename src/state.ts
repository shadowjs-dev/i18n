import { CATALOG_LIMITS } from "./catalog";
import { I18nError } from "./errors";
import type { I18nState } from "./i18n-types";

/**
 * Id of the `<script type="application/json">` that carries the state: `"__SHADOW_I18N__"`.
 * {@link renderI18nStateScript} writes it (unless given another `id`) and {@link readI18nState}
 * looks for it first.
 *
 * @example
 * ```ts
 * import { parseI18nState, STATE_SCRIPT_ID } from "@shadow-js/i18n";
 *
 * const text = document.getElementById(STATE_SCRIPT_ID)?.textContent;
 * export const state = text ? parseI18nState(text) : undefined;
 * ```
 * @since 1.0.0
 */
export const STATE_SCRIPT_ID = "__SHADOW_I18N__";

/**
 * Name of the `<meta>` that can carry the state instead of a script: `"shadow-i18n"`.
 * {@link i18nHeadTags} writes it with `state: true`, and {@link readI18nState} reads it when the
 * page has no state script.
 *
 * @example
 * ```ts
 * import { parseI18nState, STATE_META_NAME } from "@shadow-js/i18n";
 *
 * const meta = document.querySelector(`meta[name="${STATE_META_NAME}"]`);
 * const content = meta?.getAttribute("content");
 * export const state = content ? parseI18nState(content) : undefined;
 * ```
 * @since 1.0.0
 */
export const STATE_META_NAME = "shadow-i18n";

/**
 * Largest state text {@link parseI18nState} accepts, in UTF-16 code units: 8 000 000. A longer
 * text is rejected with `INVALID_STATE` before it is parsed.
 *
 * @example
 * ```ts
 * import { createI18n, STATE_MAX_LENGTH, serializeI18nState } from "@shadow-js/i18n";
 *
 * const i18n = createI18n({ defaultLocale: "en", locales: ["en"], messages: { en: { title: "Home" } } });
 * const size = serializeI18nState(i18n.state()).length;
 * if (size > STATE_MAX_LENGTH / 2) console.warn(`the i18n state is ${size} characters`);
 * ```
 * @since 1.0.0
 */
export const STATE_MAX_LENGTH = 8_000_000;

const SAFE_TOKEN = /^[A-Za-z0-9+/=_-]{1,200}$/;
const UNSAFE = /[<>&\u2028\u2029]/g;

/**
 * JSON of a state that is safe inside `<script type="application/json">` and in an attribute
 * value: `<`, `>`, `&`, U+2028 and U+2029 are written as unicode escapes, so no message can close
 * the script element. `JSON.parse` (and {@link parseI18nState}) reads it back unchanged.
 *
 * @param state From `i18n.state()`.
 * @returns JSON text.
 * @example
 * ```ts
 * import { serializeI18nState } from "@shadow-js/i18n";
 *
 * const json = serializeI18nState({ v: 1, locale: "en", messages: { en: { a: "</script>" } } });
 * console.log(json); // {"v":1,"locale":"en","messages":{"en":{"a":"\u003c/script\u003e"}}}
 * ```
 * @since 1.0.0
 */
export function serializeI18nState(state: I18nState): string {
  return JSON.stringify(state).replace(
    UNSAFE,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/**
 * Parses and validates state text: a version 1 snapshot whose catalogs are flat string maps. Only
 * `v`, `locale` and `messages` are kept. Whether `locale` is supported is checked later, by
 * `createI18n({ state })` or `hydrate`.
 *
 * @param text JSON from {@link serializeI18nState}.
 * @returns The state.
 * @throws I18nError `INVALID_STATE` for text longer than {@link STATE_MAX_LENGTH}, invalid JSON,
 *   a value that is not a version 1 snapshot with a string `locale`, or a catalog that is not a
 *   plain object of strings (an array, a nested object) or has more than 100 000 messages.
 * @example
 * ```ts
 * import { parseI18nState } from "@shadow-js/i18n";
 *
 * const state = parseI18nState('{"v":1,"locale":"fr","messages":{"fr":{"title":"Bienvenue"}}}');
 * console.log(state.locale, state.messages["fr"]); // "fr" { title: "Bienvenue" }
 * ```
 * @see {@link readI18nState}
 * @since 1.0.0
 */
export function parseI18nState(text: string): I18nState {
  if (text.length > STATE_MAX_LENGTH) {
    throw new I18nError(
      "INVALID_STATE",
      __DEV__ ? `the state is larger than ${STATE_MAX_LENGTH} characters.` : "I18N_STATE_7",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new I18nError(
        "INVALID_STATE",
        __DEV__ ? `the state is not valid JSON: ${error.message}` : "I18N_STATE_3",
        {
          cause: error,
        },
      );
    }
    throw error;
  }
  if (typeof value !== "object" || value === null) {
    throw new I18nError("INVALID_STATE", __DEV__ ? "the state must be an object." : "I18N_STATE_6");
  }
  const locale = Reflect.get(value, "locale");
  const messages = Reflect.get(value, "messages");
  if (
    Reflect.get(value, "v") !== 1 ||
    typeof locale !== "string" ||
    typeof messages !== "object" ||
    messages === null ||
    Array.isArray(messages)
  ) {
    throw new I18nError(
      "INVALID_STATE",
      __DEV__ ? "the state is not a version 1 snapshot." : "I18N_STATE_9",
    );
  }
  for (const code of Object.keys(messages)) {
    const catalog = Object.getOwnPropertyDescriptor(messages, code)?.value;
    if (typeof catalog !== "object" || catalog === null || Array.isArray(catalog)) {
      throw new I18nError(
        "INVALID_STATE",
        __DEV__ ? `the catalog for "${code}" must be an object.` : "I18N_STATE_1",
      );
    }
    const keys = Object.keys(catalog);
    if (keys.length > CATALOG_LIMITS.maxKeys) {
      throw new I18nError(
        "INVALID_STATE",
        __DEV__
          ? `the catalog for "${code}" has more than ${CATALOG_LIMITS.maxKeys} messages.`
          : "I18N_STATE_4",
      );
    }
    for (const key of keys) {
      if (typeof Object.getOwnPropertyDescriptor(catalog, key)?.value !== "string") {
        throw new I18nError(
          "INVALID_STATE",
          __DEV__ ? `"${code}.${key}" must be a string.` : "I18N_STATE_8",
        );
      }
    }
  }
  return { v: 1, locale, messages: messages as I18nState["messages"] };
}

/**
 * Options of {@link renderI18nStateScript}.
 *
 * @example
 * ```ts
 * import { renderI18nStateScript, type StateScriptOptions } from "@shadow-js/i18n";
 *
 * const options: StateScriptOptions = { nonce: "r4nd0m", id: "i18n-state" };
 * export const html = renderI18nStateScript({ v: 1, locale: "en", messages: {} }, options);
 * ```
 * @since 1.0.0
 */
export interface StateScriptOptions {
  /**
   * CSP nonce of the request (`event.nonce`), written as the `nonce` attribute. 1 to 200
   * characters of `A-Z a-z 0-9 + / = _ -`, or `INVALID_VALUE` is thrown. Default: no attribute.
   */
  readonly nonce?: string | undefined;
  /**
   * Element id, with the same character rule as `nonce`. {@link readI18nState} only finds the
   * default id.
   * @default {@link STATE_SCRIPT_ID} (`"__SHADOW_I18N__"`)
   */
  readonly id?: string;
}

/**
 * The HTML of the state `<script>`, for a custom document shell. Only the nonce and id are
 * interpolated, and both must be plain tokens; the JSON is escaped by {@link serializeI18nState}.
 *
 * @param state From `i18n.state()`.
 * @param options Nonce and id.
 * @returns `<script type="application/json" id="..." nonce="...">...</script>` (no `nonce`
 *   attribute when none is given).
 * @throws I18nError `INVALID_VALUE` for a nonce or id with unexpected characters.
 * @example
 * ```ts
 * import { createI18n, renderI18nStateScript } from "@shadow-js/i18n";
 *
 * const i18n = createI18n({ defaultLocale: "en", locales: ["en"], messages: { en: { title: "Home" } } });
 *
 * export function documentShell(body: string, nonce: string): string {
 *   const state = renderI18nStateScript(i18n.state(), { nonce });
 *   return `<!doctype html><html lang="${i18n.locale()}"><body>${body}${state}</body></html>`;
 * }
 * ```
 * @since 1.0.0
 */
export function renderI18nStateScript(state: I18nState, options: StateScriptOptions = {}): string {
  const id = options.id ?? STATE_SCRIPT_ID;
  if (!SAFE_TOKEN.test(id))
    throw new I18nError(
      "INVALID_VALUE",
      __DEV__ ? `"${id}" is not a safe element id.` : "I18N_STATE_2",
    );
  if (options.nonce !== undefined && !SAFE_TOKEN.test(options.nonce)) {
    throw new I18nError(
      "INVALID_VALUE",
      __DEV__ ? "the nonce contains unexpected characters." : "I18N_STATE_5",
    );
  }
  const nonce = options.nonce === undefined ? "" : ` nonce="${options.nonce}"`;
  return `<script type="application/json" id="${id}"${nonce}>${serializeI18nState(state)}</script>`;
}

/**
 * The part of `document` that {@link readI18nState} uses; pass one to read the state of another
 * document (a parsed HTML string, a test double).
 *
 * @example
 * ```ts
 * import { readI18nState, type StateDocument } from "@shadow-js/i18n";
 *
 * const html = new DOMParser().parseFromString(
 *   '<script type="application/json" id="__SHADOW_I18N__">{"v":1,"locale":"fr","messages":{}}</script>',
 *   "text/html",
 * );
 * const doc: StateDocument = html;
 * console.log(readI18nState(doc)?.locale); // "fr"
 * ```
 * @since 1.0.0
 */
export interface StateDocument {
  /** Finds the state script by id ({@link STATE_SCRIPT_ID}); `null` when absent. */
  getElementById(id: string): { readonly textContent: string | null } | null;
  /** Finds the state `<meta>` by a `meta[name="shadow-i18n"]` selector; `null` when absent. */
  querySelector(selector: string): { getAttribute(name: string): string | null } | null;
}

/**
 * Options of {@link readI18nState}.
 *
 * @example
 * ```ts
 * import { readI18nState, type ReadStateOptions } from "@shadow-js/i18n";
 *
 * const options: ReadStateOptions = { onError: (error) => console.warn(error.message) };
 * export const state = readI18nState(undefined, options);
 * ```
 * @since 1.0.0
 */
export interface ReadStateOptions {
  /**
   * Called with the `INVALID_STATE` error when the embedded state is oversized, malformed or
   * tampered with. `readI18nState` then returns `undefined`, so the app starts with its defaults
   * instead of failing to start. Default: none, the error is thrown.
   */
  readonly onError?: (error: I18nError) => void;
}

/**
 * Reads the state the server embedded: the `<script id="__SHADOW_I18N__">` first, then
 * `<meta name="shadow-i18n">`. Call it before `hydrate()` and pass the result to `createI18n({ state })`,
 * so the first client render uses the server's locale and text.
 *
 * The page is untrusted input (an extension or a proxy can rewrite it). Pass `onError` to start
 * with the defaults and a report when the state is invalid, instead of an exception.
 *
 * @param doc The document. Default `globalThis.document`.
 * @param options `onError`: receive an invalid state as a report and get `undefined` back.
 * @returns The state, or `undefined` when the page has none (or there is no document, on the
 *   server, or the state was invalid and `onError` took the error).
 * @throws I18nError `INVALID_STATE` when the embedded text is invalid (see {@link parseI18nState})
 *   and no `onError` was given.
 * @example
 * ```ts
 * import { createI18n, type I18nState, readI18nState } from "@shadow-js/i18n";
 *
 * // The snapshot is typed with `string` locales; name yours (the instance still checks it).
 * const state = readI18nState(undefined, {
 *   onError: (error) => console.warn(error.message),
 * }) as I18nState<"en" | "fr"> | undefined;
 *
 * export const i18n = createI18n({
 *   defaultLocale: "en",
 *   locales: ["en", "fr"],
 *   messages: { en: { title: "Welcome" } },
 *   loaders: { fr: () => fetch("/locales/fr.json").then((response) => response.json()) },
 *   ...(state === undefined ? {} : { state }),
 * });
 * ```
 * @see {@link ReadStateOptions}
 * @since 1.0.0
 */
export function readI18nState(
  doc?: StateDocument,
  options: ReadStateOptions = {},
): I18nState | undefined {
  const target = doc ?? (Reflect.get(globalThis, "document") as StateDocument | undefined);
  if (target === undefined) return undefined;
  try {
    // An empty script or meta is no state, the same as a missing one.
    const scriptText = target.getElementById(STATE_SCRIPT_ID)?.textContent;
    if (scriptText) return parseI18nState(scriptText);
    const content = target
      .querySelector(`meta[name="${STATE_META_NAME}"]`)
      ?.getAttribute("content");
    return content ? parseI18nState(content) : undefined;
  } catch (error) {
    if (options.onError !== undefined && error instanceof I18nError) {
      options.onError(error);
      return undefined;
    }
    throw error;
  }
}
