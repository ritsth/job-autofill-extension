import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from './gemini';
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
