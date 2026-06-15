import { AIError, type AIProvider, type GenerateInput } from './provider';

// Google Gemini via the Generative Language REST API. The user supplies their
// own free AI Studio key (https://aistudio.google.com/apikey); it is read from
// storage and sent only to Google. Called from the background service worker so
// the key and the cross-origin request stay out of page context.

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export class GeminiProvider implements AIProvider {
  readonly id = 'gemini';

  constructor(
    private apiKey: string,
    private model = 'gemini-2.0-flash',
  ) {}

  async generate({ system, prompt, maxOutputTokens, json }: GenerateInput): Promise<string> {
    if (!this.apiKey) {
      throw new AIError('No Gemini API key set. Add one in the extension options.');
    }

    const url = `${ENDPOINT}/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(
      this.apiKey,
    )}`;

    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: maxOutputTokens ?? 1024,
        ...(json ? { responseMimeType: 'application/json' } : {}),
      },
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new AIError(`Network error reaching Gemini: ${(e as Error).message}`);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      if (res.status === 400 || res.status === 403) {
        throw new AIError('Gemini rejected the request — check that your API key is valid.');
      }
      if (res.status === 429) {
        throw new AIError('Gemini rate limit hit (free tier). Wait a minute and try again.');
      }
      throw new AIError(`Gemini error ${res.status}: ${detail.slice(0, 200)}`);
    }

    const data = (await res.json()) as GeminiResponse;
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
    if (!text.trim()) {
      throw new AIError('Gemini returned an empty response. Try rephrasing or retry.');
    }
    return text.trim();
  }
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}
