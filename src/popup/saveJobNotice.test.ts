import { describe, expect, it } from 'vitest';
import { saveJobNotice } from './notices';
import { MAX_JOBS, MAX_TEXT } from '../lib/savedJobs';

describe('saveJobNotice', () => {
  it('is a plain confirmation when neither cap was hit', () => {
    expect(saveJobNotice({ keptExistingText: false, truncated: false, evicted: false })).toBe('Job saved.');
  });

  it('reports a trimmed posting with the character cap', () => {
    const msg = saveJobNotice({ keptExistingText: false, truncated: true, evicted: false });
    expect(msg).toContain(MAX_TEXT.toLocaleString());
    expect(msg).toContain('trimmed');
    expect(msg).not.toContain('oldest');
  });

  it('reports an evicted job with the list cap', () => {
    const msg = saveJobNotice({ keptExistingText: false, truncated: false, evicted: true });
    expect(msg).toContain(String(MAX_JOBS));
    expect(msg).toContain('oldest');
    expect(msg).not.toContain('trimmed');
  });

  it('reports both when one save trips each cap', () => {
    // A long posting saved at capacity hits both; reporting only one would hide
    // the other, which is the silent data loss #85 is about.
    const msg = saveJobNotice({ keptExistingText: false, truncated: true, evicted: true });
    expect(msg).toContain('trimmed');
    expect(msg).toContain('oldest');
    expect(msg.endsWith('.')).toBe(true);
  });

  it('explains that re-saving kept the original posting', () => {
    expect(saveJobNotice({ keptExistingText: true, truncated: false, evicted: false }))
      .toBe('Updated — kept the posting text from the first save.');
  });

  it('composes retained-text and eviction notices', () => {
    const msg = saveJobNotice({ keptExistingText: true, truncated: false, evicted: true });
    expect(msg).toContain('kept the posting text from the first save');
    expect(msg).toContain('oldest');
    expect(msg).not.toContain('trimmed');
  });

  it('never claims a trim when the outcome says existing text was kept', () => {
    const msg = saveJobNotice({ keptExistingText: true, truncated: true, evicted: false });
    expect(msg).toContain('kept the posting text');
    expect(msg).not.toContain('trimmed');
  });

});
