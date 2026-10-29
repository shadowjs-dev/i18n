/**
 * XLIFF 1.2 for the hand-off to translators: the messages of the default locale with the translations a locale already has,
 * and the way back. The messages are ICU strings and stay as written; the translator sees the source and fills the target. A
 * returned target that takes other arguments or tags than its source is refused (the same rule `validateCatalogs` applies).
 */

/** One message of an exchange file. */
export interface TransUnit {
  readonly key: string;
  readonly source: string;
  readonly target?: string | undefined;
}

const XML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/** Escapes a text for XML content and attribute values. */
export function escapeXml(text: string): string {
  let out = "";
  for (const character of text) out += XML_ESCAPES[character] ?? character;
  return out;
}

/** Reads the five XML entities and numeric references; any other `&...;` is kept as written. */
export function unescapeXml(text: string): string {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const character = text.charAt(index);
    if (character !== "&") {
      out += character;
      index += 1;
      continue;
    }
    const end = text.indexOf(";", index);
    const entity = end === -1 || end - index > 12 ? "" : text.slice(index + 1, end);
    let replacement: string | undefined;
    if (entity === "amp") replacement = "&";
    else if (entity === "lt") replacement = "<";
    else if (entity === "gt") replacement = ">";
    else if (entity === "quot") replacement = '"';
    else if (entity === "apos") replacement = "'";
    else if (entity.startsWith("#x") || entity.startsWith("#")) {
      const code = entity.startsWith("#x")
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
      if (
        Number.isInteger(code) &&
        code >= 0 &&
        code <= 0x10ffff &&
        !(code >= 0xd800 && code <= 0xdfff)
      ) {
        replacement = String.fromCodePoint(code);
      }
    }
    if (replacement === undefined) {
      out += character;
      index += 1;
    } else {
      out += replacement;
      index = end + 1;
    }
  }
  return out;
}

/**
 * Writes an XLIFF 1.2 document.
 *
 * @param units The messages, in the order to write them.
 * @param source The language of the sources (`en`).
 * @param target The language of the targets (`fr`).
 * @returns The document, ending in a newline.
 */
export function writeXliff(units: readonly TransUnit[], source: string, target: string): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">',
    `  <file original="messages" datatype="plaintext" source-language="${escapeXml(source)}" target-language="${escapeXml(target)}">`,
    "    <body>",
  ];
  for (const unit of units) {
    lines.push(`      <trans-unit id="${escapeXml(unit.key)}">`);
    lines.push(`        <source>${escapeXml(unit.source)}</source>`);
    if (unit.target !== undefined) {
      lines.push(`        <target state="translated">${escapeXml(unit.target)}</target>`);
    } else {
      lines.push('        <target state="new"></target>');
    }
    lines.push("      </trans-unit>");
  }
  lines.push("    </body>", "  </file>", "</xliff>", "");
  return lines.join("\n");
}

/** Where the start tag that begins at `open` ends: the first `>` outside a quoted attribute value, or -1. */
function tagEnd(xml: string, open: number): number {
  let quote = "";
  for (let index = open; index < xml.length; index += 1) {
    const character = xml.charAt(index);
    if (quote !== "") {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") quote = character;
    else if (character === ">") return index;
  }
  return -1;
}

/** The text between `<name ...>` and `</name>` starting at `from`, and where the element ended. */
function elementAt(
  xml: string,
  name: string,
  from: number,
): { text: string; attributes: string; end: number } | undefined {
  // A loop, not a recursive retry: a file that repeats `<sourcex` has as many misses as it likes.
  let open = xml.indexOf(`<${name}`, from);
  for (;;) {
    if (open === -1) return undefined;
    const afterName = xml.charAt(open + name.length + 1);
    if (
      afterName === ">" ||
      afterName === " " ||
      afterName === "\n" ||
      afterName === "\t" ||
      afterName === "/"
    ) {
      break;
    }
    open = xml.indexOf(`<${name}`, open + 1);
  }
  const close = tagEnd(xml, open);
  if (close === -1) return undefined;
  const attributes = xml.slice(open + name.length + 1, close);
  if (attributes.endsWith("/"))
    return { text: "", attributes: attributes.slice(0, -1), end: close + 1 };
  const end = xml.indexOf(`</${name}>`, close);
  if (end === -1) return undefined;
  return { text: xml.slice(close + 1, end), attributes, end: end + name.length + 3 };
}

/** The value of one attribute in the text of a start tag. */
function attributeOf(attributes: string, name: string): string | undefined {
  for (const quote of ['"', "'"]) {
    const marker = `${name}=${quote}`;
    const start = attributes.indexOf(marker);
    if (start === -1) continue;
    const before = attributes.charAt(start - 1);
    if (start > 0 && before !== " " && before !== "\n" && before !== "\t") continue;
    const end = attributes.indexOf(quote, start + marker.length);
    if (end !== -1) return unescapeXml(attributes.slice(start + marker.length, end));
  }
  return undefined;
}

/** What {@link readXliff} found. */
export interface ReadXliff {
  readonly source: string | undefined;
  readonly target: string | undefined;
  readonly units: readonly TransUnit[];
}

/**
 * Reads the units of an XLIFF 1.2 document. A unit without an `id` or a `source` is skipped; an empty target is no target.
 *
 * @param xml The document.
 * @returns The languages the file names and its units.
 * @throws SyntaxError when the text holds no `<xliff>` element.
 */
export function readXliff(xml: string): ReadXliff {
  const root = elementAt(xml, "xliff", 0);
  if (root === undefined)
    throw new SyntaxError("the file is not an XLIFF document: it has no <xliff> element.");
  const file = elementAt(root.text, "file", 0);
  const fileAttributes = file?.attributes ?? "";
  const units: TransUnit[] = [];
  let cursor = 0;
  const body = file?.text ?? root.text;
  for (;;) {
    const unit = elementAt(body, "trans-unit", cursor);
    if (unit === undefined) break;
    cursor = unit.end;
    const id = attributeOf(unit.attributes, "id");
    const source = elementAt(unit.text, "source", 0);
    if (id === undefined || id === "" || source === undefined) continue;
    const target = elementAt(unit.text, "target", 0);
    const written = target === undefined ? "" : unescapeXml(target.text);
    units.push({
      key: id,
      source: unescapeXml(source.text),
      ...(written === "" ? {} : { target: written }),
    });
  }
  return {
    source: attributeOf(fileAttributes, "source-language"),
    target: attributeOf(fileAttributes, "target-language"),
    units,
  };
}
