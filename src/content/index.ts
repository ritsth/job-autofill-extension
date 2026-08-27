// Content script: detects the ATS, fills standard fields on demand, and injects
// an "✨ AI answer" button beside each open-ended question.

import { getProfile, onProfileChanged } from '../lib/profile';
import { getSavedJobs, onSavedJobsChanged } from '../lib/savedJobs';
import { hostMatches, isHostDisabled } from '../lib/host';
import {
  applyStandardFills,
  findOpenQuestions,
  fillInput,
  needsReplaceConfirm,
  type OpenQuestion,
} from './adapters/shared';
import { greenhouseAdapter } from './adapters/greenhouse';
import { leverAdapter } from './adapters/lever';
import { workdayAdapter } from './adapters/workday';
import { ashbyAdapter } from './adapters/ashby';
import type { SiteAdapter } from './adapters/types';
import { AI_BUTTON_CSS, BUTTON_CLASS } from './aiButtonStyles';
import {
  CONTEXT_LOST_MESSAGE,
  isContextInvalidated,
  pageMessageRole,
  sendToBackground,
  UNSUPPORTED_REPLY_DELAY_MS,
} from '../lib/messages';
import type { AIResult, CapturedJob, ContentMessage, FillResult, PageInfo } from '../lib/messages';
import {
  startSponsorshipWatch,
  setScannerEnabled,
  setBadgeFeatures,
  setBadgeIntroSeen,
  setBadgeCorner,
  getScanText,
  captureJobWhenReady,
} from './sponsorship';

const ADAPTERS: SiteAdapter[] = [greenhouseAdapter, leverAdapter, workdayAdapter, ashbyAdapter];
const adapter = ADAPTERS.find((a) => a.matches(new URL(location.href))) ?? null;

const BUTTON_LABEL = '✨ AI answer';
const CONFIRM_LABEL = '↻ Replace your text?';
const CONFIRM_WINDOW_MS = 4000;

// Buttons awaiting a confirming second click → the timer that disarms them.
// Keyed weakly so a button dropped by injectQuestionButtons' reconciliation
// takes its armed state with it.
const armedButtons = new WeakMap<HTMLButtonElement, number>();

// Buttons WE created. Reconciliation and cleanup only ever touch members of this
// set, so a host page element that happens to share our class can never mark a
// question as handled or get deleted by us. A WeakSet (not a DOM attribute) means
// the host can't forge membership by copying an attribute.
const ownedButtons = new WeakSet<HTMLButtonElement>();

// --- Messaging from popup ---
const isTopFrame = window.top === window.self;

// "Save this job" must read the frame that actually holds the posting. On some
// SPA / prerendered LinkedIn views the visible job renders in a SUB-FRAME, not the
// top document, so a top-frame-only capture reads an empty page. So CAPTURE_JOB is
// answered by the top frame AND any job-board sub-frame: empty frames poll the full
// timeout and reply last, so whichever frame really holds the posting wins the
// sendMessage race. Ad / tracker sub-frames are excluded by host so they can't
// answer with their own body text. PAGE_INFO / PAGE_FILL use a different rule —
// see pageMessageRole.
const JOB_HOSTS = [
  'linkedin.com', 'joinhandshake.com', 'greenhouse.io', 'lever.co',
  'myworkdayjobs.com', 'myworkday.com', 'myworkdaysite.com', 'ashbyhq.com', 'ycombinator.com',
];
const answersCapture = isTopFrame || JOB_HOSTS.some((h) => hostMatches(location.hostname, h));

chrome.runtime.onMessage.addListener((msg: ContentMessage, _sender, sendResponse) => {
  if (msg.type === 'CAPTURE_JOB') {
    if (!answersCapture) return false;
    // Async: also waits a beat for SPA detail panes to paint before snapshotting.
    captureJobWhenReady().then(({ company, role, text }) => {
      const captured: CapturedJob = { company, role, text, url: location.href, title: document.title };
      sendResponse(captured);
    });
    return true;
  }
  // PAGE_INFO / PAGE_FILL are answered by whichever frame an adapter matched —
  // the top frame normally, or the ATS's own iframe when a company careers site
  // embeds the application form. See pageMessageRole for the race it resolves.
  const role = pageMessageRole(adapter !== null, isTopFrame);
  if (role === 'ignore') return false;

  if (msg.type === 'PAGE_INFO') {
    if (!adapter) {
      // role === 'answer-late': concede "unsupported" only after giving an
      // adapter-matching sub-frame time to answer first.
      setTimeout(
        () =>
          sendResponse({
            supported: false,
            site: null,
            company: '',
            role: '',
            jobText: '',
          } satisfies PageInfo),
        UNSUPPORTED_REPLY_DELAY_MS,
      );
      return true;
    }
    sendResponse({
      supported: true,
      site: adapter.id,
      ...adapter.getPageInfo(),
      jobText: getScanText(),
    } satisfies PageInfo);
    return false;
  }
  if (msg.type === 'PAGE_FILL') {
    // Only the adapter's own frame fills. The popup disables Fill unless some
    // frame reported supported, so an adapter-less frame acting here could only
    // ever be the wrong one — a careers page filling its own newsletter signup
    // while the real form sits in the iframe. Restricting it to one frame also
    // means there are no per-frame summaries to merge.
    if (!adapter) return false;
    getProfile()
      .then((profile) => {
        const summary = applyStandardFills(profile);
        injectQuestionButtons();
        sendResponse({
          filled: summary.filled,
          total: summary.total,
          alreadyFilled: summary.alreadyFilled,
        } satisfies FillResult);
      })
      .catch(() => sendResponse({ filled: 0, total: 0, alreadyFilled: 0 } satisfies FillResult));
    return true;
  }
  return false;
});

// --- AI answer buttons ---
// Reconcile the page to exactly one button immediately after each open question.
// We do NOT mark the textarea (an attribute or node identity the host framework
// would strip on re-render): Oracle/Workday-style forms re-render the field
// continuously, which previously made every observer cycle append another button
// while the old ones orphaned — a runaway pile-up. Keying on structure instead
// (button right after its textarea) is churn-proof: strays are removed, gaps are
// filled, and the count can't exceed the number of current questions.
function injectQuestionButtons(): void {
  // Suspend the observer so our own DOM writes below don't re-trigger this pass.
  const wasObserving = questionsOn;
  if (wasObserving) observer.disconnect();

  const questions = findOpenQuestions();
  const wanted = new Set<Element>(questions.map((q) => q.el));

  // Group OUR buttons by the current open-question textarea they sit right after.
  // Anything else — a button orphaned by a re-render, or a stray — is dropped.
  const byQuestion = new Map<Element, HTMLButtonElement[]>();
  for (const btn of document.querySelectorAll<HTMLButtonElement>(`.${BUTTON_CLASS}`)) {
    if (!ownedButtons.has(btn)) continue; // ignore host elements sharing the class
    const prev = btn.previousElementSibling;
    if (prev && wanted.has(prev)) {
      (byQuestion.get(prev) ?? byQuestion.set(prev, []).get(prev)!).push(btn);
    } else {
      btn.remove();
    }
  }

  // Keep exactly one button per question, preferring an in-flight one (disabled
  // while its answer generates) so a pending fill still targets a live node.
  const credited = new Set<Element>();
  for (const [el, btns] of byQuestion) {
    const keep = btns.find((b) => b.disabled) ?? btns[0];
    for (const b of btns) if (b !== keep) b.remove();
    credited.add(el);
  }

  // Add a button for any open question that doesn't already have one after it.
  for (const q of questions) {
    if (!credited.has(q.el)) addButtonFor(q);
  }

  if (wasObserving) observer.observe(document.body, { childList: true, subtree: true });
}

function addButtonFor(q: OpenQuestion): void {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = BUTTON_CLASS;
  btn.textContent = BUTTON_LABEL;
  ownedButtons.add(btn);
  btn.addEventListener('click', () => generateAnswer(q, btn));

  // Place the button right after the textarea.
  q.el.insertAdjacentElement('afterend', btn);
}

function disarm(btn: HTMLButtonElement): void {
  const timer = armedButtons.get(btn);
  if (timer !== undefined) window.clearTimeout(timer);
  armedButtons.delete(btn);
}

async function generateAnswer(q: OpenQuestion, btn: HTMLButtonElement): Promise<void> {
  // Replacing text the applicant already has is destructive and unrecoverable,
  // so it takes two clicks. Regeneration stays available — it just has to be
  // deliberate.
  if (needsReplaceConfirm(q.el.value, armedButtons.has(btn))) {
    btn.textContent = CONFIRM_LABEL;
    armedButtons.set(
      btn,
      window.setTimeout(() => {
        armedButtons.delete(btn);
        btn.textContent = BUTTON_LABEL;
      }, CONFIRM_WINDOW_MS),
    );
    return;
  }
  disarm(btn);

  // Revert to the constant, not to whatever the button happened to read on
  // entry — that could be the confirm prompt or a leftover transient state.
  const original = BUTTON_LABEL;
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
    // A stale content script (extension reloaded/updated under an open tab) is
    // recoverable by refreshing, so say that rather than a bare "failed".
    btn.textContent = isContextInvalidated(e)
      ? '⚠️ ' + CONTEXT_LOST_MESSAGE.slice(0, 40)
      : '⚠️ failed';
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
  style.textContent = AI_BUTTON_CSS;
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
    // Remove only OUR buttons; a later re-enable rebuilds them from scratch.
    document
      .querySelectorAll<HTMLButtonElement>(`.${BUTTON_CLASS}`)
      .forEach((n) => ownedButtons.has(n) && n.remove());
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
    try {
      const profile = await getProfile();
      // Seed the one-time badge coachmark flag and the user's badge corner before
      // enabling the scanner, so the first badge render is already correct.
      const { badgeIntroSeen, badgeCorner } = await chrome.storage.local.get([
        'badgeIntroSeen',
        'badgeCorner',
      ]);
      setBadgeIntroSeen(Boolean(badgeIntroSeen));
      setBadgeCorner(badgeCorner);
      setBadgeFeatures({ coverLetter: profile.coverLetterEnabled, resume: profile.tailoredResumeEnabled });
      // Gate on both the global switch and this host's per-site opt-out
      // ("⚙ Turn off on this site only" on the badge itself). Top frame only
      // (see the guard above), so this is always the URL-bar host the user
      // sees, even on a page whose posting text comes from a same-origin iframe.
      setScannerEnabled(profile.scanEnabled && !isHostDisabled(location.hostname, profile.disabledHosts));
    } catch (e) {
      // A failed storage read (e.g. an extension-update limbo) must not silently
      // kill the scanner — fall back to defaults, including for the per-site
      // opt-out: scanEnabled defaults ON in withDefaults, so this matches a
      // fresh profile with no disabled hosts. Force the coachmark to "seen" so
      // a fallback never flashes the intro bubble.
      console.warn('[Little AI Helper] scanner init failed; starting with defaults', e);
      setBadgeIntroSeen(true);
      setScannerEnabled(true);
    }
    startSponsorshipWatch();
  })();
  onProfileChanged((profile) => {
    setBadgeFeatures({ coverLetter: profile.coverLetterEnabled, resume: profile.tailoredResumeEnabled });
    setScannerEnabled(profile.scanEnabled && !isHostDisabled(location.hostname, profile.disabledHosts));
  });
}
