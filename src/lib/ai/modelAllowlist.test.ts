// Cross-package contract test: the curated model list lives in this package
// (GEMINI_MODELS) and is mirrored by MODEL_ALLOWLIST in server/index.js. They
// can't share a module — Cloud Run deploys with `gcloud run deploy --source
// server`, so only the server/ folder is uploaded and a shared file outside it
// would not ship. This test is the guard instead: if the two drift, the proxy
// would reject a model the Options dropdown offers, and CI fails here first.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, GEMINI_MODELS } from './models';

const SERVER_SOURCE = readFileSync(
  fileURLToPath(new URL('../../../server/index.js', import.meta.url)),
  'utf8',
);

/**
 * Ids inside `const MODEL_ALLOWLIST = new Set([...])`. Throws rather than
 * returning empty if the declaration moves, so a silent pass is impossible.
 */
function serverAllowlist(): string[] {
  const block = /const MODEL_ALLOWLIST = new Set\(\[([\s\S]*?)\]\)/.exec(SERVER_SOURCE);
  if (!block) {
    throw new Error(
      'Could not find `const MODEL_ALLOWLIST = new Set([...])` in server/index.js — ' +
        'update this test if the declaration was renamed or restructured.',
    );
  }
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** The hardcoded fallback in `const MODEL = process.env.VERTEX_MODEL || '...'`. */
function serverDefaultModel(): string {
  const match = /const MODEL = process\.env\.VERTEX_MODEL \|\| '([^']+)'/.exec(SERVER_SOURCE);
  if (!match) {
    throw new Error(
      'Could not find the VERTEX_MODEL fallback in server/index.js — ' +
        'update this test if that declaration changed.',
    );
  }
  return match[1];
}

describe('model list stays in sync with the proxy', () => {
  it('server allowlist matches the curated client list exactly', () => {
    // Sorted so ordering differences between the two files are not failures.
    expect(serverAllowlist().sort()).toEqual(GEMINI_MODELS.map((m) => m.id).sort());
  });

  it("server's default model is one the client also offers", () => {
    // A fallback outside the curated list would be unreachable from the UI.
    expect(GEMINI_MODELS.map((m) => m.id)).toContain(serverDefaultModel());
  });

  it("server's default model is the client default", () => {
    // Otherwise an unset `model` in the request body silently uses a different
    // model than the dropdown shows as selected.
    expect(serverDefaultModel()).toBe(DEFAULT_MODEL);
  });

  it('parses a non-empty allowlist', () => {
    // Guards the regexes themselves: a parse that quietly yields [] would make
    // the comparison above pass only when the client list is empty too.
    expect(serverAllowlist().length).toBeGreaterThan(0);
  });
});
