import { beforeEach, describe, it, expect } from 'vitest';
import {
  clearAiVerdictCache,
  getCachedAiVerdict,
  setCachedAiVerdict,
} from './sponsorship';
import type { SponsorAnalysis } from './sponsorship';

/**
 * The AI eligibility cache is keyed by a 32-bit hash of the scanned posting
 * text. Two different postings can land on the same key, and serving one's
 * verdict for the other would report its sponsorship / citizenship / clearance
 * requirements on an unrelated job — wrong in the one direction the applicant
 * cannot check (#331).
 */
describe('AI eligibility verdict cache', () => {
  beforeEach(clearAiVerdictCache);

  const verdict = (reason: string): SponsorAnalysis => ({
    verdict: 'yes',
    restrictions: [],
    cautions: [],
    positives: ['Sponsorship available'],
    experience: { required: null, preferred: null },
    reason,
    source: 'ai',
  });

  // A REAL collision, not a contrived one: djb2 truncated to 32 bits is affine
  // in its running state, so an equal-length colliding pair ("ara" / "c0a")
  // still collides with any shared prefix and suffix around it. These are two
  // genuinely different postings — same role, different requisition code —
  // whose scanned text hashes identically.
  const PREFIX = 'Senior Backend Engineer at Acme. We sponsor H-1B visas for this role. Ref ';
  const SUFFIX = '-2024. Apply on our careers site.';
  const postingA = `${PREFIX}ara${SUFFIX}`;
  const postingB = `${PREFIX}c0a${SUFFIX}`;

  it('serves a cached verdict back for the exact text it was stored under', () => {
    setCachedAiVerdict(postingA, verdict('posting A'));

    expect(getCachedAiVerdict(postingA)?.reason).toBe('posting A');
  });

  it('does not serve one posting\'s verdict for a different posting that hashes the same', () => {
    // Guard the premise first: if this pair ever stops colliding, the test
    // below would pass for the wrong reason and prove nothing.
    expect(postingA).not.toBe(postingB);
    setCachedAiVerdict(postingA, verdict('posting A'));
    // A collision means postingB finds A's entry by key — the text check is the
    // only thing standing between it and A's verdict.
    expect(getCachedAiVerdict(postingB)).toBeNull();
  });

  it('caches the colliding postings independently rather than one evicting the other', () => {
    setCachedAiVerdict(postingA, verdict('posting A'));
    setCachedAiVerdict(postingB, verdict('posting B'));

    // Same key, so B overwrites A's slot — A must then miss cleanly and get a
    // fresh read, never B's verdict.
    expect(getCachedAiVerdict(postingB)?.reason).toBe('posting B');
    expect(getCachedAiVerdict(postingA)).toBeNull();
  });

  it('misses cleanly for text that was never cached', () => {
    expect(getCachedAiVerdict('a posting nobody has analysed')).toBeNull();
  });

  it('treats a posting whose text merely changed as a miss', () => {
    // The watcher re-reads the page constantly; an edited posting is a
    // different posting as far as the verdict is concerned.
    setCachedAiVerdict(postingA, verdict('posting A'));

    expect(getCachedAiVerdict(`${postingA} Updated: now fully remote.`)).toBeNull();
  });
});
