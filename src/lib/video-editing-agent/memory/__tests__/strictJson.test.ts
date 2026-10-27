import { describe, expect, it } from 'vitest';
import { StrictJsonError, parseStrictJson, stripCodeFence } from '../strictJson';

describe('parseStrictJson', () => {
  it('parses what JSON.parse parses', () => {
    const text = '{"a":[1,2.5,-3e2,true,false,null],"b":{"c":"x\\ny中"},"d":""}';
    expect(parseStrictJson(text)).toEqual(JSON.parse(text));
  });

  it('rejects a duplicate key at the top level and in nested objects', () => {
    expect(() => parseStrictJson('{"goal":"a","goal":"b"}')).toThrow(StrictJsonError);
    expect(() => parseStrictJson('{"x":[{"id":"1","id":"2"}]}')).toThrow(/duplicate key "id"/);
  });

  it('accepts the same key in sibling objects', () => {
    expect(parseStrictJson('[{"id":"1"},{"id":"2"}]')).toEqual([{ id: '1' }, { id: '2' }]);
  });

  it.each([
    ['trailing text', '{"a":1} x'],
    ['unterminated object', '{"a":1'],
    ['bare word', '{"a":nope}'],
    ['single quotes', "{'a':1}"],
    ['empty input', ''],
    ['trailing comma', '[1,2,]'],
  ])('rejects %s', (_label, text) => {
    expect(() => parseStrictJson(text)).toThrow(StrictJsonError);
  });

  it('treats __proto__ as an ordinary key', () => {
    const parsed = parseStrictJson('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(parsed)).toEqual(['__proto__']);
  });
});

describe('stripCodeFence', () => {
  it('unwraps one fenced block and leaves bare text alone', () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripCodeFence('{"a":1}')).toBe('{"a":1}');
  });
});
