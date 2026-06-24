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

### Redeploy after the model picker

The proxy now honors a client-requested model (validated against `MODEL_ALLOWLIST` in
[`server/index.js`](server/index.js); keep it in sync with
[`src/lib/ai/models.ts`](src/lib/ai/models.ts)). Redeploy to pick up the change — **no
secret needed**, the existing env vars are preserved when you omit `--update-env-vars`:

```bash
gcloud run deploy job-autofill-proxy --source server --region us-central1
curl -s https://job-autofill-proxy-rz75fufhtq-uc.a.run.app/ | jq   # still healthy
```

## Verify

1. `npm run build` → reload unpacked at `chrome://extensions` (ID should match Step 1).
2. Options → AI provider = **Managed proxy** → **Sign in with Google** → "Signed in as …".
3. Run an AI feature → Firestore `usage` doc appears, `count` increments per call.
4. (owner) Paste `PROXY_TOKEN` into Options → Admin token → calls run unmetered.

## Chrome Web Store listing (separate from the above)

OAuth "Publish app" ≠ Web Store listing. Listing copy and privacy policy live in
[`STORE_LISTING.md`](STORE_LISTING.md) and [`PRIVACY.md`](PRIVACY.md).

> **Status: ✅ LIVE** — published 2026-06-22.
> Chrome Web Store URL: <https://chromewebstore.google.com/detail/Little%20AI%20Helper/iibpijacaghdcckphindbaijjgcbaoll>
> Store **Item ID** `iibpijacaghdcckphindbaijjgcbaoll`. The OAuth client "AI Job Assistant"
> was rebound to that Item ID, and `manifest.config.ts` `key` now holds the store's public
> key (dev-only; `npm run package` strips it via `CRX_NO_KEY`). Verified the local
> `npm run build` ID matches the store Item ID.

**Key gotcha:** the Web Store assigns the published item its **own** ID/public key — it
does **not** honor the local `key.pem`. So the OAuth client (currently bound to the dev
ID from `key.pem`) must be **rebound to the store-assigned Item ID** after the first
upload, or `getAuthToken` / managed-proxy sign-in breaks for installed users.

Ordered steps:

1. Register a Web Store developer account (one-time **$5**) at
   <https://chrome.google.com/webstore/devconsole>.
2. `npm run package` → upload `web-store-package.zip` as a **new item** (don't submit).
   This mints the permanent **Item ID** + a store key.
3. **Rebind OAuth + adopt the store key:**
   - Dashboard → item → **Package** tab → copy the **public key**, note the **Item ID**.
   - Google Auth Platform → **Clients** → edit **"AI Job Assistant"** → set its **Item ID**
     to the store Item ID. `client_id` is unchanged, so `OAUTH_CLIENT_ID` /
     `oauth2.client_id` stay the same and **no Cloud Run redeploy** is needed.
   - Replace `key:` in [`manifest.config.ts`](manifest.config.ts) with the store public key
     (so local unpacked dev shares the store ID; `key.pem` is then superseded — keep it
     backed up but it no longer drives the ID).
   - `npm run package` again → upload the new version.
4. Fill the listing from [`STORE_LISTING.md`](STORE_LISTING.md): description, single
   purpose, category, icon (128px in the package), **screenshots** (guide below), privacy
   policy URL, and the **Privacy practices** disclosures.
5. Submit with **Public** visibility → Google review (~1–3 days; the `<all_urls>`
   justification is in `STORE_LISTING.md`).

### Screenshot capture (1–5 × 1280×800 PNG)

After step 3 (so the dev ID matches and sign-in works): `npm run build`, load `dist/`
unpacked, size the captured area to exactly **1280×800**, and capture: the **Options**
page filled in, the **side panel** on a Greenhouse/Lever posting, the **eligibility
badge** (YES/NO), an **✨ AI answer** draft, and a generated **cover letter**.
