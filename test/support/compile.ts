import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compile } from "@shadow-js/compiler/javascript";

const dir: string = join(import.meta.dirname, "..", ".generated");
const ENTRY: string = join(import.meta.dirname, "..", "..", "src", "index.ts");
let loads = 0;

/**
 * Compiles component source with the real ShadowJS compiler and imports the result. Inside
 * `source`, `"@i18n"` names this package's source entry.
 *
 * @param source TSX text.
 * @param target Output flavor.
 * @returns The module namespace.
 */
export async function load<T = Record<string, unknown>>(
  source: string,
  target: "dom" | "ssr" = "dom",
): Promise<T> {
  const text = source.replaceAll('"@i18n"', JSON.stringify(ENTRY));
  mkdirSync(dir, { recursive: true });
  const result = compile(text, { filename: "case.tsx", generate: target });
  loads += 1;
  const name = `${createHash("sha1").update(`${target}:${loads}:${text}`).digest("hex").slice(0, 12)}.ts`;
  const file = join(dir, name);
  writeFileSync(file, result.code);
  return (await import(/* @vite-ignore */ file)) as T;
}
