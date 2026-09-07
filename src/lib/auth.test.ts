import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onAuthChanged, reconcileAuthUser, signOut, type AuthUser } from './auth';

const AUTH_KEY = 'auth';

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
  vi.restoreAllMocks();
});

function emitStorageChange(
  changes: { [key: string]: chrome.storage.StorageChange },
  area: string,
): void {
  for (const listener of storageChangeListeners) listener(changes, area);
}

describe('onAuthChanged', () => {
  it('calls back with the new user for a local auth change', () => {
    const callback = vi.fn();
    const next: AuthUser = { email: 'jane@example.com' };
    onAuthChanged(callback);

    emitStorageChange({ [AUTH_KEY]: { newValue: next } }, 'local');

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(next);
  });

  it('calls back with null when the auth key is removed during sign-out', () => {
    const callback = vi.fn();
    onAuthChanged(callback);

    emitStorageChange({ [AUTH_KEY]: { newValue: undefined } }, 'local');

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(null);
  });

  it('ignores auth changes from the sync area', () => {
    const callback = vi.fn();
    onAuthChanged(callback);

    emitStorageChange({ [AUTH_KEY]: { newValue: { email: 'jane@example.com' } } }, 'sync');

    expect(callback).not.toHaveBeenCalled();
  });

  it('ignores unrelated local storage changes', () => {
    const callback = vi.fn();
    onAuthChanged(callback);

    emitStorageChange({ profile: { newValue: { name: 'Jane' } } }, 'local');

    expect(callback).not.toHaveBeenCalled();
  });

  it('stops delivering changes after unsubscribe', () => {
    const callback = vi.fn();
    const unsubscribe = onAuthChanged(callback);

    unsubscribe();
    emitStorageChange({ [AUTH_KEY]: { newValue: { email: 'jane@example.com' } } }, 'local');

    expect(callback).not.toHaveBeenCalled();
    expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledOnce();
  });
});

describe('signOut', () => {
  it('sends the encoded OAuth token in a POST body, not the URL', async () => {
    const token = 'token+with/slash?&= ü';
    const fetchMock = vi.fn().mockResolvedValue({});
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('chrome', {
      runtime: { lastError: undefined },
      identity: {
        getAuthToken: vi.fn((_options: unknown, callback: (result: string) => void) =>
          callback(token),
        ),
        removeCachedAuthToken: vi.fn((_details: unknown, callback: () => void) => callback()),
        clearAllCachedAuthTokens: vi.fn((callback: () => void) => callback()),
      },
      storage: {
        local: {
          set: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn().mockResolvedValue(undefined),
        },
      },
    });

    await signOut();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'token=token%2Bwith%2Fslash%3F%26%3D%20%C3%BC',
    });
  });
});

describe('reconcileAuthUser', () => {
  it('returns the stored user without requesting a token', async () => {
    const stored: AuthUser = { email: 'stored@example.com' };
    const getAuthToken = vi.fn();
    const set = vi.fn();
    vi.stubGlobal('chrome', {
      identity: { getAuthToken },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({ [AUTH_KEY]: stored }),
          set,
        },
      },
    });

    await expect(reconcileAuthUser()).resolves.toEqual(stored);
    expect(getAuthToken).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it('persists and returns the user recovered from a silent token', async () => {
    const user: AuthUser = { email: 'recovered@example.com' };
    const set = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(user),
    }));
    vi.stubGlobal('chrome', {
      runtime: { lastError: undefined },
      identity: {
        getAuthToken: vi.fn((_options: unknown, callback: (result: string) => void) =>
          callback('cached-token'),
        ),
      },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set,
        },
      },
    });

    await expect(reconcileAuthUser()).resolves.toEqual(user);
    expect(set).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith({ [AUTH_KEY]: user });
  });

  it('returns null without persisting when no silent token exists', async () => {
    const set = vi.fn();
    vi.stubGlobal('chrome', {
      runtime: { lastError: undefined },
      identity: {
        getAuthToken: vi.fn((_options: unknown, callback: (result?: string) => void) =>
          callback(undefined),
        ),
      },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set,
        },
      },
    });

    await expect(reconcileAuthUser()).resolves.toBeNull();
    expect(set).not.toHaveBeenCalled();
  });

  it('honors explicit sign-out without requesting a silent token', async () => {
    const getAuthToken = vi.fn((_options: unknown, callback: (result: string) => void) =>
      callback('cached-token'),
    );
    const set = vi.fn();
    vi.stubGlobal('chrome', {
      runtime: { lastError: undefined },
      identity: { getAuthToken },
      storage: {
        local: {
          get: vi.fn((key: string) =>
            Promise.resolve(key === 'signedOut' ? { signedOut: true } : {}),
          ),
          set,
        },
      },
    });

    await expect(reconcileAuthUser()).resolves.toBeNull();
    expect(getAuthToken).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });
});
