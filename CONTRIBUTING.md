# Contributing to Little AI Helper

Thanks for your interest in improving Little AI Helper! This is a Chrome (MV3)
extension that autofills job applications and drafts AI answers. Contributions of
all sizes are welcome — bug fixes, accessibility improvements, tests, and docs.

By contributing, you agree that your contributions are licensed under the project's
[MIT License](LICENSE).

## Ways to contribute

- **Good first issues** — check the [issues labeled `good first issue`](https://github.com/ritsth/job-autofill-extension/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).
  These are scoped to be small, self-contained, and low-risk (accessibility labels,
  small UX guards, unit tests for pure helpers, docs).
- **Bugs** — open an issue using the bug report template. Include the job site,
  steps to reproduce, and what you expected.
- **Features** — open a feature request first so we can align on scope before you
  invest time.

## Prerequisites

- **Node.js 20+** and npm (the server also targets Node ≥20).
- Google Chrome (or another Chromium browser) for loading the unpacked extension.

## Getting started

```bash
git clone https://github.com/ritsth/job-autofill-extension.git
cd job-autofill-extension
npm install
```

### Run it locally

```bash
npm run build          # type-check + build into dist/
```

Then load it in Chrome:

1. Go to `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `dist/` folder.
4. After code changes, run `npm run build` again and hit the **reload** icon on the
   extension card. If a job page was already open, refresh that tab too.

> `npm run dev` (Vite) is available for HMR while iterating on the popup/options UI,
> but content-script and manifest changes are most reliably tested via `npm run build`
> + reload-unpacked.

## Project layout

```
src/
  background/   Service worker (messaging hub between popup and content scripts)
  content/      Content scripts: ATS adapters, eligibility scanner, job capture
  lib/          Shared logic: AI providers/prompts, profile & saved-jobs storage,
                document parsing, host matching
  options/      Settings page
  popup/        Side-panel UI (the main surface)
  ui/           Shared styles
server/         Cloud Run proxy (Node, relays to Vertex AI) — not needed for most
                extension work; see server/README.md if you touch it
docs/           Architecture, security, and deployment notes
```

## Before you open a pull request

All four of these must pass — they're exactly what CI enforces:

```bash
npm run lint         # ESLint (0 errors; warnings are allowed but avoid adding new ones)
npm run typecheck    # tsc --noEmit (strict mode)
npm test             # Vitest unit tests
npm run build        # full production build
```

## Coding guidelines

- **TypeScript, strict mode.** Prefer precise types over `any`.
- **Match the surrounding code.** Follow the naming, comment density, and idioms of
  the file you're editing rather than introducing a new style.
- **Keep PRs focused.** One logical change per PR; it makes review faster and reverts
  safer. Unrelated cleanups belong in their own PR.
- **Accessibility matters.** UI changes should keep buttons/controls labelled and
  keyboard-usable.
- **No secrets or personal data** in commits (API keys, tokens, `.env`, real GCP
  project identifiers, personal emails).

## Tests

- Tests use [Vitest](https://vitest.dev/) and live next to the code as
  `*.test.ts` (e.g. [`src/lib/host.test.ts`](src/lib/host.test.ts),
  [`src/content/analyze.test.ts`](src/content/analyze.test.ts)).
- Run all tests with `npm test`, or `npm run test:watch` while developing.
- **Pure functions are the easiest place to add coverage** — if you touch or add a
  self-contained helper (text parsing, validation, formatting), please add a test for
  it. New behavior should come with a test.

## Pull request process

1. **Fork** the repo (external contributors) and create a topic branch:
   `git checkout -b fix/short-description` or `feat/short-description`.
2. Make your change; run the four checks above.
3. Push and open a PR against `main`. Fill in the PR template (what/why, how you
   tested, and the checklist).
4. **CI runs automatically.** For first-time contributors, a maintainer approves the
   workflow run before checks appear — this is normal.
5. `main` is protected: a PR needs its **CI checks green** and **one approving review**
   before it can merge. A maintainer will review; please respond to feedback by pushing
   follow-up commits to the same branch.

## Questions

Open an issue or start a discussion. Thanks for helping make the project better!
