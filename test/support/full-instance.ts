import { detection } from "../../src/detect";
import { formatting } from "../../src/format";
import type { BaseCatalog, CatalogLoader, I18n, I18nFeature } from "../../src/i18n-types";
import { persistence } from "../../src/persistence";
import { localeRouting } from "../../src/routing";
import type { Messages } from "../../src/types";
import { createI18nWithIcu, type IcuI18nOptions } from "../../src/with-icu";

/** Every opt-in feature, so a test exercises the instance the way an app that uses all of them does. */
export const ALL_FEATURES: readonly I18nFeature[] = [
  formatting,
  localeRouting,
  persistence,
  detection,
];

/** `createI18nWithIcu` with every feature installed (a test may still pass its own `features`). */
export function createI18n<
  const L extends string,
  const D extends L,
  const Mg extends Partial<Record<L, Messages>> = Record<never, never>,
  const Ld extends Partial<Record<L, CatalogLoader>> = Record<never, never>,
>(options: IcuI18nOptions<L, D, Mg, Ld>): I18n<L, BaseCatalog<Mg, Ld, D>> {
  return createI18nWithIcu({ features: ALL_FEATURES, ...options });
}
