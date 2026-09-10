import { describe, it, expect } from 'vitest';
import { parseLooseJson, extractJsonObject, parseResumeJson } from './resumeImport';

describe('parseLooseJson', () => {
  it('parses clean JSON', () => {
    expect(parseLooseJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips code fences', () => {
    expect(parseLooseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it.each(['', '```json\n', '```JSON\r\n', 'Here is the JSON:\n```json\n'])(
    'preserves code-fence text inside JSON values with wrapper %j',
    (prefix) => {
      const data = { description: 'Wrote ```json examples``` and ```JSON samples```.' };
      const raw = `${prefix}${JSON.stringify(data)}${prefix ? '\n```' : ''}`;
      expect(parseLooseJson(raw)).toEqual(data);
    },
  );

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

  it.each([
    ['```json\n{"a":1,"summary":"partial\n```', 'partial '],
    ['```json{"a":1,"summary":"partial```', 'partial'],
  ])('still repairs a truncated JSON object before a closing fence: %j', (raw, summary) => {
    expect(parseLooseJson(raw)).toEqual({ a: 1, summary });
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

  it('returns JSON string contents unchanged', () => {
    const raw = JSON.stringify({ description: 'Documented ```json {"ok": true} ``` examples.' });
    expect(extractJsonObject(raw)).toBe(raw);
  });
});

describe('parseResumeJson', () => {
  it('preserves literal code fences in work descriptions', () => {
    const description = 'Wrote ```json examples``` for the API documentation.';
    const parsed = parseResumeJson(JSON.stringify({ work: [{ title: 'Engineer', description }] }));
    expect(parsed.work[0].description).toBe(description);
  });

  it('maps a truncated resume response to partial data instead of throwing', () => {
    const raw =
      '{"personal":{"firstName":"Ada","lastName":"Lovelace","email":"ada@x.com"},' +
      '"work":[{"title":"Engineer","company":"Acme","startDate":"2020","endDate":"present","descrip';
    const parsed = parseResumeJson(raw);
    expect(parsed.personal.firstName).toBe('Ada');
    expect(parsed.work[0].company).toBe('Acme');
  });
});
