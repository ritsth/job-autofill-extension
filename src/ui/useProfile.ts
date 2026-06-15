import { useEffect, useRef, useState } from 'react';
import { DEFAULT_PROFILE, getProfile, onProfileChanged, saveProfile, type Profile } from '../lib/profile';

export type SaveState = 'idle' | 'saving' | 'saved';

/**
 * Loads the profile and auto-saves edits (debounced). External changes (e.g.
 * another tab) are merged in when not mid-edit.
 */
export function useProfile() {
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
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
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(async () => {
        await saveProfile(next);
        setSaveState('saved');
        editing.current = false;
        window.setTimeout(() => setSaveState('idle'), 1500);
      }, 500);
      return next;
    });
  }

  return { profile, loaded, saveState, update, setProfile };
}
