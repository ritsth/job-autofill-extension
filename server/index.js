// Cloud Run → Vertex AI proxy.
//
// The browser extension cannot safely hold a Google Cloud credential, so this
// tiny service does: it authenticates to Vertex AI with the Cloud Run service
// account (Application Default Credentials — no keys in code) and relays one
// kind of request:
//
//   POST /generate   { system, prompt, maxOutputTokens? }  ->  { text }
//
// Access control (two modes):
//   • Google user — the extension sends the caller's Google sign-in access token
//     as the bearer. We verify it (tokeninfo, checking the OAuth client id) and
//     meter the verified user against a per-user DAILY_LIMIT in Firestore, so one
//     user can't drain the whole Vertex budget.
//   • Admin override — a bearer equal to the shared PROXY_TOKEN skips sign-in and
//     quota (for the publisher / trusted testing).

import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { VertexAI } from '@google-cloud/vertexai';
import { Firestore, FieldValue } from '@google-cloud/firestore';

const PORT = process.env.PORT || 8080;
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT;
const LOCATION = process.env.VERTEX_LOCATION || 'us-central1';
// Vertex AI needs versioned/current model IDs (unlike AI Studio's bare aliases).
// gemini-2.5-flash is broadly available; older 1.5/2.0 IDs 404 on newer projects.
const MODEL = process.env.VERTEX_MODEL || 'gemini-2.5-flash';
// Models a client is allowed to request via the request body. Keep in sync with
// the curated list in src/lib/ai/models.ts. Anything outside this set falls back
// to MODEL, so a client can't bill the project against an arbitrary/expensive id.
const MODEL_ALLOWLIST = new Set([
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
]);
const PROXY_TOKEN = process.env.PROXY_TOKEN || '';
// The OAuth client id the extension's tokens are minted for. We reject any token
// whose audience is a different app, so a token grabbed elsewhere can't be replayed.
const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID || '';
// Per-user requests allowed per UTC day. Tune without a code change.
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 50);
// Global ceiling across ALL users per UTC day — the backstop against a Sybil
// flood (many free Google accounts each under the per-user limit) draining the
// Vertex budget. Sized well above honest aggregate usage.
const GLOBAL_DAILY_LIMIT = Number(process.env.GLOBAL_DAILY_LIMIT || 2000);
// Hard caps on a single request's cost. maxOutputTokens is the main spend lever;
// clamp it regardless of what the client asks. Prompt is also bounded (below the
// 1 MB body cap) so one call can't be made arbitrarily expensive.
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS || 4096);
const MAX_PROMPT_CHARS = Number(process.env.MAX_PROMPT_CHARS || 200_000);

if (!PROJECT) console.warn('[proxy] GOOGLE_CLOUD_PROJECT is not set');
if (!OAUTH_CLIENT_ID) console.warn('[proxy] OAUTH_CLIENT_ID is not set — Google sign-in will be rejected!');
if (!PROXY_TOKEN) console.warn('[proxy] PROXY_TOKEN is not set — the admin override is disabled.');

const vertex = new VertexAI({ project: PROJECT, location: LOCATION });
const db = new Firestore({ projectId: PROJECT });

/**
 * Constant-time string compare for the admin token, so a timing side-channel
 * can't be used to recover it. Returns false when the admin token is unset or
 * the lengths differ (length itself is not secret, but timingSafeEqual throws on
 * mismatched buffers).
 */
function safeEqual(a, b) {
  if (!b || !a || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// tokeninfo is ~1 network call; access tokens live ~1h. Cache the verified
// identity by token so we resolve a user at most once per token lifetime per
// instance instead of on every /generate call.
const tokenCache = new Map(); // accessToken -> { sub, email, exp(ms) }

/**
 * Verifies a Google OAuth access token and returns { sub, email }, or null if it
 * is invalid / expired / minted for a different OAuth client.
 */
async function verifyGoogleToken(accessToken) {
  const cached = tokenCache.get(accessToken);
  if (cached && cached.exp > Date.now()) return cached;

  let info;
  try {
    const res = await fetch(
      'https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(accessToken),
    );
    if (!res.ok) return null;
    info = await res.json();
  } catch {
    return null;
  }

  // The token must be ours: tokeninfo returns the granting client in `aud`/`azp`.
  const audience = info.aud || info.azp;
  if (OAUTH_CLIENT_ID && audience !== OAUTH_CLIENT_ID) return null;
  if (!info.sub) return null;
  const expMs = info.exp ? Number(info.exp) * 1000 : Date.now() + 5 * 60_000;
  if (expMs <= Date.now()) return null;

  const identity = { sub: info.sub, email: info.email || '', exp: expMs };
  tokenCache.set(accessToken, identity);
  return identity;
}

/** UTC day key like 20260617, so a user's counter resets at midnight UTC. */
function utcDayKey(d = new Date()) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Atomically checks-and-increments a user's daily counter. Returns
 * { allowed, count, limit }. Increments only when allowed, so a blocked call
 * doesn't consume quota.
 */
async function checkAndIncrementQuota(sub, email) {
  const day = utcDayKey();
  const userRef = db.collection('usage').doc(`${sub}_${day}`);
  // Global counter lives in the same collection (so the existing `expireAt` TTL
  // prunes it); the `_global_` prefix can't collide with numeric Google subs.
  const globalRef = db.collection('usage').doc(`_global_${day}`);
  const expireAt = new Date(Date.now() + 2 * 24 * 60 * 60_000);
  return db.runTransaction(async (tx) => {
    // All reads before any writes (Firestore requirement).
    const [userSnap, globalSnap] = await Promise.all([tx.get(userRef), tx.get(globalRef)]);
    const count = userSnap.exists ? userSnap.get('count') || 0 : 0;
    const globalCount = globalSnap.exists ? globalSnap.get('count') || 0 : 0;
    // Global ceiling is the Sybil backstop; checked first and reported distinctly.
    if (globalCount >= GLOBAL_DAILY_LIMIT) {
      return { allowed: false, reason: 'global', count, limit: DAILY_LIMIT };
    }
    if (count >= DAILY_LIMIT) {
      return { allowed: false, reason: 'user', count, limit: DAILY_LIMIT };
    }
    tx.set(userRef, { count: FieldValue.increment(1), sub, email, day, expireAt }, { merge: true });
    tx.set(globalRef, { count: FieldValue.increment(1), day, expireAt }, { merge: true });
    return { allowed: true, reason: null, count: count + 1, limit: DAILY_LIMIT };
  });
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) reject(new Error('Request body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function generate({ system, prompt, maxOutputTokens, json, thinking, model: requested }) {
  // Honor the client's model only if it's allowlisted; otherwise use the default.
  const modelId = requested && MODEL_ALLOWLIST.has(requested) ? requested : MODEL;
  const model = vertex.getGenerativeModel({
    model: modelId,
    systemInstruction: system ? { role: 'system', parts: [{ text: system }] } : undefined,
    generationConfig: {
      temperature: 0.7,
      // Clamp to the server cap regardless of what the client requests, so a
      // crafted body can't make one call arbitrarily expensive.
      maxOutputTokens: Math.min(Number(maxOutputTokens) || 1024, MAX_OUTPUT_TOKENS),
      // Thinking on (dynamic budget) only when asked — better open-ended
      // answers. Off by default: 2.5 Flash otherwise spends the output budget
      // on hidden reasoning and truncates/empties short requests. 2.5 Pro can't
      // disable thinking (budget 0 → 400 INVALID_ARGUMENT), so give it a small
      // BOUNDED budget (1024) instead of dynamic -1 — dynamic thinking would
      // otherwise eat the output budget and truncate the answer mid-sentence.
      thinkingConfig: { thinkingBudget: thinking ? -1 : modelId.includes('2.5-pro') ? 1024 : 0 },
      // JSON mode for structured extraction (e.g. resume parsing) so the model
      // returns parseable JSON with no markdown fences or prose.
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
  });
  const result = await model.generateContent(prompt);
  const parts = result?.response?.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text || '').join('').trim();
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  // Health check
  if (req.method === 'GET' && req.url === '/') {
    return send(res, 200, {
      ok: true,
      model: MODEL,
      location: LOCATION,
      dailyLimit: DAILY_LIMIT,
      globalDailyLimit: GLOBAL_DAILY_LIMIT,
    });
  }

  if (req.method !== 'POST' || req.url !== '/generate') {
    return send(res, 404, { error: 'Not found' });
  }

  // Auth + quota. Admin token (if configured) bypasses sign-in and metering;
  // otherwise the bearer must be a valid Google sign-in token and the user must
  // be under their daily limit.
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) {
    return send(res, 401, { error: 'Sign in to use the managed AI.' });
  }
  const isAdmin = safeEqual(token, PROXY_TOKEN);
  if (!isAdmin) {
    const user = await verifyGoogleToken(token);
    if (!user) {
      return send(res, 401, { error: 'Sign in to use the managed AI.' });
    }
    let quota;
    try {
      quota = await checkAndIncrementQuota(user.sub, user.email);
    } catch (e) {
      console.error('[proxy] quota check failed', e);
      return send(res, 500, { error: 'Quota check failed. Try again.' });
    }
    if (!quota.allowed) {
      const error =
        quota.reason === 'global'
          ? 'The managed AI is at its daily capacity. Try again after midnight UTC, or add your own free Gemini key in options.'
          : `Daily limit reached (${quota.limit}/day). Resets at midnight UTC.`;
      return send(res, 429, { error });
    }
  }

  try {
    const raw = await readBody(req);
    const { system = '', prompt = '', maxOutputTokens, json, thinking, model } = JSON.parse(raw || '{}');
    if (!prompt) return send(res, 400, { error: 'Missing "prompt"' });
    if (prompt.length > MAX_PROMPT_CHARS || (system && system.length > MAX_PROMPT_CHARS)) {
      return send(res, 413, { error: 'Request too large.' });
    }

    const args = { system, prompt, maxOutputTokens, json, thinking, model };
    // Gemini occasionally returns an empty candidate for no real reason (a
    // transient hiccup). One retry almost always succeeds and saves the user a
    // manual re-run. The quota was already counted above, so the retry is free
    // to the user and doesn't double-count.
    let text = await generate(args);
    if (!text) text = await generate(args);
    if (!text) return send(res, 502, { error: 'Empty response from Vertex AI' });
    return send(res, 200, { text });
  } catch (err) {
    console.error('[proxy] error', err);
    const status = err?.code === 429 ? 429 : 500;
    return send(res, status, { error: String(err?.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(
    `[proxy] listening on :${PORT} (project=${PROJECT}, model=${MODEL}, location=${LOCATION}, dailyLimit=${DAILY_LIMIT})`,
  );
});
