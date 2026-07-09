import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json';

// Hosts where the full autofill adapters run (standard HTML application forms).
// Kept for host_permissions; adapters self-detect via their own matches().
const GREENHOUSE_MATCHES = [
  'https://boards.greenhouse.io/*',
  'https://job-boards.greenhouse.io/*',
  'https://*.greenhouse.io/*',
];
const LEVER_MATCHES = ['https://jobs.lever.co/*'];
const WORKDAY_MATCHES = [
  'https://*.myworkdayjobs.com/*',
  'https://*.myworkday.com/*',
  'https://*.myworkdaysite.com/*',
];

// The content script runs on every page so the eligibility scanner has no gaps.
// It self-gates at runtime: autofill only activates on Greenhouse/Lever, and the
// badge only appears when (a) the user has the scanner enabled and (b) the page
// actually looks like a job posting.
const CONTENT_MATCHES = ['<all_urls>'];

export default defineManifest({
  manifest_version: 3,
  name: 'Little AI Helper',
  version: pkg.version,
  description: pkg.description,
  icons: {
    '16': 'icons/icon16.png',
    '48': 'icons/icon48.png',
    '128': 'icons/icon128.png',
  },
  // No default_popup: clicking the action opens the side panel (set up in the
  // service worker via setPanelBehavior) so the UI stays open until closed.
  action: {
    default_title: 'Little AI Helper',
  },
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  options_page: 'src/options/index.html',
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  // `identity` powers Google sign-in (chrome.identity.getAuthToken) for the
  // managed proxy, which meters AI usage per signed-in user. Keep this list
  // minimal — filling/AI buttons run via the declared content script, so no
  // `scripting` (programmatic injection) is needed.
  permissions: ['storage', 'activeTab', 'sidePanel', 'identity'],
  // OAuth client for sign-in. Create an "OAuth client ID → Chrome Extension"
  // bound to this extension's ID in Google Cloud Console, then paste it here.
  oauth2: {
    client_id: '1074158639574-u0ukfm6q8tlk8473v1u9nlcg9jgd65ge.apps.googleusercontent.com',
    scopes: ['openid', 'email', 'profile'],
  },
  // `key` pins a stable unpacked extension ID locally so the OAuth client keeps
  // matching across reloads. The Chrome Web Store REJECTS `key` in uploaded
  // packages (it assigns its own ID), so `npm run package` sets CRX_NO_KEY to
  // omit it. After publishing, rebind the OAuth client to the store-assigned ID.
  ...(process.env.CRX_NO_KEY
    ? {}
    : {
        key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyx7iOCwUWaSBtBb53d3CAKRAay5uVjfWZfwkSt5DwNPHJUEm5e3Bs+YwNFEfJD6RTdckQxvuxI3nHEasBIZJuTLaaHAoCzrHqwuOoZvIzVWjpNdZChPoXCXAE4c/Di2NNaFmOHlupUiuFoSgEneZhB5xuuTScsEnkz9JBgYhsdJ4PJKyfDXvkqXQ3J2T9R5avp3LwdV2BlPJKefhfP5T6dPOKPWsOa/pqyXhSZ4CdYNahyDn59a4BFWdhWmWnY7eUzScNs7wrv2m1s3dbEH27jFK3NRdW59lEJKSo87PKQoVQ+QltD7rDJWY7DkeadJbM3wKMeukg69/dSK+SYRvWwIDAQAB',
      }),
  // Job-site hosts (content scripts) + Gemini endpoint (so the service worker
  // can fetch it). The user's key never leaves their machine.
  host_permissions: [
    ...GREENHOUSE_MATCHES,
    ...LEVER_MATCHES,
    ...WORKDAY_MATCHES,
    'https://generativelanguage.googleapis.com/*',
    // Managed-proxy mode (Cloud Run). Lets the service worker call the proxy.
    'https://*.run.app/*',
  ],
  content_scripts: [
    {
      matches: CONTENT_MATCHES,
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
      // Run in sub-frames too: company career sites (e.g. Suvoda) embed the ATS
      // application form in an iframe, so the AI-answer buttons must reach it. The
      // popup-messaging handlers and the eligibility badge stay top-frame-only.
      all_frames: true,
    },
  ],
});
