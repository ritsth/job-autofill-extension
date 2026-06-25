// Content script: detects the ATS, fills standard fields on demand, and injects
// an "✨ AI answer" button beside each open-ended question.

import { getProfile, onProfileChanged } from '../lib/profile';
import { getSavedJobs, onSavedJobsChanged } from '../lib/savedJobs';
import { applyStandardFills, findOpenQuestions, fillInput, type OpenQuestion } from './adapters/shared';
import { greenhouseAdapter } from './adapters/greenhouse';
import { leverAdapter } from './adapters/lever';
import { workdayAdapter } from './adapters/workday';
import type { SiteAdapter } from './adapters/types';
import { sendToBackground } from '../lib/messages';
import type { AIResult, CapturedJob, ContentMessage, FillResult, PageInfo } from '../lib/messages';
import {
  startSponsorshipWatch,
  setScannerEnabled,
  setBadgeFeatures,
  setBadgeIntroSeen,
  getScanText,
  captureJob,
} from './sponsorship';

const ADAPTERS: SiteAdapter[] = [greenhouseAdapter, leverAdapter, workdayAdapter];
const adapter = ADAPTERS.find((a) => a.matches(new URL(location.href))) ?? null;

const BUTTON_CLASS = 'jaf-ai-btn';
const MARK_ATTR = 'data-jaf-bound';

// --- Messaging from popup ---
// Only the top frame answers the popup. With all_frames enabled, registering this
// in every sub-frame would make several frames race to sendResponse (the iframe
// could win and shadow the real page), so the listener is top-frame-only.
const isTopFrame = window.top === window.self;
if (isTopFrame)
  chrome.runtime.onMessage.addListener((msg: ContentMessage, _sender, sendResponse) => {
  if (msg.type === 'PAGE_INFO') {
    const info: PageInfo = adapter
      ? { supported: true, site: adapter.id, ...adapter.getPageInfo(), jobText: getScanText() }
      : { supported: false, site: null, company: '', role: '', jobText: '' };
    sendResponse(info);
    return false;
  }
  if (msg.type === 'CAPTURE_JOB') {
    const { company, role, text } = captureJob();
    const captured: CapturedJob = { company, role, text, url: location.href, title: document.title };
    sendResponse(captured);
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
    const jobText = getScanText();
    const res = await sendToBackground<AIResult>({ type: 'AI_GENERATE_ANSWER', question, jobText });
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
      color: #fff; background: #44506b; border: none; border-radius: 6px;
      cursor: pointer; line-height: 1.2;
    }
    .${BUTTON_CLASS}:hover { background: #333c52; }
    .${BUTTON_CLASS}:disabled { opacity: .7; cursor: default; }
  `;
  document.documentElement.appendChild(style);
}

// The AI-answer buttons show on the autofill boards (adapter) and, on any other
// site, once the user has an active saved job — so "save this job" lights up the
// "✨ AI answer" button next to that application's free-text questions anywhere.
let questionsOn = false;
let stylesInjected = false;

function setQuestionButtons(on: boolean): void {
  if (on === questionsOn) return;
  questionsOn = on;
  if (on) {
    if (!stylesInjected) {
      injectStyles();
      stylesInjected = true;
    }
    injectQuestionButtons();
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    observer.disconnect();
    window.clearTimeout(pending); // cancel any debounced re-inject still queued
    // Remove the buttons and unmark their textareas so they can re-bind later.
    document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((n) => n.remove());
    document.querySelectorAll(`[${MARK_ATTR}]`).forEach((el) => el.removeAttribute(MARK_ATTR));
  }
}

const recomputeQuestions = (activeId: string | null) =>
  setQuestionButtons(!!adapter || !!activeId);

getSavedJobs().then((s) => recomputeQuestions(s.activeId));
onSavedJobsChanged((s) => recomputeQuestions(s.activeId));

// The content script loads on every page; the scanner is gated by the user's
// setting. Run it once, in the top frame only, to avoid duplicate badges from
// re-injection or same-origin iframes.
const scannerGlobal = window as unknown as { __jafScannerStarted?: boolean };
if (window.top === window.self && !scannerGlobal.__jafScannerStarted) {
  scannerGlobal.__jafScannerStarted = true;
  (async () => {
    const profile = await getProfile();
    // Seed the one-time badge coachmark flag before enabling the scanner, so the
    // first badge render knows whether to show it.
    const { badgeIntroSeen } = await chrome.storage.local.get('badgeIntroSeen');
    setBadgeIntroSeen(Boolean(badgeIntroSeen));
    setBadgeFeatures({ coverLetter: profile.coverLetterEnabled, resume: profile.tailoredResumeEnabled });
    setScannerEnabled(profile.scanEnabled);
    startSponsorshipWatch();
  })();
  onProfileChanged((profile) => {
    setBadgeFeatures({ coverLetter: profile.coverLetterEnabled, resume: profile.tailoredResumeEnabled });
    setScannerEnabled(profile.scanEnabled);
  });
}
