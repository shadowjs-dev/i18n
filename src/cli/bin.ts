/**
 * The `shadow-i18n` executable: wires the process into {@link main}. Everything testable lives in the other modules.
 */
import { main } from "./main";

declare const __VERSION__: string;

process.exitCode = await main(process.argv.slice(2), {
  cwd: process.cwd(),
  // Replaced by the build with the version in package.json.
  version: __VERSION__,
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
});
