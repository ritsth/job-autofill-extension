import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTEXT_LOST_MESSAGE } from '../lib/messages';
import {
  BADGE_AI_CHECK_ERROR_MAX,
  INLINE_ANSWER_ERROR_MAX,
  clearButtonError,
  showButtonError,
} from './buttonError';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('AI button errors', () => {
  const message = 'The AI service could not complete this request. Sign in again in Options and try again.';

  it.each([BADGE_AI_CHECK_ERROR_MAX, INLINE_ANSWER_ERROR_MAX])('keeps the complete error in the title with a %i-character label', (limit) => {
    const button = { textContent: 'Thinking…', title: '' };
    showButtonError(button, message, 'AI answer', limit);

    expect(button.textContent).toBe('⚠ ' + message.slice(0, limit));
    expect(button.textContent).not.toContain('Sign in again');
    expect(button.title).toBe(message);
  });

  it.each(['', 'Re-read this posting with AI (more accurate on odd wording)'])(
    'restores the label and original title (%j) together',
    (title) => {
      const button = { textContent: 'Analyzing…', title };
      showButtonError(button, message, 'AI check', BADGE_AI_CHECK_ERROR_MAX);

      vi.advanceTimersByTime(3999);
      expect(button.title).toBe(message);
      vi.advanceTimersByTime(1);
      expect(button).toEqual({ textContent: 'AI check', title });
    },
  );

  it('preserves the full context-lost message until its shorter reset timeout', () => {
    const button = { textContent: 'Thinking…', title: '' };
    showButtonError(button, CONTEXT_LOST_MESSAGE, 'AI answer', INLINE_ANSWER_ERROR_MAX, 3000);
    expect(button.title).toBe(CONTEXT_LOST_MESSAGE);

    vi.advanceTimersByTime(3000);
    expect(button).toEqual({ textContent: 'AI answer', title: '' });
  });

  it('clears a stale tooltip on retry without resetting the new in-flight label', () => {
    const button = { textContent: 'AI check', title: 'Check this posting' };
    showButtonError(button, message, 'AI check', BADGE_AI_CHECK_ERROR_MAX);
    vi.advanceTimersByTime(1000);

    clearButtonError(button);
    button.textContent = 'Analyzing…';
    vi.advanceTimersByTime(4000);
    expect(button).toEqual({ textContent: 'Analyzing…', title: 'Check this posting' });
  });

  it('replaces an error without restoring its stale timer or tooltip', () => {
    const button = { textContent: 'AI check', title: 'Check this posting' };
    showButtonError(button, message, 'AI check', BADGE_AI_CHECK_ERROR_MAX);
    vi.advanceTimersByTime(1000);
    showButtonError(button, CONTEXT_LOST_MESSAGE, 'AI check', BADGE_AI_CHECK_ERROR_MAX);

    vi.advanceTimersByTime(3000);
    expect(button.title).toBe(CONTEXT_LOST_MESSAGE);
    vi.advanceTimersByTime(1000);
    expect(button).toEqual({ textContent: 'AI check', title: 'Check this posting' });
  });
});

// #298 asked for one shared constant so "the next call site" would not "invent a
// fourth number", and #310 reported the literals had outlived the helper that
// #303 built. A source scan is the only thing that actually holds that line —
// the same approach modelAllowlist.test.ts uses to guard two values that must
// not drift. Reading the sources keeps the check honest if a call site moves.
describe('every showButtonError call site uses a named limit', () => {
  const CALL_SITES = ['../content/index.ts', '../content/sponsorship.ts'];

  it.each(CALL_SITES)('passes no bare numeric limit in %s', (rel) => {
    const source = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    const calls = [...source.matchAll(/showButtonError\(([^;]*?)\);/gs)];

    // Guards the regex itself: zero matches would make the assertion vacuous.
    expect(calls.length).toBeGreaterThan(0);
    for (const [call] of calls) {
      expect(call).toMatch(/_ERROR_MAX/);
    }
  });
});
