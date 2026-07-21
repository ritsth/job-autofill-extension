import { describe, expect, it } from 'vitest';
import { canGenerateDocuments } from './Popup';

describe('canGenerateDocuments', () => {
  it('is true only when both company and role have non-whitespace text', () => {
    expect(canGenerateDocuments('Acme', 'Engineer')).toBe(true);
  });

  it('is false when either field is empty', () => {
    expect(canGenerateDocuments('', 'Engineer')).toBe(false);
    expect(canGenerateDocuments('Acme', '')).toBe(false);
    expect(canGenerateDocuments('', '')).toBe(false);
  });

  it('treats whitespace-only input as blank', () => {
    expect(canGenerateDocuments('   ', 'Engineer')).toBe(false);
    expect(canGenerateDocuments('Acme', '\t\n')).toBe(false);
  });
});
