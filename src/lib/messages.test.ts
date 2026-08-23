import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONTEXT_LOST_MESSAGE,
  isContextInvalidated,
  pageMessageRole,
  sendToBackground,
  UNSUPPORTED_REPLY_DELAY_MS,
} from './messages';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isContextInvalidated', () => {
  it('recognises the error Chrome raises in an orphaned content script', () => {
    expect(isContextInvalidated(new Error('Extension context invalidated.'))).toBe(true);
    // Chrome's casing has varied across versions, so match case-insensitively.
    expect(isContextInvalidated(new Error('extension context invalidated'))).toBe(true);
  });

  it('recognises the message sendToBackground rewrites it to', () => {
    // Without this, every caller downstream of the rewrite would see only the
    // friendly string and the predicate would silently never fire.
    expect(isContextInvalidated(new Error(CONTEXT_LOST_MESSAGE))).toBe(true);
  });

  it('does not claim unrelated failures', () => {
    expect(isContextInvalidated(new Error('Daily limit reached (50/day).'))).toBe(false);
    expect(isContextInvalidated(new Error('Could not reach the proxy: network error'))).toBe(false);
    expect(isContextInvalidated(undefined)).toBe(false);
    expect(isContextInvalidated(null)).toBe(false);
  });
});

describe('sendToBackground — orphaned content script', () => {
  const msg = { type: 'AI_ANALYZE_JOB', text: 'posting' } as const;

  it('fails with the actionable message when the runtime is already gone', async () => {
    // chrome.runtime.id goes undefined the moment the context dies, so this is
    // caught before Chrome throws anything.
    const sendMessage = vi.fn();
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    await expect(sendToBackground(msg)).rejects.toThrow(CONTEXT_LOST_MESSAGE);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('rewrites Chrome\'s raw error when sendMessage is the thing that throws', async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error('Extension context invalidated.'));
    vi.stubGlobal('chrome', { runtime: { id: 'abc', sendMessage } });

    await expect(sendToBackground(msg)).rejects.toThrow(CONTEXT_LOST_MESSAGE);
  });

  it('leaves unrelated errors untouched so real failures stay diagnosable', async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error('Daily limit reached (50/day).'));
    vi.stubGlobal('chrome', { runtime: { id: 'abc', sendMessage } });

    await expect(sendToBackground(msg)).rejects.toThrow('Daily limit reached (50/day).');
  });

  it('passes the response through when the runtime is healthy', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ text: 'ok' });
    vi.stubGlobal('chrome', { runtime: { id: 'abc', sendMessage } });

    await expect(sendToBackground(msg)).resolves.toEqual({ text: 'ok' });
    expect(sendMessage).toHaveBeenCalledWith(msg);
  });

  it('stays readable after the badge truncates it to 32 characters', () => {
    // The AI-check button slices the message; the action must survive.
    expect(CONTEXT_LOST_MESSAGE.slice(0, 32)).toContain('Refresh this page');
  });
});

describe('pageMessageRole — which frame answers PAGE_INFO / PAGE_FILL', () => {
  it('lets the frame an adapter matched answer immediately', () => {
    // The normal case: a Greenhouse/Lever/Workday/Ashby page opened directly.
    expect(pageMessageRole(true, true)).toBe('answer');
  });

  it('lets an adapter-matching SUB-frame answer immediately too', () => {
    // The bug this fixes: a company careers site embedding the ATS in an
    // iframe. The sub-frame holds the real form, so it must be allowed to win.
    expect(pageMessageRole(true, false)).toBe('answer');
  });

  it('makes the adapter-less top frame concede late rather than never', () => {
    // It still has to reply — on a genuinely unsupported page nobody else will
    // and the popup would hang — but late, so an embedded ATS frame beats it.
    expect(pageMessageRole(false, true)).toBe('answer-late');
  });

  it('keeps an adapter-less sub-frame silent', () => {
    // An ad or tracker iframe has nothing to say about the application form,
    // and letting it answer would let it win the race with an empty reply.
    expect(pageMessageRole(false, false)).toBe('ignore');
  });

  it('concedes fast enough to stay imperceptible on an unsupported page', () => {
    expect(UNSUPPORTED_REPLY_DELAY_MS).toBeGreaterThan(0);
    expect(UNSUPPORTED_REPLY_DELAY_MS).toBeLessThanOrEqual(1000);
  });
});
