import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { check, exportXliff, importXliff, scanSources } from "./run";

/**
 * Argument parsing and dispatch of the `shadow-i18n` command. `main` takes its output as a parameter, so a test runs it
 * without a process. With `--json` every outcome is one document on stdout in the contract the other ShadowJS commands
 * print (schema 1: `command`, `ok`, `data`, `warnings`, and `error` when it failed).
 */

/** Where `main` writes: stdout, stderr, and the folder paths are relative to. */
export interface Io {
  readonly cwd: string;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  /** Printed by `--version`. */
  readonly version: string;
}

const HELP = `shadow-i18n: check, extract and exchange the messages of a ShadowJS app

Usage
  shadow-i18n check                       catalogs against each other and against the code (exit 1 on any problem)
  shadow-i18n extract                     list the message keys the code uses (and the computed ones)
  shadow-i18n export <locale>             write an XLIFF 1.2 file for translators
  shadow-i18n import <locale> <file>      merge the translations of an XLIFF file into <locale>.json

Options
  -m, --messages <dir>   folder of the <locale>.json catalogs (default: messages)
  -s, --src <dir>        folder to read for keys; repeat for several (default: src)
  -b, --base <locale>    the locale the others follow (default: en)
      --allow-missing    check: a locale may lack keys the base has (it falls back to the base)
      --ignore-unused    check: do not report keys no source uses
  -f, --function <name>  check, extract: another name for the translate function; repeat for several
      --component <name> check, extract: another name for the <Trans> component; repeat for several
  -o, --out <file>       export: the file to write (default: <locale>.xlf)
      --only-missing     export: only the messages the locale lacks
      --strict           import: write nothing when any translation is rejected
      --cwd <dir>        run in <dir>
      --json             print one JSON document on stdout instead of words
  -h, --help             show this help
  -v, --version          show the version of @shadow-js/i18n
`;

const OPTIONS = {
  messages: { type: "string", short: "m" },
  src: { type: "string", short: "s", multiple: true },
  base: { type: "string", short: "b" },
  "allow-missing": { type: "boolean" },
  "ignore-unused": { type: "boolean" },
  function: { type: "string", short: "f", multiple: true },
  component: { type: "string", multiple: true },
  out: { type: "string", short: "o" },
  "only-missing": { type: "boolean" },
  strict: { type: "boolean" },
  cwd: { type: "string" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

/** The codes of the `error` of a failed `--json` run, for the documentation and the tests. */
export const ERROR_CODES = [
  "SHADOW_I18N_UNKNOWN_COMMAND",
  "SHADOW_I18N_UNKNOWN_OPTION",
  "SHADOW_I18N_INVALID_OPTION",
  "SHADOW_I18N_MISSING_COMMAND",
  "SHADOW_I18N_MISSING_ARGUMENT",
  "SHADOW_I18N_PROBLEMS",
  "SHADOW_I18N_FAILED",
] as const;

interface Document {
  readonly schema: 1;
  readonly command: string;
  readonly ok: boolean;
  readonly data: Record<string, unknown>;
  readonly warnings: readonly { readonly code: string; readonly message: string }[];
  readonly error?: { readonly code: string; readonly message: string };
}

function document(
  command: string,
  data: Record<string, unknown>,
  error?: Document["error"],
): Document {
  return {
    schema: 1,
    command,
    ok: error === undefined,
    data,
    warnings: [],
    ...(error === undefined ? {} : { error }),
  };
}

/**
 * Runs the command.
 *
 * @param argv The arguments after the executable.
 * @param io Output and working folder.
 * @returns The exit code: 0 on success, 1 when a check found problems or the command could not run.
 */
export async function main(argv: readonly string[], io: Io): Promise<number> {
  const json =
    argv.includes("--json") &&
    argv.indexOf("--json") < (argv.indexOf("--") === -1 ? argv.length : argv.indexOf("--"));
  const emit = (value: Document): void => io.out(JSON.stringify(value, null, 2));
  const fail = (
    command: string,
    code: (typeof ERROR_CODES)[number],
    message: string,
    data: Record<string, unknown> = {},
  ): number => {
    if (json) emit(document(command, data, { code, message }));
    else io.err(`error: ${message}`);
    return 1;
  };

  let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>;
  try {
    parsed = parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    const message = error.message.split(". ")[0] ?? error.message;
    if (!json) io.err("Run `shadow-i18n --help` for usage.");
    return fail(
      "shadow-i18n",
      /^Unknown option/.test(message) ? "SHADOW_I18N_UNKNOWN_OPTION" : "SHADOW_I18N_INVALID_OPTION",
      message,
    );
  }
  const { values, positionals } = parsed;
  const [command, ...rest] = positionals;
  if (values.version === true) {
    io.out(io.version);
    return 0;
  }
  if (values.help === true || command === "help") {
    if (json) emit(document("shadow-i18n", { usage: HELP }));
    else io.out(HELP.trimEnd());
    return 0;
  }
  if (command === undefined)
    return fail(
      "shadow-i18n",
      "SHADOW_I18N_MISSING_COMMAND",
      "no command given. Run `shadow-i18n --help` for usage.",
    );

  const cwd = resolve(io.cwd, values.cwd ?? ".");
  const messages = resolve(cwd, values.messages ?? "messages");
  const sources = (values.src ?? ["src"]).map((folder) => resolve(cwd, folder));
  const base = values.base ?? "en";
  const names = {
    ...(values.function === undefined ? {} : { functions: values.function }),
    ...(values.component === undefined ? {} : { components: values.component }),
  };
  const name = `shadow-i18n ${command}`;

  try {
    switch (command) {
      case "check": {
        const result = await check({
          messages,
          sources,
          base,
          cwd,
          ...(values["allow-missing"] === true ? { allowMissing: true } : {}),
          ...(values["ignore-unused"] === true ? { ignoreUnused: true } : {}),
          ...names,
        });
        if (json) {
          emit(
            document(
              name,
              { ...result },
              result.ok
                ? undefined
                : {
                    code: "SHADOW_I18N_PROBLEMS",
                    message: `${result.problems.length} problem(s) found.`,
                  },
            ),
          );
        } else {
          for (const problem of result.problems) {
            const where =
              problem.file === undefined
                ? problem.locale === undefined
                  ? ""
                  : `${problem.locale}.json: `
                : `${problem.file}${problem.line === undefined ? "" : `:${problem.line}`}: `;
            io.err(`${where}${problem.kind}: ${problem.detail}`);
          }
          io.out(
            result.ok
              ? `ok: ${result.locales.length} locale(s), ${result.keys} message(s), ${result.files} source file(s) read.`
              : `${result.problems.length} problem(s) in ${result.locales.length} locale(s), ${result.files} source file(s) read.`,
          );
        }
        return result.ok ? 0 : 1;
      }
      case "extract": {
        const scan = await scanSources(sources, cwd, names);
        const unique = [...new Set(scan.keys.map((entry) => entry.key))].sort();
        if (json)
          emit(
            document(name, {
              keys: unique,
              uses: scan.keys,
              dynamic: scan.dynamic,
              files: scan.files,
            }),
          );
        else {
          for (const key of unique) io.out(key);
          for (const entry of scan.dynamic)
            io.err(
              `${entry.file}:${entry.line}: computed key${entry.prefix === "" ? "" : ` starting with "${entry.prefix}"`}`,
            );
        }
        return 0;
      }
      case "export": {
        const [locale] = rest;
        if (locale === undefined)
          return fail(
            name,
            "SHADOW_I18N_MISSING_ARGUMENT",
            "export needs a locale: `shadow-i18n export fr`.",
          );
        const result = await exportXliff({
          messages,
          base,
          locale,
          out: resolve(cwd, values.out ?? `${locale}.xlf`),
          ...(values["only-missing"] === true ? { onlyMissing: true } : {}),
        });
        if (json) emit(document(name, { ...result }));
        else io.out(`wrote ${result.units} message(s) to ${result.file}`);
        return 0;
      }
      case "import": {
        const [locale, file] = rest;
        if (locale === undefined || file === undefined) {
          return fail(
            name,
            "SHADOW_I18N_MISSING_ARGUMENT",
            "import needs a locale and a file: `shadow-i18n import fr fr.xlf`.",
          );
        }
        const result = await importXliff({
          messages,
          base,
          locale,
          from: resolve(cwd, file),
          ...(values.strict === true ? { strict: true } : {}),
        });
        const rejected = result.skipped.length > 0;
        if (json) {
          emit(
            document(
              name,
              { ...result },
              rejected && values.strict === true
                ? {
                    code: "SHADOW_I18N_PROBLEMS",
                    message: `${result.skipped.length} translation(s) rejected; nothing written.`,
                  }
                : undefined,
            ),
          );
        } else {
          for (const entry of result.skipped) io.err(`${entry.key}: ${entry.reason}`);
          io.out(
            `merged ${result.written} translation(s) into ${result.file}${rejected ? `; ${result.skipped.length} rejected` : ""}`,
          );
        }
        return rejected && values.strict === true ? 1 : 0;
      }
      default:
        return fail(
          "shadow-i18n",
          "SHADOW_I18N_UNKNOWN_COMMAND",
          `unknown command "${command}". Run \`shadow-i18n --help\` for usage.`,
        );
    }
  } catch (error) {
    return fail(name, "SHADOW_I18N_FAILED", error instanceof Error ? error.message : String(error));
  }
}
