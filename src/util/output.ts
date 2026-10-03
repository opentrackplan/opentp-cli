/** Lines written to stdout per console.log call by printLines */
const LINES_PER_WRITE = 1000;

/**
 * Prints lines to stdout like `console.log(lines.join("\n"))`, a chunk at a time, so that a very
 * large report is never built as one string. Prints nothing for no lines.
 */
export function printLines(lines: Iterable<string>): void {
  let chunk: string[] = [];
  for (const line of lines) {
    chunk.push(line);
    if (chunk.length >= LINES_PER_WRITE) {
      console.log(chunk.join("\n"));
      chunk = [];
    }
  }
  if (chunk.length > 0) console.log(chunk.join("\n"));
}

/** `JSON.stringify(value, null, 2)` indented by `indent` after the first line */
function indented(value: unknown, indent: string): string {
  const text = JSON.stringify(value, null, 2) ?? "null";
  return text.replaceAll("\n", `\n${indent}`);
}

/**
 * The lines of `JSON.stringify(document, null, 2)`, produced one at a time: each element of an
 * array value is serialized on its own, so that a document with very large arrays never becomes
 * one string. Joined with "\n" they equal the JSON.stringify text.
 */
export function* jsonLines(document: Record<string, unknown>): Generator<string> {
  const entries = Object.entries(document).filter(
    ([, value]) => value !== undefined && typeof value !== "function" && typeof value !== "symbol",
  );
  if (entries.length === 0) {
    yield "{}";
    return;
  }
  yield "{";
  for (let index = 0; index < entries.length; index += 1) {
    const [key, value] = entries[index];
    const comma = index < entries.length - 1 ? "," : "";
    const name = JSON.stringify(key);
    if (Array.isArray(value) && value.length > 0) {
      yield `  ${name}: [`;
      for (let item = 0; item < value.length; item += 1) {
        yield `    ${indented(value[item], "    ")}${item < value.length - 1 ? "," : ""}`;
      }
      yield `  ]${comma}`;
    } else {
      yield `  ${name}: ${indented(value, "  ")}${comma}`;
    }
  }
  yield "}";
}
