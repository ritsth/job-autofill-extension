// Pure classification of a Vertex AI finishReason into the message the user
// sees, if any. Split out from index.js (see #285) so it can be imported
// directly by a test — index.js itself can't be imported for testing: it has
// unconditional top-level side effects (new VertexAI(...), new Firestore(...),
// server.listen(...)) that fire the moment the module loads. This file has
// none, so it's freely importable.
//
// Mirrors src/lib/ai/gemini.ts's finishReason handling, so a safety block or a
// truncated response reads the same to the user whether they're on the BYO-key
// Gemini path or this managed proxy (#239 — the proxy used to discard
// finishReason entirely and could only ever say "empty response"). Duplicated
// rather than imported from gemini.ts: server/ is a standalone Cloud Run
// deployable with its own package.json, not built alongside the extension, so
// there is no shared module to import from — keep the two in sync by hand if
// either changes.
//
// Wording deliberately does NOT say "Gemini" (unlike gemini.ts) — every other
// message in this file speaks generically ("the managed AI", "the AI service")
// since the proxy never discloses which model runs behind it.

export const MIN_VIABLE_ANSWER_LENGTH = 40;

/**
 * @param {string | undefined} finishReason
 * @param {string} text
 * @returns {string | null} the curated message to show the user, or null when
 *   the response should be treated as usable (including "genuinely empty",
 *   which the caller retries separately).
 */
export function classifyFinishReason(finishReason, text) {
  if (finishReason === 'SAFETY') {
    return 'This response was blocked for safety reasons. Try rephrasing.';
  }
  if (finishReason === 'RECITATION') {
    return 'This response was blocked because it matched existing content too closely. Try rephrasing.';
  }
  // A short MAX_TOKENS answer means the output budget ran out almost
  // immediately, not that a real answer got clipped near the end — same
  // reasoning and threshold as gemini.ts. A substantial MAX_TOKENS answer is
  // returned as-is; discarding a mostly-complete reply would be worse.
  if (finishReason === 'MAX_TOKENS' && text.length < MIN_VIABLE_ANSWER_LENGTH) {
    return 'The response was cut off before it could really start (ran out of output budget). Try again.';
  }
  return null;
}
