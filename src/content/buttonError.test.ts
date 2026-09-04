import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTEXT_LOST_MESSAGE } from '../lib/messages';
import { clearButtonError, showButtonError } from './buttonError';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('AI button errors', () => {
  const message = 'The AI service could not complete this request. Sign in again in Options and try again.';

  it.each([32, 40])('keeps the complete error in the title with a %i-character label', (limit) => {
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
      showButtonError(button, message, 'AI check', 32);

      vi.advanceTimersByTime(3999);
      expect(button.title).toBe(message);
      vi.advanceTimersByTime(1);
      expect(button).toEqual({ textContent: 'AI check', title });
    },
  );

  it('preserves the full context-lost message until its shorter reset timeout', () => {
    const button = { textContent: 'Thinking…', title: '' };
    showButtonError(button, CONTEXT_LOST_MESSAGE, 'AI answer', 40, 3000);
    expect(button.title).toBe(CONTEXT_LOST_MESSAGE);

    vi.advanceTimersByTime(3000);
    expect(button).toEqual({ textContent: 'AI answer', title: '' });
  });

  it('clears a stale tooltip on retry without resetting the new in-flight label', () => {
    const button = { textContent: 'AI check', title: 'Check this posting' };
    showButtonError(button, message, 'AI check', 32);
    vi.advanceTimersByTime(1000);

    clearButtonError(button);
    button.textContent = 'Analyzing…';
    vi.advanceTimersByTime(4000);
    expect(button).toEqual({ textContent: 'Analyzing…', title: 'Check this posting' });
  });

  it('replaces an error without restoring its stale timer or tooltip', () => {
    const button = { textContent: 'AI check', title: 'Check this posting' };
    showButtonError(button, message, 'AI check', 32);
    vi.advanceTimersByTime(1000);
    showButtonError(button, CONTEXT_LOST_MESSAGE, 'AI check', 32);

    vi.advanceTimersByTime(3000);
    expect(button.title).toBe(CONTEXT_LOST_MESSAGE);
    vi.advanceTimersByTime(1000);
    expect(button).toEqual({ textContent: 'AI check', title: 'Check this posting' });
  });
});
