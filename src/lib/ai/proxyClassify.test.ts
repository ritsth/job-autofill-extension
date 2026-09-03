// server/classify.js has no top-level side effects (unlike server/index.js,
// which fires off VertexAI/Firestore clients and server.listen the moment it
// loads), so it's importable directly by a real test — see #285.

import { describe, expect, it } from 'vitest';
import { classifyFinishReason, MIN_VIABLE_ANSWER_LENGTH } from '../../../server/classify.js';

describe('classifyFinishReason', () => {
  it('returns the safety message for a SAFETY block, regardless of text', () => {
    expect(classifyFinishReason('SAFETY', '')).toBe(
      'This response was blocked for safety reasons. Try rephrasing.',
    );
    // A non-empty text alongside SAFETY still gets blocked — the finishReason
    // is authoritative, not the text length.
    expect(classifyFinishReason('SAFETY', 'x'.repeat(500))).toBe(
      'This response was blocked for safety reasons. Try rephrasing.',
    );
  });

  it('returns the recitation message for a RECITATION block, regardless of text', () => {
    expect(classifyFinishReason('RECITATION', '')).toBe(
      'This response was blocked because it matched existing content too closely. Try rephrasing.',
    );
    expect(classifyFinishReason('RECITATION', 'x'.repeat(500))).toBe(
      'This response was blocked because it matched existing content too closely. Try rephrasing.',
    );
  });

  it('returns the cut-off message for MAX_TOKENS with a short answer', () => {
    expect(classifyFinishReason('MAX_TOKENS', 'x'.repeat(MIN_VIABLE_ANSWER_LENGTH - 1))).toBe(
      'The response was cut off before it could really start (ran out of output budget). Try again.',
    );
  });

  it('pins the exact MIN_VIABLE_ANSWER_LENGTH boundary', () => {
    // One character under the threshold: still classified as "cut off".
    expect(classifyFinishReason('MAX_TOKENS', 'x'.repeat(39))).not.toBeNull();
    // Exactly at the threshold: no longer classified — a substantial answer,
    // not one that ran out of budget almost immediately.
    expect(classifyFinishReason('MAX_TOKENS', 'x'.repeat(40))).toBeNull();
    expect(classifyFinishReason('MAX_TOKENS', 'x'.repeat(41))).toBeNull();
  });

  it('does not discard a substantial MAX_TOKENS answer', () => {
    // A mostly-complete reply that simply hit the output cap is returned
    // as-is — discarding it would be worse than a slightly truncated answer.
    expect(classifyFinishReason('MAX_TOKENS', 'a real, substantial answer'.repeat(10))).toBeNull();
  });

  it('returns null for STOP with non-empty text (the normal, successful case)', () => {
    expect(classifyFinishReason('STOP', 'a normal answer')).toBeNull();
  });

  it('returns null for an undefined finishReason with non-empty text', () => {
    expect(classifyFinishReason(undefined, 'a normal answer')).toBeNull();
  });

  it('returns null for a genuinely empty response with no finishReason classification — the caller retries this case separately', () => {
    expect(classifyFinishReason('STOP', '')).toBeNull();
    expect(classifyFinishReason(undefined, '')).toBeNull();
  });
});
