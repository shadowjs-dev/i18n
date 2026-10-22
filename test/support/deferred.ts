import type { Messages } from "../../src/types";

/** A promise the test settles by hand: no timers, no sleeps. */
export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

/** Makes a {@link Deferred}. */
export function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

/** A loader whose every call is a new {@link Deferred} the test settles; `calls` lists them in order. */
export interface GatedLoader {
  readonly load: () => Promise<Messages>;
  readonly calls: Array<Deferred<Messages>>;
}

/** Makes a {@link GatedLoader}. */
export function gatedLoader(): GatedLoader {
  const calls: Array<Deferred<Messages>> = [];
  return {
    calls,
    load: () => {
      const call = deferred<Messages>();
      calls.push(call);
      return call.promise;
    },
  };
}

/** Lets every already-settled promise reaction run (microtasks only, no timers). */
export async function drain(rounds = 8): Promise<void> {
  for (let round = 0; round < rounds; round += 1) await Promise.resolve();
}
