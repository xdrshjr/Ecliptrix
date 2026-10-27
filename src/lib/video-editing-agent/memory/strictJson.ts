/**
 * strictJson.ts — JSON parsing that refuses what `JSON.parse` silently accepts.
 *
 * `JSON.parse` keeps the LAST of two equal keys, so a model could make a
 * summary say one thing to a reader of the raw text and another to the code.
 * The conversation digest is re-injected into every later turn; ambiguity in it
 * is rejected instead of resolved.
 *
 * Pure: no React, DOM or network access.
 */

export class StrictJsonError extends Error {
  constructor(message: string, readonly offset: number) {
    super(`${message} at offset ${offset}`);
    this.name = 'StrictJsonError';
  }
}

const WHITESPACE = /[ \t\r\n]/;
const LITERALS: Record<string, unknown> = { true: true, false: false, null: null };

class Cursor {
  offset = 0;
  constructor(readonly text: string) {}

  peek(): string {
    return this.text[this.offset] ?? '';
  }

  skipWhitespace(): void {
    while (WHITESPACE.test(this.peek())) this.offset += 1;
  }

  expect(character: string): void {
    if (this.peek() !== character) {
      throw new StrictJsonError(`expected "${character}"`, this.offset);
    }
    this.offset += 1;
  }

  fail(message: string): never {
    throw new StrictJsonError(message, this.offset);
  }
}

function readString(cursor: Cursor): string {
  const start = cursor.offset;
  cursor.expect('"');
  while (cursor.offset < cursor.text.length) {
    const character = cursor.text[cursor.offset];
    if (character === '\\') cursor.offset += 2;
    else if (character === '"') break;
    else cursor.offset += 1;
  }
  cursor.expect('"');
  // JSON.parse validates escapes and control characters inside the token.
  return JSON.parse(cursor.text.slice(start, cursor.offset)) as string;
}

function readScalar(cursor: Cursor): unknown {
  const match = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/
    .exec(cursor.text.slice(cursor.offset, cursor.offset + 40));
  if (!match) cursor.fail('unexpected token');
  cursor.offset += match[0].length;
  return match[0] in LITERALS ? LITERALS[match[0]] : Number(match[0]);
}

function readArray(cursor: Cursor): unknown[] {
  const items: unknown[] = [];
  cursor.expect('[');
  cursor.skipWhitespace();
  if (cursor.peek() === ']') {
    cursor.offset += 1;
    return items;
  }
  for (;;) {
    items.push(readValue(cursor));
    cursor.skipWhitespace();
    if (cursor.peek() === ']') break;
    cursor.expect(',');
  }
  cursor.offset += 1;
  return items;
}

function readObject(cursor: Cursor): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  cursor.expect('{');
  cursor.skipWhitespace();
  if (cursor.peek() === '}') {
    cursor.offset += 1;
    return result;
  }
  for (;;) {
    cursor.skipWhitespace();
    const key = readString(cursor);
    if (key in result) cursor.fail(`duplicate key "${key}"`);
    cursor.skipWhitespace();
    cursor.expect(':');
    result[key] = readValue(cursor);
    cursor.skipWhitespace();
    if (cursor.peek() === '}') break;
    cursor.expect(',');
  }
  cursor.offset += 1;
  return result;
}

function readValue(cursor: Cursor): unknown {
  cursor.skipWhitespace();
  const next = cursor.peek();
  if (next === '{') return readObject(cursor);
  if (next === '[') return readArray(cursor);
  if (next === '"') return readString(cursor);
  return readScalar(cursor);
}

/**
 * Parse `text` as exactly one JSON value, rejecting duplicate object keys at
 * any depth and any trailing characters.
 *
 * @throws StrictJsonError on malformed JSON, duplicate keys or trailing text.
 */
export function parseStrictJson(text: string): unknown {
  const cursor = new Cursor(text);
  const value = readValue(cursor);
  cursor.skipWhitespace();
  if (cursor.offset < text.length) cursor.fail('trailing characters');
  return value;
}

/** One surrounding Markdown code fence is the only wrapper models add; drop it. */
export function stripCodeFence(text: string): string {
  const match = /^\s*```[a-zA-Z]*\s*\n([\s\S]*?)\n\s*```\s*$/.exec(text);
  return match ? match[1] : text;
}
