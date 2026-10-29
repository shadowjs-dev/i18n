import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../src/cli/main";
import {
  assignKey,
  check,
  exportXliff,
  importXliff,
  readCatalogs,
  scanSources,
} from "../src/cli/run";
import { escapeXml, readXliff, unescapeXml, writeXliff } from "../src/cli/xliff";

let root: string;

async function put(path: string, text: string): Promise<void> {
  const file = join(root, path);
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, text);
}

async function putJson(path: string, value: unknown): Promise<void> {
  await put(path, JSON.stringify(value, null, 2));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "shadow-i18n-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A small app: two locales, one source file, a nested catalog. */
async function app(): Promise<void> {
  await putJson("messages/en.json", {
    greet: "Hello {name}",
    cart: { title: "Cart", items: "{n, plural, one {# item} other {# items}}" },
    unused: "x",
  });
  await putJson("messages/fr.json", {
    greet: "Bonjour {name}",
    cart: { title: "Panier", items: "{n, plural, one {# article} other {# articles}}" },
    unused: "y",
  });
  await put(
    "src/app.tsx",
    'export const a = t("greet", { name }); export const b = t("cart.title"); export const c = t("cart.items", { n }); t("unused");',
  );
}

describe("[I18N-CLI-01] XLIFF", () => {
  it("escapes and unescapes the five entities and numeric references", () => {
    expect(escapeXml(`a<b>&"c'`)).toBe("a&lt;b&gt;&amp;&quot;c&apos;");
    expect(unescapeXml("a&lt;b&gt;&amp;&quot;c&apos; &#65;&#x42; &unknown; &")).toBe(
      `a<b>&"c' AB &unknown; &`,
    );
    expect(unescapeXml("&#xD800; &#99999999;")).toBe("&#xD800; &#99999999;");
  });

  it("round-trips units with markup, ICU syntax and non-Latin text", () => {
    const units = [
      {
        key: "a.b",
        source: "Hi <b>{name}</b> & {n, plural, one {# “x”} other {# 'y'}}",
        target: "مرحبا <b>{name}</b>",
      },
      { key: "c", source: "Bye" },
    ];
    const xml = writeXliff(units, "en", "ar");
    const back = readXliff(xml);
    expect(back.source).toBe("en");
    expect(back.target).toBe("ar");
    expect(back.units).toEqual(units);
  });

  it("refuses a text that is not XLIFF and skips units without an id or a source", () => {
    expect(() => readXliff("<html></html>")).toThrow(SyntaxError);
    const xml =
      '<xliff><file source-language="en" target-language="fr"><trans-unit><source>x</source></trans-unit><trans-unit id="k"><target>y</target></trans-unit><trans-unit id="ok"><source>s</source><target>t</target></trans-unit></file></xliff>';
    expect(readXliff(xml).units).toEqual([{ key: "ok", source: "s", target: "t" }]);
  });
});

describe("[I18N-CLI-02] catalogs and sources", () => {
  it("reads every locale and names the file that is not valid", async () => {
    await app();
    expect(Object.keys(await readCatalogs(join(root, "messages")))).toEqual(["en", "fr"]);
    await put("messages/de.json", "{ nope");
    await expect(readCatalogs(join(root, "messages"))).rejects.toThrow(
      /de\.json is not valid JSON/,
    );
    await put("messages/de.json", "[1]");
    await expect(readCatalogs(join(root, "messages"))).rejects.toThrow(/must hold a JSON object/);
    await expect(readCatalogs(join(root, "missing"))).rejects.toThrow(/cannot be read/);
  });

  it("[I18N-R5-5] the catalogs have no prototype, so --base constructor is a missing locale, not Object's member", async () => {
    await app();
    const messages = join(root, "messages");
    const catalogs = await readCatalogs(messages);
    expect(Object.getPrototypeOf(catalogs)).toBeNull();
    expect(catalogs["constructor"]).toBeUndefined();
    expect(catalogs["toString"]).toBeUndefined();
    await expect(
      check({ messages, sources: [join(root, "src")], base: "constructor" }),
    ).rejects.toThrow(/there is no constructor\.json/);
    await expect(
      exportXliff({ messages, base: "__proto__", locale: "fr", out: join(root, "out.xlf") }),
    ).rejects.toThrow(/there is no __proto__\.json/);
    await exportXliff({ messages, base: "en", locale: "toString", out: join(root, "ts.xlf") });
    const units = readXliff(await readFile(join(root, "ts.xlf"), "utf8")).units;
    expect(units.every((unit) => unit.target === undefined)).toBe(true);
    await expect(
      importXliff({
        messages,
        base: "constructor",
        locale: "fr",
        from: join(root, "ts.xlf"),
      }),
    ).rejects.toThrow(/there is no constructor\.json/);
  });

  it("scans source folders, skipping dependencies, build output and declaration files", async () => {
    await put("src/a.ts", 't("one")');
    await put("src/deep/b.tsx", '<Trans key="two" />');
    await put("src/node_modules/x.ts", 't("never")');
    await put("src/dist/y.ts", 't("never")');
    await put("src/types.d.ts", 't("never")');
    await put("src/notes.md", 't("never")');
    const scan = await scanSources([join(root, "src")], root);
    expect(scan.keys.map((entry) => [entry.key, entry.file])).toEqual([
      ["one", "src/a.ts"],
      ["two", "src/deep/b.tsx"],
    ]);
    expect(scan.files).toBe(2);
    await expect(scanSources([join(root, "nope")], root)).rejects.toThrow(/does not exist/);
  });

  it("reads other names for the translate function", async () => {
    await put("src/a.ts", 'translate("one"); msg("two")');
    const scan = await scanSources([join(root, "src")], root, { functions: ["msg"] });
    expect(scan.keys.map((entry) => entry.key)).toContain("two");
  });
});

describe("[I18N-CLI-03] check", () => {
  it("passes a consistent app when the unused key is allowed", async () => {
    await app();
    const result = await check({
      messages: join(root, "messages"),
      sources: [join(root, "src")],
      base: "en",
      cwd: root,
    });
    expect(result.ok).toBe(true);
    expect(result.keys).toBe(4);
    expect(result.locales).toEqual(["en", "fr"]);
  });

  it("reports a key the code uses and the catalog lacks, with file and line", async () => {
    await app();
    await put("src/more.ts", '\n\nt("cart.checkout");');
    const result = await check({
      messages: join(root, "messages"),
      sources: [join(root, "src")],
      base: "en",
      cwd: root,
    });
    expect(result.ok).toBe(false);
    const problem = result.problems.find((entry) => entry.kind === "undefined-key");
    expect(problem).toMatchObject({ key: "cart.checkout", file: "src/more.ts", line: 3 });
  });

  it("reports an unused key unless told to ignore it, and treats a computed prefix as use", async () => {
    await putJson("messages/en.json", { used: "a", status: { on: "On", off: "Off" }, stale: "z" });
    await put("src/a.ts", 't("used"); t(`status.$' + "{state}`);");
    const loud = await check({
      messages: join(root, "messages"),
      sources: [join(root, "src")],
      base: "en",
      cwd: root,
    });
    expect(loud.problems.map((entry) => [entry.kind, entry.key])).toEqual([
      ["unused-key", "stale"],
    ]);
    const quiet = await check({
      messages: join(root, "messages"),
      sources: [join(root, "src")],
      base: "en",
      cwd: root,
      ignoreUnused: true,
    });
    expect(quiet.ok).toBe(true);
  });

  it("reports a locale that lacks a key or changes the arguments, unless missing keys are allowed", async () => {
    await app();
    await putJson("messages/fr.json", { greet: "Bonjour", cart: { title: "Panier" }, unused: "y" });
    const strict = await check({
      messages: join(root, "messages"),
      sources: [join(root, "src")],
      base: "en",
      cwd: root,
    });
    expect(
      strict.problems.map((entry) => `${entry.locale}:${entry.kind}:${entry.key}`).sort(),
    ).toEqual(["fr:argument-mismatch:greet", "fr:missing-key:cart.items"]);
    const lenient = await check({
      messages: join(root, "messages"),
      sources: [join(root, "src")],
      base: "en",
      cwd: root,
      allowMissing: true,
    });
    expect(lenient.problems.map((entry) => entry.kind)).toEqual(["argument-mismatch"]);
  });

  it("fails clearly when the base locale has no catalog", async () => {
    await putJson("messages/fr.json", { a: "b" });
    await expect(
      check({ messages: join(root, "messages"), sources: [root], base: "en", cwd: root }),
    ).rejects.toThrow(/no en\.json/);
  });
});

describe("[I18N-CLI-04] export and import", () => {
  it("exports every message with what the locale has, or only what it lacks", async () => {
    await app();
    await putJson("messages/fr.json", { greet: "Bonjour {name}" });
    const out = join(root, "out/fr.xlf");
    expect(
      await exportXliff({ messages: join(root, "messages"), base: "en", locale: "fr", out }),
    ).toEqual({ file: out, units: 4 });
    const all = readXliff(await readFile(out, "utf8"));
    expect(all.units.find((unit) => unit.key === "greet")?.target).toBe("Bonjour {name}");
    expect(all.units.find((unit) => unit.key === "cart.title")?.target).toBeUndefined();
    const only = await exportXliff({
      messages: join(root, "messages"),
      base: "en",
      locale: "fr",
      out,
      onlyMissing: true,
    });
    expect(only.units).toBe(3);
    await expect(
      exportXliff({ messages: join(root, "messages"), base: "en", locale: "en", out }),
    ).rejects.toThrow(/nothing to translate/);
  });

  it("exports a locale that has no catalog yet, and imports into a new file", async () => {
    await app();
    const out = join(root, "de.xlf");
    await exportXliff({ messages: join(root, "messages"), base: "en", locale: "de", out });
    const xml = (await readFile(out, "utf8")).replace(
      '<target state="new"></target>',
      '<target state="translated">Hallo {name}</target>',
    );
    await writeFile(out, xml);
    const result = await importXliff({
      messages: join(root, "messages"),
      base: "en",
      locale: "de",
      from: out,
    });
    expect(result.written).toBe(1);
    expect(JSON.parse(await readFile(join(root, "messages/de.json"), "utf8"))).toEqual({
      greet: "Hallo {name}",
    });
  });

  it("keeps the shape of the file: flat keys stay flat, nested objects are extended", () => {
    const catalog: Record<string, unknown> = { "a.b": "flat", n: { x: "1" } };
    assignKey(catalog, "a.b", "flat2");
    assignKey(catalog, "n.y", "2");
    assignKey(catalog, "p.q.r", "3");
    expect(catalog).toEqual({ "a.b": "flat2", n: { x: "1", y: "2" }, p: { q: { r: "3" } } });
  });

  it("rejects translations that break the message, name a key the base lacks, or answer a changed source", async () => {
    await app();
    const from = join(root, "fr.xlf");
    const xml = writeXliff(
      [
        { key: "greet", source: "Hello {name}", target: "Bonjour {nom}" },
        { key: "cart.title", source: "Cart", target: "Panier 2" },
        { key: "ghost", source: "x", target: "y" },
        { key: "unused", source: "old source", target: "z" },
      ],
      "en",
      "fr",
    );
    await writeFile(from, xml);
    const result = await importXliff({
      messages: join(root, "messages"),
      base: "en",
      locale: "fr",
      from,
    });
    expect(result.written).toBe(1);
    expect(result.skipped.map((entry) => entry.key).sort()).toEqual(["ghost", "greet", "unused"]);
    const fr = JSON.parse(await readFile(join(root, "messages/fr.json"), "utf8"));
    expect(fr.cart.title).toBe("Panier 2");
    expect(fr.greet).toBe("Bonjour {name}");
  });

  it("writes nothing in strict mode when anything is rejected, and refuses a file for another locale", async () => {
    await app();
    const from = join(root, "fr.xlf");
    await writeFile(
      from,
      writeXliff(
        [
          { key: "cart.title", source: "Cart", target: "P" },
          { key: "ghost", source: "x", target: "y" },
        ],
        "en",
        "fr",
      ),
    );
    const before = await readFile(join(root, "messages/fr.json"), "utf8");
    const result = await importXliff({
      messages: join(root, "messages"),
      base: "en",
      locale: "fr",
      from,
      strict: true,
    });
    expect(result.written).toBe(0);
    expect(await readFile(join(root, "messages/fr.json"), "utf8")).toBe(before);
    await expect(
      importXliff({ messages: join(root, "messages"), base: "en", locale: "es", from }),
    ).rejects.toThrow(/for the locale "fr"/);
    await writeFile(from, "not xml");
    await expect(
      importXliff({ messages: join(root, "messages"), base: "en", locale: "fr", from }),
    ).rejects.toThrow(/not an XLIFF/);
  });
});

describe("[I18N-CLI-05] the command", () => {
  function io(): { lines: string[]; errors: string[]; value: Parameters<typeof main>[1] } {
    const lines: string[] = [];
    const errors: string[] = [];
    return {
      lines,
      errors,
      value: {
        cwd: root,
        version: "9.9.9",
        out: (line) => lines.push(line),
        err: (line) => errors.push(line),
      },
    };
  }

  it("check exits 0 for a good app and 1 with the problems on stderr for a bad one", async () => {
    await app();
    const good = io();
    expect(await main(["check", "--ignore-unused"], good.value)).toBe(0);
    expect(good.lines[0]).toMatch(/^ok: 2 locale/);
    await put("src/bad.ts", 't("nope")');
    const bad = io();
    expect(await main(["check", "--ignore-unused"], bad.value)).toBe(1);
    expect(bad.errors[0]).toBe(
      'src/bad.ts:1: undefined-key: the code uses "nope", which en.json does not define.',
    );
  });

  it("--json prints one document in the shared contract, for success and for failure", async () => {
    await app();
    await put("src/bad.ts", 't("nope")');
    const run = io();
    expect(await main(["check", "--json"], run.value)).toBe(1);
    expect(run.errors).toEqual([]);
    const document = JSON.parse(run.lines.join("\n"));
    expect(document).toMatchObject({
      schema: 1,
      command: "shadow-i18n check",
      ok: false,
      error: { code: "SHADOW_I18N_PROBLEMS" },
    });
    expect(document.data.problems[0].kind).toBe("undefined-key");
    const unknown = io();
    expect(await main(["wat", "--json"], unknown.value)).toBe(1);
    expect(JSON.parse(unknown.lines.join("\n")).error.code).toBe("SHADOW_I18N_UNKNOWN_COMMAND");
  });

  it("extract lists keys, export writes the file, import merges it", async () => {
    await app();
    const extract = io();
    expect(await main(["extract"], extract.value)).toBe(0);
    expect(extract.lines).toEqual(["cart.items", "cart.title", "greet", "unused"]);
    const exported = io();
    expect(await main(["export", "de"], exported.value)).toBe(0);
    expect(exported.lines[0]).toMatch(/^wrote 4 message\(s\) to .*de\.xlf$/);
    const missing = io();
    expect(await main(["import", "de"], missing.value)).toBe(1);
    expect(missing.errors[0]).toMatch(/import needs a locale and a file/);
    const merged = io();
    expect(await main(["import", "de", "de.xlf"], merged.value)).toBe(0);
    expect(merged.lines[0]).toMatch(/^merged 0 translation/);
  });

  it("handles help, version, a missing command and bad options", async () => {
    const help = io();
    expect(await main(["--help"], help.value)).toBe(0);
    expect(help.lines[0]).toMatch(/^shadow-i18n: /);
    const version = io();
    expect(await main(["-v"], version.value)).toBe(0);
    expect(version.lines).toEqual(["9.9.9"]);
    const none = io();
    expect(await main([], none.value)).toBe(1);
    const bad = io();
    expect(await main(["check", "--nope"], bad.value)).toBe(1);
    expect(bad.errors.join("\n")).toMatch(/Unknown option/);
    const badJson = io();
    expect(await main(["check", "--nope", "--json"], badJson.value)).toBe(1);
    expect(JSON.parse(badJson.lines.join("\n")).error.code).toBe("SHADOW_I18N_UNKNOWN_OPTION");
  });
});
