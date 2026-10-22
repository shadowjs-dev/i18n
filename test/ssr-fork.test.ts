import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import type { I18nError } from "../src/errors";
import type { DocumentLike, I18n } from "../src/i18n-types";
import type { PersistStrategy } from "../src/persist";
import { createI18nMiddleware, getEventI18n } from "../src/server";
import { type Deferred, deferred, drain } from "./support/deferred";
import { fakeEvent } from "./support/event";
import { createI18n } from "./support/full-instance";

const LOCALES = ["en", "fr", "de", "es", "ar"] as const;
type Locale = (typeof LOCALES)[number];

const WORD: Record<Locale, string> = {
  en: "Hello",
  fr: "Bonjour",
  de: "Hallo",
  es: "Hola",
  ar: "مرحبا",
};

interface Server {
  readonly i18n: I18n<Locale, { readonly hello: "Hello {name}" }>;
  readonly gates: Map<Locale, Array<Deferred<Record<string, string>>>>;
  readonly writes: string[];
  readonly document: DocumentLike & { readonly attributes: Map<string, string> };
  readonly errors: I18nError[];
}

/** A module-level instance with lazy catalogs the test releases by hand, persistence and a document it must never touch. */
function makeServer(): Server {
  const gates = new Map<Locale, Array<Deferred<Record<string, string>>>>();
  const writes: string[] = [];
  const attributes = new Map<string, string>();
  const errors: I18nError[] = [];
  const document: DocumentLike & { readonly attributes: Map<string, string> } = {
    attributes,
    documentElement: { setAttribute: (name, value) => void attributes.set(name, value) },
  };
  const strategy: PersistStrategy = {
    read: () => undefined,
    write: (locale) => void writes.push(locale),
  };
  const loaders = Object.fromEntries(
    LOCALES.filter((locale) => locale !== "en").map((locale) => [
      locale,
      () => {
        const gate = deferred<Record<string, string>>();
        gates.set(locale, [...(gates.get(locale) ?? []), gate]);
        return gate.promise;
      },
    ]),
  );
  const i18n = createI18n({
    defaultLocale: "en",
    locales: LOCALES,
    messages: { en: { hello: `${WORD.en} {name}` } },
    loaders,
    persist: strategy,
    syncDocument: document,
    onError: (error) => errors.push(error),
  });
  return { i18n, gates, writes, document, errors };
}

/** What `hello` says: Arabic text isolates the argument for bidirectional display. */
function said(locale: Locale, name: string): string {
  return locale === "ar" ? `${WORD[locale]} \u2068${name}\u2069` : `${WORD[locale]} ${name}`;
}

function release(server: Server, locale: Locale): void {
  for (const gate of server.gates.get(locale) ?? [])
    gate.resolve({ hello: `${WORD[locale]} {name}` });
}

describe("per-request forks", () => {
  it("[I18N-490] concurrent forks interleaved with await keep their own locales and the module instance is never mutated", async () => {
    const server = makeServer();
    const { i18n } = server;
    const before = {
      locale: i18n.locale(),
      pending: i18n.pending(),
      state: JSON.stringify(i18n.state()),
    };
    const attributesBefore = [...server.document.attributes];

    const outputs: string[] = [];
    const request = async (locale: Locale, name: string): Promise<void> => {
      const fork = i18n.fork(locale);
      await fork.setLocale(locale);
      outputs.push(`${locale}:${fork.translate("hello", { name })}`);
      await Promise.resolve();
      // After yielding to the other requests, the fork still answers in its own locale.
      expect(fork.locale()).toBe(locale);
      expect(fork.translate("hello", { name })).toBe(said(locale, name));
      await drain(3);
      expect(fork.dir()).toBe(locale === "ar" ? "rtl" : "ltr");
    };
    const all = Promise.all([
      request("fr", "a"),
      request("de", "b"),
      request("ar", "c"),
      request("fr", "d"),
      request("es", "e"),
      request("en", "f"),
    ]);
    await drain();
    // Released in an order unrelated to the order of the requests.
    for (const locale of ["es", "ar", "fr", "de"] as const) {
      release(server, locale);
      await drain();
    }
    await all;
    expect(outputs.sort()).toEqual(
      [
        `ar:${said("ar", "c")}`,
        `de:${WORD.de} b`,
        `en:${WORD.en} f`,
        `es:${WORD.es} e`,
        `fr:${WORD.fr} a`,
        `fr:${WORD.fr} d`,
      ].sort(),
    );
    expect(i18n.locale()).toBe(before.locale);
    expect(i18n.pending()).toBe(before.pending);
    // The catalogs are shared (that is the point), but the primary's own snapshot names its locale.
    expect(JSON.parse(JSON.stringify(i18n.state())).locale).toBe("en");
    expect([...server.document.attributes]).toEqual(attributesBefore);
    expect(server.writes).toEqual([]);
    expect(server.errors).toEqual([]);
    expect(JSON.stringify(i18n.state()).includes(`"locale":"en"`)).toBe(true);
    expect(before.state.includes(`"locale":"en"`)).toBe(true);
  });

  it("[I18N-490] property: any number of forks released in any order each end in their own locale (fixed seed)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom(...LOCALES), { minLength: 1, maxLength: 12 }),
        fc.shuffledSubarray([...LOCALES], { minLength: LOCALES.length }),
        async (requested, order) => {
          const server = makeServer();
          const forks = requested.map((locale) => server.i18n.fork(locale));
          const calls = forks.map((fork, index) => fork.setLocale(requested[index] as Locale));
          await drain();
          for (const locale of order) {
            release(server, locale);
            await drain();
          }
          await Promise.all(calls);
          forks.forEach((fork, index) => {
            const locale = requested[index] as Locale;
            expect(fork.locale()).toBe(locale);
            expect(fork.translate("hello", { name: "x" })).toBe(said(locale, "x"));
          });
          expect(server.i18n.locale()).toBe("en");
          expect(server.writes).toEqual([]);
        },
      ),
      { seed: 490, numRuns: 25 },
    );
  });

  it("[I18N-490] the middleware gives each interleaved request its own fork; the module instance stays in its default locale", async () => {
    const server = makeServer();
    const middleware = createI18nMiddleware(server.i18n, { strategy: ["url"] });
    const seen: string[] = [];
    const run = async (path: string, locale: Locale): Promise<void> => {
      const event = fakeEvent(`https://x.test${path}`);
      await middleware(event, async () => {
        const forked = getEventI18n<typeof server.i18n>(event);
        await Promise.resolve();
        await drain(2);
        seen.push(`${path}=${forked.translate("hello", { name: "x" })}`);
        expect(forked).not.toBe(server.i18n);
        expect(forked.locale()).toBe(locale);
        return new Response("ok");
      });
    };
    const all = Promise.all([
      run("/fr/a", "fr"),
      run("/de/b", "de"),
      run("/fr/c", "fr"),
      run("/en/d", "en"),
    ]);
    await drain();
    release(server, "de");
    await drain();
    release(server, "fr");
    await all;
    expect(seen.sort()).toEqual([
      `/de/b=${said("de", "x")}`,
      `/en/d=${said("en", "x")}`,
      `/fr/a=${said("fr", "x")}`,
      `/fr/c=${said("fr", "x")}`,
    ]);
    expect(server.i18n.locale()).toBe("en");
    expect(server.writes).toEqual([]);
  });

  it("[I18N-491] fork() with no argument starts from the instance's current locale; an unknown locale throws and creates nothing", async () => {
    const server = makeServer();
    const first = server.i18n.setLocale("fr");
    release(server, "fr");
    await first;
    const fork = server.i18n.fork();
    expect(fork.locale()).toBe("fr");
    await fork.setLocale("en");
    expect(fork.locale()).toBe("en");
    expect(server.i18n.locale()).toBe("fr");
    expect(() => server.i18n.fork("xx" as never)).toThrow(
      expect.objectContaining({ code: "UNKNOWN_LOCALE" }),
    );
    // A regional tag resolves to the supported locale.
    expect(server.i18n.fork("de-AT" as never).locale()).toBe("de");
  });

  it("[I18N-491] a fork of a fork is independent of both, and a fork's setLocale never writes persistence or the document", async () => {
    const server = makeServer();
    const attributesBefore = [...server.document.attributes];
    const outer = server.i18n.fork("en");
    const inner = outer.fork("es");
    const call = inner.setLocale("es");
    release(server, "es");
    await call;
    await outer.setLocale("en");
    expect(inner.locale()).toBe("es");
    expect(outer.locale()).toBe("en");
    expect(server.i18n.locale()).toBe("en");
    expect(server.writes).toEqual([]);
    expect([...server.document.attributes]).toEqual(attributesBefore);
  });

  it("[I18N-492] disposing a fork cancels its own pending switch and leaves the module instance and other forks alone", async () => {
    const server = makeServer();
    const doomed = server.i18n.fork("en");
    const alive = server.i18n.fork("en");
    const doomedCall = doomed.setLocale("fr");
    const aliveCall = alive.setLocale("fr");
    doomed.dispose();
    release(server, "fr");
    await expect(doomedCall).resolves.toBe("en");
    await expect(aliveCall).resolves.toBe("fr");
    expect(doomed.locale()).toBe("en");
    expect(alive.locale()).toBe("fr");
    // The primary still works.
    await expect(server.i18n.setLocale("fr")).resolves.toBe("fr");
  });

  it("[I18N-492] a request-time hook that is slow does not leak its locale into a later request on the same module instance", async () => {
    const server = makeServer();
    const slow = server.i18n.fork("de");
    const slowCall = slow.setLocale("de");
    const quick = server.i18n.fork("en");
    expect(quick.translate("hello", { name: "q" })).toBe("Hello q");
    release(server, "de");
    await slowCall;
    expect(quick.translate("hello", { name: "q" })).toBe("Hello q");
    expect(vi.mocked(console.warn).mock.calls).toEqual([]);
  });
});
