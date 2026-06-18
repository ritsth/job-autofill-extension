# Deployment record — managed proxy sign-in + per-user quota

Concrete, project-specific steps taken to make the managed AI proxy publishable
(Google sign-in + per-user daily quota). For the general explanation see
[`server/README.md`](server/README.md). **Secrets (PROXY_TOKEN, key.pem) are never
committed and not recorded here.**

## Project facts

| Thing | Value |
| --- | --- |
| GCP project ID | `chrome-extension-499519` |
| GCP project number | `1074158639574` |
| GCP / dev account | `akitirsth@gmail.com` |
| Cloud Run service | `job-autofill-proxy` (region `us-central1`) |
| Service URL | `https://job-autofill-proxy-rz75fufhtq-uc.a.run.app` |
| OAuth client ID | `1074158639574-u0ukfm6q8tlk8473v1u9nlcg9jgd65ge.apps.googleusercontent.com` |
| OAuth client name | `AI Job Assistant` (type: Chrome Extension) |
| Runtime service account | `1074158639574-compute@developer.gserviceaccount.com` |
| Firestore | Native mode, location `nam5`, collection `usage` |
| Daily limit | 50 requests / user / UTC day |

## Step 1 — Stable extension ID ✅

Generated an RSA keypair so the unpacked extension ID never changes (the OAuth
client is bound to a fixed ID).

```bash
# Private key — KEEP SECRET, gitignored, used for publishing
openssl genrsa 2048 2>/dev/null | openssl pkcs8 -topk8 -nocrypt -out key.pem

# Public key for the manifest `key` field:
openssl rsa -in key.pem -pubout -outform DER 2>/dev/null | base64 | tr -d '\n'; echo

# Derived extension ID:
openssl rsa -in key.pem -pubout -outform DER 2>/dev/null | shasum -a 256 | head -c 32 | tr '0-9a-f' 'a-p'; echo
```

- Public key pasted into [`manifest.config.ts`](manifest.config.ts) → `key:`.
- `key.pem` added to [`.gitignore`](.gitignore). **Back it up** — needed to keep the
  same ID when publishing to the Web Store.

## Step 2 — OAuth client ✅

Google Cloud Console → **Google Auth Platform**:

1. **Clients → Create client → Chrome Extension**, name `AI Job Assistant`, Item ID =
   the extension ID from Step 1. → produced the client ID above.
2. **Data Access → Add scopes** (manual entry):
   - `openid`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/userinfo.profile`
3. **Audience → Publish app** (status: In production). Non-sensitive scopes → no Google
   verification needed, so any Google account can sign in.
4. **Branding**: app name set; logo optional (skipped).

Client ID written into [`manifest.config.ts`](manifest.config.ts) → `oauth2.client_id`
and passed to the server as `OAUTH_CLIENT_ID` (Step 4).

## Step 3 — Firestore ✅

```bash
gcloud services enable firestore.googleapis.com
gcloud firestore databases create --location=nam5

# Let the Cloud Run runtime SA read/write Firestore:
gcloud projects add-iam-policy-binding chrome-extension-499519 \
  --member="serviceAccount:1074158639574-compute@developer.gserviceaccount.com" \
  --role="roles/datastore.user"

# Auto-prune spent day-counters:
gcloud firestore fields ttls update expireAt --collection-group=usage --enable-ttl
```

Quota docs land in `usage/<sub>_<YYYYMMDD>` with `count`, `email`, `expireAt`.

## Step 4 — Redeploy Cloud Run ✅ (run locally — needs the secret token)

Deploys the new server code (token verification + Firestore quota) and sets the new
env vars. `--update-env-vars` merges, so existing vars (GOOGLE_CLOUD_PROJECT,
VERTEX_*) are preserved.

```bash
cd ~/Documents/Chrome-Extension
export PROXY_TOKEN="<your admin token — do NOT commit or paste into chat>"
export OAUTH_CLIENT_ID="1074158639574-u0ukfm6q8tlk8473v1u9nlcg9jgd65ge.apps.googleusercontent.com"

gcloud run deploy job-autofill-proxy \
  --source server \
  --region us-central1 \
  --update-env-vars "OAUTH_CLIENT_ID=$OAUTH_CLIENT_ID,DAILY_LIMIT=50,PROXY_TOKEN=$PROXY_TOKEN"
```

Sanity check:
```bash
curl -s https://job-autofill-proxy-rz75fufhtq-uc.a.run.app/ | jq   # expect "dailyLimit": 50
```

## Verify

1. `npm run build` → reload unpacked at `chrome://extensions` (ID should match Step 1).
2. Options → AI provider = **Managed proxy** → **Sign in with Google** → "Signed in as …".
3. Run an AI feature → Firestore `usage` doc appears, `count` increments per call.
4. (owner) Paste `PROXY_TOKEN` into Options → Admin token → calls run unmetered.

## Still ahead — Chrome Web Store (separate from the above)

OAuth "Publish app" ≠ Web Store listing. To list publicly:
1. Pay the one-time **$5** developer fee at the Chrome Web Store Developer Dashboard.
2. `npm run build`, then zip the `dist/` folder.
3. Upload zip + screenshots + description + privacy policy → Google review (~1–3 days).
4. Use the **same `key.pem`** so the published ID matches the OAuth client (otherwise
   create a second OAuth client for the store-assigned ID).
