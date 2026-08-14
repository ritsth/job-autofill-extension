import { describe, it, expect } from 'vitest';
import { ashbyAdapter, parseAshbyTitle } from './ashby';

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
