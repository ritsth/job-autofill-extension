import { afterEach, describe, expect, it, vi } from 'vitest';
import { textOf, titleCaseSlug } from './types';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('textOf — visible text and image alternatives', () => {
  it('reads the alt text from an image with no text content', () => {
    vi.stubGlobal('document', {
      querySelector: vi.fn().mockReturnValue({
        textContent: '',
        getAttribute: (name: string) => (name === 'alt' ? '  Acme Corp  ' : null),
      }),
    });

    expect(textOf(['header img[alt]'])).toBe('Acme Corp');
  });

  it('keeps text content ahead of alt text', () => {
    vi.stubGlobal('document', {
      querySelector: vi.fn().mockReturnValue({
        textContent: '  Visible Company  ',
        getAttribute: (name: string) => (name === 'alt' ? 'Logo Company' : null),
      }),
    });

    expect(textOf(["[class*='company']"])).toBe('Visible Company');
  });

  it('falls through when both text and alt are blank', () => {
    vi.stubGlobal('document', {
      querySelector: vi.fn((selector: string) =>
        selector === 'img[alt]'
          ? { textContent: '', getAttribute: () => '   ' }
          : { textContent: 'Fallback Company', getAttribute: () => null },
      ),
    });

    expect(textOf(['img[alt]', '.company-name'])).toBe('Fallback Company');
  });
});

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
