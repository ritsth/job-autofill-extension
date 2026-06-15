// Cloud Run → Vertex AI proxy.
//
// The browser extension cannot safely hold a Google Cloud credential, so this
// tiny service does: it authenticates to Vertex AI with the Cloud Run service
// account (Application Default Credentials — no keys in code) and relays one
// kind of request:
//
//   POST /generate   { system, prompt, maxOutputTokens? }  ->  { text }
//
// Access is gated by a shared bearer token (PROXY_TOKEN) so the public URL
// can't be abused to spend your Vertex/credit quota.

import http from 'node:http';
import { VertexAI } from '@google-cloud/vertexai';

const PORT = process.env.PORT || 8080;
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT;
const LOCATION = process.env.VERTEX_LOCATION || 'us-central1';
// Vertex AI needs versioned/current model IDs (unlike AI Studio's bare aliases).
// gemini-2.5-flash is broadly available; older 1.5/2.0 IDs 404 on newer projects.
const MODEL = process.env.VERTEX_MODEL || 'gemini-2.5-flash';
const PROXY_TOKEN = process.env.PROXY_TOKEN || '';

if (!PROJECT) console.warn('[proxy] GOOGLE_CLOUD_PROJECT is not set');
if (!PROXY_TOKEN) console.warn('[proxy] PROXY_TOKEN is not set — the endpoint is unauthenticated!');

const vertex = new VertexAI({ project: PROJECT, location: LOCATION });

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

async function generate({ system, prompt, maxOutputTokens, json }) {
  const model = vertex.getGenerativeModel({
    model: MODEL,
    systemInstruction: system ? { role: 'system', parts: [{ text: system }] } : undefined,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: maxOutputTokens ?? 1024,
      // Disable "thinking" — 2.5 Flash otherwise spends the output budget on
      // hidden reasoning and returns empty/truncated text for short requests.
      // Autofill doesn't need it.
      thinkingConfig: { thinkingBudget: 0 },
      // JSON mode for structured extraction (e.g. résumé parsing) so the model
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
    return send(res, 200, { ok: true, model: MODEL, location: LOCATION });
  }

  if (req.method !== 'POST' || req.url !== '/generate') {
    return send(res, 404, { error: 'Not found' });
  }

  // Auth
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!PROXY_TOKEN || token !== PROXY_TOKEN) {
    return send(res, 401, { error: 'Unauthorized' });
  }

  try {
    const raw = await readBody(req);
    const { system = '', prompt = '', maxOutputTokens, json } = JSON.parse(raw || '{}');
    if (!prompt) return send(res, 400, { error: 'Missing "prompt"' });

    const text = await generate({ system, prompt, maxOutputTokens, json });
    if (!text) return send(res, 502, { error: 'Empty response from Vertex AI' });
    return send(res, 200, { text });
  } catch (err) {
    console.error('[proxy] error', err);
    const status = err?.code === 429 ? 429 : 500;
    return send(res, status, { error: String(err?.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`[proxy] listening on :${PORT} (project=${PROJECT}, model=${MODEL}, location=${LOCATION})`);
});
