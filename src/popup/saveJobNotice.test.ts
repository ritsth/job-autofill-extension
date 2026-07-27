import { describe, expect, it } from 'vitest';
import { saveJobNotice } from './Popup';
import { MAX_JOBS, MAX_TEXT } from '../lib/savedJobs';

describe('saveJobNotice', () => {
  it('is a plain confirmation when neither cap was hit', () => {
    expect(saveJobNotice({ truncated: false, evicted: false })).toBe('Job saved.');
  });

  it('reports a trimmed posting with the character cap', () => {
    const msg = saveJobNotice({ truncated: true, evicted: false });
    expect(msg).toContain(MAX_TEXT.toLocaleString());
    expect(msg).toContain('trimmed');
    expect(msg).not.toContain('oldest');
  });

  it('reports an evicted job with the list cap', () => {
    const msg = saveJobNotice({ truncated: false, evicted: true });
    expect(msg).toContain(String(MAX_JOBS));
    expect(msg).toContain('oldest');
    expect(msg).not.toContain('trimmed');
  });

  it('reports both when one save trips each cap', () => {
    // A long posting saved at capacity hits both; reporting only one would hide
    // the other, which is the silent data loss #85 is about.
    const msg = saveJobNotice({ truncated: true, evicted: true });
    expect(msg).toContain('trimmed');
    expect(msg).toContain('oldest');
    expect(msg.endsWith('.')).toBe(true);
  });
});
