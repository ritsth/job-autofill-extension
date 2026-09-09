// Contract test for #280: the managed proxy must not charge a daily quota slot
// for a request it rejects itself (400 missing prompt / 413 oversize), because
// those paths never reach Vertex and so incur no real cost.
//
// Why this reads source instead of calling the handler: server/index.js has
// top-level side effects (it constructs VertexAI/Firestore clients and calls
// http.createServer().listen at import time), so it cannot be imported into
// vitest. src/lib/ai/modelAllowlist.test.ts sets the precedent for guarding a
// server/index.js invariant by parsing the file; this follows it.
//
// The invariant is an ordering one: in the /generate handler, the validation
// that produces 400/413 must appear before the checkAndIncrementQuota call.
// The 5xx paths are deliberately not covered — they have already invoked
// Vertex, and the one-shot retry is documented as intentionally free.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SERVER_SOURCE = readFileSync(
  fileURLToPath(new URL('../../../server/index.js', import.meta.url)),
  'utf8',
);

/**
 * Index of a required marker in server/index.js. Throws rather than returning
 * -1, so a renamed or restructured declaration fails loudly here instead of
 * making an ordering comparison silently pass.
 */
function indexOfOrThrow(pattern: RegExp, what: string): number {
  const match = pattern.exec(SERVER_SOURCE);
  if (!match) {
    throw new Error(
      `Could not find ${what} in server/index.js — update this test if that code was renamed or restructured.`,
    );
  }
  return match.index;
}

const quotaCall = () =>
  indexOfOrThrow(/await checkAndIncrementQuota\(/, 'the checkAndIncrementQuota call');
const missingPromptGuard = () =>
  indexOfOrThrow(/Missing "prompt"/, "the 400 'Missing \"prompt\"' guard");
const oversizeGuard = () =>
  indexOfOrThrow(/prompt\.length > MAX_PROMPT_CHARS/, 'the 413 oversize guard');
const bodyRead = () => indexOfOrThrow(/await readBody\(req\)/, 'the readBody call');

describe('#280 — self-rejected requests are not metered', () => {
  it('rejects a missing prompt before consuming quota', () => {
    // Otherwise a 400 burns one of the user's DAILY_LIMIT slots for a request
    // that produced nothing.
    expect(missingPromptGuard()).toBeLessThan(quotaCall());
  });

  it('rejects an oversize prompt before consuming quota', () => {
    // The case from #251: once profileToContext pushes a user past
    // MAX_PROMPT_CHARS, every call 413s. Metering first would silently drain
    // their whole daily allowance — and the shared global ceiling — on
    // requests Vertex never saw.
    expect(oversizeGuard()).toBeLessThan(quotaCall());
  });

  it('reads the body before consuming quota', () => {
    // Both guards above depend on the parsed body, so the read has to precede
    // the meter for either of them to be checkable first.
    expect(bodyRead()).toBeLessThan(quotaCall());
  });

  it('still meters before calling Vertex', () => {
    // The other half of the invariant: moving validation earlier must not
    // leave generation itself unmetered.
    const generateCall = indexOfOrThrow(
      /let \{ text, finishReason \} = await generate\(args\)/,
      'the first generate() call',
    );
    expect(quotaCall()).toBeLessThan(generateCall);
  });

  it('locates distinct markers', () => {
    // Guards the parsing itself: if two regexes collided on one site, the
    // ordering assertions above would compare a position against itself.
    const positions = [bodyRead(), missingPromptGuard(), oversizeGuard(), quotaCall()];
    expect(new Set(positions).size).toBe(positions.length);
  });
});
