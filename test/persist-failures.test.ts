import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nError } from "../src/errors";
import {
  type CookieDocument,
  cookieStrategy,
  type PersistStrategy,
  type StorageLike,
  storageStrategy,
} from "../src/persist";
import { deferred } from "./support/deferred";
import { createI18n } from "./support/full-instance";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A cookie jar that behaves like `document.cookie`: assignment sets one cookie, read lists them all. */
function jar(): CookieDocument & { readonly writes: string[] } {
  const cookies = new Map<string, string>();
  const writes: string[] = [];
  return {
    writes,
    get cookie(): string {
      return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    },
    set cookie(line: string) {
      writes.push(line);
      const first = line.split(";")[0] ?? "";
      const equals = first.indexOf("=");
      cookies.set(first.slice(0, equals), first.slice(equals + 1));
    },
  };
}

const quota = (): DOMException =>
  new DOMException("The quota has been exceeded.", "QuotaExceededError");
const security = (): DOMException =>
  new DOMException("The operation is insecure.", "SecurityError");

function collect(): { reports: I18nError[]; report: (error: I18nError) => void } {
  const reports: I18nError[] = [];
  return { reports, report: (error) => void reports.push(error) };
}

describe("storage strategy failures", () => {
  it("[I18N-470] blocked storage (reads and writes throw SecurityError) is reported as INVALID_STATE and never thrown", () => {
    const { reports, report } = collect();
    const storage: StorageLike = {
      getItem: () => {
        throw security();
      },
      setItem: () => {
        throw security();
      },
    };
    const strategy = storageStrategy({ storage, report });
    expect(strategy.read()).toBeUndefined();
    expect(() => strategy.write("fr")).not.toThrow();
    expect(reports.map((error) => error.code)).toEqual(["INVALID_STATE", "INVALID_STATE"]);
    expect(reports[0]?.message).toContain("storage read failed");
    expect(reports[1]?.message).toContain("storage write failed");
    expect(reports[1]?.cause).toBeInstanceOf(DOMException);
  });

  it("[I18N-471] quota exceeded on setItem is reported, not thrown, and a later write can succeed", () => {
    const { reports, report } = collect();
    let full = true;
    const memory = new Map<string, string>();
    const storage: StorageLike = {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => {
        if (full) throw quota();
        memory.set(key, value);
      },
    };
    const strategy = storageStrategy({ storage, report });
    strategy.write("fr");
    expect(reports).toHaveLength(1);
    expect(reports[0]?.code).toBe("INVALID_STATE");
    expect(strategy.read()).toBeUndefined();
    full = false;
    strategy.write("fr");
    expect(strategy.read()).toBe("fr");
    expect(reports).toHaveLength(1);
  });

  it("[I18N-471] a storage that throws something that is not a DOMException (a polyfill, a Proxy) is handled the same way", () => {
    for (const thrown of [
      new Error("polyfill quota"),
      new TypeError("not a function"),
      "string",
      42,
      null,
    ]) {
      const { reports, report } = collect();
      const storage: StorageLike = {
        getItem: () => {
          throw thrown;
        },
        setItem: () => {
          throw thrown;
        },
      };
      const strategy = storageStrategy({ storage, report });
      expect(() => strategy.read()).not.toThrow();
      expect(() => strategy.write("fr")).not.toThrow();
      expect(reports.map((error) => error.code)).toEqual(["INVALID_STATE", "INVALID_STATE"]);
      expect(reports[0]?.cause).toBe(thrown);
    }
  });

  it("[I18N-471] without a report callback a failure is silent and still not thrown", () => {
    const strategy = storageStrategy({
      storage: {
        getItem: () => {
          throw security();
        },
        setItem: () => {
          throw quota();
        },
      },
    });
    expect(strategy.read()).toBeUndefined();
    expect(() => strategy.write("fr")).not.toThrow();
  });

  it("[I18N-472] there is no storage in a non-browser runtime: reads give undefined, writes are no-ops, nothing is reported", () => {
    const { reports, report } = collect();
    const strategy = storageStrategy({ report });
    expect(strategy.read()).toBeUndefined();
    expect(() => strategy.write("fr")).not.toThrow();
    expect(reports).toEqual([]);
  });

  it("[I18N-472] a custom key is used for reading and writing", () => {
    const memory = new Map<string, string>();
    const storage: StorageLike = {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => void memory.set(key, value),
    };
    storageStrategy({ storage, key: "app.locale" }).write("de");
    expect([...memory]).toEqual([["app.locale", "de"]]);
    expect(storageStrategy({ storage, key: "app.locale" }).read()).toBe("de");
    expect(storageStrategy({ storage }).read()).toBeUndefined();
  });
});

describe("cookie strategy failures", () => {
  it("[I18N-472] there is no cookie document in a non-browser runtime: the strategy is inert and silent", () => {
    const { reports, report } = collect();
    const strategy = cookieStrategy({ report });
    expect(strategy.read()).toBeUndefined();
    expect(() => strategy.write("fr")).not.toThrow();
    expect(reports).toEqual([]);
  });

  it("[I18N-473] a document whose cookie access throws (sandboxed iframe) is reported as INVALID_STATE, never thrown", () => {
    const { reports, report } = collect();
    const blocked: CookieDocument = {
      get cookie(): string {
        throw security();
      },
      set cookie(_line: string) {
        throw security();
      },
    };
    const strategy = cookieStrategy({ document: blocked, report });
    expect(strategy.read()).toBeUndefined();
    expect(() => strategy.write("fr")).not.toThrow();
    expect(reports.map((error) => error.code)).toEqual(["INVALID_STATE", "INVALID_STATE"]);
    expect(reports[0]?.cause).toBeInstanceOf(DOMException);
  });

  it("[I18N-473] a document whose cookie is not a string is reported, not thrown", () => {
    const { reports, report } = collect();
    const strategy = cookieStrategy({ document: { cookie: undefined as never }, report });
    expect(strategy.read()).toBeUndefined();
    expect(reports.map((error) => error.code)).toEqual(["INVALID_STATE"]);
  });

  it("[I18N-473] the default cookie: Path=/, one year Max-Age, SameSite=Lax, no Secure on http", () => {
    const document = jar();
    cookieStrategy({ document }).write("fr");
    expect(document.writes).toEqual(["locale=fr; Path=/; Max-Age=31536000; SameSite=Lax"]);
  });

  it("[I18N-473] Secure is set on https pages and left off on http pages", () => {
    vi.stubGlobal("location", { protocol: "https:" });
    const secure = jar();
    cookieStrategy({ document: secure }).write("fr");
    expect(secure.writes[0]).toBe("locale=fr; Path=/; Max-Age=31536000; SameSite=Lax; Secure");
    vi.stubGlobal("location", { protocol: "http:" });
    const plain = jar();
    cookieStrategy({ document: plain }).write("fr");
    expect(plain.writes[0]).not.toContain("Secure");
  });

  it("[I18N-473] an explicit secure option wins over the page protocol", () => {
    vi.stubGlobal("location", { protocol: "https:" });
    const off = jar();
    cookieStrategy({ document: off, secure: false }).write("fr");
    expect(off.writes[0]).not.toContain("Secure");
    vi.stubGlobal("location", { protocol: "http:" });
    const on = jar();
    cookieStrategy({ document: on, secure: true }).write("fr");
    expect(on.writes[0]).toContain("; Secure");
  });

  it("[I18N-473] SameSite strict and none are written; none always requires Secure, even on http or secure: false", () => {
    const strict = jar();
    cookieStrategy({ document: strict, sameSite: "strict" }).write("fr");
    expect(strict.writes[0]).toBe("locale=fr; Path=/; Max-Age=31536000; SameSite=Strict");
    for (const secure of [undefined, false, true]) {
      const none = jar();
      cookieStrategy({
        document: none,
        sameSite: "none",
        ...(secure === undefined ? {} : { secure }),
      }).write("fr");
      expect(none.writes[0]).toBe("locale=fr; Path=/; Max-Age=31536000; SameSite=None; Secure");
    }
    const lax = jar();
    cookieStrategy({ document: lax, sameSite: "lax" }).write("fr");
    expect(lax.writes[0]).toContain("SameSite=Lax");
  });

  it("[I18N-473] an unknown SameSite value is rejected with INVALID_VALUE instead of writing a cookie the browser ignores", () => {
    for (const sameSite of ["None", "STRICT", "", "relaxed"]) {
      expect(() => cookieStrategy({ sameSite: sameSite as never })).toThrow(
        expect.objectContaining({ code: "INVALID_VALUE" }),
      );
    }
  });

  it("[I18N-473] maxAge: rounded down, never negative, and non-finite values are rejected with INVALID_VALUE", () => {
    const lifetimes: Array<[number, string]> = [
      [60.9, "Max-Age=60"],
      [0, "Max-Age=0"],
      [-5, "Max-Age=0"],
      [-0.5, "Max-Age=0"],
    ];
    for (const [maxAge, expected] of lifetimes) {
      const document = jar();
      cookieStrategy({ document, maxAge }).write("fr");
      expect(document.writes[0]).toContain(`; ${expected};`);
    }
    for (const maxAge of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => cookieStrategy({ maxAge })).toThrow(
        expect.objectContaining({ code: "INVALID_VALUE" }),
      );
    }
  });

  it("[I18N-473] Domain and a custom Path are written; the locale value is encoded", () => {
    const document = jar();
    cookieStrategy({ document, domain: "example.com", path: "/app", name: "NEXT_LOCALE" }).write(
      "zh-Hant",
    );
    expect(document.writes[0]).toBe(
      "NEXT_LOCALE=zh-Hant; Path=/app; Max-Age=31536000; SameSite=Lax; Domain=example.com",
    );
    const odd = jar();
    cookieStrategy({ document: odd }).write("a;b c");
    expect(odd.writes[0]?.startsWith("locale=a%3Bb%20c; ")).toBe(true);
    expect(cookieStrategy({ document: odd }).read()).toBe("a;b c");
  });

  it("[I18N-474] an invalid cookie name is rejected with I18nError INVALID_VALUE", () => {
    for (const name of [
      "",
      "has space",
      "semi;colon",
      "eq=ual",
      "tab\t",
      "new\nline",
      "ünï",
      'quote"',
      "comma,",
      "(paren)",
    ]) {
      expect(() => cookieStrategy({ name })).toThrow(I18nError);
      expect(() => cookieStrategy({ name })).toThrow(
        expect.objectContaining({ code: "INVALID_VALUE" }),
      );
    }
    for (const name of ["locale", "NEXT_LOCALE", "a.b-c", "x!#$%&'*+^`|~1"]) {
      expect(() => cookieStrategy({ name })).not.toThrow();
    }
  });

  it("[I18N-474] an invalid cookie name, path or domain also fails createI18n in the browser, before anything is written", () => {
    const document = jar();
    const base = {
      defaultLocale: "en",
      locales: ["en", "fr"],
      messages: { en: {} },
      syncDocument: false,
    } as const;
    expect(() =>
      createI18n({ ...base, persist: { type: "cookie", name: "bad name", document } }),
    ).toThrow(expect.objectContaining({ code: "INVALID_VALUE" }));
    expect(() =>
      createI18n({ ...base, persist: { type: "cookie", path: "/a b", document } }),
    ).toThrow(expect.objectContaining({ code: "INVALID_VALUE" }));
    expect(() =>
      createI18n({ ...base, persist: { type: "cookie", domain: "a;b", document } }),
    ).toThrow(expect.objectContaining({ code: "INVALID_VALUE" }));
    expect(document.writes).toEqual([]);
  });

  it("[I18N-474] property: a name is accepted exactly when it is an HTTP token", () => {
    const token = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
    fc.assert(
      fc.property(fc.string({ maxLength: 12 }), (name) => {
        let accepted = true;
        try {
          cookieStrategy({ name });
        } catch (error) {
          accepted = false;
          expect(error).toBeInstanceOf(I18nError);
          expect((error as I18nError).code).toBe("INVALID_VALUE");
        }
        expect(accepted).toBe(token.test(name));
      }),
      { seed: 450474, numRuns: 300 },
    );
  });

  it("[I18N-475] read ignores cookies whose name only ends or starts like ours and takes the first match", () => {
    const document: CookieDocument = { cookie: "xlocale=de; locale=fr; locale=it; locale2=es" };
    expect(cookieStrategy({ document }).read()).toBe("fr");
    expect(cookieStrategy({ document: { cookie: "a=1" } }).read()).toBeUndefined();
    expect(cookieStrategy({ document: { cookie: "locale=zh%2DHant=x" } }).read()).toBe("zh-Hant=x");
    expect(cookieStrategy({ document: { cookie: "locale=%E0%A4%A" } }).read()).toBeUndefined();
  });
});

describe("persistence through the instance", () => {
  const base = {
    defaultLocale: "en",
    locales: ["en", "fr", "de"],
    messages: { en: { a: "A" }, fr: { a: "F" } },
    syncDocument: false,
  } as const;

  it("[I18N-475] a stored locale that is not supported falls back to the default with no error", () => {
    for (const stored of ["xx", "klingon", "", "__proto__", "fr!!garbage", "e".repeat(5000)]) {
      const errors: I18nError[] = [];
      const memory = new Map<string, string>([["locale", stored]]);
      const storage: StorageLike = {
        getItem: (key) => memory.get(key) ?? null,
        setItem: (key, value) => void memory.set(key, value),
      };
      const i18n = createI18n({
        ...base,
        persist: { type: "localStorage", storage },
        detect: { order: ["storage"] },
        onError: (error) => errors.push(error),
      });
      expect(i18n.locale()).toBe("en");
      expect(errors).toEqual([]);
    }
  });

  it("[I18N-475] a supported stored locale (also a regional variant of one) is restored", () => {
    for (const [stored, expected] of [
      ["fr", "fr"],
      ["fr-CA", "fr"],
      ["de", "de"],
    ] as const) {
      const i18n = createI18n({
        ...base,
        persist: {
          type: "localStorage",
          storage: { getItem: () => stored, setItem: () => undefined },
        },
        detect: { order: ["storage"] },
        onError: () => undefined,
      });
      expect(i18n.locale()).toBe(expected);
    }
  });

  it("[I18N-475] a cookie holding an unsupported or malformed value falls back with no error", () => {
    for (const cookie of ["locale=xx", "locale=%E0%A4%A", "locale=", "other=fr"]) {
      const errors: I18nError[] = [];
      const i18n = createI18n({
        ...base,
        persist: { type: "cookie", document: { cookie } },
        detect: { order: ["storage"] },
        onError: (error) => errors.push(error),
      });
      expect(i18n.locale()).toBe("en");
      expect(errors).toEqual([]);
    }
  });

  it("[I18N-476] setLocale resolves and switches when storage is blocked; the failure is reported through onError", async () => {
    const errors: I18nError[] = [];
    const i18n = createI18n({
      ...base,
      persist: {
        type: "localStorage",
        storage: {
          getItem: () => {
            throw security();
          },
          setItem: () => {
            throw quota();
          },
        },
      },
      onError: (error) => errors.push(error),
    });
    await expect(i18n.setLocale("fr")).resolves.toBe("fr");
    expect(i18n.locale()).toBe("fr");
    expect(errors.map((error) => error.code)).toEqual(["INVALID_STATE"]);
    expect(errors[0]?.message).toContain("storage write failed");
  });

  it("[I18N-476] a lazy locale whose storage write fails still resolves and applies", async () => {
    const errors: I18nError[] = [];
    const gate = deferred<Record<string, string>>();
    const i18n = createI18n({
      ...base,
      locales: ["en", "fr", "de"],
      loaders: { de: () => gate.promise },
      persist: {
        type: "localStorage",
        storage: {
          getItem: () => null,
          setItem: () => {
            throw quota();
          },
        },
      },
      onError: (error) => errors.push(error),
    });
    const call = i18n.setLocale("de");
    gate.resolve({ a: "D" });
    await expect(call).resolves.toBe("de");
    expect(i18n.t("a")).toBe("D");
    expect(errors.map((error) => error.code)).toEqual(["INVALID_STATE"]);
  });

  it("[I18N-476] a persist strategy that throws (against its contract) never makes setLocale throw or reject; the failure is reported", async () => {
    const errors: I18nError[] = [];
    const boom = new Error("strategy write exploded");
    const strategy: PersistStrategy = {
      read: () => undefined,
      write: () => {
        throw boom;
      },
    };
    const gate = deferred<Record<string, string>>();
    const i18n = createI18n({
      ...base,
      loaders: { de: () => gate.promise },
      persist: strategy,
      onError: (error) => errors.push(error),
    });
    let sync: Promise<string> | undefined;
    expect(() => {
      sync = i18n.setLocale("fr");
    }).not.toThrow();
    await expect(sync).resolves.toBe("fr");
    const lazy = i18n.setLocale("de");
    gate.resolve({ a: "D" });
    await expect(lazy).resolves.toBe("de");
    expect(i18n.locale()).toBe("de");
    expect(errors.filter((error) => error.cause === boom)).toHaveLength(2);
  });

  it("[I18N-476] a persist strategy whose read throws does not break creation with detect: the failure is reported", () => {
    const errors: I18nError[] = [];
    const boom = new Error("strategy read exploded");
    const i18n = createI18n({
      ...base,
      persist: {
        read: () => {
          throw boom;
        },
        write: () => undefined,
      },
      detect: { order: ["storage"] },
      onError: (error) => errors.push(error),
    });
    expect(i18n.locale()).toBe("en");
    expect(errors.filter((error) => error.cause === boom)).toHaveLength(1);
  });

  it("[I18N-477] the resolved locale is written after a successful switch; failed and stale loads write nothing", async () => {
    const written: string[] = [];
    const memory: PersistStrategy = {
      read: () => undefined,
      write: (locale) => void written.push(locale),
    };
    const fr = deferred<Record<string, string>>();
    const de = deferred<Record<string, string>>();
    const i18n = createI18n({
      ...base,
      loaders: { fr: () => fr.promise, de: () => de.promise },
      messages: { en: { a: "A" } },
      persist: memory,
      onError: () => undefined,
    });
    const first = i18n.setLocale("fr");
    const second = i18n.setLocale("de");
    fr.resolve({ a: "F" });
    de.reject(new Error("down"));
    await Promise.all([first, second]);
    expect(i18n.locale()).toBe("en");
    expect(written).toEqual([]);
    const third = i18n.setLocale("fr-CA" as "fr");
    await expect(third).resolves.toBe("fr");
    expect(written).toEqual(["fr"]);
  });

  it("[I18N-477] with no persist option nothing is written anywhere", async () => {
    const document = jar();
    const i18n = createI18n({ ...base });
    await i18n.setLocale("fr");
    expect(document.writes).toEqual([]);
  });
});
