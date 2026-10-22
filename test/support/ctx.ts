import type { I18nError } from "../../src/errors";
import type { FormatContext, Formats } from "../../src/icu/format";
import { createIntlCache } from "../../src/intl";

/** A format context for tests; `reports` collects what the formatter reported. */
export function makeCtx(
  locale = "en",
  extra: { formats?: Formats; timeZone?: string } = {},
): { ctx: FormatContext; reports: I18nError[] } {
  const reports: I18nError[] = [];
  const ctx: FormatContext = {
    locale,
    intl: createIntlCache(),
    formats: extra.formats ?? {},
    timeZone: extra.timeZone ?? "UTC",
    report: (error) => {
      reports.push(error);
    },
  };
  return { ctx, reports };
}
