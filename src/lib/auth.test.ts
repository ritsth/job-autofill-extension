import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onAuthChanged, type AuthUser } from './auth';

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
