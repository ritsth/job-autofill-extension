import { describe, it, expect } from 'vitest';
import { hostMatches } from './host';

describe('hostMatches', () => {
  it('matches the exact domain', () => {
    expect(hostMatches('linkedin.com', 'linkedin.com')).toBe(true);
  });

  it('matches a real subdomain', () => {
    expect(hostMatches('www.linkedin.com', 'linkedin.com')).toBe(true);
    expect(hostMatches('jobs.lever.co', 'lever.co')).toBe(true);
  });

  it('rejects a look-alike host that merely ends with the domain string', () => {
    // The bug this guards against: "evillinkedin.com".endsWith("linkedin.com") is
    // true, so a naive .endsWith() check would wrongly treat this as LinkedIn.
    expect(hostMatches('evillinkedin.com', 'linkedin.com')).toBe(false);
    expect(hostMatches('notmyworkday.com', 'myworkday.com')).toBe(false);
  });

  it('rejects an unrelated host', () => {
    expect(hostMatches('example.com', 'linkedin.com')).toBe(false);
  });
});
