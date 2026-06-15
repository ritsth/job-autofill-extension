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
  permissions: ['storage', 'activeTab', 'scripting', 'sidePanel'],
  // Job-site hosts (content scripts) + Gemini endpoint (so the service worker
  // can fetch it). The user's key never leaves their machine.
  host_permissions: [
    ...GREENHOUSE_MATCHES,
    ...LEVER_MATCHES,
    'https://generativelanguage.googleapis.com/*',
  ],
  content_scripts: [
    {
      matches: CONTENT_MATCHES,
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],
});
