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

  it('reports days, singular vs plural', () => {
    at(NOW);
    expect(timeAgo(secondsAgo(24 * 60 * 60))).toBe('1 day ago');
    expect(timeAgo(secondsAgo(3 * 24 * 60 * 60))).toBe('3 days ago');
  });

  it('clamps a future timestamp to "just now" instead of a negative age', () => {
    at(NOW);
    expect(timeAgo(NOW + 10_000)).toBe('just now');
  });
});
