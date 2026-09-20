import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  getSettings,
  onSettingsChanged,
  updateSettings,
  type Settings,
} from './settings';

const SETTINGS_KEY = 'settings';
const PROFILE_KEY = 'profile';

type StorageChangeListener = (
  changes: { [key: string]: chrome.storage.StorageChange },
  area: string,
) => void;

let store: Record<string, unknown>;
let storageChangeListeners: Set<StorageChangeListener>;

beforeEach(() => {
  store = {};
  storageChangeListeners = new Set();
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (keys: string[]) =>
          Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]])),
        ),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        }),
      },
      onChanged: {
        addListener: vi.fn((l: StorageChangeListener) => storageChangeListeners.add(l)),
        removeListener: vi.fn((l: StorageChangeListener) => storageChangeListeners.delete(l)),
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
  for (const l of storageChangeListeners) l(changes, area);
}

describe('getSettings', () => {
  it('returns the defaults when nothing is stored at all', async () => {
    await expect(getSettings()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('reads the settings key when it exists', async () => {
    store[SETTINGS_KEY] = { ...DEFAULT_SETTINGS, scanEnabled: false, disabledHosts: ['acme.com'] };

    const settings = await getSettings();

    expect(settings.scanEnabled).toBe(false);
    expect(settings.disabledHosts).toEqual(['acme.com']);
  });

  it('fills in fields missing from a partial record', async () => {
    // Same guard the profile used to carry for disabledHosts before #347 moved
    // the field here: a stored record predating a field must not resolve it to
    // undefined, which would crash the .find() in disabledHostFor.
    store[SETTINGS_KEY] = { scanEnabled: false };

    const settings = await getSettings();

    expect(settings.disabledHosts).toEqual([]);
    expect(settings.coverLetterEnabled).toBe(true);
    expect(settings.tailoredResumeEnabled).toBe(true);
  });

  describe('migration from the pre-split profile (#347)', () => {
    it('falls back to the copies stored inside the profile', async () => {
      // An install that upgraded but has not toggled anything yet: the settings
      // key does not exist and these are still the user's real choices.
      store[PROFILE_KEY] = {
        personal: { firstName: 'Jane' },
        scanEnabled: false,
        disabledHosts: ['acme.com'],
        coverLetterEnabled: false,
        tailoredResumeEnabled: true,
      };

      await expect(getSettings()).resolves.toEqual({
        scanEnabled: false,
        disabledHosts: ['acme.com'],
        coverLetterEnabled: false,
        tailoredResumeEnabled: true,
      });
    });

    it('does not write the migrated values back on read', async () => {
      // Every tab's content script calls getSettings() on load, so a
      // migrate-on-read would have all of them racing to write the same record.
      store[PROFILE_KEY] = { scanEnabled: false };

      await getSettings();

      expect(chrome.storage.local.set).not.toHaveBeenCalled();
      expect(store[SETTINGS_KEY]).toBeUndefined();
    });

    it('prefers the settings key once it exists, ignoring stale profile copies', async () => {
      store[PROFILE_KEY] = { scanEnabled: true, disabledHosts: ['stale.com'] };
      store[SETTINGS_KEY] = { ...DEFAULT_SETTINGS, scanEnabled: false, disabledHosts: [] };

      const settings = await getSettings();

      expect(settings.scanEnabled).toBe(false);
      expect(settings.disabledHosts).toEqual([]);
    });

    it('carries the pre-split choice through the first toggle', async () => {
      // The end-to-end migration path: read falls back to the profile, then the
      // first real write persists everything to the new key.
      store[PROFILE_KEY] = { scanEnabled: false, disabledHosts: ['acme.com'] };

      await updateSettings((prev) => ({ ...prev, coverLetterEnabled: false }));

      expect(store[SETTINGS_KEY]).toEqual({
        scanEnabled: false,
        disabledHosts: ['acme.com'],
        coverLetterEnabled: false,
        tailoredResumeEnabled: true,
      });
    });
  });
});

describe('updateSettings', () => {
  it('persists the updated record and returns it', async () => {
    const written = await updateSettings((prev) => ({ ...prev, scanEnabled: false }));

    expect(written.scanEnabled).toBe(false);
    expect(store[SETTINGS_KEY]).toEqual({ ...DEFAULT_SETTINGS, scanEnabled: false });
  });

  it('does not let concurrent toggles drop each other', async () => {
    // Both start before either finishes. Without serialization they would read
    // the same record and the second write would lose the first's change.
    await Promise.all([
      updateSettings((prev) => ({ ...prev, scanEnabled: false })),
      updateSettings((prev) => ({ ...prev, coverLetterEnabled: false })),
    ]);

    const settings = await getSettings();
    expect(settings.scanEnabled).toBe(false);
    expect(settings.coverLetterEnabled).toBe(false);
  });

  it('keeps the queue usable after a failed write', async () => {
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('quota'));

    await expect(updateSettings((prev) => ({ ...prev, scanEnabled: false }))).rejects.toThrow(
      'quota',
    );
    await expect(
      updateSettings((prev) => ({ ...prev, coverLetterEnabled: false })),
    ).resolves.toMatchObject({ coverLetterEnabled: false });
  });
});

describe('onSettingsChanged', () => {
  it('reports the new settings on a local change', () => {
    const callback = vi.fn();
    onSettingsChanged(callback);

    emitStorageChange(
      { [SETTINGS_KEY]: { newValue: { ...DEFAULT_SETTINGS, scanEnabled: false } } },
      'local',
    );

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ scanEnabled: false }) as Settings,
    );
  });

  it('fills defaults in for a partial stored value', () => {
    const callback = vi.fn();
    onSettingsChanged(callback);

    emitStorageChange({ [SETTINGS_KEY]: { newValue: { scanEnabled: false } } }, 'local');

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ disabledHosts: [] }) as Settings);
  });

  it('ignores changes to other keys and other storage areas', () => {
    const callback = vi.fn();
    onSettingsChanged(callback);

    // A profile edit must no longer wake the content script — the whole point
    // of the split (#347).
    emitStorageChange({ [PROFILE_KEY]: { newValue: { resumeText: 'x' } } }, 'local');
    emitStorageChange({ [SETTINGS_KEY]: { newValue: DEFAULT_SETTINGS } }, 'sync');

    expect(callback).not.toHaveBeenCalled();
  });

  it('unsubscribes when the returned disposer is called', () => {
    const callback = vi.fn();
    const off = onSettingsChanged(callback);
    off();

    emitStorageChange({ [SETTINGS_KEY]: { newValue: DEFAULT_SETTINGS } }, 'local');

    expect(callback).not.toHaveBeenCalled();
  });
});
