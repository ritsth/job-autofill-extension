import { describe, it, expect } from 'vitest';
import { letterFilename } from './coverLetter';

describe('letterFilename', () => {
  it('handles the normal case with both company and role', () => {
    expect(letterFilename('Acme Corp', 'Software Engineer')).toBe(
      'cover-letter-acme-corp-software-engineer'
    );
  });

  it('collapses special characters to single hyphens and trims leading/trailing hyphens', () => {
    expect(letterFilename('Acme & Corp!!', 'Software   Engineer')).toBe(
      'cover-letter-acme-corp-software-engineer'
    );
    expect(letterFilename('...Acme Corp...', '!!!Software Engineer!!!')).toBe(
      'cover-letter-acme-corp-software-engineer'
    );
  });

  it('returns cover-letter when both fields are empty', () => {
    expect(letterFilename('', '')).toBe('cover-letter');
  });

  it('handles only company provided', () => {
    expect(letterFilename('Acme Corp', '')).toBe('cover-letter-acme-corp');
  });

  it('handles only role provided', () => {
    expect(letterFilename('', 'Software Engineer')).toBe(
      'cover-letter-software-engineer'
    );
  });

  it('caps the slug at 60 characters', () => {
    const longCompany = 'a'.repeat(50);
    const longRole = 'b'.repeat(50);
    const result = letterFilename(longCompany, longRole);
    
    // Prefix "cover-letter-" is 13 chars.
    // The slug itself should be sliced at 60 chars.
    // Expected slug: 50 'a's + 1 hyphen + 9 'b's = 60 chars.
    expect(result).toHaveLength(73); // 13 + 60
    expect(result).toBe(`cover-letter-${'a'.repeat(50)}-${'b'.repeat(9)}`);
  });
});
