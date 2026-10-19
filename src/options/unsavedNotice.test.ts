import { describe, expect, it } from 'vitest';
import { UNSAVED_AI_NOTICE, unsavedAiNotice } from './unsavedNotice';

describe('unsavedAiNotice (#361)', () => {
  it('warns only while a save has failed', () => {
    expect(unsavedAiNotice('error')).toBe(UNSAVED_AI_NOTICE);
    // 'saving' is a 500ms debounce on the way to storage, not a divergence.
    for (const state of ['idle', 'saving', 'saved'] as const) {
      expect(unsavedAiNotice(state), state).toBeNull();
    }
  });

  it('says what the AI is actually using', () => {
    expect(UNSAVED_AI_NOTICE).toMatch(/last saved profile/);
  });
});
