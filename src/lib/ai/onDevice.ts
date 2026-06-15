import { AIError, type AIProvider, type GenerateInput } from './provider';

// Chrome's built-in on-device model (Gemini Nano) via the Prompt API.
// No key, no network, fully private — but only available on machines/Chrome
// builds where the model is downloaded. The API surface has shifted across
// Chrome versions, so we feature-detect both the newer `LanguageModel` global
// and the older `self.ai.languageModel` shape.

interface PromptSession {
  prompt(input: string): Promise<string>;
  destroy?(): void;
}

interface LanguageModelLike {
  availability?(): Promise<string>;
  capabilities?(): Promise<{ available: string }>;
  create(opts?: { initialPrompts?: Array<{ role: string; content: string }> }): Promise<PromptSession>;
}

function getLanguageModel(): LanguageModelLike | null {
  const g = self as unknown as {
    LanguageModel?: LanguageModelLike;
    ai?: { languageModel?: LanguageModelLike };
  };
  return g.LanguageModel ?? g.ai?.languageModel ?? null;
}

export async function isOnDeviceAvailable(): Promise<boolean> {
  const lm = getLanguageModel();
  if (!lm) return false;
  try {
    if (lm.availability) {
      const a = await lm.availability();
      return a === 'available' || a === 'downloadable' || a === 'downloading';
    }
    if (lm.capabilities) {
      const c = await lm.capabilities();
      return c.available !== 'no';
    }
  } catch {
    return false;
  }
  return false;
}

export class OnDeviceProvider implements AIProvider {
  readonly id = 'onDevice';

  async generate({ system, prompt }: GenerateInput): Promise<string> {
    const lm = getLanguageModel();
    if (!lm) {
      throw new AIError(
        "Chrome's built-in AI isn't available here. Switch to Gemini in options, or " +
          'enable the on-device model in a supported Chrome build.',
      );
    }

    let session: PromptSession;
    try {
      session = await lm.create({ initialPrompts: [{ role: 'system', content: system }] });
    } catch (e) {
      throw new AIError(`Could not start the on-device model: ${(e as Error).message}`);
    }

    try {
      const text = await session.prompt(prompt);
      if (!text.trim()) throw new AIError('On-device model returned an empty response.');
      return text.trim();
    } finally {
      session.destroy?.();
    }
  }
}
