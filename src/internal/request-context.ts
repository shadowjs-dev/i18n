import type { I18nBase } from "../i18n-types";
import { isPrimary } from "./instances";

/** The part of `AsyncLocalStorage` this module uses. */
interface RequestStorage {
  run<T>(instance: I18nBase, callback: () => T): T;
  getStore(): I18nBase | undefined;
}

type StorageConstructor = new () => RequestStorage;

function isStorageConstructor(value: unknown): value is StorageConstructor {
  if (typeof value !== "function") return false;
  const prototype: unknown = Reflect.get(value, "prototype");
  return (
    typeof prototype === "object" &&
    prototype !== null &&
    typeof Reflect.get(prototype, "run") === "function"
  );
}

/**
 * Finds `AsyncLocalStorage` without importing a Node module, so the browser bundle contains no
 * reference to one: hosts that have it (Node, Bun, Deno, Workers with `nodejs_compat`) expose it
 * through `process.getBuiltinModule`. Anywhere else (a browser, a runtime without it) the result
 * is `undefined` and request-scoped lookups find nothing.
 */
function detectStorage(): RequestStorage | undefined {
  const host: unknown = Reflect.get(globalThis, "process");
  if (typeof host !== "object" || host === null) return undefined;
  const load: unknown = Reflect.get(host, "getBuiltinModule");
  if (typeof load !== "function") return undefined;
  const hooks: unknown = Reflect.apply(load, host, ["node:async_hooks"]);
  if (typeof hooks !== "object" || hooks === null) return undefined;
  const Storage: unknown = Reflect.get(hooks, "AsyncLocalStorage");
  return isStorageConstructor(Storage) ? new Storage() : undefined;
}

// One storage per process, like the request event of `@shadow-js/dusk`: the lookup is a free
// function (`useI18n`), so it cannot belong to one middleware. The storage keeps no state of its
// own; every request enters it with `runWithRequestI18n`.
const storage: RequestStorage | undefined = detectStorage();

/**
 * Runs `callback` with `instance` as the instance of the request being handled. Where the runtime
 * has no `AsyncLocalStorage` the callback just runs.
 * @internal
 */
export function runWithRequestI18n<T>(instance: I18nBase, callback: () => T): T {
  return storage === undefined ? callback() : storage.run(instance, callback);
}

/**
 * The instance of the request being handled, or `undefined` outside one (or without async context).
 * @internal
 */
export function currentRequestI18n(): I18nBase | undefined {
  return storage?.getStore();
}

/**
 * True when this runtime can track the request across `await`.
 * @internal
 */
export const hasRequestContext: boolean = storage !== undefined;

/**
 * The instance a provider should provide: the request's fork when `given` is the primary instance
 * that fork was made from (same locales list: forks share it), otherwise `given`.
 * @internal
 */
export function instanceForRequest(given: I18nBase): I18nBase {
  const request = currentRequestI18n();
  if (request === undefined || !isPrimary(given) || request.locales !== given.locales) {
    return given;
  }
  return request;
}
