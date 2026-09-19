import { describe, it, expect } from 'vitest';
import { documentFilename } from './filename';

// The slug rules used to be written out twice — once in letterFilename, once in
// resumeFilename — with both test files asserting them separately against their
// own prefix (#327). They live here now, exercised through a neutral prefix, so
// resume.test.ts / coverLetter.test.ts only have to pin that each wires up the
// right prefix.
describe('documentFilename', () => {
  it('joins the prefix, company and role with hyphens', () => {
    expect(documentFilename('doc', 'Acme Corp', 'Software Engineer')).toBe(
      'doc-acme-corp-software-engineer',
    );
  });

  it('collapses special characters to single hyphens and trims leading/trailing hyphens', () => {
    expect(documentFilename('doc', 'Acme & Corp!!', 'Software   Engineer')).toBe(
      'doc-acme-corp-software-engineer',
    );
    expect(documentFilename('doc', '...Acme Corp...', '!!!Software Engineer!!!')).toBe(
      'doc-acme-corp-software-engineer',
    );
  });

  it('returns the bare prefix when both fields are empty', () => {
    expect(documentFilename('doc', '', '')).toBe('doc');
  });

  it('omits the missing half when only one field is provided', () => {
    expect(documentFilename('doc', 'Acme Corp', '')).toBe('doc-acme-corp');
    expect(documentFilename('doc', '', 'Software Engineer')).toBe('doc-software-engineer');
  });

  it('caps the slug at 60 characters, not counting the prefix', () => {
    const result = documentFilename('doc', 'a'.repeat(50), 'b'.repeat(50));

    // Slug: 50 'a's + 1 hyphen + 9 'b's = 60. Prefix "doc-" is 4 more.
    expect(result).toBe(`doc-${'a'.repeat(50)}-${'b'.repeat(9)}`);
    expect(result).toHaveLength(64);
  });

  it('caps the slug independently of how long the prefix is', () => {
    // The whole point of capping the slug rather than the finished name: the
    // longer "cover-letter" prefix must not cost the company/role any
    // characters relative to the shorter "resume" one.
    const long = documentFilename('cover-letter', 'a'.repeat(50), 'b'.repeat(50));
    const short = documentFilename('resume', 'a'.repeat(50), 'b'.repeat(50));

    expect(long.slice('cover-letter-'.length)).toBe(short.slice('resume-'.length));
  });

  it('does not leave a trailing hyphen when the cap falls on the join separator', () => {
    // 59 'a's + '-' + 50 'b's = 110 chars; slice(0, 60) yields 'a'.repeat(59) + '-',
    // a hyphen the earlier trim ran too soon to see.
    expect(documentFilename('doc', 'a'.repeat(59), 'b'.repeat(50))).toBe(`doc-${'a'.repeat(59)}`);
  });
});
