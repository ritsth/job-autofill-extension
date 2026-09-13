// Hand-written type declaration for request.js (plain JS, matching the rest of
// server/'s Node/ESM convention). This lets the TypeScript regression test
// import the pure parser with real type checking without turning on allowJs for
// the whole extension project.

type GenerateArgs = {
  system: string;
  prompt: string;
  maxOutputTokens: unknown;
  json: unknown;
  thinking: unknown;
  model: unknown;
};

export type GenerateBodyResult =
  | { ok: true; args: GenerateArgs; status?: never; error?: never }
  | { ok: false; status: number; error: string; args?: never };

export function parseGenerateBody(raw: string, maxPromptChars: number): GenerateBodyResult;
