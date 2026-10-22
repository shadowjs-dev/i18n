import type { I18nRequestEvent } from "../../src/server";

export interface FakeEvent extends I18nRequestEvent {
  readonly sent: Array<{ name: string; value: string; options: object | undefined }>;
  readonly headers: Headers;
  readonly store: Map<object, unknown>;
}

/** A hand-built request event with the structural shape the middleware needs. */
export function fakeEvent(
  url: string,
  init: {
    headers?: Record<string, string>;
    cookies?: Record<string, string>;
    method?: string;
  } = {},
): FakeEvent {
  const request = new Request(url, { method: init.method ?? "GET", headers: init.headers ?? {} });
  const jar = new Map(Object.entries(init.cookies ?? {}));
  const sent: FakeEvent["sent"] = [];
  const store = new Map<object, unknown>();
  const headers = new Headers();
  return {
    request,
    url: new URL(url),
    cookies: {
      get: (name) => jar.get(name),
      set: (name, value, options) => {
        jar.set(name, value);
        sent.push({ name, value, options });
      },
    },
    responseHeaders: headers,
    document: { lang: "en", dir: undefined },
    set: (key, value) => void store.set(key, value),
    tryGet: <T>(key: object) => store.get(key) as T | undefined,
    sent,
    headers,
    store,
  };
}
