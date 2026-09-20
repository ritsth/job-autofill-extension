// The handful of small, frequently-read switches that drive the content script,
// kept in their own chrome.storage.local key — deliberately NOT inside the
// profile blob (#347).
//
// The content script is injected on <all_urls> and subscribes to changes in
// these four values, but the profile it used to read them from also carries the
// resume and the full extracted text of every uploaded document. On one key that
// meant a debounced keystroke in Options rewrote all of that to disk and
// structured-cloned it into the top frame of every open tab, to deliver four
// booleans. Splitting them off keeps the hot, widely-broadcast payload small;
// the profile is now only read where it's actually needed (the fill + AI paths).

import { PROFILE_STORAGE_KEY } from './profile';

const SETTINGS_KEY = 'settings';

export interface Settings {
  /** Master on/off for the eligibility scanner (runs on every page when on). */
  scanEnabled: boolean;
  /**
   * Hostnames the eligibility badge is switched off on ("turn off on this site
   * only"), matched via hostMatches (exact-or-subdomain) in ./host.ts.
   * Independent of scanEnabled — this narrows where the scanner runs while
   * scanEnabled is the global master switch.
   */
  disabledHosts: string[];
  /** Show the tailored-resume generator in the side panel. */
  tailoredResumeEnabled: boolean;
  /** Show the tailored cover-letter generator in the side panel. */
  coverLetterEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  scanEnabled: true,
  disabledHosts: [],
  tailoredResumeEnabled: true,
  coverLetterEnabled: true,
};

/** Fills in anything missing, so a partial or pre-split record still loads. */
function withDefaults(stored: Partial<Settings> | undefined): Settings {
  if (!stored) return structuredClone(DEFAULT_SETTINGS);
  return {
    scanEnabled: stored.scanEnabled ?? DEFAULT_SETTINGS.scanEnabled,
    disabledHosts: stored.disabledHosts ?? DEFAULT_SETTINGS.disabledHosts,
    tailoredResumeEnabled: stored.tailoredResumeEnabled ?? DEFAULT_SETTINGS.tailoredResumeEnabled,
    coverLetterEnabled: stored.coverLetterEnabled ?? DEFAULT_SETTINGS.coverLetterEnabled,
  };
}

/**
 * Reads the settings, falling back to the copies that lived inside the profile
 * before the split so an existing install keeps its choices.
 *
 * The fallback deliberately does NOT write the migrated values back: every tab's
 * content script calls this on load, so migrating-on-read would have all of them
 * racing to write the same record. The first real toggle persists to the new key
 * instead, and from then on the legacy copies are simply ignored.
 *
 * Those copies are left in the profile record rather than stripped out, because
 * until that first toggle they ARE the user's settings — deleting them on the
 * next profile save would reset the scanner and per-site opt-outs for anyone who
 * upgrades and edits their profile before touching a switch.
 */
export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get([SETTINGS_KEY, PROFILE_STORAGE_KEY]);
  const own = stored[SETTINGS_KEY] as Partial<Settings> | undefined;
  if (own) return withDefaults(own);
  const legacy = stored[PROFILE_STORAGE_KEY] as Partial<Settings> | undefined;
  return withDefaults(legacy);
}

// Serializes the read-modify-write below, so two toggles in quick succession
// can't both read the same record and have the second write drop the first's
// change. Same pattern, and the same reason, as mutateSavedJobs in ./savedJobs.
let pendingWrite: Promise<void> = Promise.resolve();

/**
 * Applies `updater` to the current settings and persists the result, returning
 * what was written. Takes an updater rather than a whole record so callers can't
 * accidentally write back a stale snapshot they loaded earlier.
 */
export function updateSettings(updater: (prev: Settings) => Settings): Promise<Settings> {
  const result = pendingWrite.then(async () => {
    const next = updater(await getSettings());
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    return next;
  });
  // A failed write still rejects its caller, but must not poison the queue.
  pendingWrite = result.then(
    () => {},
    () => {},
  );
  return result;
}

/** Subscribe to settings changes, so every surface stays in lockstep. */
export function onSettingsChanged(cb: (settings: Settings) => void): () => void {
  const listener = (
    changes: { [key: string]: chrome.storage.StorageChange },
    area: string,
  ) => {
    if (area === 'local' && changes[SETTINGS_KEY]) {
      cb(withDefaults(changes[SETTINGS_KEY].newValue as Partial<Settings> | undefined));
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
