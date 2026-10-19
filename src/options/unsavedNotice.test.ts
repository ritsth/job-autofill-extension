import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE, type Profile } from '../lib/profile';
import { UNSAVED_AI_NOTICE, unsavedAiNotice } from './unsavedNotice';

const saved: Profile = {
  ...DEFAULT_PROFILE,
  resumeText: 'Saved resume.',
  documents: [{ id: 'd1', name: 'Saved.pdf', text: 'saved', addedAt: 1 }],
};
// The shape every edit produces: spread prev, replace only what changed.
const withNewDoc: Profile = {
  ...saved,
  documents: [...saved.documents, { id: 'd2', name: 'Huge.pdf', text: 'x'.repeat(1000), addedAt: 2 }],
};
const withNewName: Profile = { ...saved, personal: { ...saved.personal, firstName: 'New' } };

describe('unsavedAiNotice (#361)', () => {
  it('flags the section the failed save would have changed', () => {
    expect(unsavedAiNotice('error', withNewDoc, saved, 'documents')).toBe(UNSAVED_AI_NOTICE);
    expect(unsavedAiNotice('error', { ...saved, resumeText: 'Edited.' }, saved, 'resumeText')).toBe(
      UNSAVED_AI_NOTICE,
    );
  });

  it("stays quiet on a section the failed edit didn't touch", () => {
    // A failed first-name save leaves documents and resume exactly as the AI sees them.
    expect(unsavedAiNotice('error', withNewName, saved, 'documents')).toBeNull();
    expect(unsavedAiNotice('error', withNewName, saved, 'resumeText')).toBeNull();
    expect(unsavedAiNotice('error', withNewDoc, saved, 'resumeText')).toBeNull();
  });

  it('never warns unless a save has actually failed', () => {
    // 'saving' is the 500ms debounce on its way to storage, not a divergence.
    for (const state of ['idle', 'saving', 'saved'] as const) {
      expect(unsavedAiNotice(state, withNewDoc, saved, 'documents'), state).toBeNull();
    }
  });
});
