import type { Accessor } from "@shadow-js/core";
import { I18nError } from "../errors";
import type { I18nBase } from "../i18n-types";
import { intlSupport } from "../intl";
import { formatDateValue, formatNumberValue, toDate, toNumeric } from "../values";
import { ctxOf, type Shared } from "./shared";

/**
 * The formatting half of an instance, bound to its locale accessor.
 * @internal
 */
export type Formatters<L extends string> = Pick<
  I18nBase<L>,
  "formatNumber" | "formatDate" | "formatRelative" | "formatList" | "formatDisplayName"
>;

/** Seconds in each unit `formatRelative` can name; a month is 30.4375 days and a year 365.25. */
const UNIT_SECONDS: ReadonlyMap<string, number> = new Map([
  ["second", 1],
  ["minute", 60],
  ["hour", 3600],
  ["day", 86_400],
  ["week", 604_800],
  ["month", 2_629_800],
  ["quarter", 7_889_400],
  ["year", 31_557_600],
]);

/** A short, single-line description of a bad argument for a report: `"abc"`, `null`, `NaN`, `an object`. */
function describe(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}...` : value);
  }
  if (value instanceof Date) return "an invalid Date";
  if (typeof value === "object" && value !== null) return "an object";
  if (typeof value === "function") return "a function";
  return String(value);
}

/**
 * English text for a relative time, used when the runtime has no `Intl.RelativeTimeFormat` or it
 * rejects the input: `in 3 days`, `1 hour ago`, `now`.
 */
function plainRelative(amount: number, unit: string): string {
  if (amount === 0) return "now";
  const count = Math.abs(amount);
  const text = `${count} ${unit}${count === 1 ? "" : "s"}`;
  return amount > 0 ? `in ${text}` : `${text} ago`;
}

/**
 * Builds the `Intl` based formatters of one instance. Each reads `locale()`, so a call inside an
 * effect or JSX expression re-runs when the locale changes.
 */
export function createFormatters<L extends string>(
  shared: Shared<L>,
  locale: Accessor<L>,
): Formatters<L> {
  const { options } = shared;

  const numberOptions = (
    format: string | Intl.NumberFormatOptions | undefined,
  ): Intl.NumberFormatOptions | undefined => {
    if (format === undefined || typeof format !== "string") return format;
    const named = options.formats?.number;
    if (named !== undefined && Object.hasOwn(named, format)) return named[format];
    if (format === "percent") return { style: "percent" };
    if (format === "integer") return { maximumFractionDigits: 0 };
    unknownFormat("number", format);
    return undefined;
  };

  const dateOptions = (
    format: string | Intl.DateTimeFormatOptions | undefined,
  ): Intl.DateTimeFormatOptions => {
    if (format === undefined) return { dateStyle: "medium" };
    if (typeof format !== "string") return format;
    const named = options.formats?.date;
    if (named !== undefined && Object.hasOwn(named, format)) return named[format] ?? {};
    if (format === "short" || format === "medium" || format === "long" || format === "full") {
      return { dateStyle: format };
    }
    unknownFormat("date", format);
    return { dateStyle: "medium" };
  };

  const unknownFormat = (kind: string, format: string): void => {
    shared.report(new I18nError("FORMAT_FAILED", `unknown ${kind} format "${format}".`));
  };

  /**
   * The text shown for a value that cannot be formatted. An object may have no `toString`, or one
   * that throws; a formatter must not throw for a bad value, so that case is reported and the kind
   * of value is shown instead.
   */
  const shown = (value: unknown): string => {
    try {
      return String(value);
    } catch (error) {
      shared.report(
        new I18nError("FORMAT_FAILED", `${describe(value)} has no text.`, { cause: error }),
      );
      return describe(value);
    }
  };

  const safely = <T>(label: string, fallback: T, run: () => T): T => {
    try {
      return run();
    } catch (error) {
      if (error instanceof RangeError || error instanceof TypeError) {
        shared.report(
          new I18nError("FORMAT_FAILED", `${label}: ${error.message}`, { cause: error }),
        );
        return fallback;
      }
      throw error;
    }
  };

  /** Reports a missing `Intl` feature (once, through the instance's once-only filter) and says what is shown instead. */
  const missing = (feature: string, method: string, instead: string): void => {
    shared.report(
      new I18nError(
        "FORMAT_FAILED",
        `${method}: Intl.${feature} is not available in this runtime; showing ${instead}.`,
      ),
    );
  };

  const formatNumber: I18nBase<L>["formatNumber"] = (value, format) => {
    const active = locale();
    const numeric = toNumeric(value);
    if (numeric === undefined) {
      shared.report(
        new I18nError("INVALID_VALUE", `formatNumber needs a number, got ${describe(value)}.`),
      );
      return shown(value);
    }
    return safely("formatNumber", String(numeric), () =>
      formatNumberValue(ctxOf(shared, active), numeric, numberOptions(format)),
    );
  };

  const formatDate: I18nBase<L>["formatDate"] = (value, format) => {
    const active = locale();
    const date = toDate(value);
    if (date === undefined) {
      shared.report(
        new I18nError(
          "INVALID_VALUE",
          `formatDate needs a Date, a timestamp or an ISO string, got ${describe(value)}.`,
        ),
      );
      return shown(value);
    }
    return safely("formatDate", date.toISOString(), () =>
      formatDateValue(ctxOf(shared, active), date, dateOptions(format)),
    );
  };

  const formatRelative: I18nBase<L>["formatRelative"] = (value, relative = {}) => {
    const active = locale();
    const at = value instanceof Date ? value.getTime() : value;
    const now =
      relative.now === undefined
        ? (options.now ?? Date.now)()
        : relative.now instanceof Date
          ? relative.now.getTime()
          : relative.now;
    if (!Number.isFinite(at) || !Number.isFinite(now)) {
      shared.report(
        new I18nError(
          "INVALID_VALUE",
          `formatRelative needs finite times, got ${describe(value)}${
            relative.now === undefined ? "" : ` and now ${describe(relative.now)}`
          }.`,
        ),
      );
      return shown(value);
    }
    const seconds = (at - now) / 1000;
    const abs = Math.abs(seconds);
    let bare: string | undefined;
    if (relative.unit !== undefined) {
      const given: unknown = relative.unit;
      const single = typeof given === "string" && given.endsWith("s") ? given.slice(0, -1) : given;
      if (typeof single === "string" && UNIT_SECONDS.has(single)) bare = single;
      else {
        shared.report(
          new I18nError(
            "FORMAT_FAILED",
            `formatRelative: unknown unit ${describe(given)}; the unit follows from the distance instead.`,
          ),
        );
      }
    }
    bare ??=
      abs < 60
        ? "second"
        : abs < 3600
          ? "minute"
          : abs < 86_400
            ? "hour"
            : abs < 604_800
              ? "day"
              : abs < 2_629_800
                ? "week"
                : abs < 31_557_600
                  ? "month"
                  : "year";
    const size = UNIT_SECONDS.get(bare) ?? 1;
    // Half rounds away from zero, so "in 2 minutes" and "2 minutes ago" are mirror images. A past
    // time that rounds to nothing stays -0, which `Intl` words as "0 minutes ago".
    const amount = Math.sign(seconds) * Math.round(Math.abs(seconds / size));
    const formatOptions: Intl.RelativeTimeFormatOptions = {
      numeric: relative.numeric ?? "auto",
      style: relative.style ?? "long",
    };
    if (!intlSupport().relativeTimeFormat) {
      missing("RelativeTimeFormat", "formatRelative", "plain English text");
      return plainRelative(amount, bare);
    }
    return safely("formatRelative", plainRelative(amount, bare), () =>
      shared.intl
        .relative(active, formatOptions)
        .format(amount, bare as Intl.RelativeTimeFormatUnit),
    );
  };

  const formatList: I18nBase<L>["formatList"] = (values, format) => {
    const active = locale();
    let listOptions: Intl.ListFormatOptions | undefined;
    if (typeof format === "string") {
      const named = options.formats?.list;
      if (named !== undefined && Object.hasOwn(named, format)) listOptions = named[format];
      else unknownFormat("list", format);
    } else listOptions = format;
    const items = [...values];
    if (!intlSupport().listFormat) {
      missing("ListFormat", "formatList", "the items separated by commas");
      return items.join(", ");
    }
    return safely("formatList", items.join(", "), () =>
      shared.intl.list(active, listOptions).format(items),
    );
  };

  const formatDisplayName: I18nBase<L>["formatDisplayName"] = (code, name) => {
    const active = locale();
    if (!intlSupport().displayNames) {
      missing("DisplayNames", "formatDisplayName", "the code");
      return code;
    }
    return safely(`formatDisplayName(${describe(code)}, ${name.type})`, code, () => {
      const names = shared.intl.displayNames(active, {
        type: name.type,
        ...(name.style === undefined ? {} : { style: name.style }),
        ...(name.languageDisplay === undefined ? {} : { languageDisplay: name.languageDisplay }),
      });
      return names.of(code) ?? code;
    });
  };

  return { formatNumber, formatDate, formatRelative, formatList, formatDisplayName };
}
