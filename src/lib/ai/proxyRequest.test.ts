// server/request.js has no top-level side effects (unlike server/index.js,
// which fires off VertexAI/Firestore clients and server.listen the moment it
// loads), so it's importable directly by a real test — the same split that
// #285 made for classify.js.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseGenerateBody } from '../../../server/request.js';

const MAX = 200_000;

describe('parseGenerateBody', () => {
  it('accepts a normal body and passes the generation options through', () => {
    const raw = JSON.stringify({
      prompt: 'write a cover letter',
      system: 'you are helpful',
      maxOutputTokens: 512,
      json: true,
      thinking: false,
      model: 'gemini-2.5-flash',
    });
    const result = parseGenerateBody(raw, MAX);

    expect(result.ok).toBe(true);
    expect(result.args).toEqual({
      prompt: 'write a cover letter',
      system: 'you are helpful',
      maxOutputTokens: 512,
      json: true,
      thinking: false,
      model: 'gemini-2.5-flash',
    });
  });

  it('defaults system to an empty string when absent', () => {
    const result = parseGenerateBody(JSON.stringify({ prompt: 'hi' }), MAX);
    expect(result).toEqual({
      ok: true,
      args: {
        system: '',
        prompt: 'hi',
        maxOutputTokens: undefined,
        json: undefined,
        thinking: undefined,
        model: undefined,
      },
    });
  });

  it('rejects a missing or empty prompt with 400', () => {
    for (const raw of ['', '{}', JSON.stringify({ prompt: '' })]) {
      expect(parseGenerateBody(raw, MAX)).toEqual({
        ok: false,
        status: 400,
        error: 'Missing "prompt"',
      });
    }
  });

  it('rejects a non-string prompt with 400 rather than reading .length off it', () => {
    // The body is attacker-controlled JSON. A number prompt has no .length, so
    // an untyped size check would read undefined and wave an arbitrary payload
    // straight past the cap.
    for (const prompt of [42, { text: 'x' }, ['x'], true]) {
      const result = parseGenerateBody(JSON.stringify({ prompt }), MAX);
      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
    }
  });

  it('rejects a non-string system with 400', () => {
    const result = parseGenerateBody(JSON.stringify({ prompt: 'hi', system: 7 }), MAX);
    expect(result).toEqual({ ok: false, status: 400, error: 'Invalid "system"' });
  });

  it('rejects malformed JSON with 400, not a 500 "generation failed"', () => {
    expect(parseGenerateBody('{not json', MAX)).toEqual({
      ok: false,
      status: 400,
      error: 'Invalid JSON body',
    });
  });

  it('rejects a JSON array or null body with 400', () => {
    expect(parseGenerateBody('[]', MAX).status).toBe(400);
    expect(parseGenerateBody('null', MAX).status).toBe(400);
  });

  it('rejects an oversized prompt with 413 at the exact cap', () => {
    expect(parseGenerateBody(JSON.stringify({ prompt: 'x'.repeat(MAX) }), MAX).ok).toBe(true);
    expect(parseGenerateBody(JSON.stringify({ prompt: 'x'.repeat(MAX + 1) }), MAX)).toEqual({
      ok: false,
      status: 413,
      error: 'Request too large.',
    });
  });

  it('rejects an oversized system with 413 even when the prompt fits', () => {
    const raw = JSON.stringify({ prompt: 'hi', system: 'x'.repeat(MAX + 1) });
    expect(parseGenerateBody(raw, MAX).status).toBe(413);
  });
});

describe('the /generate handler meters only servable requests (#280)', () => {
  // The bug this guards is an ORDERING bug, and ordering is not observable from
  // request.js alone: index.js can never be imported (top-level VertexAI,
  // Firestore and server.listen). A source scan is the honest instrument here —
  // verified failing against the pre-fix ordering, where the quota call sat
  // above the body read.
  const source = readFileSync(new URL('../../../server/index.js', import.meta.url), 'utf8');

  const meterCall = 'await checkAndIncrementQuota(';
  const generateCall = 'await generate(args)';

  it('validates the body before it increments the quota', () => {
    const validated = source.indexOf('parseGenerateBody(raw');
    const metered = source.indexOf(meterCall);

    expect(validated).toBeGreaterThan(-1);
    expect(metered).toBeGreaterThan(-1);
    // A 400/413 never reaches Vertex, so charging a daily slot for it spends
    // the user's allowance — and the shared global ceiling — on nothing.
    expect(validated).toBeLessThan(metered);
  });

  it('reads the body before it increments the quota', () => {
    expect(source).toContain('if (overflowed) return;');
    expect(source).toContain("data = '';");
    expect(source.indexOf('raw = await readBody(req)')).toBeLessThan(source.indexOf(meterCall));
  });

  it('still counts a request that reached Vertex', () => {
    // The 5xx paths are deliberately NOT refunded: they invoked Vertex, so real
    // cost was incurred, and the one-shot retry is documented as free precisely
    // because the increment already happened.
    expect(source.indexOf(meterCall)).toBeLessThan(source.indexOf(generateCall));
  });
});
