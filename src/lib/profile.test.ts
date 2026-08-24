import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL, GEMINI_MODELS } from './ai/models';
import { DEFAULT_PROFILE, onProfileChanged, profileToContext, type Profile } from './profile';

const STORAGE_KEY = 'profile';

type StorageChangeListener = (
  changes: { [key: string]: chrome.storage.StorageChange },
  area: string,
) => void;
let storageChangeListeners: Set<StorageChangeListener>;

beforeEach(() => {
  storageChangeListeners = new Set();
  vi.stubGlobal('chrome', {
    storage: {
      onChanged: {
        addListener: vi.fn((listener: StorageChangeListener) => {
          storageChangeListeners.add(listener);
        }),
        removeListener: vi.fn((listener: StorageChangeListener) => {
          storageChangeListeners.delete(listener);
        }),
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function emitStorageChange(
  changes: { [key: string]: chrome.storage.StorageChange },
  area: string,
): void {
  for (const listener of storageChangeListeners) listener(changes, area);
}

describe('onProfileChanged', () => {
  it('calls back with the profile for local changes', () => {
    const callback = vi.fn();
    const next: Profile = {
      ...DEFAULT_PROFILE,
      personal: { ...DEFAULT_PROFILE.personal, firstName: 'Jane' },
    };
    onProfileChanged(callback);

    emitStorageChange({ [STORAGE_KEY]: { newValue: next } }, 'local');

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(next);
  });

  it('ignores profile changes from the sync area', () => {
    const callback = vi.fn();
    onProfileChanged(callback);

    emitStorageChange({ [STORAGE_KEY]: { newValue: DEFAULT_PROFILE } }, 'sync');

    expect(callback).not.toHaveBeenCalled();
  });

  it('ignores unrelated local storage changes', () => {
    const callback = vi.fn();
    onProfileChanged(callback);

    emitStorageChange({ savedJobs: { newValue: [] } }, 'local');

    expect(callback).not.toHaveBeenCalled();
  });

  it('uses the full default profile when the profile key is removed', () => {
    const callback = vi.fn();
    onProfileChanged(callback);

    emitStorageChange({ [STORAGE_KEY]: { newValue: undefined } }, 'local');

    expect(callback).toHaveBeenCalledWith(DEFAULT_PROFILE);
  });

  it('stops delivering changes after unsubscribe', () => {
    const callback = vi.fn();
    const unsubscribe = onProfileChanged(callback);

    unsubscribe();
    emitStorageChange({ [STORAGE_KEY]: { newValue: DEFAULT_PROFILE } }, 'local');

    expect(callback).not.toHaveBeenCalled();
    expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledOnce();
  });

  it('deep-merges a partial profile with defaults', () => {
    const callback = vi.fn();
    onProfileChanged(callback);

    emitStorageChange(
      { [STORAGE_KEY]: { newValue: { personal: { firstName: 'Jane' } } } },
      'local',
    );

    expect(callback).toHaveBeenCalledWith({
      ...DEFAULT_PROFILE,
      personal: { ...DEFAULT_PROFILE.personal, firstName: 'Jane' },
    });
  });

  it.each([
    ['unknown', 'gemini-2.0-flash', DEFAULT_MODEL],
    ['known', GEMINI_MODELS[0].id, GEMINI_MODELS[0].id],
  ])('normalizes a %s stored model', (_kind, storedModel, expectedModel) => {
    const callback = vi.fn();
    onProfileChanged(callback);

    emitStorageChange(
      { [STORAGE_KEY]: { newValue: { ai: { model: storedModel } } } },
      'local',
    );

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        ai: { ...DEFAULT_PROFILE.ai, model: expectedModel },
      }),
    );
  });
});

describe('profileToContext', () => {
  it('returns an empty string for a completely empty profile', () => {
    // Regression test for #169: profileToContext used to unconditionally push a
    // "Name:" line, so an empty profile silently produced "Name:" instead of "",
    // which meant downstream code had no way to detect the profile was empty.
    expect(profileToContext(DEFAULT_PROFILE)).toBe('');
  });

  it('produces a clean single Name line when only firstName is set', () => {
    const p: Profile = {
      ...DEFAULT_PROFILE,
      personal: { ...DEFAULT_PROFILE.personal, firstName: 'Jane' },
    };
    expect(profileToContext(p)).toBe('Name: Jane');
  });

  it('produces a clean single Name line when only lastName is set (no stray space)', () => {
    const p: Profile = {
      ...DEFAULT_PROFILE,
      personal: { ...DEFAULT_PROFILE.personal, lastName: 'Smith' },
    };
    expect(profileToContext(p)).toBe('Name: Smith');
  });

  it('includes the Phone line when phone is set', () => {
    const p: Profile = {
      ...DEFAULT_PROFILE,
      personal: { ...DEFAULT_PROFILE.personal, phone: '555-1234' },
    };
    expect(profileToContext(p)).toBe('Phone: 555-1234');
  });

  it('still includes the other sections for a populated profile', () => {
    const p: Profile = {
      ...DEFAULT_PROFILE,
      personal: { ...DEFAULT_PROFILE.personal, firstName: 'Jane', lastName: 'Doe', city: 'Atlanta' },
      skills: ['TypeScript', 'React'],
      workHistory: [
        { company: 'Acme', title: 'Engineer', startDate: '2022', endDate: '', description: 'Built things' },
      ],
    };
    const result = profileToContext(p);
    expect(result).toContain('Name: Jane Doe');
    expect(result).toContain('Location: Atlanta');
    expect(result).toContain('Skills: TypeScript, React');
    expect(result).toContain('Work history:');
    expect(result).toContain('Acme');
  });
});
