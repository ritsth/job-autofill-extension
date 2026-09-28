import { AIError, type AIProvider, type GenerateInput } from './provider';
import { DEFAULT_MODEL } from './models';

// Google Gemini via the Generative Language REST API. The user supplies their
// own free AI Studio key (https://aistudio.google.com/apikey); it is read from
// storage and sent only to Google. Called from the background service worker so
// the key and the cross-origin request stay out of page context.

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Markers Google uses when the API key itself is the problem, rather than
 * anything about the request. Matched case-insensitively against the raw error
 * body, since the wrapper JSON around them varies.
 */
// Deliberately only key-SPECIFIC reasons. PERMISSION_DENIED is a status, not a
// reason: it also covers "this API is not enabled for the project" and
// tuned-model access errors, whose bodies name the actual fix. Matching on it
// would hide exactly the detail this function exists to preserve. A genuine key
// problem carries one of the markers below alongside it anyway.
const KEY_ERROR_MARKERS = [
  'API_KEY_INVALID',
  'API_KEY_SERVICE_BLOCKED',
  'API key not valid',
  'API key expired',
];

/**
 * Whether a 400/403 body is actually about the key. Exported for tests: the
 * distinction decides which of two very different instructions the user gets.
 */
export function isApiKeyError(detail: string): boolean {
  const upper = detail.toUpperCase();
  return KEY_ERROR_MARKERS.some((marker) => upper.includes(marker.toUpperCase()));
}

export class GeminiProvider implements AIProvider {
  readonly id = 'gemini';

  constructor(
    private apiKey: string,
    private model = DEFAULT_MODEL,
  ) {}

  async generate({ system, prompt, maxOutputTokens, json, thinking, model }: GenerateInput): Promise<string> {
    if (!this.apiKey) {
      throw new AIError('No Gemini API key set. Add one in the extension options.');
    }

    // Per-request override (free-text answers) wins; otherwise the fast default.
    const modelId = model || this.model;
    const url = `${ENDPOINT}/${encodeURIComponent(modelId)}:generateContent`;

    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: maxOutputTokens ?? 1024,
        // Gemini 2.5 models default thinking ON over REST, which can eat the
        // whole output budget and truncate the answer. Pin the budget: dynamic
        // (-1) when the caller opts in; otherwise off (0). thinkingConfig only
        // applies to 2.5 models. 2.5 Pro can't disable thinking (budget 0 is
        // rejected), so give it a small BOUNDED budget (1024) rather than the
        // dynamic -1, which would otherwise consume the output and truncate the
        // reply mid-sentence.
        ...(modelId.includes('2.5')
          ? {
              thinkingConfig: {
                thinkingBudget: thinking ? -1 : modelId.includes('2.5-pro') ? 1024 : 0,
              },
            }
          : {}),
        ...(json ? { responseMimeType: 'application/json' } : {}),
      },
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        // The key travels as a header, not a `?key=` query param — URLs leak
        // into logs and history; headers don't.
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new AIError(`Network error reaching Gemini: ${(e as Error).message}`);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      if (res.status === 400 || res.status === 403) {
        // Only blame the key when Google's own response says the key is the
        // problem, or when there is no body to go on. A 400 from this API is
        // more often something else entirely — an unavailable model, an
        // oversized payload, an INVALID_ARGUMENT on a generation-config field
        // (see the thinkingBudget note above) — and telling those users to
        // check a perfectly good key sends them somewhere useless while the
        // real reason, already fetched, goes unsaid (#329).
        if (!detail.trim() || isApiKeyError(detail)) {
          throw new AIError('Gemini rejected the request — check that your API key is valid.');
        }
        // Otherwise fall through: Google told us what's wrong, so pass it on.
      }
      if (res.status === 429) {
        throw new AIError('Gemini rate limit hit (free tier). Wait a minute and try again.');
      }
      throw new AIError(`Gemini error ${res.status}: ${detail.slice(0, 200)}`);
    }

    const data = (await res.json()) as GeminiResponse;
    const candidate = data.candidates?.[0];
    const text = (candidate?.content?.parts?.map((p) => p.text).join('') ?? '').trim();
    const finishReason = candidate?.finishReason;

    if (finishReason === 'SAFETY') {
      throw new AIError('Gemini blocked this response for safety reasons. Try rephrasing.');
    }
    if (finishReason === 'RECITATION') {
      throw new AIError(
        'Gemini blocked this response because it matched existing content too closely. Try rephrasing.',
      );
    }
    // MAX_TOKENS with a substantial answer already in hand is left alone —
    // the codebase spends real effort tuning thinkingBudget to avoid exactly
    // this (see above), and discarding a mostly-complete answer because the
    // budget ran out right at the end would be worse than returning it. Only
    // the case that matches what was actually observed in the wild — the
    // budget being exhausted before any real answer formed, e.g. a single
    // word ("Fellow") — gets its own message rather than the generic one.
    if (finishReason === 'MAX_TOKENS' && text.length < MIN_VIABLE_ANSWER_LENGTH) {
      throw new AIError(
        "Gemini's response was cut off before it could really start (ran out of output budget). Try again.",
      );
    }
    if (!text) {
      throw new AIError('Gemini returned an empty response. Try rephrasing or retry.');
    }
    return text;
  }
}

// Below this, a MAX_TOKENS cutoff reads as "the budget ran out almost
// immediately" rather than "a real answer got clipped near the end" — chosen
// well under the shortest legitimate reply this codebase asks for (the
// free-text answer prompt's own floor is "about 4-6 sentences").
//
// Exported so src/lib/ai/minViableAnswerLength.test.ts can hold it equal to
// server/classify.js's copy, which the standalone proxy cannot import (#316).
export const MIN_VIABLE_ANSWER_LENGTH = 40;

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
}
