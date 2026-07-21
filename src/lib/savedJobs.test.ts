import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addJob, isJobTextTruncated, MAX_TEXT } from './savedJobs';

describe('isJobTextTruncated — save cap boundary', () => {
  it('is false at or below the cap', () => {
    expect(isJobTextTruncated('')).toBe(false);
    expect(isJobTextTruncated('a'.repeat(MAX_TEXT - 1))).toBe(false);
    expect(isJobTextTruncated('a'.repeat(MAX_TEXT))).toBe(false);
  });

  it('is true one character past the cap', () => {
    expect(isJobTextTruncated('a'.repeat(MAX_TEXT + 1))).toBe(true);
  });
});

describe('addJob — storage-side truncation', () => {
  // Minimal in-memory chrome.storage.local: enough for get/set with one key.
  let store: Record<string, unknown>;

  beforeEach(() => {
    store = {};
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: store[key] })),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(store, items);
          }),
        },
      },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('caps persisted text at MAX_TEXT and warns, for input one char over', async () => {
    const longText = 'a'.repeat(MAX_TEXT + 1);
    const state = await addJob({ company: 'Acme', role: 'Engineer', url: 'https://x', text: longText });

    expect(state.jobs[0].text).toHaveLength(MAX_TEXT);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining(`${MAX_TEXT + 1} to ${MAX_TEXT}`),
    );
  });

  it('does not warn and stores text unchanged when under the cap', async () => {
    const state = await addJob({ company: 'Acme', role: 'Engineer', url: 'https://x', text: 'short posting' });

    expect(state.jobs[0].text).toBe('short posting');
    expect(console.warn).not.toHaveBeenCalled();
  });
});
