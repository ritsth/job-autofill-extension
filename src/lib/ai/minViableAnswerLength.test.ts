// Cross-package contract test: the BYO-key path and the standalone managed
// proxy intentionally use the same cutoff when MAX_TOKENS stops too early.
// server/ ships by itself, so it cannot import the client constant; this test
// is the executable guard that keeps the two copies aligned (#316).

import { describe, expect, it } from 'vitest';
import { MIN_VIABLE_ANSWER_LENGTH as clientMinimum } from './gemini';
import { MIN_VIABLE_ANSWER_LENGTH as serverMinimum } from '../../../server/classify.js';

describe('minimum viable answer length stays in sync with the proxy', () => {
  it('uses one MAX_TOKENS cutoff in both AI paths', () => {
    expect(serverMinimum).toBe(clientMinimum);
  });
});