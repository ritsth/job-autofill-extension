// Curated Gemini models the user can pick from in Options. Single source of
// truth for the dropdown and for default/normalization logic. All four ids exist
// on both AI Studio (BYO key, src/lib/ai/gemini.ts) and Vertex AI (the managed
// proxy, server/index.js). When this list changes, mirror it in the server's
// MODEL_ALLOWLIST so the proxy accepts the new ids.

export interface ModelOption {
  id: string;
  label: string;
}

export const GEMINI_MODELS: ModelOption[] = [
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro — best quality, slower' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash — fast (recommended)' },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite — fastest, cheapest' },
];

export const DEFAULT_MODEL = 'gemini-2.5-flash';

/** True if `id` is one of the curated models we offer. */
export function isKnownModel(id: string): boolean {
  return GEMINI_MODELS.some((m) => m.id === id);
}
