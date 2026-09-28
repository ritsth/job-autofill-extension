import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiProvider, isApiKeyError } from './gemini';
import { AIError } from './provider';

function mockGeminiResponse(body: unknown, ok = true, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GeminiProvider — finishReason handling (#182)', () => {
  const generate = () =>
    new GeminiProvider('fake-key').generate({ system: 'sys', prompt: 'prompt' });

  it('returns the text unchanged on a normal STOP finish', async () => {
    mockGeminiResponse({
      candidates: [{ content: { parts: [{ text: 'A complete answer.' }] }, finishReason: 'STOP' }],
    });
    await expect(generate()).resolves.toBe('A complete answer.');
  });

  it('still returns the text when finishReason is absent (older/unversioned responses)', async () => {
    // No regression for responses that never carried finishReason at all —
    // this is the entire previous behavior of the function.
    mockGeminiResponse({ candidates: [{ content: { parts: [{ text: 'Some answer.' }] } }] });
    await expect(generate()).resolves.toBe('Some answer.');
  });

  it('names the cause when MAX_TOKENS cuts the response off almost immediately', async () => {
    // The actual reported failure: the model's thinking budget consumed the
    // entire output and left a single word.
    mockGeminiResponse({
      candidates: [{ content: { parts: [{ text: 'Fellow' }] }, finishReason: 'MAX_TOKENS' }],
    });
    await expect(generate()).rejects.toThrow(AIError);
    await expect(generate()).rejects.toThrow(/cut off/i);
  });

  it('does NOT throw for MAX_TOKENS once a substantial answer already formed', async () => {
    // Deliberate: discarding a mostly-complete answer because the budget ran
    // out right at the end would be worse than returning it. This is the
    // "leave partial-but-real output alone" half of the issue's proposed fix.
    const longAnswer =
      'This is a long, mostly complete answer that ran right up against the ' +
      'output budget and got cut off at the very end without finishing the l';
    mockGeminiResponse({
      candidates: [{ content: { parts: [{ text: longAnswer }] }, finishReason: 'MAX_TOKENS' }],
    });
    await expect(generate()).resolves.toBe(longAnswer);
  });

  it('reports a safety block distinctly instead of "empty response"', async () => {
    mockGeminiResponse({ candidates: [{ content: {}, finishReason: 'SAFETY' }] });
    await expect(generate()).rejects.toThrow(AIError);
    await expect(generate()).rejects.toThrow(/safety/i);
  });

  it('reports a recitation block distinctly instead of "empty response"', async () => {
    mockGeminiResponse({ candidates: [{ content: {}, finishReason: 'RECITATION' }] });
    await expect(generate()).rejects.toThrow(AIError);
    await expect(generate()).rejects.toThrow(/matched existing content/i);
  });

  it('falls back to the generic empty-response error for a truly empty, unflagged response', async () => {
    mockGeminiResponse({ candidates: [{ content: { parts: [{ text: '' }] }, finishReason: 'STOP' }] });
    await expect(generate()).rejects.toThrow(AIError);
    await expect(generate()).rejects.toThrow(/empty response/i);
  });

  it('trims whitespace-only text the same as empty', async () => {
    mockGeminiResponse({
      candidates: [{ content: { parts: [{ text: '   \n  ' }] }, finishReason: 'STOP' }],
    });
    await expect(generate()).rejects.toThrow(/empty response/i);
  });
});

// None of the HTTP status branches had a test before (#329) — only the
// finishReason handling above did. A 400 from this API is usually NOT about the
// key, so the branch that decides between "check your key" and the real reason
// is worth pinning.
describe('GeminiProvider — HTTP error responses (#329)', () => {
  const generate = () =>
    new GeminiProvider('test-key').generate({ system: 'sys', prompt: 'p' });

  /** Mocks a non-OK response whose body is raw text, as Google returns it. */
  function mockErrorResponse(status: number, body: string): void {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status,
        json: () => Promise.reject(new Error('not json')),
        text: () => Promise.resolve(body),
      }),
    );
  }

  /** Runs `generate()` expecting it to reject, and returns the thrown error. */
  async function rejection(): Promise<Error> {
    let caught: unknown;
    let threw = false;
    try {
      await generate();
    } catch (e) {
      threw = true;
      caught = e;
    }
    expect(threw).toBe(true);
    return caught as Error;
  }

  const KEY_INVALID_BODY = JSON.stringify({
    error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] },
  });

  const MODEL_MISSING_BODY = JSON.stringify({
    error: { code: 404, message: 'models/gemini-9.9-ultra is not found for API version v1beta', status: 'NOT_FOUND' },
  });

  const BAD_CONFIG_BODY = JSON.stringify({
    error: { code: 400, message: 'Unable to submit request because thinkingBudget is not supported by this model', status: 'INVALID_ARGUMENT' },
  });

  describe('when the body says the key is the problem', () => {
    it('tells the user to check their API key on a 400', async () => {
      mockErrorResponse(400, KEY_INVALID_BODY);
      await expect(generate()).rejects.toThrow(/check that your API key is valid/i);
    });

    it('tells the user to check their API key on a 403 PERMISSION_DENIED', async () => {
      mockErrorResponse(403, JSON.stringify({ error: { status: 'PERMISSION_DENIED' } }));
      await expect(generate()).rejects.toThrow(/check that your API key is valid/i);
    });
  });

  describe('when the body says something else', () => {
    it('surfaces an unsupported-config 400 instead of blaming the key', async () => {
      // The exact hazard the thinkingBudget comment in gemini.ts is about:
      // previously this read "check that your API key is valid", sending the
      // user to regenerate a key that was fine.
      mockErrorResponse(400, BAD_CONFIG_BODY);

      const err = await rejection();
      expect(err.message).toContain('thinkingBudget is not supported');
      expect(err.message).not.toMatch(/API key/i);
    });

    it('surfaces a missing-model error with its status code', async () => {
      mockErrorResponse(400, MODEL_MISSING_BODY);

      const err = await rejection();
      expect(err.message).toContain('400');
      expect(err.message).toContain('is not found for API version');
      expect(err.message).not.toMatch(/API key/i);
    });

    it('truncates a very long body rather than surfacing all of it', async () => {
      mockErrorResponse(400, 'x'.repeat(5000));

      const err = await rejection();
      expect(err.message.length).toBeLessThan(300);
    });
  });

  it('falls back to the key hint when there is no body to go on', async () => {
    // Nothing better to say, so keep the actionable guess rather than emitting
    // a bare "Gemini error 400: ".
    mockErrorResponse(400, '');
    await expect(generate()).rejects.toThrow(/check that your API key is valid/i);
  });

  it('reports a 429 as a rate limit, not a key problem', async () => {
    mockErrorResponse(429, JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED' } }));
    await expect(generate()).rejects.toThrow(/rate limit/i);
  });

  it('reports an unmapped status with its code and body', async () => {
    mockErrorResponse(500, 'upstream exploded');

    const err = await rejection();
    expect(err.message).toContain('500');
    expect(err.message).toContain('upstream exploded');
  });
});

describe('isApiKeyError', () => {
  it('recognises the markers Google uses for a key problem', () => {
    for (const marker of [
      'API_KEY_INVALID',
      'API_KEY_SERVICE_BLOCKED',
      'PERMISSION_DENIED',
      'API key not valid. Please pass a valid API key.',
      'API key expired. Please renew the API key.',
    ]) {
      expect(isApiKeyError(`{"error":{"message":"${marker}"}}`)).toBe(true);
    }
  });

  it('is case-insensitive', () => {
    expect(isApiKeyError('api_key_invalid')).toBe(true);
    expect(isApiKeyError('Api Key Not Valid')).toBe(true);
  });

  it('does not treat other request errors as key problems', () => {
    expect(isApiKeyError('thinkingBudget is not supported by this model')).toBe(false);
    expect(isApiKeyError('The request payload size exceeds the limit')).toBe(false);
    expect(isApiKeyError('models/foo is not found for API version v1beta')).toBe(false);
    expect(isApiKeyError('')).toBe(false);
  });
});
