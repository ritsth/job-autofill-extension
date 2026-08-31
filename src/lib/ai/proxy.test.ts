import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProxyProvider } from './proxy';
import { AIError } from './provider';

function mockProxyResponse(body: unknown, status: number): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ProxyProvider — error passthrough vs. wrapping (#239)', () => {
  const generate = () =>
    new ProxyProvider('https://proxy.example.com/generate', 'tok').generate({
      system: 'sys',
      prompt: 'prompt',
    });

  /** The thrown AIError's message, for tests that assert on exact wording. */
  async function generateErrorMessage(): Promise<string> {
    try {
      await generate();
      throw new Error('expected generate() to reject');
    } catch (e) {
      return (e as Error).message;
    }
  }

  it('returns the text unchanged on 200', async () => {
    mockProxyResponse({ text: 'A complete answer.' }, 200);
    await expect(generate()).resolves.toBe('A complete answer.');
  });

  it('surfaces the sign-in message verbatim, not double-wrapped', async () => {
    mockProxyResponse({ error: 'Sign in to use the managed AI.' }, 401);
    await expect(generate()).rejects.toThrow(AIError);
    await expect(generate()).rejects.toThrow('Sign in to use the managed AI.');
  });

  it('surfaces the daily-limit message verbatim', async () => {
    mockProxyResponse({ error: 'Daily limit reached (50/day). Resets at midnight UTC.' }, 429);
    await expect(generate()).rejects.toThrow('Daily limit reached (50/day). Resets at midnight UTC.');
  });

  // The three cases below are what #239 added: server/index.js's
  // classifyFinishReason now curates a full message for a safety/recitation
  // block or a near-empty MAX_TOKENS truncation, mirroring GeminiProvider's own
  // finishReason handling. Sent at 502 (see server/index.js), which must pass
  // through unprefixed the same way 401/429 already do — a user on the BYO-key
  // Gemini path and a user on the managed proxy should read an identical cause
  // for an identical failure, not "Proxy error: <the same sentence>".
  it('surfaces a safety-block message verbatim, without a "Proxy error:" prefix', async () => {
    mockProxyResponse({ error: 'This response was blocked for safety reasons. Try rephrasing.' }, 502);
    await expect(generate()).rejects.toThrow(AIError);
    const message = await generateErrorMessage();
    expect(message).toBe('This response was blocked for safety reasons. Try rephrasing.');
    expect(message).not.toMatch(/^Proxy error:/);
  });

  it('surfaces a recitation-block message verbatim', async () => {
    mockProxyResponse(
      { error: 'This response was blocked because it matched existing content too closely. Try rephrasing.' },
      502,
    );
    expect(await generateErrorMessage()).toBe(
      'This response was blocked because it matched existing content too closely. Try rephrasing.',
    );
  });

  it('surfaces a truncated-response message verbatim', async () => {
    mockProxyResponse(
      { error: 'The response was cut off before it could really start (ran out of output budget). Try again.' },
      502,
    );
    expect(await generateErrorMessage()).toBe(
      'The response was cut off before it could really start (ran out of output budget). Try again.',
    );
  });

  it('still prefixes an unexpected failure with "Proxy error:" for context', async () => {
    // Everything that ISN'T one of the curated, complete messages above still
    // gets the prefix — losing it there would make a bare status code or an
    // unrelated failure read as if it were the whole story.
    mockProxyResponse({ error: 'Quota check failed. Try again.' }, 500);
    expect(await generateErrorMessage()).toBe('Proxy error: Quota check failed. Try again.');
  });

  it('falls back to the status code when the body has no error field', async () => {
    mockProxyResponse({}, 500);
    expect(await generateErrorMessage()).toBe('Proxy error: 500');
  });

  it('throws when the 200 response has no usable text', async () => {
    mockProxyResponse({ text: '' }, 200);
    await expect(generate()).rejects.toThrow(/empty response/i);
  });
});
