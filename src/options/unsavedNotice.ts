import type { SaveState } from '../ui/useProfile';

/**
 * Shown on the parts of Options that describe what the AI will see — uploaded
 * documents and the "N of M chars used for AI" numbers — while a save has
 * failed. Options renders the in-memory profile, but the AI features, "Fill
 * this page" and the popup all read the profile from storage, which still holds
 * the last save that succeeded. Without this, a document that didn't fit in
 * storage is listed as consuming AI budget it will never get (#361).
 */
export const UNSAVED_AI_NOTICE =
  "Not saved yet — the AI is still using your last saved profile, so this section shows changes it can't see.";

/** Null when the display matches storage; the notice when it may not. */
export function unsavedAiNotice(saveState: SaveState): string | null {
  return saveState === 'error' ? UNSAVED_AI_NOTICE : null;
}
