import { afterEach, describe, expect, it, vi } from 'vitest';
import { isOnDeviceAvailable, OnDeviceProvider } from './onDevice';

function installLanguageModel(response = '{"ok":true}') {
  const prompt = vi.fn().mockResolvedValue(response);
  const destroy = vi.fn();
  const create = vi.fn().mockResolvedValue({ prompt, destroy });
  vi.stubGlobal('self', { LanguageModel: { create } });
  return { create, destroy, prompt };
}

// Stubs just enough of `self` to exercise one availability/capabilities shape.
// `global` lets a case target the older self.ai.languageModel path instead of
// the newer top-level LanguageModel.
function installAvailability(
  shape: { availability?: () => unknown; capabilities?: () => unknown },
  global: 'LanguageModel' | 'ai.languageModel' = 'LanguageModel',
) {
  const lm = { create: vi.fn(), ...shape };
  vi.stubGlobal(
    'self',
    global === 'LanguageModel' ? { LanguageModel: lm } : { ai: { languageModel: lm } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OnDeviceProvider', () => {
  it('asks for JSON-only output when a caller requests JSON mode', async () => {
    const { create, destroy, prompt } = installLanguageModel();

    const result = await new OnDeviceProvider().generate({
      system: 'Extract structured data.',
      prompt: 'RESUME: Ada Lovelace',
      json: true,
    });

    expect(result).toBe('{"ok":true}');
    expect(create).toHaveBeenCalledWith({
      initialPrompts: [{ role: 'system', content: 'Extract structured data.' }],
    });
    expect(prompt).toHaveBeenCalledWith(
      'RESUME: Ada Lovelace\n\nReturn only valid JSON. Do not use Markdown code fences or include explanatory text.',
    );
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('leaves plain-text requests unchanged', async () => {
    const { prompt } = installLanguageModel('A tailored answer.');

    await new OnDeviceProvider().generate({
      system: 'Write an answer.',
      prompt: 'Why are you interested in this role?',
    });

    expect(prompt).toHaveBeenCalledWith('Why are you interested in this role?');
  });
});

describe('isOnDeviceAvailable', () => {
  it('is false when no on-device model global is present', async () => {
    vi.stubGlobal('self', {});
    expect(await isOnDeviceAvailable()).toBe(false);
  });

  it.each(['available', 'downloadable', 'downloading'])(
    'is true when availability() reports "%s"',
    async (status) => {
      installAvailability({ availability: vi.fn().mockResolvedValue(status) });
      expect(await isOnDeviceAvailable()).toBe(true);
    },
  );

  it.each(['unavailable', 'no'])(
    'is false when availability() reports "%s"',
    async (status) => {
      installAvailability({ availability: vi.fn().mockResolvedValue(status) });
      expect(await isOnDeviceAvailable()).toBe(false);
    },
  );

  it('falls back to capabilities() when availability() is absent', async () => {
    installAvailability({ capabilities: vi.fn().mockResolvedValue({ available: 'readily' }) });
    expect(await isOnDeviceAvailable()).toBe(true);
  });

  it('is false when capabilities() reports "no"', async () => {
    installAvailability({ capabilities: vi.fn().mockResolvedValue({ available: 'no' }) });
    expect(await isOnDeviceAvailable()).toBe(false);
  });

  it('prefers availability() over capabilities() when both are present', async () => {
    // If this ever regresses to preferring capabilities(), a model that only
    // reports readiness via availability() would be reported as false.
    const capabilities = vi.fn().mockResolvedValue({ available: 'no' });
    installAvailability({ availability: vi.fn().mockResolvedValue('available'), capabilities });
    expect(await isOnDeviceAvailable()).toBe(true);
    expect(capabilities).not.toHaveBeenCalled();
  });

  it('detects the older self.ai.languageModel global the same way', async () => {
    installAvailability(
      { availability: vi.fn().mockResolvedValue('available') },
      'ai.languageModel',
    );
    expect(await isOnDeviceAvailable()).toBe(true);
  });

  it('is false, not a rejected promise, when availability() throws', async () => {
    installAvailability({ availability: vi.fn().mockRejectedValue(new Error('boom')) });
    await expect(isOnDeviceAvailable()).resolves.toBe(false);
  });

  it('is false, not a rejected promise, when capabilities() throws', async () => {
    installAvailability({ capabilities: vi.fn().mockRejectedValue(new Error('boom')) });
    await expect(isOnDeviceAvailable()).resolves.toBe(false);
  });
});
