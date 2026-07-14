import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnDeviceProvider } from './onDevice';

function installLanguageModel(response = '{"ok":true}') {
  const prompt = vi.fn().mockResolvedValue(response);
  const destroy = vi.fn();
  const create = vi.fn().mockResolvedValue({ prompt, destroy });
  vi.stubGlobal('self', { LanguageModel: { create } });
  return { create, destroy, prompt };
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
