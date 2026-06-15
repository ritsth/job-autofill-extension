// Pluggable AI provider interface. v1 ships Gemini (BYO-key) and an on-device
// fallback. v2's Cloud Run "managed mode" will add a ProxyProvider implementing
// this same interface — nothing else in the codebase needs to change.

export interface GenerateInput {
  /** High-level instruction / persona for the model. */
  system: string;
  /** The concrete task + context (profile, question, etc.). */
  prompt: string;
  /** Optional output budget (e.g. résumé parsing needs more than a short answer). */
  maxOutputTokens?: number;
  /** Request strict JSON output (sets the model's JSON response mode). */
  json?: boolean;
}

export interface AIProvider {
  readonly id: string;
  generate(input: GenerateInput): Promise<string>;
}

export class AIError extends Error {}
