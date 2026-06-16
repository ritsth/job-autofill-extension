# AI Job Application Autofill (Chrome Extension)

Auto-fills repetitive job applications on **Greenhouse**, **Lever**, and
**Workday** from a structured profile, and uses AI to:

- **Answer open-ended questions** an "✨ AI answer" button appears beside free-text
  questions; it drafts an answer from your résumé + uploaded documents.
- **Generate a tailored cover letter** from your base template (company / role / date
  substituted, then AI-tailored), downloadable as a `.pdf`.
- **Flag eligibility at a glance** every covered page is scanned for visa-sponsorship /
  U.S.-citizenship / security-clearance language and shows a bold **YES / NO** badge
  in the corner. On **Handshake** the badge also hosts a one-click cover-letter
  generator (employer/role auto-detected from the posting).

The UI is a **side panel** (stays open while you browse, closes only when you close it).

**AI providers:** Gemini (BYO free key), on-device (Chrome built-in), or a **managed
proxy** — a small Cloud Run service that relays to **Vertex AI** so you can spend the
GCP $300 credit (AI Studio's Gemini API is excluded from the credit; Vertex isn't). See
[`server/README.md`](server/README.md) to deploy it, then pick "Managed proxy" in options.

**Where it runs:** full autofill on **Greenhouse**, **Lever**, and **Workday**
(`*.myworkdayjobs.com`). The eligibility badge
runs on **every page** (so no job board is missed), but it self-gates — it only appears
when the page actually looks like a job posting, and it stays current on single-page
boards as you click between postings. Toggle it on/off any time from the side panel
("Scan every page for visa/eligibility"). Because it runs everywhere, Chrome shows the
"read and change your data on all websites" permission.

All your data stays on your machine (`chrome.storage.local`). The AI layer is
**bring-your-own-key** (default: free Google Gemini) with an on-device fallback —
nothing is sent to any server we run.

## Tech

TypeScript · React (popup + options) · Vite + `@crxjs/vite-plugin` · Manifest V3.

## Develop

```bash
npm install
node scripts/make-icons.mjs   # generates placeholder icons (one-time)
npm run dev                   # Vite dev server with HMR
```

Then load it in Chrome:

1. Go to `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select the `dist/` folder.
3. Edits hot-reload. For a production bundle: `npm run build` (also typechecks).

## Setup (first run)

The options page opens automatically on install. Fill in:

- **AI provider** → Gemini, and paste a free key from
  [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
- Your **personal info, work history, skills, and résumé** (paste text or upload a
  PDF/DOCX — text is extracted for AI context).
- A **base cover letter** using `{{company}}`, `{{role}}`, `{{date}}` placeholders.

## Verify end-to-end

1. Open a real **Greenhouse** (`*.greenhouse.io`), **Lever** (`jobs.lever.co`), or
   **Workday** (`*.myworkdayjobs.com`) job
   application. A **YES/NO eligibility badge** appears top-right automatically.
2. Click the extension icon → the **side panel** opens (and stays open).
3. **Fill this page** → standard fields populate.
4. On a free-text question, click **✨ AI answer** → an editable draft appears.
5. In the panel → **Generate cover letter** → review/edit → **Download .pdf**.
6. On a **Handshake** posting, the eligibility badge exposes its own cover-letter
   generator (employer/role auto-detected).

Edge cases handled: no key set (popup prompts you), unsupported page (popup says so),
on-device fallback when no key is set and Chrome's built-in model is available.

## Architecture

| Area | Path |
| --- | --- |
| Profile schema + storage | `src/lib/profile.ts` |
| AI providers (pluggable) | `src/lib/ai/` (`gemini.ts`, `onDevice.ts`, `provider.ts`) |
| Document text extraction | `src/lib/documents.ts` |
| Cover-letter helpers | `src/lib/coverLetter.ts` |
| Background AI hub | `src/background/service-worker.ts` |
| Autofill + question buttons | `src/content/` (`adapters/` per site) |
| Options / Popup UI | `src/options/`, `src/popup/` |

The `AIProvider` interface is the seam for **v2**: a Cloud Run "managed mode" proxy
becomes a new `ProxyProvider` with no other code changes. Workday support is a new
adapter under `src/content/adapters/`.

## Roadmap

Shipped since v1: Cloud Run → Vertex AI managed proxy, Workday adapter, Handshake
eligibility badge + cover-letter generator, PDF cover-letter export.

Still ahead (v2+):

- Proxy **sign-in + per-user quotas** (today the proxy is shared-token only — see below).
- Multi-provider picker (Groq / OpenRouter / Claude) — interface already supports it.
- Chrome Web Store packaging + privacy policy.

### Publishing & the proxy token

The managed proxy is gated by a single shared `PROXY_TOKEN`, and the extension ships
with **a pre-filled proxy URL but no token** (`src/lib/profile.ts`). That means:

- If you publish and tell users to paste **your** token, every user's AI calls hit
  **your** Cloud Run service and bill **your** GCP account. A token shipped inside the
  extension is trivially extractable (extensions are just zipped JS), so it would be
  effectively public and could drain your Vertex credit — there are no per-user quotas yet.
- The safe model for a public release is **bring-your-own**: each user pastes their own
  free **Gemini** key, or deploys their own proxy, or uses the **on-device** model.

Treat the managed proxy as a "you + people you trust" feature until sign-in + quotas land.
