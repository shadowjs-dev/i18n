/**
 * The supported subset of ICU date/time skeletons (`yMMMd`, `Hm`, `EEEE`, ...), translated to
 * `Intl.DateTimeFormat` options. The field order and separators come from the locale, as in ICU.
 */

/**
 * A parsed date or time skeleton: the `Intl.DateTimeFormat` options it stands for. The parser stores
 * one on a `{d, date, ::...}` or `{d, time, ::...}` argument; the object and its options are frozen.
 *
 * @example
 * ```ts
 * import { type DateSkeleton, parseDateSkeleton } from "@shadow-js/i18n/icu";
 *
 * const skeleton: DateSkeleton = parseDateSkeleton("EEEEd");
 * console.log(new Intl.DateTimeFormat("en", skeleton.options).format(new Date(2024, 0, 15)));
 * ```
 * @see {@link DateTimeNode}
 * @since 1.0.0
 */
export interface DateSkeleton {
  /**
   * The `Intl.DateTimeFormat` options. Only the fields the skeleton names are set; field order and
   * separators come from the locale when the options are used.
   */
  readonly options: Intl.DateTimeFormatOptions;
}

/** Thrown for a skeleton letter or width this package does not support. */
export class DateSkeletonError extends Error {
  readonly token: string;
  constructor(token: string, detail: string) {
    super(`${detail}: "${token}"`);
    this.name = "DateSkeletonError";
    this.token = token;
  }
}

/** Splits a skeleton into runs of the same letter: `"yMMMd"` -> `["y","MMM","d"]`. */
function runs(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let index = 1; index <= text.length; index += 1) {
    if (index === text.length || text[index] !== text[start]) {
      out.push(text.slice(start, index));
      start = index;
    }
  }
  return out;
}

/** The longest run each letter accepts; a longer run has no meaning in ICU and is rejected. */
const MAX_RUN: Readonly<Record<string, number>> = Object.freeze({
  G: 5,
  M: 5,
  L: 5,
  E: 6,
  c: 6,
  d: 2,
  h: 2,
  H: 2,
  K: 2,
  k: 2,
  j: 2,
  J: 2,
  C: 2,
  m: 2,
  s: 2,
  z: 4,
  O: 4,
  Z: 4,
  v: 4,
  V: 4,
});

const NUMERIC = (count: number): "numeric" | "2-digit" => (count === 2 ? "2-digit" : "numeric");
const TEXT = (count: number): "short" | "long" | "narrow" =>
  count === 4 ? "long" : count === 5 ? "narrow" : "short";

/**
 * Parses an ICU date or time skeleton (the text after `::`) into `Intl.DateTimeFormat` options. Each
 * run of one letter sets one field:
 *
 * - `G` era, `E` or `c` weekday: 4 letters `long`, 5 `narrow`, otherwise `short`.
 * - `y` year: `yy` is `2-digit`, otherwise `numeric`.
 * - `M` or `L` month: `M` `numeric`, `MM` `2-digit`, `MMM` `short`, `MMMM` `long`, `MMMMM` `narrow`.
 * - `d` day, `m` minute, `s` second: 2 letters `2-digit`, otherwise `numeric`.
 * - Hour, with the same widths: `h` (cycle h12), `K` (h11), `H` (h23), `k` (h24), and `j`, `J`, `C`
 *   (the locale's cycle).
 * - `S` fractional seconds: 1 to 3 digits.
 * - Time zone name: `z` (`zzzz` `long`, otherwise `short`), `O` or `Z` (`longOffset`/`shortOffset`),
 *   `v` or `V` (`longGeneric`/`shortGeneric`), the long form for 4 letters.
 * - `a`, `b`, `B` are accepted and set nothing: the day period follows the hour cycle.
 *
 * @param text Skeleton letters such as `"yMMMd"` or `"Hm"`, without the `::`.
 * @returns The frozen options.
 * @throws `DateSkeletonError` (an `Error` whose `name` is `"DateSkeletonError"` and whose `token`
 * is the offending run) for an empty skeleton, a run longer than its letter allows (`ddd`, `MMMMMM`,
 * `zzzzz`; `y` takes any length), more than three `S`, or any other letter (quarters, week numbers,
 * day of year). Inside a message, {@link parseMessage} turns it into a
 * `MessageSyntaxError` with `syntaxCode` `"INVALID_SKELETON"`.
 * @example
 * ```ts
 * import { parseDateSkeleton } from "@shadow-js/i18n/icu";
 *
 * console.log(parseDateSkeleton("yMMMd").options);
 * // { year: "numeric", month: "short", day: "numeric" }
 * console.log(parseDateSkeleton("Hm").options);
 * // { hour: "numeric", hourCycle: "h23", minute: "numeric" }
 * ```
 * @see {@link DateSkeleton}
 * @since 1.0.0
 */
export function parseDateSkeleton(text: string): DateSkeleton {
  const options: Record<string, unknown> = {};
  if (text.length === 0) throw new DateSkeletonError(text, "Empty skeleton");
  for (const part of runs(text)) {
    const letter = part[0] ?? "";
    const count = part.length;
    const longest = MAX_RUN[letter];
    if (longest !== undefined && count > longest) {
      throw new DateSkeletonError(part, "Too many repeated letters");
    }
    switch (letter) {
      case "G":
        options["era"] = TEXT(count);
        break;
      case "y":
        options["year"] = count === 2 ? "2-digit" : "numeric";
        break;
      case "M":
      case "L":
        options["month"] = count <= 2 ? NUMERIC(count) : TEXT(count);
        break;
      case "d":
        options["day"] = NUMERIC(count);
        break;
      case "E":
      case "c":
        options["weekday"] = TEXT(count);
        break;
      case "h":
        options["hour"] = NUMERIC(count);
        options["hourCycle"] = "h12";
        break;
      case "K":
        options["hour"] = NUMERIC(count);
        options["hourCycle"] = "h11";
        break;
      case "H":
        options["hour"] = NUMERIC(count);
        options["hourCycle"] = "h23";
        break;
      case "k":
        options["hour"] = NUMERIC(count);
        options["hourCycle"] = "h24";
        break;
      case "j":
      case "J":
      case "C":
        // Locale-preferred hour cycle: leave it to Intl.
        options["hour"] = NUMERIC(count);
        break;
      case "a":
      case "b":
      case "B":
        // The day period follows the hour cycle; Intl prints it with 12-hour cycles.
        break;
      case "m":
        options["minute"] = NUMERIC(count);
        break;
      case "s":
        options["second"] = NUMERIC(count);
        break;
      case "S":
        if (count > 3) throw new DateSkeletonError(part, "At most three fractional digits");
        options["fractionalSecondDigits"] = count;
        break;
      case "z":
        options["timeZoneName"] = count === 4 ? "long" : "short";
        break;
      case "O":
      case "Z":
        options["timeZoneName"] = count === 4 ? "longOffset" : "shortOffset";
        break;
      case "v":
      case "V":
        options["timeZoneName"] = count === 4 ? "longGeneric" : "shortGeneric";
        break;
      default:
        throw new DateSkeletonError(part, "Unsupported date skeleton field");
    }
  }
  return Object.freeze({ options: Object.freeze(options) as Intl.DateTimeFormatOptions });
}
