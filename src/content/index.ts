// Content script: detects the ATS, fills standard fields on demand, and injects
// an "✨ AI answer" button beside each open-ended question.

import { getProfile, onProfileChanged } from '../lib/profile';
import { applyStandardFills, findOpenQuestions, fillInput, type OpenQuestion } from './adapters/shared';
import { greenhouseAdapter } from './adapters/greenhouse';
import { leverAdapter } from './adapters/lever';
import type { SiteAdapter } from './adapters/types';
import { sendToBackground } from '../lib/messages';
import type { AIResult, ContentMessage, FillResult, PageInfo } from '../lib/messages';
import { startSponsorshipWatch, setScannerEnabled } from './sponsorship';

const ADAPTERS: SiteAdapter[] = [greenhouseAdapter, leverAdapter];
const adapter = ADAPTERS.find((a) => a.matches(new URL(location.href))) ?? null;

const BUTTON_CLASS = 'jaf-ai-btn';
const MARK_ATTR = 'data-jaf-bound';

// --- Messaging from popup ---
chrome.runtime.onMessage.addListener((msg: ContentMessage, _sender, sendResponse) => {
  if (msg.type === 'PAGE_INFO') {
    const info: PageInfo = adapter
      ? { supported: true, site: adapter.id, ...adapter.getPageInfo() }
      : { supported: false, site: null, company: '', role: '' };
    sendResponse(info);
    return false;
  }
  if (msg.type === 'PAGE_FILL') {
    getProfile()
      .then((profile) => {
        const summary = applyStandardFills(profile);
        injectQuestionButtons();
        sendResponse({ filled: summary.filled, total: summary.total } satisfies FillResult);
      })
      .catch(() => sendResponse({ filled: 0, total: 0 } satisfies FillResult));
    return true;
  }
  return false;
});

// --- AI answer buttons ---
function injectQuestionButtons(): void {
  if (!adapter) return;
  for (const q of findOpenQuestions()) {
    if (q.el.getAttribute(MARK_ATTR)) continue;
    q.el.setAttribute(MARK_ATTR, '1');
    addButtonFor(q);
  }
}

function addButtonFor(q: OpenQuestion): void {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = BUTTON_CLASS;
  btn.textContent = '✨ AI answer';
  btn.addEventListener('click', () => generateAnswer(q, btn));

  // Place the button right after the textarea.
  q.el.insertAdjacentElement('afterend', btn);
}

async function generateAnswer(q: OpenQuestion, btn: HTMLButtonElement): Promise<void> {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = '… thinking';
  try {
    const question = q.label || 'Please answer this application question.';
    const res = await sendToBackground<AIResult>({ type: 'AI_GENERATE_ANSWER', question });
    if (res.error) {
      btn.textContent = '⚠️ ' + res.error.slice(0, 40);
      setTimeout(() => (btn.textContent = original), 4000);
    } else {
      fillInput(q.el, res.text);
      btn.textContent = '✓ filled';
      setTimeout(() => (btn.textContent = original), 2000);
    }
  } catch (e) {
    btn.textContent = '⚠️ failed';
    console.error('[JobAutofill] answer generation failed', e);
    setTimeout(() => (btn.textContent = original), 3000);
  } finally {
    btn.disabled = false;
  }
}

// Application forms often render after a click, so watch for new questions.
let pending = 0;
const observer = new MutationObserver(() => {
  window.clearTimeout(pending);
  pending = window.setTimeout(injectQuestionButtons, 400);
});

function injectStyles(): void {
  const style = document.createElement('style');
  style.textContent = `
    .${BUTTON_CLASS} {
      display: inline-flex; align-items: center; gap: 4px;
      margin: 6px 0; padding: 5px 10px; font-size: 12px; font-weight: 600;
      color: #fff; background: #4f46e5; border: none; border-radius: 6px;
      cursor: pointer; line-height: 1.2;
    }
    .${BUTTON_CLASS}:hover { background: #4338ca; }
    .${BUTTON_CLASS}:disabled { opacity: .7; cursor: default; }
  `;
  document.documentElement.appendChild(style);
}

if (adapter) {
  injectStyles();
  injectQuestionButtons();
  observer.observe(document.body, { childList: true, subtree: true });
}

// The content script loads on every page; the scanner is gated by the user's
// setting. Run it once, in the top frame only, to avoid duplicate badges from
// re-injection or same-origin iframes.
const scannerGlobal = window as unknown as { __jafScannerStarted?: boolean };
if (window.top === window.self && !scannerGlobal.__jafScannerStarted) {
  scannerGlobal.__jafScannerStarted = true;
  (async () => {
    const profile = await getProfile();
    setScannerEnabled(profile.scanEnabled);
    startSponsorshipWatch();
  })();
  onProfileChanged((profile) => setScannerEnabled(profile.scanEnabled));
}
