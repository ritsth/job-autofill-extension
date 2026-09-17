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
  // Identifies the most recently scheduled save. clearTimeout below only cancels
  // a timer that hasn't fired yet — once its 500ms debounce elapses and the async
  // callback starts (i.e. it's inside `await saveProfile`), a NEW edit can no
  // longer cancel it. Without this, that now-uncancellable callback still shares
  // editing.current/saveState/saveError with whatever a later edit schedules, so
  // whichever save finishes last wins regardless of which edit is actually
  // newer — the earlier save's completion can flip editing.current to false
  // while a newer edit is still in flight, letting onProfileChanged apply a
  // stale external update over it (#194). Each in-flight callback checks its
  // own generation against the current one before touching any shared state, so
  // a superseded save's completion becomes a no-op instead of clobbering it.
  const saveGeneration = useRef(0);

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
    const generation = ++saveGeneration.current;
    editing.current = true;
    setProfile((prev) => {
      const next = updater(prev);
      setSaveState('saving');
      setSaveError('');
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(async () => {
        try {
          await saveProfile(next);
          if (generation === saveGeneration.current) {
            setSaveState('saved');
            // Guarded too: without this, a slow-to-reset save A can flip
            // saveState back to 'idle' 1500ms later even though a newer save B
            // has since taken over — A's own generation check above only
            // covers the moment its save just finished, not this nested timer.
            window.setTimeout(() => {
              if (generation === saveGeneration.current) setSaveState('idle');
            }, 1500);
          }
        } catch (err) {
          if (generation === saveGeneration.current) {
            setSaveState('error');
            setSaveError(profileSaveErrorMessage(err));
          }
        } finally {
          if (generation === saveGeneration.current) editing.current = false;
        }
      }, 500);
      return next;
    });
  }

  return { profile, loaded, saveState, saveError, update, setProfile };
}
