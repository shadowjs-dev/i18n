import { describe, expect, it } from "vitest";
import {
  dateOptions,
  formatDateValue,
  formatNumberValue,
  hasOwn,
  numberOptions,
  ownValue,
  toDate,
  toNumeric,
  unwrap,
} from "../src/values";
import { makeCtx } from "./support/ctx";

describe("value helpers", () => {
  it("[I18N-447] ownValue and hasOwn never reach the prototype chain", () => {
    const values = Object.create({ inherited: 1 }) as Record<string, unknown>;
    values["own"] = 2;
    expect(ownValue(values, "own")).toBe(2);
    expect(ownValue(values, "inherited")).toBeUndefined();
    expect(ownValue({}, "toString")).toBeUndefined();
    expect(ownValue({}, "constructor")).toBeUndefined();
    expect(ownValue({}, "__proto__")).toBeUndefined();
    expect(ownValue(undefined, "x")).toBeUndefined();
    expect(ownValue(JSON.parse('{"__proto__": 5}'), "__proto__")).toBe(5);
    expect(hasOwn(values, "own")).toBe(true);
    expect(hasOwn(values, "inherited")).toBe(false);
    expect(hasOwn(undefined, "x")).toBe(false);
    expect(hasOwn({ undefinedValue: undefined }, "undefinedValue")).toBe(true);
  });

  it("[I18N-447] unwrap calls accessors and returns everything else unchanged", () => {
    expect(unwrap(() => 5)).toBe(5);
    expect(unwrap(5)).toBe(5);
    expect(unwrap("text")).toBe("text");
    expect(unwrap(null)).toBeNull();
    expect(unwrap(undefined)).toBeUndefined();
    const object = {};
    expect(unwrap(object)).toBe(object);
    expect(unwrap(() => () => 1)).toBeTypeOf("function");
  });

  const numeric: ReadonlyArray<readonly [input: unknown, expected: number | bigint | undefined]> = [
    [5, 5],
    [-0.5, -0.5],
    [0, 0],
    [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
    [Number.NaN, undefined],
    [10n, 10n],
    ["12", 12],
    [" 12 ", 12],
    ["1e3", 1000],
    ["-1.5", -1.5],
    ["", undefined],
    ["   ", undefined],
    ["abc", undefined],
    ["12abc", undefined],
    ["NaN", undefined],
    [null, undefined],
    [undefined, undefined],
    [true, undefined],
    [{}, undefined],
    [[], undefined],
    [[5], undefined],
    [() => 5, undefined],
    [Symbol("x"), undefined],
    [new Date(0), undefined],
  ];

  it.each(numeric)("[I18N-447] toNumeric(%s) is %s", (input, expected) => {
    expect(toNumeric(input)).toBe(expected);
  });

  it("[I18N-447] toDate takes a Date, a timestamp or a date string and nothing else", () => {
    const moment = new Date(Date.UTC(2024, 0, 15, 22, 30, 5));
    expect(toDate(moment)).toBe(moment);
    expect(toDate(moment.getTime())?.getTime()).toBe(moment.getTime());
    expect(toDate(moment.toISOString())?.getTime()).toBe(moment.getTime());
    expect(toDate("2024-01-15")?.getTime()).toBe(Date.UTC(2024, 0, 15));
    expect(toDate(0)?.getTime()).toBe(0);
    expect(toDate(-1)?.getTime()).toBe(-1);
    expect(toDate(8.64e15)?.getTime()).toBe(8.64e15);
    for (const bad of [
      new Date(Number.NaN),
      Number.NaN,
      Number.POSITIVE_INFINITY,
      8.64e15 + 1,
      "",
      "not a date",
      "yesterday",
      null,
      undefined,
      {},
      [],
      true,
      10n,
      Symbol("x"),
      () => 0,
    ]) {
      expect(toDate(bad), String(typeof bad)).toBeUndefined();
    }
  });

  it("[I18N-447] numberOptions: named formats first, then integer and percent, otherwise a report", () => {
    const { ctx, reports } = makeCtx("en", {
      formats: {
        number: {
          percent: { style: "percent", maximumFractionDigits: 2 },
          price: { style: "currency", currency: "EUR" },
        },
      },
    });
    expect(numberOptions(undefined, ctx)).toBeUndefined();
    expect(numberOptions("price", ctx)).toEqual({ style: "currency", currency: "EUR" });
    // A name the app defines wins over the built-in of the same name.
    expect(numberOptions("percent", ctx)).toEqual({ style: "percent", maximumFractionDigits: 2 });
    expect(numberOptions("integer", ctx)).toEqual({ maximumFractionDigits: 0 });
    expect(reports).toEqual([]);
    for (const unknown of ["nope", "constructor", "toString", "__proto__", ""]) {
      expect(numberOptions(unknown, ctx), unknown).toBeUndefined();
    }
    expect(reports.map((error) => error.code)).toEqual(Array(5).fill("FORMAT_FAILED"));
    expect(reports[0]?.message).toContain('unknown number format "nope"');
    const bare = makeCtx("en").ctx;
    expect(numberOptions("percent", bare)).toEqual({ style: "percent" });
  });

  it("[I18N-447] dateOptions: date and time styles, named formats, and unknown names", () => {
    const { ctx, reports } = makeCtx("en", {
      formats: {
        date: { day: { weekday: "long" }, short: { month: "numeric" } },
        time: { clock: { hour: "numeric", hourCycle: "h23" } },
      },
    });
    expect(dateOptions("date", undefined, ctx)).toEqual({ dateStyle: "medium" });
    expect(dateOptions("time", undefined, ctx)).toEqual({ timeStyle: "medium" });
    for (const style of ["short", "medium", "long", "full"] as const) {
      expect(dateOptions("time", style, ctx)).toEqual({ timeStyle: style });
    }
    expect(dateOptions("date", "long", ctx)).toEqual({ dateStyle: "long" });
    expect(dateOptions("date", "day", ctx)).toEqual({ weekday: "long" });
    expect(dateOptions("date", "short", ctx)).toEqual({ month: "numeric" });
    expect(dateOptions("time", "clock", ctx)).toEqual({ hour: "numeric", hourCycle: "h23" });
    // The two kinds keep separate names.
    expect(dateOptions("time", "day", ctx)).toEqual({ timeStyle: "medium" });
    expect(reports.map((error) => error.message)).toEqual([
      expect.stringContaining('unknown time format "day"'),
    ]);
    for (const unknown of ["constructor", "toString", "__proto__"]) {
      expect(dateOptions("date", unknown, ctx)).toEqual({ dateStyle: "medium" });
    }
    expect(reports).toHaveLength(4);
  });

  it("[I18N-447] formatNumberValue scales numbers and leaves bigints alone", () => {
    const { ctx } = makeCtx("en");
    expect(formatNumberValue(ctx, 0.5, { maximumFractionDigits: 0 }, 100)).toBe("50");
    expect(formatNumberValue(ctx, 0.5, { style: "percent" })).toBe("50%");
    expect(formatNumberValue(ctx, 5n, undefined, 100)).toBe("5");
    expect(formatNumberValue(ctx, 1234.5, undefined)).toBe("1,234.5");
    expect(() => formatNumberValue(ctx, 1, { style: "currency" })).toThrow(TypeError);
  });

  it("[I18N-447] formatDateValue applies the context zone only when the options name none", () => {
    const moment = new Date(Date.UTC(2024, 0, 15, 22, 30));
    const options = { hour: "numeric", minute: "2-digit", hourCycle: "h23" } as const;
    const utc = makeCtx("en", { timeZone: "UTC" }).ctx;
    const riyadh = makeCtx("en", { timeZone: "Asia/Riyadh" }).ctx;
    expect(formatDateValue(utc, moment, options)).toBe("22:30");
    expect(formatDateValue(riyadh, moment, options)).toBe("01:30");
    expect(formatDateValue(riyadh, moment, { ...options, timeZone: "UTC" })).toBe("22:30");
    expect(() => formatDateValue(utc, moment, { ...options, timeZone: "Mars/Base" })).toThrow(
      RangeError,
    );
  });
});
