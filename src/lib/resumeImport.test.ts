import { describe, it, expect } from 'vitest';
import { parseLooseJson, extractJsonObject, parseResumeJson } from './resumeImport';

describe('parseLooseJson', () => {
  it('parses clean JSON', () => {
    expect(parseLooseJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips code fences', () => {
    expect(parseLooseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('ignores prose before and after the object', () => {
    expect(parseLooseJson('Sure! Here is the JSON:\n{"a":1}\nHope that helps.')).toEqual({ a: 1 });
  });

  it('recovers from an unescaped newline inside a string value', () => {
    // Invalid strict JSON (raw newline in the string) — the classic model failure.
    const raw = '{"summary":"line one\nline two"}';
    expect(() => JSON.parse(raw)).toThrow();
    expect(parseLooseJson(raw)).toEqual({ summary: 'line one line two' });
  });

  it('repairs a truncated response (cut off mid-string)', () => {
    const raw = '{"work":[{"title":"Engineer","company":"Acme","description":"Did a lot of goo';
    const out = parseLooseJson(raw) as { work: { title: string; company: string }[] };
    expect(out.work[0].title).toBe('Engineer');
    expect(out.work[0].company).toBe('Acme');
  });

  it('repairs truncation cut at a dangling key', () => {
    const raw = '{"a":1,"b":2,"c":';
    expect(parseLooseJson(raw)).toEqual({ a: 1, b: 2 });
  });

  it('returns null when nothing is parseable', () => {
    expect(parseLooseJson('no json here at all')).toBeNull();
  });
});

describe('extractJsonObject', () => {
  it('returns the balanced object and drops trailing prose', () => {
    expect(extractJsonObject('{"a":{"b":1}} trailing junk }')).toBe('{"a":{"b":1}}');
  });

  it('does not stop at a brace inside a string', () => {
    expect(extractJsonObject('{"a":"has } brace"}')).toBe('{"a":"has } brace"}');
  });
});

describe('parseResumeJson', () => {
  it('maps a truncated resume response to partial data instead of throwing', () => {
    const raw =
      '{"personal":{"firstName":"Ada","lastName":"Lovelace","email":"ada@x.com"},' +
      '"work":[{"title":"Engineer","company":"Acme","startDate":"2020","endDate":"present","descrip';
    const parsed = parseResumeJson(raw);
    expect(parsed.personal.firstName).toBe('Ada');
    expect(parsed.work[0].company).toBe('Acme');
  });
});
