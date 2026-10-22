/**
 * The supported subset of ICU number skeletons (`::percent .00 currency/EUR compact-short ...`),
 * translated to `Intl.NumberFormat` options. Unsupported tokens are an error, never ignored.
 */

/**
 * A parsed number skeleton: the `Intl.NumberFormat` options it stands for, plus the `scale/N`
 * multiplier `Intl` has no option for. The parser stores one on a `{n, number, ::...}` argument; the
 * object and its options are frozen.
 *
 * @example
 * ```ts
 * import { type NumberSkeleton, parseNumberSkeleton } from "@shadow-js/i18n/icu";
 *
 * const skeleton: NumberSkeleton = parseNumberSkeleton("scale/100 .0");
 * const shown = new Intl.NumberFormat("en", skeleton.options).format(0.256 * skeleton.scale);
 * console.log(shown); // "25.6"
 * ```
 * @see {@link NumberNode}
 * @since 1.0.0
 */
export interface NumberSkeleton {
  /** The `Intl.NumberFormat` options. Only the fields the skeleton names are set. */
  readonly options: Intl.NumberFormatOptions;
  /**
   * The value is multiplied by this before formatting (`scale/100` gives `100`). `1` when the
   * skeleton has no `scale/` token. The formatter does not apply it to bigint values.
   */
  readonly scale: number;
}

/** Thrown for a skeleton token this package does not support. */
export class SkeletonError extends Error {
  readonly token: string;
  constructor(token: string, detail: string) {
    super(`${detail}: "${token}"`);
    this.name = "SkeletonError";
    this.token = token;
  }
}

const ROUNDING: Readonly<Record<string, string>> = Object.freeze({
  "rounding-mode-ceiling": "ceil",
  "rounding-mode-floor": "floor",
  "rounding-mode-down": "trunc",
  "rounding-mode-up": "expand",
  "rounding-mode-half-even": "halfEven",
  "rounding-mode-half-down": "halfTrunc",
  "rounding-mode-half-up": "halfExpand",
});

const WIDTH: Readonly<Record<string, "short" | "narrow" | "long" | "iso">> = Object.freeze({
  "unit-width-short": "short",
  "unit-width-narrow": "narrow",
  "unit-width-full-name": "long",
  "unit-width-iso-code": "iso",
});

/**
 * White space between skeleton tokens: what `\s` matches in JavaScript, written out so that no regular
 * expression runs over message text.
 */
function isSkeletonSpace(code: number): boolean {
  return (
    (code >= 9 && code <= 13) ||
    code === 32 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

/** Splits a skeleton at white space; empty pieces are dropped. One forward scan. */
function skeletonTokens(text: string): string[] {
  const tokens: string[] = [];
  let start = -1;
  for (let index = 0; index <= text.length; index += 1) {
    const space = index === text.length || isSkeletonSpace(text.charCodeAt(index));
    if (space) {
      if (start !== -1) tokens.push(text.slice(start, index));
      start = -1;
    } else if (start === -1) {
      start = index;
    }
  }
  return tokens;
}

function isLowerLetter(code: number): boolean {
  return code >= 97 && code <= 122;
}

/** Three ASCII letters, as in `EUR`. */
function isCurrencyCode(code: string): boolean {
  if (code.length !== 3) return false;
  for (let index = 0; index < 3; index += 1) {
    const unit = code.charCodeAt(index) | 32;
    if (!isLowerLetter(unit)) return false;
  }
  return true;
}

/** Lower-case letter words joined by single hyphens, as in `kilometer-per-hour`. */
function isUnitName(unit: string): boolean {
  let wordLength = 0;
  for (let index = 0; index < unit.length; index += 1) {
    const code = unit.charCodeAt(index);
    if (isLowerLetter(code)) wordLength += 1;
    else if (code === 45 && wordLength > 0) wordLength = 0;
    else return false;
  }
  return wordLength > 0;
}

/** Counts the leading characters of `text` equal to `character`. */
function run(text: string, from: number, character: string): number {
  let end = from;
  while (text[end] === character) end += 1;
  return end - from;
}

/** Fraction digits: `.00`, `.##`, `.0#`, `.00*`, `.`. */
function fraction(token: string, options: Record<string, unknown>): void {
  const body = token.slice(1);
  if (body === "") {
    options["minimumFractionDigits"] = 0;
    options["maximumFractionDigits"] = 0;
    return;
  }
  const zeros = run(body, 0, "0");
  const hashes = run(body, zeros, "#");
  const star = body[zeros] === "*" ? 1 : 0;
  if (zeros + hashes + star !== body.length || (star === 1 && hashes > 0)) {
    throw new SkeletonError(token, "Unsupported fraction precision");
  }
  options["minimumFractionDigits"] = zeros;
  options["maximumFractionDigits"] = star === 1 ? Math.max(zeros, 20) : zeros + hashes;
}

/** Significant digits: `@@@`, `@@#`, `@@*`. */
function significant(token: string, options: Record<string, unknown>): void {
  const ats = run(token, 0, "@");
  const hashes = run(token, ats, "#");
  const star = token[ats] === "*" ? 1 : 0;
  if (ats === 0 || ats + hashes + star !== token.length || (star === 1 && hashes > 0)) {
    throw new SkeletonError(token, "Unsupported significant-digit precision");
  }
  options["minimumSignificantDigits"] = ats;
  options["maximumSignificantDigits"] = star === 1 ? 21 : ats + hashes;
}

/**
 * Parses an ICU number skeleton (the text after `::`) into `Intl.NumberFormat` options and a scale.
 * Supported tokens (with their ICU short forms):
 *
 * - Style: `percent` (`%`), `currency/EUR` (any 3-letter code, upper-cased), `unit/meter` or
 *   `measure-unit/length-meter`.
 * - Notation: `compact-short` (`K`), `compact-long` (`KK`), `scientific`, `engineering`,
 *   `notation-simple`.
 * - Precision: `precision-integer`, `.00`, `.0#`, `.00*`, `.` (fraction digits) and `@@`, `@@#`,
 *   `@@*` (significant digits).
 * - Integer width: `integer-width/000` (or `integer-width/*000`) and `000`.
 * - Sign: `sign-always` (`+!`), `sign-except-zero` (`+?`), `sign-never` (`+_`), `sign-auto`,
 *   `sign-accounting`, `sign-accounting-always`.
 * - Grouping: `group-off` (`,_`), `group-min2` (`,?`), `group-auto`, `group-on-aligned` (`,!`).
 * - Unit width: `unit-width-short`, `unit-width-narrow`, `unit-width-full-name`,
 *   `unit-width-iso-code` (currency display for a currency, unit display otherwise).
 * - Rounding: `rounding-mode-ceiling`, `-floor`, `-down`, `-up`, `-half-even`, `-half-down`,
 *   `-half-up`.
 * - `scale/N`: multiply the value by `N` before formatting.
 *
 * @param text Tokens separated by white space, for example `"currency/EUR .00 sign-always"`.
 * @returns The frozen options and the scale.
 * @throws `SkeletonError` (an `Error` whose `name` is `"SkeletonError"` and whose `token` is the
 * offending token) for an empty skeleton or an unknown or malformed token; unsupported tokens are
 * never ignored. Inside a message, {@link parseMessage} turns it into a `MessageSyntaxError` with
 * `syntaxCode` `"INVALID_SKELETON"`.
 * @example
 * ```ts
 * import { parseNumberSkeleton } from "@shadow-js/i18n/icu";
 *
 * const { options } = parseNumberSkeleton("currency/EUR .00 sign-always");
 * console.log(options.style, options.currency, options.minimumFractionDigits); // "currency" "EUR" 2
 * console.log(new Intl.NumberFormat("en", options).format(5)); // "+€5.00"
 * ```
 * @see {@link NumberSkeleton}
 * @since 1.0.0
 */
export function parseNumberSkeleton(text: string): NumberSkeleton {
  const options: Record<string, unknown> = {};
  let scale = 1;
  let width: "short" | "narrow" | "long" | "iso" | undefined;
  let accounting = false;
  const tokens = skeletonTokens(text);
  if (tokens.length === 0) throw new SkeletonError(text, "Empty skeleton");
  for (const token of tokens) {
    const rounding = ROUNDING[token];
    const mappedWidth = WIDTH[token];
    if (rounding !== undefined) options["roundingMode"] = rounding;
    else if (mappedWidth !== undefined) width = mappedWidth;
    else if (token === "percent" || token === "%") options["style"] = "percent";
    else if (token.startsWith("scale/")) {
      const factor = Number(token.slice(6));
      if (!Number.isFinite(factor) || token.length === 6) {
        throw new SkeletonError(token, "Invalid scale");
      }
      scale = factor;
    } else if (token.startsWith("currency/")) {
      const code = token.slice(9);
      if (!isCurrencyCode(code)) throw new SkeletonError(token, "Invalid currency code");
      options["style"] = "currency";
      options["currency"] = code.toUpperCase();
    } else if (token.startsWith("unit/") || token.startsWith("measure-unit/")) {
      const raw = token.slice(token.indexOf("/") + 1);
      // `measure-unit/length-meter` carries a category prefix; `unit/meter` does not.
      const unit = token.startsWith("measure-unit/") ? raw.slice(raw.indexOf("-") + 1) : raw;
      if (!isUnitName(unit)) {
        throw new SkeletonError(token, "Invalid unit");
      }
      options["style"] = "unit";
      options["unit"] = unit;
    } else if (token === "compact-short" || token === "K") {
      options["notation"] = "compact";
      options["compactDisplay"] = "short";
    } else if (token === "compact-long" || token === "KK") {
      options["notation"] = "compact";
      options["compactDisplay"] = "long";
    } else if (token === "scientific") options["notation"] = "scientific";
    else if (token === "engineering") options["notation"] = "engineering";
    else if (token === "notation-simple") options["notation"] = "standard";
    else if (token === "precision-integer") {
      options["minimumFractionDigits"] = 0;
      options["maximumFractionDigits"] = 0;
    } else if (token.startsWith(".")) fraction(token, options);
    else if (token.startsWith("@")) significant(token, options);
    else if (token.startsWith("integer-width/")) {
      const body = token.slice(14);
      const from = body.startsWith("*") ? 1 : 0;
      const min = run(body, from, "0");
      // Anything after the zeros (`integer-width/00x`) is an unsupported width, not ignored.
      if (min === 0 || from + min !== body.length) {
        throw new SkeletonError(token, "Unsupported integer width");
      }
      options["minimumIntegerDigits"] = min;
    } else if (token.length > 0 && run(token, 0, "0") === token.length) {
      options["minimumIntegerDigits"] = token.length;
    } else if (token === "sign-always" || token === "+!") options["signDisplay"] = "always";
    else if (token === "sign-except-zero" || token === "+?") options["signDisplay"] = "exceptZero";
    else if (token === "sign-never" || token === "+_") options["signDisplay"] = "never";
    else if (token === "sign-auto") options["signDisplay"] = "auto";
    else if (token === "sign-accounting") accounting = true;
    else if (token === "sign-accounting-always") {
      accounting = true;
      options["signDisplay"] = "always";
    } else if (token === "group-off" || token === ",_") options["useGrouping"] = false;
    else if (token === "group-min2" || token === ",?") options["useGrouping"] = "min2";
    else if (token === "group-auto" || token === "group-on-aligned" || token === ",!") {
      options["useGrouping"] = "auto";
    } else throw new SkeletonError(token, "Unsupported number skeleton token");
  }
  if (accounting) options["currencySign"] = "accounting";
  if (width !== undefined) {
    if (options["style"] === "currency") {
      options["currencyDisplay"] =
        width === "short"
          ? "symbol"
          : width === "narrow"
            ? "narrowSymbol"
            : width === "long"
              ? "name"
              : "code";
    } else {
      options["unitDisplay"] = width === "iso" ? "short" : width;
    }
  }
  return Object.freeze({ options: Object.freeze(options) as Intl.NumberFormatOptions, scale });
}
