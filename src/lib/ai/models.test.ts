import { describe, it, expect } from 'vitest';
import { GEMINI_MODELS, DEFAULT_MODEL, isKnownModel } from './models';

describe('isKnownModel', () => {
  it('accepts every curated model id', () => {
    for (const m of GEMINI_MODELS) {
      expect(isKnownModel(m.id)).toBe(true);
    }
  });

  it('accepts the default model', () => {
    expect(isKnownModel(DEFAULT_MODEL)).toBe(true);
  });

  it('rejects unknown, empty, or malformed ids', () => {
    expect(isKnownModel('gpt-4')).toBe(false);
    expect(isKnownModel('gemini-1.0-pro')).toBe(false);
    expect(isKnownModel('')).toBe(false);
    expect(isKnownModel('GEMINI-2.5-FLASH')).toBe(false); // case-sensitive
  });
});

describe('GEMINI_MODELS', () => {
  it('has unique ids and non-empty labels', () => {
    const ids = GEMINI_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of GEMINI_MODELS) expect(m.label.trim().length).toBeGreaterThan(0);
  });

  it('includes the default model', () => {
    expect(GEMINI_MODELS.some((m) => m.id === DEFAULT_MODEL)).toBe(true);
  });
});
