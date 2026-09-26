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

  it('keeps a literal code fence inside a string value', () => {
    const raw = JSON.stringify({ a: 'Wrote ```json examples``` for the docs.' });
    expect(extractJsonObject(raw)).toBe(raw);
  });

  it('drops an outer fence without touching a fence inside a string value', () => {
    const inner = JSON.stringify({ a: 'see ```json here```' });
    expect(extractJsonObject('```json\n' + inner + '\n```')).toBe(inner);
  });

  it('drops a dangling closing fence from a truncated response', () => {
    expect(extractJsonObject('```json\n{"a":"unterminated\n```')).toBe('{"a":"unterminated');
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

  it('preserves a Markdown example quoted in a work description', () => {
    const description = 'Wrote ```json examples``` for the API documentation.';
    const raw = JSON.stringify({ work: [{ title: 'Engineer', description }] });
    expect(parseResumeJson(raw).work[0].description).toBe(description);
  });

  // The prompt shows the model a shape where every field is quoted, but nothing
  // enforces that — and a bare year is exactly what a model emits unquoted.
  // These used to be dropped silently, with no error and nothing on screen to
  // suggest the import had lost a field it genuinely found (#343).
  describe('fields the model returned as JSON numbers', () => {
    it('keeps a numeric graduationYear', () => {
      const raw = JSON.stringify({
        education: [{ school: 'MIT', degree: 'BS', graduationYear: 2024 }],
      });
      expect(parseResumeJson(raw).education[0].graduationYear).toBe('2024');
    });

    it('keeps numeric work start/end dates', () => {
      const raw = JSON.stringify({
        work: [{ title: 'Engineer', company: 'Acme', startDate: 2020, endDate: 2024 }],
      });
      const [job] = parseResumeJson(raw).work;
      expect(job.startDate).toBe('2020');
      expect(job.endDate).toBe('2024');
    });

    it('keeps a numeric personal field', () => {
      // Less likely than a year, but it runs through the same helper.
      const raw = JSON.stringify({ personal: { phone: 5550100 } });
      expect(parseResumeJson(raw).personal.phone).toBe('5550100');
    });

    it('keeps a numeric entry in the skills list', () => {
      const raw = JSON.stringify({ skills: ['TypeScript', 3, 'React'] });
      expect(parseResumeJson(raw).skills).toEqual(['TypeScript', '3', 'React']);
    });

    it('still drops values that are neither string nor number', () => {
      // A boolean or object in a text field is meaningless — only the numeric
      // case was a real loss, so the rest stay rejected.
      const raw = JSON.stringify({
        education: [{ school: 'MIT', degree: true, field: { name: 'CS' }, graduationYear: null }],
      });
      const [edu] = parseResumeJson(raw).education;
      expect(edu.degree).toBe('');
      expect(edu.field).toBe('');
      expect(edu.graduationYear).toBe('');
    });
  });
});
