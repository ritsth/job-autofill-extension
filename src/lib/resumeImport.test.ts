import { describe, it, expect } from 'vitest';
import {
  applyImport,
  extractJsonObject,
  parseLooseJson,
  parseResumeJson,
  revertImport,
  type ParsedResume,
} from './resumeImport';
import { DEFAULT_PROFILE, type Profile } from './profile';

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

describe('applyImport / revertImport', () => {
  const parsed: ParsedResume = {
    personal: { firstName: 'Ada', email: 'ada@example.com' },
    work: [{ company: 'Acme', title: 'Engineer', startDate: '2022', endDate: '', description: '' }],
    education: [{ school: 'MIT', degree: 'BS', field: 'CS', graduationYear: '2024' }],
    skills: ['TypeScript'],
  };

  /** A profile carrying content in every section an import must NOT touch. */
  function populated(): Profile {
    return {
      ...structuredClone(DEFAULT_PROFILE),
      personal: { ...DEFAULT_PROFILE.personal, lastName: 'Lovelace', phone: '555-0100' },
      resumeText: 'my resume',
      documents: [{ id: 'd1', name: 'portfolio.pdf', text: 'portfolio text', addedAt: 1 }],
      baseCoverLetter: 'Dear {{company}},',
      preferences: { ...DEFAULT_PROFILE.preferences, salaryExpectation: '100000' },
      ai: { ...DEFAULT_PROFILE.ai, apiKey: 'secret-key' },
    };
  }

  describe('applyImport', () => {
    it('writes only the four imported sections', () => {
      const before = populated();
      const after = applyImport(before, parsed);

      expect(after.workHistory).toEqual(parsed.work);
      expect(after.education).toEqual(parsed.education);
      expect(after.skills).toEqual(parsed.skills);
      // Everything else is carried through untouched.
      expect(after.resumeText).toBe(before.resumeText);
      expect(after.documents).toEqual(before.documents);
      expect(after.baseCoverLetter).toBe(before.baseCoverLetter);
      expect(after.preferences).toEqual(before.preferences);
      expect(after.ai).toEqual(before.ai);
    });

    it('merges personal rather than replacing it', () => {
      const after = applyImport(populated(), parsed);

      expect(after.personal.firstName).toBe('Ada');   // from the parse
      expect(after.personal.lastName).toBe('Lovelace'); // existing, not in the parse
      expect(after.personal.phone).toBe('555-0100');
    });

    it('keeps existing sections the parse found nothing for', () => {
      const before = applyImport(populated(), parsed);
      const after = applyImport(before, { personal: {}, work: [], education: [], skills: [] });

      expect(after.workHistory).toEqual(before.workHistory);
      expect(after.education).toEqual(before.education);
      expect(after.skills).toEqual(before.skills);
    });
  });

  describe('revertImport', () => {
    it('puts the four imported sections back', () => {
      const snapshot = populated();
      const imported = applyImport(snapshot, parsed);

      const reverted = revertImport(imported, snapshot);

      expect(reverted.personal).toEqual(snapshot.personal);
      expect(reverted.workHistory).toEqual(snapshot.workHistory);
      expect(reverted.education).toEqual(snapshot.education);
      expect(reverted.skills).toEqual(snapshot.skills);
    });

    // The bug this exists for: undo used to replace the whole profile with the
    // snapshot, so anything edited between the import and the undo went with it
    // — and the button sits there for the whole session, so "between" can be a
    // long time (#352).
    it('keeps unrelated edits made after the import', () => {
      const snapshot = populated();
      const imported = applyImport(snapshot, parsed);

      // The user carries on working: uploads a document, pastes an API key,
      // rewrites the cover letter, sets a salary.
      const edited: Profile = {
        ...imported,
        documents: [
          ...imported.documents,
          { id: 'd2', name: 'transcript.pdf', text: 'transcript text', addedAt: 2 },
        ],
        ai: { ...imported.ai, apiKey: 'freshly-pasted-key' },
        baseCoverLetter: 'Rewritten letter',
        preferences: { ...imported.preferences, salaryExpectation: '125000' },
        resumeText: 'updated resume text',
      };

      const reverted = revertImport(edited, snapshot);

      expect(reverted.documents).toHaveLength(2);
      expect(reverted.documents.map((d) => d.name)).toContain('transcript.pdf');
      expect(reverted.ai.apiKey).toBe('freshly-pasted-key');
      expect(reverted.baseCoverLetter).toBe('Rewritten letter');
      expect(reverted.preferences.salaryExpectation).toBe('125000');
      expect(reverted.resumeText).toBe('updated resume text');
    });

    it('does not resurrect a stale value from the snapshot outside those sections', () => {
      // The snapshot's own apiKey must not come back over a newer one.
      const snapshot = populated();
      const edited: Profile = { ...snapshot, ai: { ...snapshot.ai, apiKey: 'newer-key' } };

      expect(revertImport(edited, snapshot).ai.apiKey).toBe('newer-key');
    });

    it('round-trips: apply then revert restores the imported sections exactly', () => {
      const snapshot = populated();

      const reverted = revertImport(applyImport(snapshot, parsed), snapshot);

      expect(reverted).toEqual(snapshot);
    });
  });
});
