/**
 * `@shadow-js/i18n/icu`: the ICU MessageFormat parser, printer and formatter, the message compiler,
 * and the catalog tooling that reads messages as ICU (validation, signatures, pseudo-localization).
 * The root entry does not load any of it; `createI18nWithIcu` does, through `icuCompiler`.
 * @packageDocumentation
 */

export type { FormatContext, Formats, TagHandler } from "../values";
export type {
  ArgumentNode,
  DateTimeNode,
  MessageCase,
  MessageNode,
  NumberNode,
  PluralNode,
  PoundNode,
  SelectNode,
  TagNode,
  TextNode,
} from "./ast";
export { icuCompile, icuCompiler } from "./compile";
export type { DateSkeleton } from "./date-skeleton";
export { parseDateSkeleton } from "./date-skeleton";
export type { FormatOptions } from "./format";
export { formatToParts, formatToString } from "./format";
export type { NumberSkeleton } from "./number-skeleton";
export { parseNumberSkeleton } from "./number-skeleton";
export type { ParseOptions } from "./parse";
export { PARSE_LIMITS, parseMessage } from "./parse";
export type { PrintOptions } from "./print";
export { printMessage } from "./print";
export type { PseudoOptions } from "./pseudo";
export { pseudoLocalize } from "./pseudo";
export type {
  ArgumentClass,
  CatalogIssue,
  CatalogValidation,
  MessageSignature,
  ValidateOptions,
} from "./validate";
export { messageSignature, validateCatalogs } from "./validate";
