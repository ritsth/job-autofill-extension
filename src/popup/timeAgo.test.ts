import { afterEach, describe, expect, it, vi } from 'vitest';
import { timeAgo } from './Popup';

// timeAgo is relative to Date.now(), so pin a fixed "now" and express each case
// as an offset back from it.
const NOW = new Date('2026-07-20T12:00:00Z').getTime();
const secondsAgo = (s: number): number => NOW - s * 1000;

describe('timeAgo', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function at(now: number): void {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  }

  it('reports "just now" under a minute', () => {
    at(NOW);
    expect(timeAgo(secondsAgo(0))).toBe('just now');
    expect(timeAgo(secondsAgo(59))).toBe('just now');
  });

  it('reports minutes between 1 and 59', () => {
    at(NOW);
    expect(timeAgo(secondsAgo(60))).toBe('1 min ago');
    expect(timeAgo(secondsAgo(45 * 60))).toBe('45 min ago');
  });

  it('reports hours between 1 and 23', () => {
    at(NOW);
    expect(timeAgo(secondsAgo(60 * 60))).toBe('1 hr ago');
    expect(timeAgo(secondsAgo(5 * 60 * 60))).toBe('5 hr ago');
  });

  it('reports days, singular vs plural before the week boundary', () => {
    at(NOW);
    expect(timeAgo(secondsAgo(24 * 60 * 60))).toBe('1 day ago');
    expect(timeAgo(secondsAgo(3 * 24 * 60 * 60))).toBe('3 days ago');
    expect(timeAgo(secondsAgo(6 * 24 * 60 * 60))).toBe('6 days ago');
  });

  it('reports weeks at and after seven days', () => {
    at(NOW);
    expect(timeAgo(secondsAgo(7 * 24 * 60 * 60))).toBe('1 wk ago');
    expect(timeAgo(secondsAgo(4 * 7 * 24 * 60 * 60))).toBe('4 wk ago');
  });

  it('reports months at and after five weeks', () => {
    at(NOW);
    expect(timeAgo(secondsAgo(5 * 7 * 24 * 60 * 60))).toBe('1 mo ago');
    expect(timeAgo(secondsAgo(11 * 30 * 24 * 60 * 60))).toBe('11 mo ago');
  });

  it('reports years at and after twelve months', () => {
    at(NOW);
    expect(timeAgo(secondsAgo(12 * 30 * 24 * 60 * 60))).toBe('1 yr ago');
    expect(timeAgo(secondsAgo(2 * 365 * 24 * 60 * 60))).toBe('2 yr ago');
  });

  it('clamps a future timestamp to "just now" instead of a negative age', () => {
    at(NOW);
    expect(timeAgo(NOW + 10_000)).toBe('just now');
  });

  it('rounds a fractional elapsed time to the nearest second (round-half-up)', () => {
    // timeAgo uses Math.round, not floor: 59.5s elapsed rounds to 60s, which
    // fails the "< 60" check and reports "1 min ago" even though real elapsed
    // time is under a minute. Documenting the actual (round-half-up) behavior
    // rather than the floor semantics one might otherwise assume.
    at(NOW);
    expect(timeAgo(NOW - 59_500)).toBe('1 min ago');
    expect(timeAgo(NOW - 59_400)).toBe('just now');
  });
});
