import type { Profile } from '../lib/profile';
import type { SaveState } from '../ui/useProfile';

/**
 * Shown on the parts of Options that describe what the AI will see — uploaded
 * documents and the "N of M chars used for AI" numbers — when they show changes
 * that never reached storage. Options renders the in-memory profile, but the AI
 * features, "Fill this page" and the popup all read storage, which still holds
 * the last save that succeeded. Without this, a document that didn't fit in
 * storage is listed as consuming AI budget it will never get (#361).
 */
export const UNSAVED_AI_NOTICE =
  "Not saved yet — the AI is still using your last saved profile, so it can't see the changes in this section.";

/**
 * The notice for one section, or null when that section matches storage.
 *
 * Only after a failed save: `saving` is a 500ms debounce on its way to storage,
 * not a divergence. And only when THIS section differs — a failed edit to the
 * first name leaves the documents exactly as the AI sees them, and saying
 * otherwise would cry wolf. Compared by reference: every update spreads `prev`,
 * so an untouched section keeps its identity, and comparing multi-megabyte
 * document text on every render would be the expensive way to learn the same.
 */
export function unsavedAiNotice(
  saveState: SaveState,
  current: Profile,
  saved: Profile,
  section: 'documents' | 'resumeText',
): string | null {
  if (saveState !== 'error') return null;
  return current[section] === saved[section] ? null : UNSAVED_AI_NOTICE;
}
