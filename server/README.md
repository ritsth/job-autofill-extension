# Job Autofill — Vertex AI proxy (Cloud Run)

A tiny service that lets the extension use **Gemini on Vertex AI** (which is
eligible for the Google Cloud **$300 free-trial credit**, unlike the AI Studio
Gemini API). It authenticates to Vertex with the Cloud Run service account, so
**no Google credential is ever shipped in the extension**.

Each caller is identified by their **Google sign-in token** and metered against a
**per-user daily limit** (Firestore), so one user can't drain the whole budget —
which makes it safe to ship in a published extension. A shared **admin token**
(`PROXY_TOKEN`) bypasses sign-in and metering, for the owner / trusted testing.

```
Extension ──(Bearer Google token)──▶ Cloud Run (this) ─┬─(verify token + quota)──▶ Firestore
                                                        └─(service identity)──────▶ Vertex AI / Gemini
   (or Bearer PROXY_TOKEN ─ admin, unmetered)
```

Endpoint: `POST /generate  { system, prompt, maxOutputTokens? }  ->  { text }`

---

## One-time GCP setup

You need a Google Cloud **project** with billing enabled (your free-trial
account is a billing account). You can reuse the project AI Studio created for
your Gemini key, or make a new one.

```bash
# 0. Pick your project (reuse an existing one or create a new one)
gcloud projects list                 # find an existing project id
# gcloud projects create my-job-autofill --name="Job Autofill"   # OR create new
export PROJECT_ID="<your-project-id>"
gcloud config set project "$PROJECT_ID"

# 1. Make sure billing (the $300 trial account) is linked to this project.
#    Easiest in the console: https://console.cloud.google.com/billing
gcloud billing projects describe "$PROJECT_ID"     # shows the linked billing account

# 2. Enable the APIs we use (Firestore stores the per-user daily counters)
gcloud services enable run.googleapis.com aiplatform.googleapis.com firestore.googleapis.com

# 3. Create the Firestore database in Native mode (once per project)
gcloud firestore databases create --location=nam5    # pick a location near you

# 4. Optional admin secret — bypasses sign-in + quota (owner use only)
export PROXY_TOKEN="$(openssl rand -hex 24)"
echo "Admin token (optional — paste into Options ▸ Admin token to bypass quota):"
echo "$PROXY_TOKEN"
```

### OAuth client for Google sign-in

The extension signs users in with `chrome.identity`, and this server verifies the
token's audience against your OAuth client id. Create one:

1. The extension needs a **stable ID** — set a fixed `key` in `manifest.config.ts`
   (and use the same key in the published build). Load the unpacked extension and
   copy its ID from `chrome://extensions`.
2. Google Cloud Console ▸ **APIs & Services ▸ Credentials ▸ Create credentials ▸
   OAuth client ID ▸ Chrome Extension**, paste the extension ID.
3. Configure the **OAuth consent screen** (scopes: `openid`, `email`, `profile`).
4. Put the client id into `manifest.config.ts` → `oauth2.client_id`, and pass the
   same value to the server as `OAUTH_CLIENT_ID` (below).

```bash
export OAUTH_CLIENT_ID="<your-id>.apps.googleusercontent.com"
export DAILY_LIMIT=50          # requests per user per UTC day
```

### Let the service account use Firestore

```bash
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/datastore.user"
```

### Auto-prune old counters (optional)

Each counter doc carries an `expireAt` field. Add a Firestore **TTL policy** on it
so spent days clean themselves up:
Console ▸ Firestore ▸ TTL ▸ Create policy → collection `usage`, field `expireAt`.

## Deploy

Run from the repo root (the `--source server` points at this folder):

```bash
gcloud run deploy job-autofill-proxy \
  --source server \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=$PROJECT_ID,VERTEX_LOCATION=us-central1,VERTEX_MODEL=gemini-2.5-flash,OAUTH_CLIENT_ID=$OAUTH_CLIENT_ID,DAILY_LIMIT=$DAILY_LIMIT,PROXY_TOKEN=$PROXY_TOKEN"
```

> `--allow-unauthenticated` only opens it at the network layer; the service still
> rejects any request without a valid Google sign-in token (or the admin
> `PROXY_TOKEN`), and meters signed-in users against `DAILY_LIMIT`.

> **Hardening (recommended for a public deploy):** add `--max-instances=3
> --concurrency=40 --timeout=60`, set `GLOBAL_DAILY_LIMIT` / `MAX_OUTPUT_TOKENS`, and put
> `PROXY_TOKEN` in Secret Manager via `--set-secrets` instead of `--set-env-vars`. Full
> rationale, exact commands, and the billing kill-switch are in
> [`../docs/SECURITY.md`](../docs/SECURITY.md).

The command prints a **Service URL** like
`https://job-autofill-proxy-xxxxxxxxxx-uc.a.run.app`. Save it.

### Grant Vertex access to the service account (if needed)

The default Compute service account usually already has access. If you get a
permission error, grant it explicitly:

```bash
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```

### Set a budget alert (recommended)

So nothing surprises you after the trial credit / 90 days:
https://console.cloud.google.com/billing → Budgets & alerts → create a small budget.

### Troubleshooting (gotchas seen on fresh projects)

- **Deploy fails with `storage.objects.get` 403** — the Compute service account
  Cloud Build uses lacks build/storage roles on new projects. Grant them:
  ```bash
  SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role="roles/cloudbuild.builds.builder"
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role="roles/storage.objectViewer"
  ```
- **`/generate` returns a 404 "Publisher Model ... not found"** — Vertex needs a
  current model ID, and newer projects only have the latest generation. Use
  `gemini-2.5-flash` (the default here). The bare `gemini-2.0-flash` alias from
  AI Studio does **not** work on Vertex.

---

## Point the extension at it

In the extension **Options → AI provider**:

1. Provider → **Managed proxy (Vertex AI)**
2. **Proxy URL** → the Cloud Run Service URL + `/generate`
   (e.g. `https://job-autofill-proxy-xxxx-uc.a.run.app/generate`)
3. Click **Sign in with Google** — normal users need nothing else.
4. *(owner only)* **Admin token** → the `PROXY_TOKEN`, to bypass sign-in + quota.

## Test it

```bash
URL="https://job-autofill-proxy-xxxx-uc.a.run.app"
curl -s "$URL/" | jq                      # health check (shows dailyLimit)

# Admin path (unmetered):
curl -s -X POST "$URL/generate" \
  -H "Authorization: Bearer $PROXY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"system":"Be brief.","prompt":"Say hello in 5 words."}' | jq

curl -s -o /dev/null -w "%{http_code}\n" -X POST "$URL/generate" \
  -H "Content-Type: application/json" -d '{"prompt":"hi"}'   # expect 401 (no token)

curl -s -o /dev/null -w "%{http_code}\n" -X POST "$URL/generate" \
  -H "Authorization: Bearer not-a-real-token" \
  -H "Content-Type: application/json" -d '{"prompt":"hi"}'   # expect 401 (bad token)
```

The signed-in-user path is easiest to exercise from the extension itself (it
sends the real Google token). Watch the `usage` collection in Firestore — a
`<sub>_<YYYYMMDD>` doc appears and its `count` climbs with each call; once it
hits `DAILY_LIMIT` the next call returns **429**.

## Run locally (optional)

```bash
cd server
npm install
gcloud auth application-default login        # ADC for local Vertex + Firestore
GOOGLE_CLOUD_PROJECT=$PROJECT_ID OAUTH_CLIENT_ID=$OAUTH_CLIENT_ID DAILY_LIMIT=50 PROXY_TOKEN=test npm start
# then POST to http://localhost:8080/generate with "Authorization: Bearer test" (admin path)
```
