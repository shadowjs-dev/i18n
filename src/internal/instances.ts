import type { I18nError } from "../errors";
import type { I18nBase } from "../i18n-types";

/**
 * Instances made by `createI18n` and their forks, with how each one reports its problems and whether
 * it is a primary (`createI18n`, not `fork`). Written once per instance, read by providers. This module
 * has no import-time work, so a bundle that never renders a provider keeps none of it.
 * @internal
 */
const registry: WeakMap<
  I18nBase,
  { readonly report: (error: I18nError) => void; readonly primary: boolean }
> = new WeakMap();

/**
 * Instances whose page state was already compared with their locale (outermost provider only).
 * @internal
 */
const checked: WeakSet<I18nBase> = new WeakSet();

/**
 * Remembers how `instance` reports and whether it is a primary instance.
 * @internal
 */
export function register(
  instance: I18nBase,
  report: (error: I18nError) => void,
  primary: boolean,
): void {
  registry.set(instance, { report, primary });
}

/**
 * True when `instance` is a primary instance (made by `createI18n`, not forked).
 * @internal
 */
export function isPrimary(instance: I18nBase): boolean {
  return registry.get(instance)?.primary === true;
}

/**
 * The reporter of `instance`: its `onError` option, or the once-only console warning. An instance
 * that was not made here reports to the console in development.
 * @internal
 */
export function reporterOf(instance: I18nBase): (error: I18nError) => void {
  return (
    registry.get(instance)?.report ??
    ((error: I18nError): void => {
      if (__DEV__) console.warn(error.message);
    })
  );
}

/**
 * True the first time it is asked about `instance`.
 * @internal
 */
export function firstProviderOf(instance: I18nBase): boolean {
  if (checked.has(instance)) return false;
  checked.add(instance);
  return true;
}
