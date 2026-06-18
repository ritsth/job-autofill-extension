import { AIError, type AIProvider, type GenerateInput } from './provider';

// Managed-proxy provider: posts to the Cloud Run service, which holds the Google
// Cloud credential and relays to Vertex AI. `token` is the bearer to send — the
// user's Google sign-in token (the proxy meters it per user), or an admin token
// that bypasses metering. The caller resolves which one. Called from the
// background service worker; host_permissions cover https://*.run.app/*.

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
      // The proxy already returns clear messages for sign-in (401) and the daily
      // quota / rate limit (429), so surface those verbatim.
      if (res.status === 401 || res.status === 429) throw new AIError(msg);
      throw new AIError(`Proxy error: ${msg}`);
    }

    const data = (await res.json()) as { text?: string };
    const text = (data.text || '').trim();
    if (!text) throw new AIError('Proxy returned an empty response. Try again.');
    return text;
  }
}
