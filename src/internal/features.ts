/**
 * The feature slots of an instance: what each opt-in feature plugs into the core, how the
 * `features` option is read, and the `TypeError` a missing feature raises.
 * @packageDocumentation
 */
import type { Accessor } from "@shadow-js/core";
import type { I18nError } from "../errors";
import type { DetectConfig, I18nFeature, I18nFeatureName, PersistSpec } from "../i18n-types";
import type { LocaleRouting, LocaleRoutingOptions } from "../routing";
import type { Formatters } from "./formatters";
import type { Shared } from "./shared";

/**
 * The persist strategies the `persist` option names, as the persistence feature resolved them.
 * @internal
 */
export interface ResolvedPersistence {
  /** Reads the first value a strategy remembers; a strategy that throws is reported and skipped. */
  read(): string | undefined;
  /** Writes the locale with every strategy; a strategy that throws is reported, the others still run. */
  write(locale: string): void;
  /** The cookie name of the cookie strategy, when there is one (detection reads that cookie). */
  readonly cookieName: string | undefined;
}

/**
 * What the detection feature is given when the instance that `createI18n` returns is created in
 * the browser.
 * @internal
 */
export interface DetectionRequest<L extends string> {
  /** The `detect` option, `true` already turned into `{}`. */
  readonly config: DetectConfig;
  /** The supported locales. */
  readonly locales: readonly L[];
  /** The instance's URL scheme, when the routing feature is installed. */
  readonly routing: LocaleRouting<L> | undefined;
  /** The persistence of the instance, when the `persist` option names strategies. */
  readonly persistence: ResolvedPersistence | undefined;
}

/**
 * The function each feature plugs into the core, by feature name.
 * @internal
 */
export interface FeaturePlugs {
  /** Builds the `format*` methods of one instance (the one `createI18n` returns, and each fork). */
  readonly formatting: <L extends string>(shared: Shared<L>, locale: Accessor<L>) => Formatters<L>;
  /** Builds the URL helpers shared by the instance and its forks. */
  readonly routing: <L extends string>(options: LocaleRoutingOptions<L>) => LocaleRouting<L>;
  /** Resolves the `persist` option, once, for the instance `createI18n` returns in the browser. */
  readonly persistence: (
    persist: PersistSpec | readonly PersistSpec[],
    report: (error: I18nError) => void,
  ) => ResolvedPersistence;
  /** Chooses the initial locale, once, for the instance `createI18n` returns in the browser. */
  readonly detection: <L extends string>(request: DetectionRequest<L>) => L | undefined;
}

/**
 * The features an instance was created with, by name.
 * @internal
 */
export type Plugs = { readonly [N in I18nFeatureName]?: FeaturePlugs[N] };

/** Where each feature is exported: its export name and the subpath of `@shadow-js/i18n`. */
const WHERE: Readonly<Record<I18nFeatureName, readonly [string, string]>> = Object.freeze({
  formatting: ["formatting", "format"],
  routing: ["localeRouting", "routing"],
  persistence: ["persistence", "persistence"],
  detection: ["detection", "detect"],
});

/**
 * The error of a call or option that needs a feature the instance was created without. It names
 * the feature, where to import it from and the preset that has every feature.
 * @internal
 */
export function featureMissing(name: I18nFeatureName, what: string): TypeError {
  const [exported, subpath] = WHERE[name];
  return new TypeError(
    __DEV__
      ? `[shadow-i18n] ${what} needs the ${exported} feature: import { ${exported} } from "@shadow-js/i18n/${subpath}" and pass createI18n({ features: [${exported}] }), or use createI18nFull from "@shadow-js/i18n/full".`
      : `I18N_FEATURE_2 ${exported}`,
  );
}

/** Stores one feature's plug under its name; generic so the name and the plug stay paired. */
function slot<N extends I18nFeatureName>(
  plugs: { -readonly [K in I18nFeatureName]?: FeaturePlugs[K] },
  feature: I18nFeature<N>,
): void {
  plugs[feature.name] = feature.plug;
}

/**
 * Reads the `features` option into plugs by name. A feature listed twice (the same object) counts
 * once; anything that is not one of the package's features throws.
 * @internal
 */
export function collectFeatures(features: unknown): Plugs {
  const plugs: { -readonly [K in I18nFeatureName]?: FeaturePlugs[K] } = {};
  if (features === undefined) return plugs;
  if (!Array.isArray(features)) {
    throw new TypeError(
      __DEV__
        ? "[shadow-i18n] the features option must be an array of features (for example [formatting])."
        : "I18N_FEATURES",
    );
  }
  const seen = new Map<string, unknown>();
  features.forEach((feature: unknown, index) => {
    const name: unknown =
      typeof feature === "object" && feature !== null ? Reflect.get(feature, "name") : undefined;
    if (
      typeof name !== "string" ||
      !Object.hasOwn(WHERE, name) ||
      typeof Reflect.get(feature as object, "plug") !== "function"
    ) {
      throw new TypeError(
        __DEV__
          ? `[shadow-i18n] features[${index}] is not an i18n feature: pass formatting, localeRouting, persistence or detection from their @shadow-js/i18n subpaths.`
          : "I18N_FEATURE_1",
      );
    }
    const known = seen.get(name);
    if (known === feature) return;
    if (known !== undefined) {
      throw new TypeError(
        __DEV__ ? `[shadow-i18n] two different "${name}" features were passed.` : "I18N_FEATURE_3",
      );
    }
    seen.set(name, feature);
    slot(plugs, feature as I18nFeature);
  });
  return plugs;
}
