// Typed message contracts shared across popup, options, content scripts and the
// background service worker. Background handles the AI_* messages (it owns the
// network + key). Content scripts handle the PAGE_* messages (they own the DOM).

export interface PageInfo {
  supported: boolean;
  site: 'greenhouse' | 'lever' | 'workday' | null;
  company: string;
  role: string;
  /** Scoped job-posting text, used to tailor AI answers + the cover letter. */
  jobText: string;
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

/** Promise wrapper around chrome.runtime.sendMessage (to background). */
export function sendToBackground<T = unknown>(msg: BackgroundMessage): Promise<T> {
  return chrome.runtime.sendMessage(msg);
}

/** Promise wrapper around chrome.tabs.sendMessage (to a content script). */
export function sendToTab<T = unknown>(tabId: number, msg: ContentMessage): Promise<T> {
  return chrome.tabs.sendMessage(tabId, msg);
}
