import { I18nError } from "./errors";

/**
 * Where the chosen locale is remembered: an entry of the `persist` option. The instance writes the
 * locale after each successful `setLocale` and, with `detect`, uses the first value a strategy
 * reads as the `"storage"` source. {@link cookieStrategy} and {@link storageStrategy} make the
 * built-in ones. A strategy must not throw: one that does is reported as `INVALID_STATE`.
 *
 * @example
 * ```ts
 * import { createI18n, type PersistStrategy } from "@shadow-js/i18n";
 * import { detection } from "@shadow-js/i18n/detect";
 * import { persistence } from "@shadow-js/i18n/persistence";
 *
 * // Remember the locale in the URL hash, for an app without cookies or storage.
 * const hashStrategy: PersistStrategy = {
 *   read: () => new URLSearchParams(location.hash.slice(1)).get("lang") ?? undefined,
 *   write: (locale) => {
 *     history.replaceState(null, "", `#lang=${encodeURIComponent(locale)}`);
 *   },
 * };
 *
 * export const i18n = createI18n({
 *   defaultLocale: "en",
 *   locales: ["en", "fr"],
 *   persist: hashStrategy,
 *   detect: { order: ["storage", "navigator"] },
 *   features: [persistence, detection],
 * });
 * ```
 * @since 1.0.0
 */
export interface PersistStrategy {
  /** The remembered locale, or `undefined` when there is none. Must not throw. Runs untracked: what it reads is not subscribed. */
  read(): string | undefined;
  /** Remembers `locale`. Must not throw. Runs untracked, even when `setLocale` is called inside a computation. */
  write(locale: string): void;
}

/**
 * The part of `document` the cookie strategy uses; pass one as the `document` option to read and
 * write cookies somewhere else (a test double).
 *
 * @example
 * ```ts
 * import { type CookieDocument, cookieStrategy } from "@shadow-js/i18n";
 *
 * const jar: CookieDocument = { cookie: "" };
 * const strategy = cookieStrategy({ document: jar, secure: false });
 * strategy.write("fr");
 * console.log(jar.cookie); // "locale=fr; Path=/; Max-Age=31536000; SameSite=Lax"
 * ```
 * @since 1.0.0
 */
export interface CookieDocument {
  /** The `document.cookie` accessor: read gives every cookie, write sets one. */
  cookie: string;
}

/**
 * The part of `Storage` the storage strategy uses; `localStorage`, `sessionStorage` and test
 * doubles satisfy it.
 *
 * @example
 * ```ts
 * import { type StorageLike, storageStrategy } from "@shadow-js/i18n";
 *
 * const memory = new Map<string, string>();
 * const storage: StorageLike = {
 *   getItem: (key) => memory.get(key) ?? null,
 *   setItem: (key, value) => void memory.set(key, value),
 * };
 *
 * const strategy = storageStrategy({ storage });
 * strategy.write("fr");
 * console.log(strategy.read()); // "fr"
 * ```
 * @since 1.0.0
 */
export interface StorageLike {
  /** The stored value of `key`, or `null`. */
  getItem(key: string): string | null;
  /** Stores `value` under `key`. */
  setItem(key: string, value: string): void;
}

/**
 * Options of {@link cookieStrategy}.
 *
 * @example
 * ```ts
 * import { type CookieStrategyOptions, cookieStrategy } from "@shadow-js/i18n";
 *
 * const options: CookieStrategyOptions = {
 *   name: "lang",
 *   maxAge: 60 * 60 * 24 * 90,
 *   sameSite: "strict",
 *   domain: "example.com",
 * };
 *
 * export const strategy = cookieStrategy(options);
 * ```
 * @since 1.0.0
 */
export interface CookieStrategyOptions {
  /**
   * Cookie name: an HTTP token (letters, digits and ``!#$%&'*+-.^_`|~``). Anything else throws
   * `INVALID_VALUE`.
   * @default `"locale"`
   */
  readonly name?: string;
  /**
   * The cookie's `Path`: printable ASCII without spaces, `"` or `;`; anything else throws
   * `INVALID_VALUE`.
   * @default `"/"`
   */
  readonly path?: string;
  /**
   * Lifetime in seconds, written as `Max-Age` (rounded down, and at least 0). `NaN` and infinite
   * values throw `INVALID_VALUE`.
   * @default `31_536_000` (one year)
   */
  readonly maxAge?: number;
  /**
   * The `SameSite` attribute. `"none"` always adds `Secure`, as browsers require. Any other value
   * throws `INVALID_VALUE`.
   * @default `"lax"`
   */
  readonly sameSite?: "lax" | "strict" | "none";
  /** Add `Secure`. Default: true when `location.protocol` is `https:`. */
  readonly secure?: boolean;
  /**
   * The cookie's `Domain`, to share it with subdomains. Default: none (the current host only). The
   * same characters as `path` are allowed.
   */
  readonly domain?: string;
  /** The document to use. Default `globalThis.document`; without one the strategy is inert (SSR). */
  readonly document?: CookieDocument | undefined;
  /**
   * Receives problems reaching or using `document` or `location` (an `INVALID_STATE` error whose
   * `cause` is what was thrown): blocked cookies, a sandboxed frame. Default: none; the instance
   * passes its own `onError` for specs it builds.
   */
  readonly report?: (error: I18nError) => void;
}

/**
 * Options of {@link storageStrategy}.
 *
 * @example
 * ```ts
 * import { type StorageStrategyOptions, storageStrategy } from "@shadow-js/i18n";
 *
 * const options: StorageStrategyOptions = {
 *   key: "app.locale",
 *   storage: sessionStorage,
 *   report: (error) => console.warn(error.message),
 * };
 *
 * export const strategy = storageStrategy(options);
 * ```
 * @since 1.0.0
 */
export interface StorageStrategyOptions {
  /**
   * The storage key.
   * @default `"locale"`
   */
  readonly key?: string;
  /**
   * The storage. Default `globalThis.localStorage`, looked up only when a `window` exists; without
   * one the strategy is inert.
   */
  readonly storage?: StorageLike | undefined;
  /**
   * Receives storage access errors (private mode, blocked storage, quota, anything the storage
   * throws) as `INVALID_STATE` with the thrown value as `cause`. Default: none; the instance passes
   * its own `onError` for specs it builds.
   */
  readonly report?: (error: I18nError) => void;
}

const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const COOKIE_ATTR = /^[\x21\x23-\x3a\x3c-\x7e]*$/;

/**
 * What went wrong, for a report: the message of an `Error`, otherwise the thrown value as text.
 * Shared with `persistence.ts`; not part of the public API.
 * @internal
 */
export function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reports a failed access as `INVALID_STATE`. A persistence strategy never throws: whatever the
 * platform raised (a `SecurityError` from blocked storage, a quota error, a polyfill's `Error`) is
 * handed to `report`, and the caller carries on without remembering the locale.
 */
function fail(
  report: ((error: I18nError) => void) | undefined,
  message: string,
  cause: unknown,
): void {
  report?.(new I18nError("INVALID_STATE", `${message}: ${reason(cause)}`, { cause }));
}

/** Reads a global that may not exist (SSR) or may throw on access (blocked storage). */
function globalValue(name: string, report: ((error: I18nError) => void) | undefined): unknown {
  try {
    return Reflect.get(globalThis, name);
  } catch (error) {
    fail(report, `${name} is not accessible`, error);
    return undefined;
  }
}

/**
 * Remembers the locale in a cookie (`name=value; Path; Max-Age; SameSite`, plus `Domain` and
 * `Secure` when set). Inert where there is no `document` (server rendering), so one configuration
 * works on both sides; the server middleware sets the cookie from the request. `read` returns the
 * first cookie with the name, decoded, or `undefined` when its encoding is invalid.
 *
 * @param options Name, lifetime and attributes.
 * @returns A strategy for the `persist` option.
 * @throws I18nError `INVALID_VALUE` for a cookie name that is not an HTTP token, a `path` or
 *   `domain` with spaces, double quotes, semicolons, control or non-ASCII characters, a `sameSite`
 *   other than `"lax"`, `"strict"` or `"none"`, or a `maxAge` that is not a finite number. Reading
 *   or writing the cookie never throws: a blocked `document.cookie` goes to `report`.
 * @example
 * ```ts
 * import { cookieStrategy, createI18n } from "@shadow-js/i18n";
 *
 * export const i18n = createI18n({
 *   defaultLocale: "en",
 *   locales: ["en", "fr"],
 *   persist: cookieStrategy({ name: "NEXT_LOCALE", maxAge: 60 * 60 * 24 * 30 }),
 * });
 * ```
 * @see {@link CookieStrategyOptions}
 * @since 1.0.0
 */
export function cookieStrategy(options: CookieStrategyOptions = {}): PersistStrategy {
  const name = options.name ?? "locale";
  if (!COOKIE_NAME.test(name)) {
    throw new I18nError(
      "INVALID_VALUE",
      __DEV__ ? `"${name}" is not a valid cookie name.` : "I18N_COOKIE_3",
    );
  }
  const path = options.path ?? "/";
  for (const value of [options.domain, path]) {
    if (value !== undefined && !COOKIE_ATTR.test(value))
      throw new I18nError(
        "INVALID_VALUE",
        __DEV__ ? `"${value}" is not a valid cookie attribute.` : "I18N_COOKIE_1",
      );
  }
  const sameSite = options.sameSite ?? "lax";
  if (sameSite !== "lax" && sameSite !== "strict" && sameSite !== "none") {
    throw new I18nError(
      "INVALID_VALUE",
      __DEV__
        ? `sameSite must be "lax", "strict" or "none", got ${JSON.stringify(sameSite)}.`
        : "I18N_COOKIE_4",
    );
  }
  const maxAge = options.maxAge ?? 31_536_000;
  if (!Number.isFinite(maxAge)) {
    throw new I18nError(
      "INVALID_VALUE",
      __DEV__ ? `maxAge must be a finite number of seconds, got ${maxAge}.` : "I18N_COOKIE_2",
    );
  }
  const documentOf = (): CookieDocument | undefined =>
    options.document ?? (globalValue("document", options.report) as CookieDocument | undefined);
  return {
    read() {
      const doc = documentOf();
      if (doc === undefined) return undefined;
      let jar: string;
      try {
        jar = doc.cookie;
        if (typeof jar !== "string") throw new TypeError("document.cookie is not a string");
      } catch (error) {
        fail(options.report, "cookie read failed", error);
        return undefined;
      }
      for (const part of jar.split(";")) {
        const equals = part.indexOf("=");
        if (equals === -1 || part.slice(0, equals).trim() !== name) continue;
        try {
          return decodeURIComponent(part.slice(equals + 1).trim());
        } catch (error) {
          if (error instanceof URIError) return undefined;
          throw error;
        }
      }
      return undefined;
    },
    write(locale) {
      const doc = documentOf();
      if (doc === undefined) return;
      const location = globalValue("location", options.report) as { protocol?: string } | undefined;
      const secure = options.secure ?? location?.protocol === "https:";
      const parts = [
        `${name}=${encodeURIComponent(locale)}`,
        `Path=${path}`,
        `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
        `SameSite=${sameSite.replace(/^./, (c) => c.toUpperCase())}`,
      ];
      if (options.domain !== undefined) parts.push(`Domain=${options.domain}`);
      if (secure || sameSite === "none") parts.push("Secure");
      try {
        doc.cookie = parts.join("; ");
      } catch (error) {
        fail(options.report, "cookie write failed", error);
      }
    },
  };
}

/**
 * Remembers the locale in `localStorage` (or any {@link StorageLike}). Access errors (private mode,
 * blocked storage, quota, any value the storage throws) are reported as `INVALID_STATE` and
 * ignored: the choice then lasts for the page only. Inert on the server.
 *
 * @param options Key and storage.
 * @returns A strategy for the `persist` option.
 * @example
 * ```ts
 * import { createI18n, storageStrategy } from "@shadow-js/i18n";
 *
 * export const i18n = createI18n({
 *   defaultLocale: "en",
 *   locales: ["en", "fr"],
 *   persist: storageStrategy({ key: "app.locale" }),
 *   detect: true,
 * });
 * ```
 * @see {@link StorageStrategyOptions}
 * @since 1.0.0
 */
export function storageStrategy(options: StorageStrategyOptions = {}): PersistStrategy {
  const key = options.key ?? "locale";
  const storageOf = (): StorageLike | undefined =>
    options.storage ??
    // Node 22+ defines a `localStorage` global that warns when touched: only look in a browser.
    (Reflect.get(globalThis, "window") === undefined
      ? undefined
      : (globalValue("localStorage", options.report) as StorageLike | undefined));
  return {
    read() {
      try {
        return storageOf()?.getItem(key) ?? undefined;
      } catch (error) {
        fail(options.report, "storage read failed", error);
        return undefined;
      }
    },
    write(locale) {
      try {
        storageOf()?.setItem(key, locale);
      } catch (error) {
        fail(options.report, "storage write failed", error);
      }
    },
  };
}
