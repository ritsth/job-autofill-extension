import { describe, it, expect } from 'vitest';
import { ashbyAdapter, parseAshbyJobPostingLd, parseAshbyTitle } from './ashby';

// Trimmed from the real payload served at
// jobs.ashbyhq.com/ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245/application
// (note the leading space Ashby puts in `title`).
const JOB_ID = '34413f8d-26bf-4bbc-8ade-eb309a0e2245';
const REAL_LD = JSON.stringify({
  '@context': 'https://schema.org/',
  '@type': 'JobPosting',
  title: ' Security Engineer, Cloud',
  identifier: { '@type': 'PropertyValue', name: 'Ramp', value: JOB_ID },
  hiringOrganization: { '@type': 'Organization', name: 'Ramp' },
});

describe('parseAshbyTitle — role/company from an Ashby page title', () => {
  it('splits a real posting title on " @ "', () => {
    expect(parseAshbyTitle('Fullstack Engineer, Product Team (New Grad) @ Composio')).toEqual({
      role: 'Fullstack Engineer, Product Team (New Grad)',
      company: 'Composio',
    });
  });

  it('returns nothing for a board index title', () => {
    // Board pages are titled "{Company} Jobs" with no " @ ". Returning empty
    // here is what stops "Composio Jobs" being reported as a role.
    expect(parseAshbyTitle('Composio Jobs')).toEqual({ role: '', company: '' });
    expect(parseAshbyTitle('Ramp Jobs')).toEqual({ role: '', company: '' });
  });

  it('returns nothing for an empty or whitespace-only title', () => {
    expect(parseAshbyTitle('')).toEqual({ role: '', company: '' });
    expect(parseAshbyTitle('   \n\t ')).toEqual({ role: '', company: '' });
  });

  it('splits on the last " @ " when the role itself contains one', () => {
    // The company is always the trailing segment, so the first group is greedy.
    expect(parseAshbyTitle('Engineer @ Growth @ Acme')).toEqual({
      role: 'Engineer @ Growth',
      company: 'Acme',
    });
  });

  it('trims the leading space Ashby actually serves in its title', () => {
    // Verified live: <title> is " Security Engineer, Cloud @ Ramp".
    expect(parseAshbyTitle(' Security Engineer, Cloud @ Ramp')).toEqual({
      role: 'Security Engineer, Cloud',
      company: 'Ramp',
    });
  });

  it('requires spaces around the separator, so an email-like title is not split', () => {
    expect(parseAshbyTitle('Engineer@Acme')).toEqual({ role: '', company: '' });
  });

  it('trims surrounding whitespace from both halves', () => {
    expect(parseAshbyTitle('  Software Engineer  @  Acme Corp  ')).toEqual({
      role: 'Software Engineer',
      company: 'Acme Corp',
    });
  });

  it('returns nothing when there is no role before the separator', () => {
    expect(parseAshbyTitle('@ Acme')).toEqual({ role: '', company: '' });
  });
});

describe('parseAshbyJobPostingLd — role/company from the server-rendered JSON-LD', () => {
  it('reads role and company from a real posting payload, trimming the padded title', () => {
    expect(parseAshbyJobPostingLd(REAL_LD, JOB_ID)).toEqual({
      role: 'Security Engineer, Cloud',
      company: 'Ramp',
    });
  });

  it('declines when identifier.value is a different job than the URL', () => {
    // Guards a <head> left stale by a client-side navigation between postings:
    // better to fall through to the title than report the previous job.
    expect(parseAshbyJobPostingLd(REAL_LD, 'some-other-job-id')).toBeNull();
  });

  it('skips the id check when the URL has no job segment', () => {
    expect(parseAshbyJobPostingLd(REAL_LD, '')).toEqual({
      role: 'Security Engineer, Cloud',
      company: 'Ramp',
    });
  });

  it('declines a non-JobPosting node even when it carries usable-looking fields', () => {
    // Deliberately populated so ONLY the @type check can reject it — a payload
    // with no title/company would be declined by the later guard regardless,
    // which would let a dropped @type check pass unnoticed.
    const org = JSON.stringify({
      '@type': 'Organization',
      title: ' Security Engineer, Cloud',
      identifier: { name: 'Ramp', value: JOB_ID },
      hiringOrganization: { name: 'Ramp' },
    });
    expect(parseAshbyJobPostingLd(org, JOB_ID)).toBeNull();
  });

  it('declines malformed JSON without throwing', () => {
    expect(parseAshbyJobPostingLd('{not json', JOB_ID)).toBeNull();
    expect(parseAshbyJobPostingLd('', JOB_ID)).toBeNull();
  });

  it('falls back to identifier.name when hiringOrganization is missing', () => {
    const partial = JSON.stringify({
      '@type': 'JobPosting',
      title: 'Security Engineer',
      identifier: { name: 'Ramp', value: JOB_ID },
    });
    expect(parseAshbyJobPostingLd(partial, JOB_ID)).toEqual({
      role: 'Security Engineer',
      company: 'Ramp',
    });
  });

  it('declines when it has neither a role nor a company to offer', () => {
    const empty = JSON.stringify({ '@type': 'JobPosting', identifier: { value: JOB_ID } });
    expect(parseAshbyJobPostingLd(empty, JOB_ID)).toBeNull();
  });
});

describe('ashbyAdapter.matches', () => {
  const matches = (href: string): boolean => ashbyAdapter.matches(new URL(href));

  it('matches an Ashby application form and board page', () => {
    expect(
      matches('https://jobs.ashbyhq.com/composio/01e0e7ad-44a2-44e8-9340-64ca70eff491/application'),
    ).toBe(true);
    expect(matches('https://jobs.ashbyhq.com/composio')).toBe(true);
  });

  it('ignores query strings such as the ?embed=true form', () => {
    expect(matches('https://jobs.ashbyhq.com/composio/abc/application?embed=true')).toBe(true);
  });

  it('does not match app.ashbyhq.com, which is the recruiter-facing product', () => {
    // Autofill must never activate inside Ashby's own ATS admin app — this is
    // why matches() is an exact host check rather than hostMatches().
    expect(matches('https://app.ashbyhq.com/jobs/some-internal-view')).toBe(false);
  });

  it('does not match a lookalike host or another board', () => {
    expect(matches('https://notjobs.ashbyhq.com/acme')).toBe(false);
    expect(matches('https://jobs.ashbyhq.com.evil.test/acme')).toBe(false);
    expect(matches('https://jobs.lever.co/acme/123')).toBe(false);
  });
});
