import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadProduction, messageOf } from "./support/production-build";

type StateModule = typeof import("../src/state");
type CatalogModule = typeof import("../src/catalog");

const MESSAGE = /^\[shadow-i18n [A-Z_]+\] I18N_[A-Z]+(?:_\d+)?$/;

describe("production error codes of the hydration state and the catalogs", () => {
  it("[ERR-CODES-2] every refusal of a state carries an I18N_ code, and different refusals carry different codes", async () => {
    const state = await loadProduction<StateModule>(join(import.meta.dirname, "../src/state.ts"));
    const snapshot = (messages: unknown): string =>
      JSON.stringify({ v: 1, locale: "en", messages });
    const messages = {
      size: messageOf(() => state.parseI18nState("x".repeat(state.STATE_MAX_LENGTH + 1))),
      json: messageOf(() => state.parseI18nState("{")),
      shape: messageOf(() => state.parseI18nState("1")),
      version: messageOf(() => state.parseI18nState('{"v":2,"locale":"en","messages":{}}')),
      catalog: messageOf(() => state.parseI18nState(snapshot({ en: 1 }))),
      text: messageOf(() => state.parseI18nState(snapshot({ en: { title: 1 } }))),
      id: messageOf(() =>
        state.renderI18nStateScript({ v: 1, locale: "en", messages: {} }, { id: "a b" }),
      ),
      nonce: messageOf(() =>
        state.renderI18nStateScript({ v: 1, locale: "en", messages: {} }, { nonce: '"' }),
      ),
    };
    for (const [name, message] of Object.entries(messages)) {
      expect(message, name).toMatch(MESSAGE);
    }
    expect(new Set(Object.values(messages)).size).toBe(Object.keys(messages).length);
  });

  it("[ERR-CODES-3] every refusal of a catalog carries an I18N_ code, and different refusals carry different codes", async () => {
    const catalog = await loadProduction<CatalogModule>(
      join(import.meta.dirname, "../src/catalog.ts"),
    );
    const messages = {
      root: messageOf(() => catalog.flattenCatalog("text")),
      value: messageOf(() => catalog.flattenCatalog({ a: 1 })),
      key: messageOf(() => catalog.flattenCatalog({ a: { "": "x" } })),
      accessor: messageOf(() =>
        catalog.flattenCatalog(
          Object.defineProperty({}, "a", { enumerable: true, get: () => "x" }),
        ),
      ),
      depth: messageOf(() => {
        let nested: unknown = "leaf";
        for (let i = 0; i < 200; i++) nested = { k: nested };
        return catalog.flattenCatalog(nested);
      }),
    };
    for (const [name, message] of Object.entries(messages)) {
      expect(message, name).toMatch(MESSAGE);
    }
    expect(new Set(Object.values(messages)).size).toBe(Object.keys(messages).length);
  });
});
