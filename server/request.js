// Pure parsing and validation of a /generate request body, split out of
// index.js the same way classify.js was (see #285): index.js has unconditional
// top-level side effects (new VertexAI(...), new Firestore(...),
// server.listen(...)) and can never be imported by a test, this file has none.
//
// Kept pure on purpose — it is the half of the handler that decides whether a
// request is servable at all, and #280 is precisely a bug about *when* that
// decision runs relative to metering. Having it callable from a test is what
// lets the ordering be checked without GCP credentials.

/**
 * @typedef {{ status: number, error: string }} GenerateBodyRejection
 * @typedef {{
 *   system: string,
 *   prompt: string,
 *   maxOutputTokens: unknown,
 *   json: unknown,
 *   thinking: unknown,
 *   model: unknown,
 * }} GenerateArgs
 */

/**
 * Decide whether a raw request body is servable, without touching quota,
 * Vertex, or anything else with a side effect.
 *
 * @param {string} raw the request body as read off the socket
 * @param {number} maxPromptChars server cap on prompt and system length
 * @returns {{ ok: true, args: GenerateArgs } | { ok: false } & GenerateBodyRejection}
 */
export function parseGenerateBody(raw, maxPromptChars) {
  let body;
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    // Previously this fell through to the handler's catch-all and surfaced as
    // "Generation failed. Try again." — a 500 for what is squarely a client
    // error, and (before #280) one the user was charged for.
    return { ok: false, status: 400, error: 'Invalid JSON body' };
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, error: 'Invalid JSON body' };
  }

  const { system = '', prompt = '', maxOutputTokens, json, thinking, model } = body;
  // The body is attacker-controlled JSON, so never trust its types: a
  // non-string prompt would otherwise reach .length below and read as
  // undefined, slipping past the size cap.
  if (typeof prompt !== 'string' || !prompt) {
    return { ok: false, status: 400, error: 'Missing "prompt"' };
  }
  if (typeof system !== 'string') {
    return { ok: false, status: 400, error: 'Invalid "system"' };
  }
  if (prompt.length > maxPromptChars || system.length > maxPromptChars) {
    return { ok: false, status: 413, error: 'Request too large.' };
  }

  return { ok: true, args: { system, prompt, maxOutputTokens, json, thinking, model } };
}
