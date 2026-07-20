import { describe, expect, it } from 'vitest';
import { isJobTextTruncated, MAX_TEXT } from './savedJobs';

describe('isJobTextTruncated — save cap boundary', () => {
  it('is false at or below the cap', () => {
    expect(isJobTextTruncated('')).toBe(false);
    expect(isJobTextTruncated('a'.repeat(MAX_TEXT - 1))).toBe(false);
    expect(isJobTextTruncated('a'.repeat(MAX_TEXT))).toBe(false);
  });

  it('is true one character past the cap', () => {
    expect(isJobTextTruncated('a'.repeat(MAX_TEXT + 1))).toBe(true);
  });
});
