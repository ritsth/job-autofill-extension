# Job Autofill — Vertex AI proxy (Cloud Run)

A tiny service that lets the extension use **Gemini on Vertex AI** (which is
eligible for the Google Cloud **$300 free-trial credit**, unlike the AI Studio
Gemini API). It authenticates to Vertex with the Cloud Run service account, so
**no Google credential is ever shipped in the extension**. The extension calls
it with a shared bearer token.

```
Extension ──(Bearer PROXY_TOKEN)──▶ Cloud Run (this) ──(service identity)──▶ Vertex AI / Gemini
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

# 2. Enable the APIs we use
gcloud services enable run.googleapis.com aiplatform.googleapis.com

# 3. Pick a strong shared secret the extension will send
export PROXY_TOKEN="$(openssl rand -hex 24)"
echo "Save this token — you'll paste it into the extension options:"
echo "$PROXY_TOKEN"
```

## Deploy

Run from the repo root (the `--source server` points at this folder):

```bash
gcloud run deploy job-autofill-proxy \
  --source server \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=$PROJECT_ID,VERTEX_LOCATION=us-central1,VERTEX_MODEL=gemini-2.0-flash,PROXY_TOKEN=$PROXY_TOKEN"
```

> `--allow-unauthenticated` only opens it at the network layer; the service
> still rejects any request without the correct `PROXY_TOKEN`.

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

---

## Point the extension at it

In the extension **Options → AI provider**:

1. Provider → **Managed proxy (Vertex AI)**
2. **Proxy URL** → the Cloud Run Service URL + `/generate`
   (e.g. `https://job-autofill-proxy-xxxx-uc.a.run.app/generate`)
3. **Proxy token** → the `PROXY_TOKEN` you generated

## Test it

```bash
URL="https://job-autofill-proxy-xxxx-uc.a.run.app"
curl -s "$URL/" | jq                      # health check
curl -s -X POST "$URL/generate" \
  -H "Authorization: Bearer $PROXY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"system":"Be brief.","prompt":"Say hello in 5 words."}' | jq

curl -s -o /dev/null -w "%{http_code}\n" -X POST "$URL/generate" \
  -H "Content-Type: application/json" -d '{"prompt":"hi"}'   # expect 401 (no token)
```

## Run locally (optional)

```bash
cd server
npm install
gcloud auth application-default login        # ADC for local Vertex calls
GOOGLE_CLOUD_PROJECT=$PROJECT_ID PROXY_TOKEN=test npm start
# then POST to http://localhost:8080/generate with "Authorization: Bearer test"
```
