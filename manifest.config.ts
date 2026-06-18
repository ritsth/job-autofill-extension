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
  name: 'AI Job Application Autofill',
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
    default_title: 'AI Job Autofill',
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
  // managed proxy, which meters AI usage per signed-in user.
  permissions: ['storage', 'activeTab', 'scripting', 'sidePanel', 'identity'],
  // OAuth client for sign-in. Create an "OAuth client ID → Chrome Extension"
  // bound to this extension's ID in Google Cloud Console, then paste it here.
  // The extension ID must be stable, so set a fixed `key` below (and use the same
  // key in the published build) — otherwise the ID changes on reload and the
  // OAuth client no longer matches.
  oauth2: {
    client_id: '1074158639574-u0ukfm6q8tlk8473v1u9nlcg9jgd65ge.apps.googleusercontent.com',
    scopes: ['openid', 'email', 'profile'],
  },
  key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAunuaggXKObgfFtm8X4j9kpSDCzUEqC2DfaWqbhurnE108+RYhHadleAeKTs++L/oH0yZ+XtIwUKAotkIaR7tUFcf+TXzwK0BFrFEAyVzaYS31CmujLgxDcjBC6zjJoZ3A08STA99DmFBNrn+PToqwewj43Lcw+queZqKoq0vq1VuBEZk8tQEO79AwkAb882wSBkyjVFM1ru7blePfMW4BMXoK3be/o96qnJlKvAlQiJ/giVf77nDCQjgTB7OGrvYgWiQtY2jxOSt4XHt/4svyijR0FJPxRH6vhDgppw9h5ccUpP/P9vvpYGO8YMKQEdMwpKpLCehYSFHVAbTAb2eaQIDAQAB', // pins a stable extension ID
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
    },
  ],
});
