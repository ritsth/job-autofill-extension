// Typed message contracts shared across popup, options, content scripts and the
// background service worker. Background handles the AI_* messages (it owns the
// network + key). Content scripts handle the PAGE_* messages (they own the DOM).

export interface PageInfo {
  supported: boolean;
  site: 'greenhouse' | 'lever' | 'workday' | 'ashby' | null;
  company: string;
  role: string;
  /** Scoped job-posting text, used to tailor AI answers + the cover letter. */
  jobText: string;
  /**
   * The TOP FRAME's hostname, so the popup can tell the user whether the
   * eligibility badge (which only ever runs top-frame) is turned off for this
   * site — see isHostDisabled in lib/host.ts. Empty when the reply came from an
   * adapter-matching SUB-frame (a company careers page embedding an ATS in an
   * iframe): that frame's own hostname is not the badge's hostname, and
   * reporting it would tell the popup the wrong site is disabled. Empty is
   * always safe here — isHostDisabled('', …) is unconditionally false.
   */
  hostname: string;
}

export interface FillResult {
  filled: number;
  total: number;
  /** Recognised fields left untouched because they already held a value. */
  alreadyFilled: number;
}

// --- Background-handled (AI) ---
export interface GenerateAnswerMsg {
  type: 'AI_GENERATE_ANSWER';
  question: string;
  /** Optional job-posting text so the answer is tailored to this role. */
  jobText?: string;
}
export interface GenerateCoverLetterMsg {
  type: 'AI_GENERATE_COVER_LETTER';
  company: string;
  role: string;
  /** Optional job-posting text so the opening paragraph fits this role. */
  jobText?: string;
}
export interface GenerateResumeMsg {
  type: 'AI_GENERATE_RESUME';
  company: string;
  role: string;
  /** Optional job-posting text so the resume is tailored to this role. */
  jobText?: string;
}
export interface ParseResumeMsg {
  type: 'AI_PARSE_RESUME';
  text: string;
}
export interface AnalyzeJobMsg {
  type: 'AI_ANALYZE_JOB';
  text: string;
}

// --- Content-handled (DOM, sent to a specific tab) ---
export interface FillPageMsg {
  type: 'PAGE_FILL';
}
export interface GetPageInfoMsg {
  type: 'PAGE_INFO';
}
export interface CaptureJobMsg {
  type: 'CAPTURE_JOB';
}

/** Snapshot of the current page's posting (works on any page, not just adapters). */
export interface CapturedJob {
  company: string;
  role: string;
  text: string;
  url: string;
  title: string;
}

export type BackgroundMessage =
  | GenerateAnswerMsg
  | GenerateCoverLetterMsg
  | GenerateResumeMsg
  | ParseResumeMsg
  | AnalyzeJobMsg;
export type ContentMessage = FillPageMsg | GetPageInfoMsg | CaptureJobMsg;
export type AnyMessage = BackgroundMessage | ContentMessage;

export interface AIResult {
  text: string;
  error?: string;
}

/** What a frame should do with a PAGE_INFO / PAGE_FILL message. */
export type FrameRole = 'answer' | 'answer-late' | 'ignore';

/**
 * Decides which frame answers PAGE_INFO / PAGE_FILL.
 *
 * chrome.tabs.sendMessage delivers to EVERY frame and keeps only the first
 * sendResponse, so the frame that actually holds the application form has to
 * win that race. Normally that's the top frame, but a company careers site can
 * embed the ATS in an iframe — then the top frame is the company's domain and
 * matches no adapter, while the sub-frame does.
 *
 * - A frame an adapter matched answers straight away, top-level or not.
 * - The top frame with no adapter answers LATE, so an adapter-matching
 *   sub-frame beats it. It must still answer eventually: on a genuinely
 *   unsupported page nobody else will, and the popup needs its "unsupported"
 *   reply. This is the same deliberate-delay technique the CAPTURE_JOB handler
 *   already relies on.
 * - A sub-frame with no adapter stays quiet — an ad or tracker iframe has
 *   nothing to say about the application form.
 */
export function pageMessageRole(hasAdapter: boolean, isTopFrame: boolean): FrameRole {
  if (hasAdapter) return 'answer';
  return isTopFrame ? 'answer-late' : 'ignore';
}

/**
 * How long the adapter-less top frame waits before conceding "unsupported".
 * Long enough for an ATS iframe's content script to win the race, short enough
 * that a genuinely unsupported page still feels instant.
 */
export const UNSUPPORTED_REPLY_DELAY_MS = 400;

/**
 * Shown instead of Chrome's internal "Extension context invalidated."
 *
 * When the extension is reloaded or auto-updated, content scripts from the
 * previous build keep running in already-open tabs but lose their connection to
 * the runtime. Every chrome.* call from that orphaned script then throws, and
 * the only cure is reloading the page so a fresh content script is injected.
 *
 * The action comes first so "Refresh this page" survives compact button labels.
 * Their tooltips retain the full message, including why a refresh is needed.
 */
export const CONTEXT_LOST_MESSAGE = 'Refresh this page — the extension was updated.';

/**
 * True for the failure an orphaned content script gets. Matched on the message
 * because Chrome surfaces it as a plain Error with no code to test.
 *
 * Recognises BOTH Chrome's raw wording and the CONTEXT_LOST_MESSAGE that
 * sendToBackground rewrites it to — callers downstream of that rewrite only ever
 * see the friendly form, so matching the raw string alone would never fire.
 */
export function isContextInvalidated(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return /extension context invalidated/i.test(msg) || msg === CONTEXT_LOST_MESSAGE;
}

/** Promise wrapper around chrome.runtime.sendMessage (to background). */
export async function sendToBackground<T = unknown>(msg: BackgroundMessage): Promise<T> {
  // chrome.runtime.id is undefined once the context is gone. Checking it first
  // catches the case before Chrome throws, and doesn't depend on the wording of
  // an internal error string.
  if (!chrome.runtime?.id) throw new Error(CONTEXT_LOST_MESSAGE);
  try {
    return (await chrome.runtime.sendMessage(msg)) as T;
  } catch (e) {
    // Keep the original as `cause` — the friendly message replaces it in the UI,
    // but the raw Chrome error is what you want in the console.
    if (isContextInvalidated(e)) throw new Error(CONTEXT_LOST_MESSAGE, { cause: e });
    throw e;
  }
}

/** Promise wrapper around chrome.tabs.sendMessage (to a content script). */
export function sendToTab<T = unknown>(tabId: number, msg: ContentMessage): Promise<T> {
  return chrome.tabs.sendMessage(tabId, msg);
}
