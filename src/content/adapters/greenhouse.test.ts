import { describe, it, expect } from 'vitest';
import { greenhouseAdapter } from './greenhouse';

describe('greenhouseAdapter.matches', () => {
  const matches = (href: string): boolean => greenhouseAdapter.matches(new URL(href));

  it('matches classic and newer Greenhouse job boards', () => {
    expect(matches('https://boards.greenhouse.io/acme/jobs/123')).toBe(true);
    expect(matches('https://job-boards.greenhouse.io/acme/jobs/123')).toBe(true);
  });

  it('matches other Greenhouse subdomains', () => {
    expect(matches('https://custom.greenhouse.io/acme/jobs/123')).toBe(true);
  });

  it('does not match unrelated or lookalike hosts', () => {
    expect(matches('https://jobs.lever.co/acme/123')).toBe(false);
    expect(matches('https://greenhouse.io.evil.test/acme/jobs/123')).toBe(false);
  });
});
