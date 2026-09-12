// Pure status-line / gating helpers used by Popup.tsx. Kept in their own module
// (not inline in Popup.tsx) so a node-environment unit test for one of these can
// import just this file instead of dragging in the whole component and its
// transitive imports (auth, messages, profile, savedJobs, coverLetter, resume,
// React) — the same reasoning classifyFinishReason was split out for (#285/#299).

import { MAX_JOBS, MAX_TEXT } from '../lib/savedJobs';

/** Cover letter / tailored resume need both fields — blank or whitespace-only
 * company/role produces a weak, generic result. */
export function canGenerateDocuments(company: string, role: string): boolean {
  return company.trim() !== '' && role.trim() !== '';
}

/**
 * Status line shown after saving a job. Both caps can bite on the same save, so
 * the notices are composed rather than chosen — silently dropping either one is
 * how a trimmed posting or an evicted job goes unnoticed.
 */
export function saveJobNotice({
  truncated,
  evicted,
}: {
  truncated: boolean;
  evicted: boolean;
}): string {
  const notices: string[] = [];
  if (truncated) {
    notices.push(
      `the posting was long, so it was trimmed to ${MAX_TEXT.toLocaleString()} characters for AI context`,
    );
  }
  if (evicted) {
    // "within the N-job limit", not "under N": after eviction the list holds
    // exactly MAX_JOBS, so "under" would be off by one.
    notices.push(`your oldest saved job was dropped to stay within the ${MAX_JOBS}-job limit`);
  }
  return notices.length === 0 ? 'Job saved.' : `Saved — ${notices.join('; ')}.`;
}

/**
 * Status line shown after "Fill this page". A field the extension recognised
 * but left alone because it already held a value is not a failure — without
 * this split, re-clicking Fill on an already-filled page reports "Filled 0 of
 * N" at the exact moment nothing actually went wrong.
 */
export function fillNotice({
  filled,
  total,
  alreadyFilled,
}: {
  filled: number;
  total: number;
  alreadyFilled: number;
}): string {
  const base = `Filled ${filled} of ${total} recognised field${total === 1 ? '' : 's'}.`;
  if (alreadyFilled === 0) return base;
  return `Filled ${filled} of ${total} — ${alreadyFilled} already had your details.`;
}

/** Compact "saved N ago" label for a saved job's timestamp. */
export function timeAgo(ts: number): string {
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  const daysElapsed = secs / (24 * 60 * 60);
  if (daysElapsed < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  const weeks = Math.round(daysElapsed / 7);
  if (daysElapsed < 35) return `${weeks} wk ago`;
  const months = Math.round(daysElapsed / 30);
  if (daysElapsed < 360) return `${months} mo ago`;
  const years = Math.round(daysElapsed / 365);
  return `${years} yr ago`;
}
