import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { flattenCatalog } from "../catalog";
import { compareKeys, type ExtractedKey, extractMessages } from "../extract";
import { validateCatalogs } from "../icu/validate";
import type { Messages } from "../types";
import { type ReadXliff, readXliff, type TransUnit, writeXliff } from "./xliff";

/**
 * What the `shadow-i18n` commands do, as functions of folders and options: they read and write files, return plain data and
 * print nothing, so a test calls them directly and the command line only chooses how to show the result.
 */

/** Folders that never hold the app's own source. */
const SKIPPED = new Set([
  "node_modules",
  "dist",
  ".git",
  ".generated",
  ".dusk",
  "coverage",
  ".turbo",
  ".vite",
]);
const SOURCE = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);
/** Largest source file read for keys; a bigger file is a generated bundle, not the app's code. */
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

/** A catalog read from `<dir>/<locale>.json`. */
export type Catalog = Record<string, unknown>;

/**
 * Reads every `<locale>.json` of a folder.
 *
 * @param dir The messages folder.
 * @returns The catalogs by locale (the file name without `.json`), sorted by locale, in an object without a prototype.
 * @throws Error when the folder is missing, holds no catalog, or a file is not valid JSON (the message names the file).
 */
export async function readCatalogs(dir: string): Promise<Record<string, Catalog>> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => extname(name) === ".json").sort();
  } catch (cause) {
    throw new Error(`the messages folder ${dir} cannot be read.`, { cause });
  }
  if (names.length === 0) throw new Error(`the messages folder ${dir} has no <locale>.json file.`);
  // No prototype: a locale named `constructor` or `toString` (from `--base`) must not find a member of Object.prototype.
  const catalogs: Record<string, Catalog> = Object.create(null);
  for (const name of names) {
    const file = join(dir, name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(file, "utf8"));
    } catch (cause) {
      throw new Error(
        `${file} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      );
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${file} must hold a JSON object of messages.`);
    }
    catalogs[basename(name, ".json")] = parsed as Catalog;
  }
  return catalogs;
}

/** The source files under some folders, sorted, without dependencies, build output and generated code. */
export async function sourceFiles(roots: readonly string[]): Promise<string[]> {
  const found: string[] = [];
  const pending = [...roots].map((root) => resolve(root));
  while (pending.length > 0) {
    const folder = pending.pop() ?? "";
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT")
        throw new Error(`the source folder ${folder} does not exist.`, { cause });
      throw cause;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIPPED.has(entry.name) && !entry.name.startsWith("."))
          pending.push(join(folder, entry.name));
      } else if (
        entry.isFile() &&
        SOURCE.has(extname(entry.name)) &&
        !entry.name.endsWith(".d.ts")
      ) {
        found.push(join(folder, entry.name));
      }
    }
  }
  return found.sort();
}

/** A literal key use with the file it is in. */
export interface UsedKey extends ExtractedKey {
  readonly file: string;
}

/** What {@link scanSources} found. */
export interface ScanResult {
  readonly keys: readonly UsedKey[];
  readonly dynamic: readonly {
    readonly file: string;
    readonly line: number;
    readonly column: number;
    readonly prefix: string;
  }[];
  readonly files: number;
}

/**
 * Finds the message keys the source files use.
 *
 * @param roots The folders to read.
 * @param base The folder the paths of the report are relative to.
 * @param options Names of the translate functions and components, when the app uses others than the defaults.
 */
export async function scanSources(
  roots: readonly string[],
  base: string,
  options: { readonly functions?: readonly string[]; readonly components?: readonly string[] } = {},
): Promise<ScanResult> {
  const files = await sourceFiles(roots);
  const keys: UsedKey[] = [];
  const dynamic: { file: string; line: number; column: number; prefix: string }[] = [];
  let read = 0;
  for (const file of files) {
    if ((await stat(file)).size > MAX_SOURCE_BYTES) continue;
    const shown = relative(base, file).split(sep).join("/");
    const result = extractMessages(await readFile(file, "utf8"), {
      ...(options.functions === undefined ? {} : { functions: options.functions }),
      ...(options.components === undefined ? {} : { components: options.components }),
    });
    read += 1;
    for (const entry of result.keys) keys.push({ ...entry, file: shown });
    for (const entry of result.dynamic) dynamic.push({ ...entry, file: shown });
  }
  return { keys, dynamic, files: read };
}

/** One problem `check` found. */
export interface Problem {
  readonly kind: string;
  readonly locale?: string;
  readonly key?: string;
  readonly file?: string;
  readonly line?: number;
  readonly detail: string;
}

/** Options of {@link check}. */
export interface CheckOptions {
  readonly messages: string;
  readonly sources: readonly string[];
  readonly base: string;
  /** Allow a locale to lack keys its base has (catalogs that rely on a fallback). */
  readonly allowMissing?: boolean;
  /** Do not report catalog keys no source uses. */
  readonly ignoreUnused?: boolean;
  readonly functions?: readonly string[];
  readonly components?: readonly string[];
  /** The folder paths in the report are relative to. Default: the current folder. */
  readonly cwd?: string;
}

/** The result of {@link check}. */
export interface CheckResult {
  readonly ok: boolean;
  readonly locales: readonly string[];
  readonly base: string;
  readonly keys: number;
  readonly files: number;
  readonly problems: readonly Problem[];
}

/**
 * Checks the catalogs of a folder against each other and against the code: every locale takes the same arguments and tags as
 * the base (`validateCatalogs`), every key the code uses exists in the base, and, unless told otherwise, every key of the
 * base is used.
 */
export async function check(options: CheckOptions): Promise<CheckResult> {
  const cwd = options.cwd ?? process.cwd();
  const catalogs = await readCatalogs(options.messages);
  if (catalogs[options.base] === undefined) {
    throw new Error(
      `there is no ${options.base}.json in ${options.messages}: the default locale needs a catalog.`,
    );
  }
  const problems: Problem[] = [];
  // The files are untyped JSON: `validateCatalogs` takes unknown leaves and reports them as `invalid-catalog`.
  const validation = validateCatalogs(catalogs as Readonly<Record<string, Messages>>, {
    base: options.base,
    ...(options.allowMissing === true ? { allowMissing: true } : {}),
  });
  for (const issue of validation.issues) {
    problems.push({
      kind: issue.kind,
      locale: issue.locale,
      ...(issue.key === "" ? {} : { key: issue.key }),
      detail: issue.detail,
    });
  }
  const scan = await scanSources(options.sources, cwd, {
    ...(options.functions === undefined ? {} : { functions: options.functions }),
    ...(options.components === undefined ? {} : { components: options.components }),
  });
  const baseKeys = [...flattenCatalog(catalogs[options.base]).keys()];
  const comparison = compareKeys(baseKeys, {
    keys: scan.keys,
    dynamic: scan.dynamic.map((entry) => ({
      line: entry.line,
      column: entry.column,
      prefix: entry.prefix,
    })),
  });
  for (const entry of comparison.missing) {
    const used = scan.keys.find(
      (candidate) =>
        candidate.key === entry.key &&
        candidate.line === entry.line &&
        candidate.column === entry.column,
    );
    problems.push({
      kind: "undefined-key",
      key: entry.key,
      ...(used === undefined ? {} : { file: used.file }),
      line: entry.line,
      detail: `the code uses "${entry.key}", which ${options.base}.json does not define.`,
    });
  }
  if (options.ignoreUnused !== true) {
    for (const key of comparison.unused) {
      problems.push({
        kind: "unused-key",
        key,
        detail: `"${key}" is in ${options.base}.json and no source uses it.`,
      });
    }
  }
  return {
    ok: problems.length === 0,
    locales: Object.keys(catalogs),
    base: options.base,
    keys: baseKeys.length,
    files: scan.files,
    problems,
  };
}

/** The messages of a catalog as exchange units: the base text and what the locale already has. */
export function unitsFor(
  base: Catalog,
  locale: Catalog | undefined,
  onlyMissing: boolean,
): TransUnit[] {
  const target = locale === undefined ? new Map<string, string>() : flattenCatalog(locale);
  const units: TransUnit[] = [];
  for (const [key, source] of flattenCatalog(base)) {
    const translated = target.get(key);
    if (onlyMissing && translated !== undefined && translated !== "") continue;
    units.push({ key, source, ...(translated === undefined ? {} : { target: translated }) });
  }
  return units;
}

/**
 * Writes an XLIFF file for a locale: every message of the base, with the translations the locale has, or only the ones it
 * lacks.
 *
 * @returns The path written and how many messages it holds.
 */
export async function exportXliff(options: {
  readonly messages: string;
  readonly base: string;
  readonly locale: string;
  readonly out: string;
  readonly onlyMissing?: boolean;
}): Promise<{ readonly file: string; readonly units: number }> {
  if (options.locale === options.base)
    throw new Error("the target locale is the base locale: there is nothing to translate.");
  const catalogs = await readCatalogs(options.messages);
  const base = catalogs[options.base];
  if (base === undefined)
    throw new Error(`there is no ${options.base}.json in ${options.messages}.`);
  const units = unitsFor(base, catalogs[options.locale], options.onlyMissing === true);
  const file = resolve(options.out);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, writeXliff(units, options.base, options.locale));
  return { file, units: units.length };
}

/** Sets a dotted key in a catalog, keeping the shape the file has: a flat key stays flat, nested objects are extended. */
export function assignKey(catalog: Catalog, key: string, value: string): void {
  if (Object.hasOwn(catalog, key)) {
    setOwn(catalog, key, value);
    return;
  }
  const parts = key.split(".");
  let at: Catalog = catalog;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index] ?? "";
    const next = Object.hasOwn(at, part) ? at[part] : undefined;
    if (typeof next === "object" && next !== null && !Array.isArray(next)) {
      at = next as Catalog;
    } else {
      const created: Catalog = {};
      setOwn(at, part, created);
      at = created;
    }
  }
  setOwn(at, parts.at(-1) ?? key, value);
}

/**
 * Writes an own data property. A plain assignment of `__proto__` would set the prototype instead
 * (and drop the translation from the file), while the catalogs read from JSON hold it as data.
 */
function setOwn(target: Catalog, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/** What {@link importXliff} did. */
export interface ImportResult {
  readonly file: string;
  readonly written: number;
  readonly skipped: readonly { readonly key: string; readonly reason: string }[];
}

/**
 * Merges the translations of an XLIFF file into `<messages>/<locale>.json`. A translation whose arguments or tags differ from
 * the base message's, for a key the base does not have, or for a source that changed since the export, is not written and is
 * reported; nothing is written when `strict` is set and any is reported.
 */
export async function importXliff(options: {
  readonly messages: string;
  readonly base: string;
  readonly locale: string;
  readonly from: string;
  readonly strict?: boolean;
}): Promise<ImportResult> {
  const catalogs = await readCatalogs(options.messages);
  const baseCatalog = catalogs[options.base];
  if (baseCatalog === undefined)
    throw new Error(`there is no ${options.base}.json in ${options.messages}.`);
  const baseMessages = flattenCatalog(baseCatalog);
  let document: ReadXliff;
  try {
    document = readXliff(await readFile(options.from, "utf8"));
  } catch (cause) {
    throw new Error(`${options.from}: ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    });
  }
  if (document.target !== undefined && document.target !== options.locale) {
    throw new Error(
      `${options.from} is for the locale "${document.target}", not "${options.locale}".`,
    );
  }
  const file = join(options.messages, `${options.locale}.json`);
  const existing = catalogs[options.locale] ?? {};
  const skipped: { key: string; reason: string }[] = [];
  const accepted: TransUnit[] = [];
  for (const unit of document.units) {
    if (unit.target === undefined) continue;
    const current = baseMessages.get(unit.key);
    if (current === undefined) {
      skipped.push({ key: unit.key, reason: `${options.base}.json has no such key` });
      continue;
    }
    if (current !== unit.source) {
      skipped.push({ key: unit.key, reason: `the source changed since the export` });
      continue;
    }
    const check = validateCatalogs(
      { [options.base]: { [unit.key]: current }, [options.locale]: { [unit.key]: unit.target } },
      { base: options.base },
    );
    const issue = check.issues[0];
    if (issue !== undefined) {
      skipped.push({ key: unit.key, reason: `${issue.kind}: ${issue.detail}` });
      continue;
    }
    accepted.push(unit);
  }
  if (options.strict === true && skipped.length > 0) return { file, written: 0, skipped };
  for (const unit of accepted) assignKey(existing, unit.key, unit.target ?? "");
  if (accepted.length > 0) await writeFile(file, `${JSON.stringify(existing, null, 2)}\n`);
  return { file, written: accepted.length, skipped };
}
