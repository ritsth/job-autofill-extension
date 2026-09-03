// Hand-written type declaration for classify.js (plain JS, matching the rest
// of server/'s Node/ESM convention — see eslint.config.js's "Server — plain
// JavaScript" block). This lets a TypeScript test import it with real type
// checking (tsc --noEmit can't infer types across a .js import without one:
// TS7016 "implicitly has an 'any' type") without turning on `allowJs` for the
// whole project or pulling server/ into tsconfig's `include`.
//
// Keep in sync with classify.js by hand — there's no build step wiring the two
// together automatically, same as classify.js and gemini.ts are kept in sync
// by hand for the same underlying reason (server/ ships standalone).

export const MIN_VIABLE_ANSWER_LENGTH: number;
export function classifyFinishReason(finishReason: string | undefined, text: string): string | null;
