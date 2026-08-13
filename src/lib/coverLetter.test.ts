import { afterEach, describe, it, expect, vi } from 'vitest';
import { letterFilename, substitutePlaceholders } from './coverLetter';

describe('substitutePlaceholders', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('replaces company, role, and date', () => {
    expect(substitutePlaceholders('{{company}}', { company: 'Acme', role: '', date: '1' })).toBe(
      'Acme',
    );
    expect(substitutePlaceholders('{{role}}', { company: '', role: 'Engineer', date: '1' })).toBe(
      'Engineer',
    );
    expect(substitutePlaceholders('{{date}}', { company: '', role: '', date: 'May 1, 2026' })).toBe(
      'May 1, 2026',
    );
  });

  it('replaces all three placeholders in one template', () => {
    const result = substitutePlaceholders('Dear {{company}}, re: {{role}} ({{date}})', {
      company: 'Acme',
      role: 'Engineer',
      date: 'May 1, 2026',
    });
    expect(result).toBe('Dear Acme, re: Engineer (May 1, 2026)');
  });

  it('matches placeholder names case-insensitively', () => {
    const result = substitutePlaceholders('{{Company}} — {{ROLE}} — {{Date}}', {
      company: 'Acme',
      role: 'Engineer',
      date: 'May 1, 2026',
    });
    expect(result).toBe('Acme — Engineer — May 1, 2026');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(
      substitutePlaceholders('{{ company }}', { company: 'Acme', role: '', date: '1' }),
    ).toBe('Acme');
  });

  it('replaces every occurrence of a repeated placeholder', () => {
    const result = substitutePlaceholders('{{company}} and {{company}} again', {
      company: 'Acme',
      role: '',
      date: '1',
    });
    expect(result).toBe('Acme and Acme again');
  });

  it('leaves the placeholder visible when the value is empty, instead of a blank gap', () => {
    // Deliberate: a missing company/role should be obvious, not silently blank.
    // See the comment in substitutePlaceholders.
    expect(substitutePlaceholders('{{company}}', { company: '', role: '', date: '1' })).toBe(
      '{{company}}',
    );
    expect(substitutePlaceholders('{{role}}', { company: '', role: '', date: '1' })).toBe(
      '{{role}}',
    );
  });

  it('defaults the date to today, formatted, when none is given', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T12:00:00Z'));
    const result = substitutePlaceholders('{{date}}', { company: '', role: '' });
    // Loose assertion — toLocaleDateString output depends on the runner's
    // locale, so an exact string match would be flaky in CI.
    expect(result).toContain('2026');
  });

  it('leaves an unknown placeholder untouched', () => {
    expect(
      substitutePlaceholders('{{name}}', { company: 'Acme', role: 'Engineer', date: '1' }),
    ).toBe('{{name}}');
  });
});

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

  it('does not leave a trailing hyphen when the slice boundary falls on the join separator', () => {
    // 59 'a's + '-' + 50 'b's = 110 chars; slice(0, 60) yields 'a'.repeat(59) + '-'
    // The fix removes the trailing hyphen.
    expect(letterFilename('a'.repeat(59), 'b'.repeat(50))).toBe(
      `cover-letter-${'a'.repeat(59)}`
    );
  });
});
