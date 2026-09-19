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

// The slug rules themselves (special characters, the 60-char cap, trimming)
// are covered once in filename.test.ts — what matters here is only that this
// caller passes the right prefix through to documentFilename (#327).
describe('letterFilename', () => {
  it('prefixes the company/role slug with "cover-letter"', () => {
    expect(letterFilename('Acme Corp', 'Software Engineer')).toBe(
      'cover-letter-acme-corp-software-engineer'
    );
  });

  it('is the bare prefix when there is no company or role', () => {
    expect(letterFilename('', '')).toBe('cover-letter');
  });
});
