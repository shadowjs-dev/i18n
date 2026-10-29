/**
 * The `persistence` feature (subpath `@shadow-js/i18n/persistence`): the `persist` option of
 * `createI18n`, which remembers the locale `setLocale` chose in a cookie, `localStorage` or a
 * strategy of your own. Without this feature the `persist` option throws a `TypeError` that names
 * it, and the strategy code is not bundled.
 * @packageDocumentation
 */
import { untrack } from "@shadow-js/core";
import { I18nError } from "./errors";
import type { I18nFeature, PersistSpec } from "./i18n-types";
import type { ResolvedPersistence } from "./internal/features";
import {
  type CookieStrategyOptions,
  cookieStrategy,
  type PersistStrategy,
  reason,
  type StorageStrategyOptions,
  storageStrategy,
} from "./persist";

export type {
  CookieDocument,
  CookieStrategyOptions,
  PersistStrategy,
  StorageLike,
  StorageStrategyOptions,
} from "./persist";
export { cookieStrategy, storageStrategy } from "./persist";

/** The strategy a spec names, and the cookie name when it is the cookie strategy. */
function strategyOf(
  spec: PersistSpec,
  report: (error: I18nError) => void,
): { strategy: PersistStrategy; cookieName?: string } {
  if (spec === "cookie") return { strategy: cookieStrategy({ report }), cookieName: "locale" };
  if (spec === "localStorage") return { strategy: storageStrategy({ report }) };
  if ("read" in spec && "write" in spec && typeof spec.read === "function") {
    return { strategy: spec };
  }
  const typed = spec as { readonly type: "cookie" | "localStorage" };
  if (typed.type === "cookie") {
    const options = spec as CookieStrategyOptions;
    return {
      strategy: cookieStrategy({ ...options, report: options.report ?? report }),
      cookieName: options.name ?? "locale",
    };
  }
  const options = spec as StorageStrategyOptions;
  return { strategy: storageStrategy({ ...options, report: options.report ?? report }) };
}

/** What a strategy threw, as the `INVALID_STATE` problem the instance reports. */
function failure(action: "read" | "write", error: unknown): I18nError {
  return new I18nError("INVALID_STATE", `a persist strategy's ${action} failed: ${reason(error)}`, {
    cause: error,
  });
}

/**
 * Resolves the `persist` option: the strategies it names, guarded so that a strategy that throws
 * (against the {@link PersistStrategy} contract) is reported and never stops the others or
 * `setLocale`.
 */
function resolvePersistence(
  persist: PersistSpec | readonly PersistSpec[],
  report: (error: I18nError) => void,
): ResolvedPersistence {
  const specs: readonly PersistSpec[] = Array.isArray(persist)
    ? (persist as readonly PersistSpec[])
    : [persist as PersistSpec];
  let cookieName: string | undefined;
  const strategies = specs.map((spec) => {
    const made = strategyOf(spec, report);
    if (made.cookieName !== undefined && cookieName === undefined) cookieName = made.cookieName;
    return made.strategy;
  });
  return {
    cookieName,
    read() {
      for (const strategy of strategies) {
        let value: string | undefined;
        try {
          // A user callback: `setLocale` may be called inside a computation, which must not subscribe to what it reads.
          value = untrack(() => strategy.read());
        } catch (error) {
          report(failure("read", error));
          continue;
        }
        if (value !== undefined) return value;
      }
      return undefined;
    },
    write(locale) {
      for (const strategy of strategies) {
        try {
          untrack(() => strategy.write(locale));
        } catch (error) {
          report(failure("write", error));
        }
      }
    },
  };
}

/**
 * The `persistence` feature: lets `createI18n` take the `persist` option, which remembers each
 * locale `setLocale` chose (after the switch succeeded) with one or more strategies: `"cookie"`,
 * `"localStorage"`, their `{ type, ...options }` forms, or a {@link PersistStrategy} of your own.
 * With the `detection` feature, the first value a strategy reads is the `"storage"` source, and
 * the cookie strategy's name is the cookie the `"cookie"` source reads.
 *
 * Only the instance `createI18n` returns persists, and only in the browser; forks and the server
 * never do. A strategy that throws is reported through `onError` as `INVALID_STATE` (its `cause`
 * is what was thrown) and the other strategies still run; `setLocale` never fails because of
 * persistence. Without this feature, a `persist` option other than `false` throws a `TypeError`
 * that names it.
 *
 * @example
 * ```ts
 * import { createI18n } from "@shadow-js/i18n";
 * import { persistence } from "@shadow-js/i18n/persistence";
 *
 * export const i18n = createI18n({
 *   defaultLocale: "en",
 *   locales: ["en", "fr"],
 *   persist: [{ type: "cookie", name: "lang" }, "localStorage"],
 *   features: [persistence],
 * });
 *
 * await i18n.setLocale("fr"); // writes the "lang" cookie and the localStorage entry
 * ```
 * @see {@link cookieStrategy}
 * @see {@link storageStrategy}
 * @since 1.0.0
 */
export const persistence: I18nFeature<"persistence"> = /* @__PURE__ */ Object.freeze({
  name: "persistence",
  plug: resolvePersistence,
});
