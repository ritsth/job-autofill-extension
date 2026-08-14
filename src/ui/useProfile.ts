import { useEffect, useRef, useState } from 'react';
import { DEFAULT_PROFILE, getProfile, onProfileChanged, saveProfile, type Profile } from '../lib/profile';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function profileSaveErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/quota/i.test(msg)) {
    return 'Could not save — local storage is full. Remove an uploaded document to free space, then edit again.';
  }
  return `Could not save — ${msg}`;
}

/**
 * Loads the profile and auto-saves edits (debounced). External changes (e.g.
 * another tab) are merged in when not mid-edit.
 */
export function useProfile() {
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState('');
  const saveTimer = useRef<number | undefined>(undefined);
  const editing = useRef(false);

  useEffect(() => {
    getProfile().then((p) => {
      setProfile(p);
      setLoaded(true);
    });
    return onProfileChanged((p) => {
      if (!editing.current) setProfile(p);
    });
  }, []);

  function update(updater: (prev: Profile) => Profile): void {
    editing.current = true;
    setProfile((prev) => {
      const next = updater(prev);
      setSaveState('saving');
      setSaveError('');
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(async () => {
        try {
          await saveProfile(next);
          setSaveState('saved');
          window.setTimeout(() => setSaveState('idle'), 1500);
        } catch (err) {
          setSaveState('error');
          setSaveError(profileSaveErrorMessage(err));
        } finally {
          editing.current = false;
        }
      }, 500);
      return next;
    });
  }

  return { profile, loaded, saveState, saveError, update, setProfile };
}
