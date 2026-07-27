import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addJob,
  deleteJob,
  getActiveJob,
  getSavedJobs,
  isJobTextTruncated,
  MAX_JOBS,
  MAX_TEXT,
  setActiveJob,
  type SavedJob,
  type SavedJobsState,
} from './savedJobs';

const STORAGE_KEY = 'savedJobs';

// Minimal in-memory chrome.storage.local: enough for get/set with one key.
// Shared by every suite below so each starts from empty storage.
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

/** What actually landed in storage, rather than a function's return value. */
function persisted(): SavedJobsState {
  return store[STORAGE_KEY] as SavedJobsState;
}

/** Seeds storage directly, bypassing addJob. */
function seed(state: SavedJobsState): void {
  store[STORAGE_KEY] = state;
}

function job(overrides: Partial<SavedJob> = {}): SavedJob {
  return {
    id: 'id-1',
    company: 'Acme',
    role: 'Engineer',
    url: 'https://x',
    text: 'posting',
    savedAt: 1,
    ...overrides,
  };
}

const partial = (text = 'short posting') => ({
  company: 'Acme',
  role: 'Engineer',
  url: 'https://x',
  text,
});

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
  it('caps persisted text at MAX_TEXT and warns, for input one char over', async () => {
    const longText = 'a'.repeat(MAX_TEXT + 1);
    await addJob(partial(longText));

    // Assert what actually landed in storage, not just addJob's return value —
    // a regression could return the right shape while persisting something else.
    expect(persisted().jobs[0].text).toBe(longText.slice(0, MAX_TEXT));
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining(`${MAX_TEXT + 1} to ${MAX_TEXT}`),
    );
  });

  it('does not warn and stores text unchanged when under the cap', async () => {
    await addJob(partial('short posting'));

    expect(persisted().jobs[0].text).toBe('short posting');
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe('addJob — ordering and active selection', () => {
  it('prepends the new job and makes it active', async () => {
    const first = await addJob(partial('first'));
    const second = await addJob(partial('second'));

    expect(second.jobs.map((j) => j.text)).toEqual(['second', 'first']);
    // The newest job is the one AI tailoring should use.
    expect(second.activeId).toBe(second.jobs[0].id);
    expect(second.activeId).not.toBe(first.activeId);
    expect(persisted().activeId).toBe(second.jobs[0].id);
  });

  it('stamps each job with a unique id and a savedAt time', async () => {
    const { jobs } = await addJob(partial());
    expect(jobs[0].id).toBeTruthy();
    expect(jobs[0].savedAt).toBeGreaterThan(0);

    const after = await addJob(partial());
    expect(after.jobs[0].id).not.toBe(after.jobs[1].id);
  });
});

describe('addJob — MAX_JOBS eviction cap', () => {
  it('keeps at most MAX_JOBS, dropping the oldest', async () => {
    const existing = Array.from({ length: MAX_JOBS }, (_, i) =>
      job({ id: `old-${i}`, text: `old-${i}` }),
    );
    seed({ jobs: existing, activeId: 'old-0' });

    const { jobs } = await addJob(partial('newest'));

    expect(jobs).toHaveLength(MAX_JOBS);
    expect(jobs[0].text).toBe('newest');
    // The oldest (last in the list) is the one that falls off the end.
    expect(jobs.some((j) => j.id === `old-${MAX_JOBS - 1}`)).toBe(false);
    expect(jobs.some((j) => j.id === 'old-0')).toBe(true);
    expect(persisted().jobs).toHaveLength(MAX_JOBS);
  });

  it('does not evict while under the cap', async () => {
    seed({ jobs: [job({ id: 'a' })], activeId: 'a' });

    const { jobs } = await addJob(partial('newest'));

    expect(jobs).toHaveLength(2);
    expect(jobs.some((j) => j.id === 'a')).toBe(true);
  });

  it('reports the dropped job so the UI can say so', async () => {
    const existing = Array.from({ length: MAX_JOBS }, (_, i) => job({ id: `old-${i}` }));
    seed({ jobs: existing, activeId: 'old-0' });

    const { evicted } = await addJob(partial('newest'));

    // Without this the 21st save silently loses the oldest posting (#85).
    expect(evicted.map((j) => j.id)).toEqual([`old-${MAX_JOBS - 1}`]);
  });

  it('reports nothing evicted while under the cap', async () => {
    seed({ jobs: [job({ id: 'a' })], activeId: 'a' });

    expect((await addJob(partial('newest'))).evicted).toEqual([]);
  });
});

describe('getSavedJobs — defaults for missing or partial state', () => {
  it('returns empty defaults when storage is empty', async () => {
    expect(await getSavedJobs()).toEqual({ jobs: [], activeId: null });
  });

  it('fills in missing fields of a partial stored value', async () => {
    store[STORAGE_KEY] = { jobs: [job({ id: 'a' })] }; // no activeId
    expect(await getSavedJobs()).toEqual({ jobs: [job({ id: 'a' })], activeId: null });

    store[STORAGE_KEY] = { activeId: 'a' }; // no jobs
    expect(await getSavedJobs()).toEqual({ jobs: [], activeId: 'a' });
  });

  it('does not hand back a shared reference to the empty default', async () => {
    // A mutable module-level default could otherwise leak between calls.
    const first = await getSavedJobs();
    first.jobs.push(job());
    expect((await getSavedJobs()).jobs).toEqual([]);
  });
});

describe('getActiveJob', () => {
  it('returns the job matching activeId', async () => {
    seed({ jobs: [job({ id: 'a' }), job({ id: 'b' })], activeId: 'b' });
    expect((await getActiveJob())?.id).toBe('b');
  });

  it('returns null when no job is active', async () => {
    seed({ jobs: [job({ id: 'a' })], activeId: null });
    expect(await getActiveJob()).toBeNull();
  });

  it('returns null when activeId points at a job that is gone', async () => {
    seed({ jobs: [job({ id: 'a' })], activeId: 'missing' });
    expect(await getActiveJob()).toBeNull();
  });
});

describe('setActiveJob', () => {
  it('switches the active job without touching the list', async () => {
    seed({ jobs: [job({ id: 'a' }), job({ id: 'b' })], activeId: 'a' });

    await setActiveJob('b');

    expect(persisted().activeId).toBe('b');
    expect(persisted().jobs.map((j) => j.id)).toEqual(['a', 'b']);
  });

  it('clears the active job without removing it', async () => {
    seed({ jobs: [job({ id: 'a' })], activeId: 'a' });

    await setActiveJob(null);

    expect(persisted().activeId).toBeNull();
    expect(persisted().jobs.map((j) => j.id)).toEqual(['a']);
  });
});

describe('deleteJob', () => {
  it('removes only the named job', async () => {
    seed({ jobs: [job({ id: 'a' }), job({ id: 'b' })], activeId: 'b' });

    await deleteJob('a');

    expect(persisted().jobs.map((j) => j.id)).toEqual(['b']);
  });

  it('clears activeId when the active job is the one deleted', async () => {
    seed({ jobs: [job({ id: 'a' }), job({ id: 'b' })], activeId: 'a' });

    await deleteJob('a');

    // Otherwise activeId would dangle and AI tailoring would silently fall back.
    expect(persisted().activeId).toBeNull();
  });

  it('leaves activeId alone when a different job is deleted', async () => {
    seed({ jobs: [job({ id: 'a' }), job({ id: 'b' })], activeId: 'b' });

    await deleteJob('a');

    expect(persisted().activeId).toBe('b');
  });

  it('is a no-op for an unknown id', async () => {
    seed({ jobs: [job({ id: 'a' })], activeId: 'a' });

    await deleteJob('nope');

    expect(persisted().jobs.map((j) => j.id)).toEqual(['a']);
    expect(persisted().activeId).toBe('a');
  });
});
