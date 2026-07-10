import { describe, it, expect } from 'vitest';
import { resumeFilename } from './resume';

describe('resumeFilename', () => {
  it('handles the normal case with both company and role', () => {
    expect(resumeFilename('Acme Corp', 'Software Engineer')).toBe(
      'resume-acme-corp-software-engineer'
    );
  });

  it('collapses special characters to single hyphens and trims leading/trailing hyphens', () => {
    expect(resumeFilename('Acme & Corp!!', 'Software   Engineer')).toBe(
      'resume-acme-corp-software-engineer'
    );
    expect(resumeFilename('...Acme Corp...', '!!!Software Engineer!!!')).toBe(
      'resume-acme-corp-software-engineer'
    );
  });

  it('returns resume when both fields are empty', () => {
    expect(resumeFilename('', '')).toBe('resume');
  });

  it('handles only company provided', () => {
    expect(resumeFilename('Acme Corp', '')).toBe('resume-acme-corp');
  });

  it('handles only role provided', () => {
    expect(resumeFilename('', 'Software Engineer')).toBe('resume-software-engineer');
  });

  it('caps the slug at 60 characters', () => {
    const longCompany = 'a'.repeat(50);
    const longRole = 'b'.repeat(50);
    const result = resumeFilename(longCompany, longRole);

    // Prefix "resume-" is 7 chars.
    // The slug itself should be sliced at 60 chars.
    // Expected slug: 50 'a's + 1 hyphen + 9 'b's = 60 chars.
    expect(result).toHaveLength(67); // 7 + 60
    expect(result).toBe(`resume-${'a'.repeat(50)}-${'b'.repeat(9)}`);
  });

  it('does not leave a trailing hyphen when the slice boundary falls on the join separator', () => {
    // 59 'a's + '-' + 50 'b's = 110 chars; slice(0, 60) yields 'a'.repeat(59) + '-'.
    // The fix removes the trailing hyphen.
    expect(resumeFilename('a'.repeat(59), 'b'.repeat(50))).toBe(
      `resume-${'a'.repeat(59)}`
    );
  });
});
