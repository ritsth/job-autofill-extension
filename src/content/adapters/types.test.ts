import { describe, it, expect } from 'vitest';
import { titleCaseSlug } from './types';

describe('titleCaseSlug — company-name fallback from URL segments', () => {
  it('replaces hyphens with spaces and title-cases each word', () => {
    expect(titleCaseSlug('acme-corp')).toBe('Acme Corp');
  });

  it('replaces underscores with spaces and title-cases each word', () => {
    expect(titleCaseSlug('acme_corp')).toBe('Acme Corp');
  });

  it('collapses consecutive separators to a single space', () => {
    expect(titleCaseSlug('acme--corp')).toBe('Acme Corp');
    expect(titleCaseSlug('acme-_corp')).toBe('Acme Corp');
  });

  it('strips leading and trailing separators via replace + trim', () => {
    // Separator replace turns edge dashes into spaces; .trim() removes them.
    expect(titleCaseSlug('-acme-')).toBe('Acme');
  });

  it('title-cases only the first letter of a single word — not smart-casing', () => {
    expect(titleCaseSlug('openai')).toBe('Openai');
  });

  it('leaves digits unchanged — \\b does not fire between letter and digit', () => {
    // Current behaviour behind Workday adapter reports like "Wd5"/"Impl" on
    // *.myworkday.com hosts. Tracked in #178; pin here, fix input separately.
    expect(titleCaseSlug('wd5')).toBe('Wd5');
  });

  it('returns an empty string for empty input without throwing', () => {
    expect(titleCaseSlug('')).toBe('');
  });
});
