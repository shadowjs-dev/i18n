import { I18nError } from "./errors";

/**
 * Limits {@link flattenCatalog} enforces on every catalog (static, loaded, added or hydrated), so a
 * hostile or broken catalog fails fast with `INVALID_CATALOG` instead of exhausting memory.
 *
 * - `maxDepth` (32): most levels of nested objects, counting the catalog object itself.
 * - `maxKeys` (100 000): most messages in one catalog.
 *
 * The object is frozen; the limits cannot be changed.
 *
 * @example
 * ```ts
 * import { CATALOG_LIMITS, flattenCatalog } from "@shadow-js/i18n";
 *
 * const catalog = { nav: { home: "Home", about: "About" } };
 * const size = flattenCatalog(catalog).size;
 * console.log(`${size} of ${CATALOG_LIMITS.maxKeys} messages`);
 * ```
 * @since 1.0.0
 */
export const CATALOG_LIMITS: Readonly<{ maxDepth: number; maxKeys: number }> = Object.freeze({
  maxDepth: 32,
  maxKeys: 100_000,
});

/**
 * Flattens a nested catalog to dotted keys, in declaration order. Only own data properties are
 * read, so a catalog parsed from JSON that contains `__proto__` or `constructor` keys is plain data
 * and never touches a prototype. Iterative, bounded by {@link CATALOG_LIMITS}. Use it to list a
 * catalog's keys for {@link compareKeys}, or to check a catalog before shipping it.
 *
 * @param catalog The nested messages: an object whose leaves are strings.
 * @returns A new `Map` from dotted key to message text.
 * @throws I18nError `INVALID_CATALOG` when the catalog is not an object, for a leaf that is not a
 *   string or an object (an array, `null`, a number), an accessor property, an empty key, a dotted key
 *   defined twice (`{ "a.b": "x", a: { b: "y" } }`), or a catalog over {@link CATALOG_LIMITS}.
 * @example
 * ```ts
 * import { flattenCatalog } from "@shadow-js/i18n";
 *
 * const flat = flattenCatalog({ nav: { home: "Home" }, title: "Welcome" });
 * console.log([...flat.keys()]); // ["nav.home", "title"]
 * console.log(flat.get("nav.home")); // "Home"
 * ```
 * @see {@link CATALOG_LIMITS}
 * @since 1.0.0
 */
export function flattenCatalog(catalog: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const stack: Array<{ value: unknown; path: string; depth: number }> = [
    { value: catalog, path: "", depth: 0 },
  ];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    const { value, path, depth } = frame;
    if (typeof value === "string") {
      if (path === "") throw new I18nError("INVALID_CATALOG", "a catalog must be an object.");
      if (out.has(path)) {
        throw new I18nError("INVALID_CATALOG", `the key "${path}" is defined twice.`);
      }
      out.set(path, value);
      if (out.size > CATALOG_LIMITS.maxKeys) {
        throw new I18nError(
          "INVALID_CATALOG",
          `the catalog has more than ${CATALOG_LIMITS.maxKeys} messages.`,
        );
      }
      continue;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new I18nError(
        "INVALID_CATALOG",
        `"${path === "" ? "(root)" : path}" must be a string or an object, got ${
          Array.isArray(value) ? "an array" : value === null ? "null" : typeof value
        }.`,
      );
    }
    if (depth >= CATALOG_LIMITS.maxDepth) {
      throw new I18nError(
        "INVALID_CATALOG",
        `"${path}" is nested deeper than ${CATALOG_LIMITS.maxDepth}.`,
      );
    }
    // Reverse so that popping visits keys in their declared order (stable error messages).
    const keys = Object.keys(value).reverse();
    for (const key of keys) {
      if (key === "") throw new I18nError("INVALID_CATALOG", `"${path}" has an empty key.`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) {
        throw new I18nError(
          "INVALID_CATALOG",
          `"${path === "" ? key : `${path}.${key}`}" is an accessor; catalogs hold plain data.`,
        );
      }
      stack.push({
        value: descriptor.value,
        path: path === "" ? key : `${path}.${key}`,
        depth: depth + 1,
      });
    }
  }
  return out;
}
