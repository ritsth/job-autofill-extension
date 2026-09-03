import { describe, it, expect } from 'vitest';
import { leverAdapter } from './lever';

describe('leverAdapter.matches', () => {
  const matches = (href: string): boolean => leverAdapter.matches(new URL(href));

  it('matches the Lever job board', () => {
    expect(matches('https://jobs.lever.co/acme/123')).toBe(true);
  });

  it('does not match Lever-adjacent or lookalike hosts', () => {
    expect(matches('https://lever.co/acme/123')).toBe(false);
    expect(matches('https://jobs.lever.co.evil.test/acme/123')).toBe(false);
  });
});
