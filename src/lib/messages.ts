// Typed message contracts shared across popup, options, content scripts and the
// background service worker. Background handles the AI_* messages (it owns the
// network + key). Content scripts handle the PAGE_* messages (they own the DOM).

export interface PageInfo {
  supported: boolean;
  site: 'greenhouse' | 'lever' | null;
  company: string;
  role: string;
}

export interface FillResult {
  filled: number;
  total: number;
}

// --- Background-handled (AI) ---
export interface GenerateAnswerMsg {
  type: 'AI_GENERATE_ANSWER';
  question: string;
}
export interface GenerateCoverLetterMsg {
  type: 'AI_GENERATE_COVER_LETTER';
  company: string;
  role: string;
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

export type BackgroundMessage =
  | GenerateAnswerMsg
  | GenerateCoverLetterMsg
  | ParseResumeMsg
  | AnalyzeJobMsg;
export type ContentMessage = FillPageMsg | GetPageInfoMsg;
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
