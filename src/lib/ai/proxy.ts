import { AIError, type AIProvider, type GenerateInput } from './provider';

// Managed-proxy provider: posts to the user's Cloud Run service, which holds the
// Google Cloud credential and relays to Vertex AI. The extension only knows the
// URL + a shared bearer token (both stored locally). Called from the background
// service worker; host_permissions cover https://*.run.app/*.

export class ProxyProvider implements AIProvider {
  readonly id = 'proxy';

  constructor(
    private url: string,
    private token: string,
  ) {}

  async generate({ system, prompt, maxOutputTokens, json, thinking }: GenerateInput): Promise<string> {
    if (!this.url) {
      throw new AIError('No proxy URL set. Add your Cloud Run URL in the extension options.');
    }

    let res: Response;
    try {
      res = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({ system, prompt, maxOutputTokens, json, thinking }),
      });
    } catch (e) {
      throw new AIError(`Could not reach the proxy: ${(e as Error).message}`);
    }

    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      const msg = (detail as { error?: string }).error || `${res.status}`;
      if (res.status === 401) throw new AIError('Proxy rejected the token — check your proxy token in options.');
      if (res.status === 429) throw new AIError('Vertex AI rate limit hit. Wait a moment and retry.');
      throw new AIError(`Proxy error: ${msg}`);
    }

    const data = (await res.json()) as { text?: string };
    const text = (data.text || '').trim();
    if (!text) throw new AIError('Proxy returned an empty response. Try again.');
    return text;
  }
}
