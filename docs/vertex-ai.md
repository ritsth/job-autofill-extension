# How Vertex AI is used (and where to see it in the console)

## TL;DR

The extension's AI features (résumé parsing, AI answers, cover letters, the
eligibility **AI check**) call **Gemini 2.5 Flash on Vertex AI** — but *indirectly*,
through a small Cloud Run proxy. Because we call a **managed publisher model**
(Gemini) over the API rather than deploying our own model, the **Vertex AI →
Model Registry / Endpoints** pages are **empty by design**. That's normal — it
does **not** mean Vertex is unused. Usage shows up under **Cloud Run**, the
**Vertex AI API metrics**, and **Billing**, not the Vertex AI model pages.

## The request path

```
Chrome extension (background service worker)
      │  POST https://job-autofill-proxy-…-uc.a.run.app/generate
      │  Authorization: Bearer <PROXY_TOKEN>
      │  { system, prompt, json?, maxOutputTokens?, thinking? }
      ▼
Cloud Run service  "job-autofill-proxy"   (server/index.js)
      │  uses the Cloud Run service account (Application Default Credentials —
      │  no API key in code) via the @google-cloud/vertexai SDK:
      │  vertex.getGenerativeModel({ model: "gemini-2.5-flash" }).generateContent(...)
      ▼
Vertex AI  (aiplatform.googleapis.com, region us-central1)
      │  publisher model:
      │  projects/chrome-extension-499519/locations/us-central1/
      │  publishers/google/models/gemini-2.5-flash:generateContent
      ▼
   { text }  ──────────────▶ back to the extension
```

Key points:

- **No model is deployed.** Gemini is a Google-hosted "publisher model"; we just
  call its `:generateContent` endpoint. There is nothing in **Model Registry**,
  **Online prediction → Endpoints**, or **Model Garden → My models**.
- **No API key is in the extension or the code.** The proxy authenticates to
  Vertex with its **Cloud Run service account** (which has `roles/aiplatform.user`)
  via ADC. The only secret the extension holds is the proxy's bearer token.
- The credit-eligible product is **Vertex AI** (the AI Studio "Gemini API" is
  excluded from the $300 trial credit — that's why we route through Vertex).

## Why the Vertex AI console looks empty

| Vertex AI console page | What it shows | Why it's empty for us |
|---|---|---|
| Model Registry | Custom/uploaded models | We didn't upload a model |
| Online prediction → Endpoints | Deployed model endpoints | We don't deploy; we call Gemini directly |
| Model Garden → My models | Tuned/saved models | We use the base Gemini, untuned |
| Notebooks / Pipelines / etc. | Other Vertex tooling | Not used |

There is **no "API call history / chat log" page** for Gemini calls in the Vertex
console. So "nothing in Vertex AI" is expected even with heavy use.

## Where the usage actually shows up

1. **Cloud Run (clearest, real-time)** — every AI call is one request here.
   - Console: Cloud Run → **job-autofill-proxy** → **Metrics** (request count) and **Logs**.
   - URL: `https://console.cloud.google.com/run/detail/us-central1/job-autofill-proxy/metrics?project=chrome-extension-499519`
   - CLI:
     ```bash
     gcloud logging read \
       'resource.type="cloud_run_revision" AND resource.labels.service_name="job-autofill-proxy" AND httpRequest.requestUrl:"/generate"' \
       --project=chrome-extension-499519 --limit=20 --freshness=7d \
       --format='table(timestamp, httpRequest.status)'
     ```
   - Each `POST /generate → 200` = one Vertex Gemini call. (`401` = a request with a
     missing/wrong token — e.g. the auth test.)

2. **Vertex AI API metrics** — traffic to `aiplatform.googleapis.com`.
   - Console: APIs & Services → **Vertex AI API** → **Metrics** (traffic, errors, latency).
   - URL: `https://console.cloud.google.com/apis/api/aiplatform.googleapis.com/metrics?project=chrome-extension-499519`

3. **Billing → Reports** — the cost (covered by the trial credit).
   - Console: Billing → **Reports**, filter **Service = "Vertex AI Generative AI"** (or "Vertex AI").
   - Note: billing data lags up to ~24h, amounts are tiny (Gemini Flash is a
     fraction of a cent per call), and the $300 trial credit absorbs it, so it may
     read as `$0.00` / "credits".

## Cost & guardrails

- Gemini 2.5 Flash on Vertex is ~fractions of a cent per request; Cloud Run scales
  to zero and is effectively free at this volume.
- A **budget alert** ("Job Autofill credit alert", $50, warns at 50/90/100%) is set
  on the billing account, scoped to this project.

## Quick "is it working" check

```bash
# Replace TOKEN with the PROXY_TOKEN you set on the service.
URL=https://job-autofill-proxy-rz75fufhtq-uc.a.run.app
curl -s "$URL/"                              # → {"ok":true,"model":"gemini-2.5-flash",...}
curl -s -X POST "$URL/generate" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"system":"Be brief.","prompt":"Say hello in 4 words."}'   # → {"text":"..."}
```

A `200` with a `{ "text": ... }` body means Vertex AI served the request.

## If you truly see *no* traffic

Then the extension isn't sending requests — usually one of:
- You haven't triggered an AI feature since switching (the eligibility badge's
  *instant* result is rules-only; only **AI check**, résumé import, AI answers, and
  cover letters call the proxy).
- The extension isn't on the **Managed proxy** provider, or the **proxy token** is
  blank/incorrect (you'd see `401`s in the Cloud Run logs).
- Use **Options → AI provider → Test proxy** to force one call and confirm.
