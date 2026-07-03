# Contributing to Little AI Helper

Thanks for helping improve Little AI Helper. This project is a Manifest V3
Chrome extension built with TypeScript, React, Vite, and Vitest.

## Dev Setup

Install dependencies:

```bash
npm install
```

Start the Vite dev server:

```bash
npm run dev
```

Then load the extension in Chrome:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select the generated `dist/` folder.

For a production-style bundle, run:

```bash
npm run build
```

The build script typechecks first, then writes the extension bundle to `dist/`.

## Before Opening a PR

Run the full local check set:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

If you change icons, regenerate them from `assets/icon-source.png`:

```bash
python3 scripts/make-icons.py
```

## Project Conventions

- Keep pull requests small and focused.
- TypeScript is strict; avoid `any` unless there is no safer type.
- Add or update tests when behavior changes.
- Keep extension permissions narrow and explain any permission change.
- Do not commit secrets, API keys, resumes, job-application data, or other
  personal data.
- Keep AI-provider changes behind the provider interfaces in `src/lib/ai/`.
- Put site-specific autofill behavior in `src/content/adapters/`.

## Where to Start

Look for issues labeled
[`good first issue`](https://github.com/ritsth/job-autofill-extension/labels/good%20first%20issue).
Good starter changes are usually docs improvements, focused adapter fixes,
tests for existing helpers, or small UI polish.

When you open a PR, include a short summary, link the issue, and list the local
commands you ran.
