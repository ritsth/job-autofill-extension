// Scans the job page for work-eligibility signals (visa sponsorship, U.S.
// citizenship, security clearance, export control) and shows a bold YES / NO /
// amber-MAYBE badge so you can triage a posting at a glance. Works on single-page
// boards (LinkedIn, Handshake) by re-checking the selected posting as you switch.
// The instant result is rules-based; an on-demand "AI check" reads odd wording.

import { sendToBackground } from '../lib/messages';
import type { AIResult } from '../lib/messages';
import { parseEligibilityJson } from '../lib/jobEligibility';
import { downloadLetter } from '../lib/coverLetter';
import { downloadResume } from '../lib/resume';
import { getProfile, saveProfile } from '../lib/profile';
import { hostMatches } from '../lib/host';

export type Verdict = 'yes' | 'no' | 'caution' | 'unknown';

export interface SponsorAnalysis {
  verdict: Verdict;
  restrictions: string[];
  cautions: string[];
  positives: string[];
  experience: { required: string | null; preferred: string | null };
  /** One-line explanation (AI source only). */
  reason?: string;
  /** Whether the verdict came from the rules pass or an AI reading. */
  source: 'rules' | 'ai';
}

// Hard restrictive signals → red NO. Order doesn't matter; labels are de-duped.
const RESTRICTIONS: { re: RegExp; label: string }[] = [
  { re: /\bmust be (a |an )?(u\.?s\.?|united states) citizen/i, label: 'U.S. citizenship required' },
  // Lookbehind avoids "preferred but not required" → false NO.
  { re: /\b(u\.?s\.?|united states)\s+citizen(ship)?\b[^.]{0,40}\b(?<!not )(require|required|must|only|need)/i, label: 'U.S. citizenship required' },
  { re: /\bcitizenship (is )?required\b/i, label: 'Citizenship required' },
  // Clearance counts as a hard restriction only with a level or requirement cue
  // (so "clearance preferred" falls through to the caution tier).
  { re: /\b(ts\/sci|top secret|secret clearance|public trust)\b/i, label: 'Security clearance' },
  { re: /\b(active|current)\s+(security |government )?clearance\b/i, label: 'Security clearance' },
  { re: /\b(security )?clearance\b[^.!?]{0,25}\b(require|required|mandatory|must)\b/i, label: 'Security clearance' },
  { re: /\b(require[sd]?|must have|must hold|must (be able to )?obtain)\b[^.!?]{0,25}\b(security )?clearance\b/i, label: 'Security clearance' },
  { re: /\b(itar|export[- ]control)/i, label: 'ITAR / export-controlled' },
  // Strong inability cue anywhere in the same sentence as "sponsor(ship)" —
  // catches "unable to consider candidates who require visa sponsorship".
  { re: /\b(unable to|not able to|cannot|can.?t|won.?t|will not|not in a position to|ineligible|not eligible|are unable to|is unable to)\b[^.!?]{0,70}\bsponsor(ship|ed|ing)?\b/i, label: 'No visa sponsorship' },
  // "do/does not ... sponsor" kept narrow so it doesn't catch "do not hesitate".
  { re: /\b(do not|does not|don.?t|are not|aren.?t)\s+(currently |presently )?(provide |offer |support )?sponsor/i, label: 'No visa sponsorship' },
  // "sponsorship is not available / not provided / not offered" word order.
  { re: /\bsponsor(ship|ed|ing)?\b[^.!?]{0,40}\b(is not|are not|not (available|provided|offered)|will not|cannot|can.?t)\b/i, label: 'No visa sponsorship' },
  { re: /\bno (visa |employer )?sponsorship\b/i, label: 'No visa sponsorship' },
  // "no current/future sponsorship available" — negation sits before "sponsorship".
  { re: /\bno\b[^.!?]{0,30}\bsponsorship\b[^.!?]{0,20}\b(available|provided|offered)\b/i, label: 'No visa sponsorship' },
  { re: /\bwithout (the need for |requiring |needing )?(visa |employer )?sponsorship\b/i, label: 'Must not need sponsorship' },
  { re: /\bwork authoriz(?:ed|ation)\b[^.!?]{0,30}\b(does not|do not|that does not)\b[^.!?]{0,15}\bsponsor/i, label: 'No visa sponsorship' },
  { re: /\bauthoriz(?:ed|ation) to work\b[^.!?]{0,45}\b(on a permanent basis|on an ongoing basis|indefinitely|without restriction)\b/i, label: 'Must not need sponsorship' },
  { re: /\b(lawful permanent resident|green card holder|permanent resident)\b[^.!?]{0,25}\b(require|required|must|only)\b/i, label: 'Permanent resident required' },
  { re: /\bmust (be|have|hold)\b[^.!?]{0,25}\b(green card|lawful permanent resident|permanent resident)\b/i, label: 'Permanent resident required' },
  { re: /\b(u\.?s\.?|united states)\s+persons?\b/i, label: 'U.S. person (export control)' },
];

// Soft / preference signals → amber caution (not a hard disqualifier).
const CAUTIONS: { re: RegExp; label: string }[] = [
  { re: /\b(u\.?s\.?|united states)\s+citizen(ship)?\b[^.!?]{0,30}\b(preferred|a plus|is a plus|desired|nice to have)\b/i, label: 'U.S. citizenship preferred' },
  { re: /\b(prefer(red|ence)?|a plus|desired)\b[^.!?]{0,30}\b(u\.?s\.?|united states)\s+citizen/i, label: 'U.S. citizenship preferred' },
  { re: /\b(security )?clearance\b[^.!?]{0,30}\b(preferred|a plus|is a plus|desired|nice to have)\b/i, label: 'Clearance preferred' },
  { re: /\b(prefer(red|ence)?|a plus|desired)\b[^.!?]{0,30}\b(security )?clearance\b/i, label: 'Clearance preferred' },
];

// Friendly signals → green YES.
const POSITIVES: { re: RegExp; label: string }[] = [
  { re: /\b(visa )?sponsorship (is )?(available|provided|offered|considered|supported)\b/i, label: 'Sponsorship available' },
  { re: /\bwe (will |can |do |are happy to |are able to |are willing to )?sponsor\b/i, label: 'Employer sponsors' },
  { re: /\b(willing|open|happy) to sponsor/i, label: 'Open to sponsorship' },
  { re: /\bwe (provide|offer)\b[^.!?]{0,15}\b(visa )?sponsorship\b/i, label: 'Employer sponsors' },
  { re: /\bsponsorship\b[^.!?]{0,25}\bfor the right candidate\b/i, label: 'Sponsorship available' },
  { re: /\bopen to international (candidates|applicants|hires)\b/i, label: 'Open to international candidates' },
  { re: /\bh-?1b\b[^.]{0,30}(sponsor|welcome|transfer)/i, label: 'H-1B sponsorship' },
];

// Spelled-out numbers → digits so "a minimum of three years" is caught.
const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const NUMBER_WORD_RE = new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join('|')})\\b`, 'g');

/** Lowercases and normalizes punctuation/numbers to make matching more robust. */
function normalizeText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[‐-―]/g, '-') // unicode dashes → hyphen
    .replace(/[ \t]+/g, ' ') // nbsp/tabs → space
    .replace(NUMBER_WORD_RE, (m) => String(NUMBER_WORDS[m]));
}

export function analyze(text: string): SponsorAnalysis {
  const norm = normalizeText(text);
  // Match eligibility on prose only — screening QUESTIONS like "Are you
  // authorized to work without sponsorship?" describe the form, not the employer's
  // stance, and would otherwise produce a false NO.
  const prose = stripQuestions(norm);
  const restrictions = dedupe(RESTRICTIONS.filter((r) => r.re.test(prose)).map((r) => r.label));
  const cautions = dedupe(CAUTIONS.filter((c) => c.re.test(prose)).map((c) => c.label));
  const positives = dedupe(POSITIVES.filter((p) => p.re.test(prose)).map((p) => p.label));
  // Hard restriction dominates; then soft preference; then a positive signal.
  const verdict: Verdict = restrictions.length
    ? 'no'
    : cautions.length
      ? 'caution'
      : positives.length
        ? 'yes'
        : 'unknown';
  return { verdict, restrictions, cautions, positives, experience: extractExperience(norm), source: 'rules' };
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

/** Drops question sentences/lines (screening questions) before eligibility matching. */
function stripQuestions(text: string): string {
  return text
    .split(/(?<=[.?!])\s+|\n+/)
    .filter((seg) => {
      const t = seg.trim();
      if (/\?\s*\*?$/.test(t)) return false; // ends with ? (optionally a required-* marker)
      if (/^(are|do|does|did|will|can|have|has|had|would|is)\s+you\b/i.test(t)) return false;
      // Imperative application-form prompts describe the FORM, not the employer's
      // stance — e.g. "please indicate 'Yes' if you are a citizen of…" or "Solely
      // for the purpose of determining if an export control license is needed…".
      // These must be dropped too, or the export-control screening question every
      // US application carries would trip the ITAR rule into a false NO.
      if (/\bplease (indicate|select|answer|confirm|specify|check|state|provide)\b/i.test(t)) return false;
      if (/\bfor the (sole )?purpose of determining\b/i.test(t)) return false;
      return true;
    })
    .join(' ');
}

/**
 * Reads a *labelled* experience field (common on Workday / ATS career pages),
 * where the answer is a label→value pair rather than inline prose — e.g.
 * "Required Years of Experience: None required" or "Years of Experience\n3-5".
 * Handles the non-numeric answers ("None required", "Entry level") that the
 * numeric prose matcher in extractExperience can't see. Returns a value sized to
 * read well after the badge's " required" / " preferred" suffix.
 */
function labeledExperience(lower: string, kind: 'required' | 'preferred'): string | null {
  const label =
    kind === 'required'
      ? '(?:required\\s+)?years?\\s+of\\s+experience|experience\\s+required|minimum\\s+(?:years?\\s+of\\s+)?experience'
      : 'preferred\\s+years?\\s+of\\s+experience|years?\\s+of\\s+experience\\s+preferred';
  // The value can sit after a colon or on the next line, so \s* spans the newline.
  const m = lower.match(new RegExp(`(?:${label})\\s*[:\\-]?\\s*([^\\n.]{1,40})`));
  const v = m?.[1]?.trim();
  if (!v) return null;
  if (/^(none|no)\b/.test(v) || /\bno experience\b/.test(v) || /\bnot? (required|necessary)\b/.test(v)) {
    return 'None';
  }
  if (/entry[- ]level|new grad/.test(v)) return 'New grad';
  const num = v.match(/(\d{1,2})\s*\+?\s*(?:to|–|—|-)?\s*(\d{1,2})?/);
  if (num) return num[2] && num[2] !== num[1] ? `${num[1]}–${num[2]} yrs` : `${num[1]}+ yrs`;
  return null;
}

/** Pulls required / preferred years-of-experience figures from the posting. */
function extractExperience(text: string): { required: string | null; preferred: string | null } {
  const lower = text.toLowerCase();
  // A 1–20 year count (with leading/trailing-digit guards so "50 years" doesn't
  // match as "5"). This is only a cheap backstop now — the real guard against
  // company-age numbers ("For more than 50 years, we have…") is that we only read
  // a number when it sits next to a requirement cue (findNear) or a labelled field.
  const YR = '(?<!\\d)(20|1[0-9]|[1-9])(?!\\d)\\s*\\+?\\s*(?:to|–|—|-)?\\s*(\\d{1,2})?\\+?\\s*years?';
  const fmt = (m: RegExpMatchArray): string =>
    m[2] && m[2] !== m[1] ? `${m[1]}–${m[2]} yrs` : `${m[1]}+ yrs`;

  const findNear = (cues: string): string | null => {
    // Prefer "N years <cue>" (the common phrasing) over "<cue> … N years".
    // Keep the windows tight so a cue binds to the adjacent number, not one a
    // clause away ("8 years preferred, 5 years required").
    const after = lower.match(new RegExp(`${YR}[^.!?]{0,12}?(?:${cues})`));
    if (after) return fmt(after);
    const before = lower.match(new RegExp(`(?:${cues})[^.!?]{0,20}?${YR}`));
    return before ? fmt(before) : null;
  };

  // Labelled fields win — they're the explicit answer and catch non-numeric values.
  const preferred =
    labeledExperience(lower, 'preferred') ?? findNear('preferred|a plus|nice to have|ideally|desirable');
  let required =
    labeledExperience(lower, 'required') ?? findNear('minimum|min\\.?|at least|required|must have|or more');
  // "N years of experience" — the common requirement phrasing, where the number is
  // bound directly to "experience" (the anchoring cue). The YR cap (≤20) rejects
  // company-age numbers like "50 years…"; "industry" is intentionally NOT a cue
  // here because "30 years of industry experience" is usually a company boast.
  if (!required) {
    const generic = lower.match(new RegExp(`${YR}\\s+(?:of\\s+)?(?:experience|exp\\b|professional|relevant)\\b`));
    if (generic) required = fmt(generic);
  }
  // Last resort: explicit "no experience" / entry-level phrasing with no number.
  if (!required) {
    if (/\bno(?:\s+prior)?\s+experience\s+(?:is\s+)?(?:required|necessary|needed)\b/.test(lower)) required = 'None';
    else if (/\b(entry[- ]level|new grad(?:uate)?s?)\b/.test(lower)) required = 'New grad';
  }
  return { required, preferred };
}

// --- Reading the right text ---

// Per-host containers for the *selected* job's detail pane, so split list+detail
// boards check the posting you're viewing rather than the whole page.
const DETAIL_SELECTORS: Record<string, string[]> = {
  'linkedin.com': [
    // Description body first, so we read the posting — not the whole detail
    // pane (feedback widget, "how you compare" upsell, applicant insights).
    '.jobs-description-content__text',
    '.jobs-box__html-content',
    '#job-details',
    '.jobs-description__content',
    // Attribute-contains variants catch the SPA (in-app nav) render, whose
    // wrapper classes differ from the server-rendered (post-reload) DOM.
    '[class*="jobs-description__container"]',
    '[class*="jobs-description"]',
    // Detail-pane wrapper: on split/collections views this scopes to the
    // SELECTED job (title + description) and keeps the left job-list, nav, and
    // profile rail out when the description-specific classes above miss.
    '.jobs-details__main-content',
    '[class*="jobs-details__main-content"]',
    '.jobs-search__job-details--wrapper',
    '.jobs-search__job-details',
    '.job-view-layout',
  ],
  'joinhandshake.com': ['[data-hook="details-container"]', 'main', '[role="main"]'],
};

const MAX_CHARS = 200_000;

// Boards that collapse the job description behind a "More"/"Show more" toggle
// which only injects the full text into the DOM once expanded — so eligibility
// wording stays hidden until then. We auto-click it (scoped to the detail pane).
// NB: LinkedIn is intentionally NOT here — its full description is already in the
// DOM (visually clamped, but innerText reads it whole), and auto-clicking its
// "see more" toggles a company link that navigates the tab away from the posting.
const EXPAND_HOSTS = ['joinhandshake.com'];
const EXPAND_LABELS = new Set([
  'more',
  'show more',
  'see more',
  'read more',
  'view more',
  'show full description',
  'see more details',
]);

function isExpandLabel(raw: string): boolean {
  const l = raw.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.…]+$/, '').trim();
  return EXPAND_LABELS.has(l);
}

/** Clicks any collapsed-description expander within `root` (once per element). */
function autoExpandDescription(root: ParentNode): void {
  if (!EXPAND_HOSTS.some((d) => hostMatches(location.hostname, d))) return;
  for (const el of root.querySelectorAll<HTMLElement>('button, a, [role="button"]')) {
    if (el.getAttribute('data-jaf-expanded')) continue;
    if (!isExpandLabel(el.textContent || '')) continue;
    el.setAttribute('data-jaf-expanded', '1');
    el.click(); // DOM updates async; the watcher re-scans the full text after.
  }
}

// Wrappers that usually hold the job description on ATS / career pages whose host
// isn't a known SPA board. Class names on these boards are often build-hashed, so
// we lean on stable data-* hooks and semantic tags. Tried in priority order (most
// specific first); the first substantial match wins, which keeps nav, footers,
// cookie banners, and "related jobs" out of the eligibility read.
const CONTENT_SELECTORS = [
  '[data-automation-id="jobPostingDescription"]', // Workday
  '[data-qa="job-description"]', // Lever (newer markup)
  '.job__description', // Greenhouse
  '#job_description', // Greenhouse (older)
  '.posting', // Lever
  'main',
  'article',
  '[role="main"]',
];

/** The most likely job-description block on a generic page, or null to fall back. */
function pickMainContent(): string | null {
  for (const sel of CONTENT_SELECTORS) {
    const el = document.querySelector<HTMLElement>(sel);
    const t = el?.innerText?.trim();
    if (t && t.length > 200) return t;
  }
  return null;
}

/**
 * Text from the largest same-origin iframe document, '' when none is readable.
 * ATSes like iCIMS render the posting in a same-origin frame, which innerText
 * on the top document never includes — so without this the scan (rules AND AI)
 * reads only the outer branding chrome and misses the real requirements.
 * Cross-origin frames throw / return null on contentDocument access and are
 * skipped, which also keeps ad frames out.
 */
function sameOriginFrameText(): string {
  let best = '';
  for (const f of document.querySelectorAll('iframe')) {
    try {
      const t = f.contentDocument?.body?.innerText?.trim() || '';
      if (t.length > best.length) best = t;
    } catch {
      // Cross-origin — skip.
    }
  }
  return best;
}

/**
 * Most robust LinkedIn description read: anchor on the "About the job" section
 * heading. That label text is stable across ALL of LinkedIn's job layouts —
 * including the newer ones whose CSS classes are hashed/obfuscated (`_243b3f31`
 * …), where no semantic selector like `#job-details` or `.jobs-description`
 * exists at all. Find the heading by its text, then return the smallest enclosing
 * block that holds the description. Returns '' when there's no such section.
 */
function linkedInDescription(): string {
  const heading = [...document.querySelectorAll<HTMLElement>('h1,h2,h3,[role="heading"]')].find(
    (h) => /^(about the job|job description)\b/i.test((h.innerText || '').trim()),
  );
  if (!heading) return '';
  // Climb to the first ancestor that also contains the description text (the
  // section wrapping the heading), then stop — don't balloon into other sections.
  let node: HTMLElement | null = heading.parentElement;
  for (let i = 0; node && i < 6; i++, node = node.parentElement) {
    const t = node.innerText?.trim() ?? '';
    if (t.length >= 120 && t.length <= 20_000) return t.slice(0, MAX_CHARS);
  }
  return '';
}

/**
 * Layout-agnostic LinkedIn read. LinkedIn's job surfaces (collections, /jobs/search,
 * /jobs/view, email `/comm/` links, public pages) each use different container
 * classes, so instead of chasing every one, anchor on the job-title element —
 * matched loosely and case-insensitively by the stable "job-title" / "topcard"
 * fragments — and climb to the smallest ancestor that also holds the description.
 * Returns '' on a genuine miss so the caller can fail cleanly rather than grab
 * page chrome. Runs per-frame, so with the all-frames CAPTURE_JOB responder the
 * frame that actually holds the posting is the one that answers.
 */
function linkedInPostingText(): string {
  const title = document.querySelector<HTMLElement>(
    '[class*="top-card__job-title" i], [class*="topcard__title" i], h1[class*="job" i]',
  );
  if (!title) return '';
  let best = '';
  let node: HTMLElement | null = title;
  for (let i = 0; node && i < 12; i++, node = node.parentElement) {
    const t = node.innerText?.trim() ?? '';
    // Keep the largest ancestor that's still posting-scale; once it balloons past
    // ~40k it has folded in the left job-list / page chrome, so stop.
    if (t.length >= 400 && t.length <= 40_000) best = t;
    else if (t.length > 40_000) break;
  }
  return best.slice(0, MAX_CHARS);
}

interface YcJob {
  title?: string;
  visa?: string;
  minExperience?: string;
  description?: string;
}

/**
 * ycombinator.com renders a job from an Inertia `data-page` JSON blob and shows a
 * feed of *other* roles on the same page, so reading innerText would blend other
 * jobs' requirements into this one (and the React root has no <main> to scope to).
 * Read THIS job's structured fields — visa + experience — straight from the page
 * props and synthesize clean text the rules/AI can parse. `visa` and
 * `minExperience` are tidy enums ("Will sponsor", "US citizen/visa only",
 * "1+ years", "Any (new grads ok)"), so this is more reliable than prose anyway.
 */
function getYcJobText(): string | null {
  if (!hostMatches(location.hostname, 'ycombinator.com')) return null;
  if (!/\/jobs\/[A-Za-z0-9]/.test(location.pathname)) return null; // job detail only
  const raw = document.querySelector('[data-page]')?.getAttribute('data-page');
  if (!raw) return null;
  let job: YcJob | undefined;
  try {
    job = (JSON.parse(raw) as { props?: { job?: YcJob } })?.props?.job;
  } catch {
    return null;
  }
  if (!job || typeof job !== 'object') return null;

  const parts: string[] = [];
  if (job.title) parts.push(String(job.title));
  const visa = String(job.visa || '').toLowerCase();
  if (/will sponsor/.test(visa)) {
    parts.push('Visa sponsorship is available for this role.');
  } else if (/citizen|visa only/.test(visa)) {
    parts.push('Open to U.S. citizens or current visa holders only — no visa sponsorship.');
  }
  // A labelled experience line so extractExperience reads it (handles "1+ years",
  // "Any (new grads ok)" → New grad, etc.).
  if (job.minExperience) parts.push(`Required years of experience: ${job.minExperience}.`);
  if (job.description) parts.push(String(job.description));
  return parts.length > 1 ? parts.join('\n\n') : null;
}

export function getScanText(): string {
  const yc = getYcJobText();
  if (yc) return yc.slice(0, MAX_CHARS);
  const host = location.hostname;
  const key = Object.keys(DETAIL_SELECTORS).find((d) => hostMatches(host, d));
  if (key) {
    autoExpandDescription(document); // reveal collapsed descriptions before reading
    for (const sel of DETAIL_SELECTORS[key]) {
      const el = document.querySelector<HTMLElement>(sel);
      const t = el?.innerText?.trim();
      if (t && t.length > 80) return t.slice(0, MAX_CHARS);
    }
    // LinkedIn: the job detail pane is the ONLY valid source. If none of the
    // known containers matched (an unfamiliar layout), try the layout-agnostic
    // title-anchored read before giving up. Still never fall back to the whole
    // page — that captures nav + profile rail + footer chrome.
    if (hostMatches(location.hostname, 'linkedin.com')) {
      // "About the job" section — survives LinkedIn's class-hashed layouts.
      const desc = linkedInDescription();
      if (desc.trim().length > 80) return desc.slice(0, MAX_CHARS);
      // Title-anchored posting block — classic top-card layouts.
      const anchored = linkedInPostingText();
      return anchored.trim().length > 80 ? anchored.slice(0, MAX_CHARS) : '';
    }
  }
  // Other sites (Greenhouse, Lever, Ashby, Workday, company pages): read just the
  // description block, not the whole body, so the eligibility read isn't diluted.
  // Badge text lives in a Shadow DOM, so innerText excludes it (no feedback loop).
  const local = pickMainContent() ?? (document.body?.innerText || '');
  // The posting may live in a same-origin iframe (iCIMS et al.) that innerText on
  // this document can't see — merge the frame's text in. Concatenating (rather
  // than picking one) keeps this recall-only: everything the scan saw before is
  // still present, so no existing site regresses.
  const frame = sameOriginFrameText();
  const combined = frame ? `${local}\n\n${frame}` : local;
  return combined.slice(0, MAX_CHARS);
}

function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h;
}

// --- Badge state + watcher ---

const BANNER_ID = 'jaf-sponsor-banner';
let dismissed = false;
let enabled = true;
let watchUrl = '';
let lastHash = 0;
let observer: MutationObserver | null = null;
let debounceTimer = 0;
// Set by the MutationObserver, cleared by a full scan. Lets the interval tick
// skip the whole-page innerText read when nothing has changed — its only real
// job is catching SPA history changes that mutate little.
let mutationDirty = false;
// Signature of the badge currently on screen, so identical re-computations keep
// the mounted DOM instead of tearing it down. Cleared by removeBadge().
let renderedSig = '';
// AI results cached per posting (by scanned-text hash) so revisiting a job — or
// a re-render from the watcher — reuses the AI verdict without another call.
const aiCache = new Map<number, SponsorAnalysis>();
// The AI verdict the user explicitly requested for the posting currently in view,
// pinned to its URL. The watcher mutates often (live counts, timestamps) which
// shifts the scanned-text hash; without this pin a re-render would miss the
// hash-keyed cache and revert the badge to the rules verdict — the "glitch back
// and forth". Cleared when the viewed posting (URL) actually changes.
let pinnedAi: SponsorAnalysis | null = null;
let pinnedAiUrl = '';
// Which generators the badge offers (Handshake only), driven by the user's
// settings. Both default on; unchecking removes that generator from the badge.
let showCoverLetterInBadge = true;
let showResumeInBadge = true;

/** Turns the scanner on/off globally (driven by the user's setting). */
export function setScannerEnabled(value: boolean): void {
  enabled = value;
  if (!enabled) removeBadge();
  else scanSponsorship();
}

// One-time "what is this badge" coachmark, shown the first time the badge ever
// appears. `introSeen` defaults true so it never flashes before the stored flag
// is loaded (index.ts loads it at init and calls setBadgeIntroSeen).
const INTRO_SEEN_KEY = 'badgeIntroSeen';
let introSeen = true;

/** Seeds the intro-seen flag from storage (called once from the content init). */
export function setBadgeIntroSeen(value: boolean): void {
  introSeen = value;
}

/** Marks the coachmark as seen so it never shows again. */
function markIntroSeen(): void {
  introSeen = true;
  chrome.storage.local.set({ [INTRO_SEEN_KEY]: true });
}

// Which viewport corner the badge sits in. The user can drag the badge (or use
// arrow keys on its header) to any corner; the choice is persisted so every page
// renders it where they put it. Loaded at content init (index.ts calls
// setBadgeCorner), defaulting to the historical top-right.
export type BadgeCorner = 'tl' | 'tr' | 'bl' | 'br';
const CORNER_KEY = 'badgeCorner';
let badgeCorner: BadgeCorner = 'tr';

/** Seeds the badge corner from storage (called once from the content init). */
export function setBadgeCorner(value: unknown): void {
  if (value === 'tl' || value === 'tr' || value === 'bl' || value === 'br') badgeCorner = value;
}

/** Pure: the corner nearest to a point (the badge's center) in a vw×vh viewport. */
export function nearestCorner(cx: number, cy: number, vw: number, vh: number): BadgeCorner {
  return `${cy < vh / 2 ? 't' : 'b'}${cx < vw / 2 ? 'l' : 'r'}` as BadgeCorner;
}

/** Clamp one axis so a size-`len` badge stays within a `viewport`-long axis. */
export function clampAxis(pos: number, len: number, viewport: number): number {
  // Inner max guards a badge larger than the viewport: pin it to the top/left
  // edge (0) rather than letting a negative upper bound push it off-screen.
  return Math.max(0, Math.min(pos, Math.max(0, viewport - len)));
}

/** Persists a new corner; must never throw in an orphaned extension context. */
function saveCorner(corner: BadgeCorner): void {
  badgeCorner = corner;
  try {
    // Catch both a synchronous throw (context invalidated) and an async
    // rejection (e.g. quota) so neither surfaces as an unhandled rejection —
    // the in-page move still works regardless.
    void chrome.storage.local.set({ [CORNER_KEY]: corner }).catch(() => {});
  } catch {
    // Extension context invalidated — keep the in-page move working anyway.
  }
}

/** Positions the badge column in a corner and flips stacking/arrow direction. */
function applyCorner(wrap: HTMLElement, corner: BadgeCorner): void {
  const st = wrap.style;
  const left = corner === 'tl' || corner === 'bl';
  const top = corner === 'tl' || corner === 'tr';
  st.left = left ? '14px' : 'auto';
  st.right = left ? 'auto' : '14px';
  st.top = top ? '14px' : 'auto';
  st.bottom = top ? 'auto' : '14px';
  st.alignItems = left ? 'flex-start' : 'flex-end';
  // Bottom corners stack in reverse so the card hugs the corner and the
  // coachmark floats above it instead of running off-screen.
  st.flexDirection = top ? 'column' : 'column-reverse';
  wrap.classList.toggle('wrap--above', !top);
  wrap.classList.toggle('wrap--left', left);
}

/**
 * Turns the eligibility scanner off everywhere by persisting scanEnabled=false.
 * The profile-change listener in index.ts then removes the badge and the
 * side-panel toggle updates in lockstep — no direct setScannerEnabled needed.
 */
async function disableScannerEverywhere(): Promise<void> {
  const p = await getProfile();
  await saveProfile({ ...p, scanEnabled: false });
}

/** Which generators the badge shows (driven by the user's settings). */
export function setBadgeFeatures(opts: { coverLetter: boolean; resume: boolean }): void {
  showCoverLetterInBadge = opts.coverLetter;
  showResumeInBadge = opts.resume;
  // Re-render so the change is reflected immediately on a visible badge.
  if (enabled && !dismissed) renderFrom(getScanText());
}

/** Snapshot the current page's posting (company/role + text) for "save job". */
export function captureJob(): { company: string; role: string; text: string } {
  const { company, role } = getJobMeta();
  return { company, role, text: getScanText() };
}

/**
 * Like captureJob(), but waits for the posting to actually be readable first.
 * On SPA job boards (LinkedIn, Handshake) an in-app navigation mounts the detail
 * pane a beat before it paints — the containers exist in the DOM but their
 * `innerText` is still empty, so a capture fired the instant the user clicks
 * "Save" comes back blank (and a full page reload "fixes" it only because the
 * server-rendered text is painted immediately). Poll getScanText() briefly until
 * it returns a substantial description, then snapshot. Returns whatever we have
 * once the deadline passes, so a genuinely empty page still fails cleanly.
 */
export async function captureJobWhenReady(
  timeoutMs = 8000,
  minChars = 400,
): Promise<{ company: string; role: string; text: string }> {
  const deadline = Date.now() + timeoutMs;
  let text = getScanText();
  while (text.trim().length < minChars && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    text = getScanText();
  }
  const { company, role } = getJobMeta();
  return { company, role, text };
}

/** Forced scan (used on load / enable): renders regardless of the hash gate. */
export function scanSponsorship(): void {
  watchUrl = location.href;
  mutationDirty = false; // this is a full read; the interval needn't repeat it
  const text = getScanText();
  lastHash = hash(text);
  renderFrom(text);
}

/** Re-scans only when the viewed content (or URL) changed — used by the watcher. */
function tick(): void {
  if (!enabled) return;
  // Hidden tabs don't need a live badge; skip the work (without clearing the
  // dirty flag) and let the visibilitychange handler catch up on focus.
  if (document.hidden) return;
  const urlChanged = location.href !== watchUrl;
  // Cheap short-circuit for the interval fallback: no mutation since the last
  // full read and the URL is unchanged, so skip the expensive whole-page
  // innerText read entirely. Content changes always set mutationDirty first
  // (the MutationObserver path), so nothing is missed.
  if (!mutationDirty && !urlChanged) return;
  mutationDirty = false;
  const text = getScanText();
  const h = hash(text);
  if (h === lastHash && !urlChanged) return;
  if (urlChanged) {
    watchUrl = location.href;
    dismissed = false; // a newly opened posting gets a fresh badge
    pinnedAi = null; // a different posting starts back at the rules verdict
  }
  lastHash = h;
  renderFrom(text);
}

/** Company/role scraped from the posting, used to seed the generator forms. */
export interface JobMeta {
  company: string;
  role: string;
}

/**
 * Identity of what the badge is currently showing. The rebuild is skipped while
 * this is unchanged, so anything the badge *displays* has to be in here.
 *
 * That includes the posting's company/role: the generator forms are seeded once
 * at build time, so leaving them out let a split-view job switch keep the
 * previous posting's values whenever both postings analysed the same (very
 * common — two "no eligibility info" postings produce an identical verdict).
 */
export function badgeSignature(
  a: SponsorAnalysis,
  meta: JobMeta,
  showCoverLetter: boolean,
  showResume: boolean,
): string {
  return [
    a.verdict, a.source, a.reason ?? '',
    a.restrictions.join(','), a.cautions.join(','), a.positives.join(','),
    a.experience.required ?? '', a.experience.preferred ?? '',
    meta.company, meta.role,
    showCoverLetter, showResume,
  ].join('|');
}

function renderFrom(text: string): void {
  if (!enabled || dismissed) return;
  if (!document.body) return;
  // Prefer the AI verdict the user pinned for this posting, then any hash-keyed
  // AI cache hit, then the instant rules pass.
  const analysis =
    (pinnedAi && pinnedAiUrl === location.href ? pinnedAi : null) ??
    aiCache.get(hash(text)) ??
    analyze(text);
  // Read the meta once and reuse it for both the signature and the render, so a
  // mutation landing between two reads can't sign one posting while showing
  // another.
  const meta = getJobMeta();
  // Skip the teardown/rebuild when the badge already shows exactly this result —
  // mutation-happy pages (live counts, timestamps) otherwise cause a rebuild
  // every debounce even though nothing visible changed. The generator toggles
  // are part of the signature so a settings change still re-renders.
  const sig = badgeSignature(analysis, meta, showCoverLetterInBadge, showResumeInBadge);
  if (sig === renderedSig && document.getElementById(BANNER_ID)) return;
  removeBadge();
  document.body.appendChild(renderBadge(analysis, meta));
  renderedSig = sig;
}

// Words that signal a work-eligibility requirement. Used to pull the relevant
// sentences to the front of the AI's input when a posting is too long to send
// whole, so the key wording isn't lost in the first-N-chars cut.
const ELIGIBILITY_CUE =
  /\b(sponsor|visa|h-?1b|citizen|nationalit|clearance|ts\/sci|secret|public trust|itar|export[- ]control|work auth|authoriz|eligib|permanent resident|green card|lawful permanent|right to work)\b/i;

const AI_SCAN_BUDGET = 12_000;

/**
 * Prepares page text for the AI eligibility read: strips screening questions
 * (which describe the application form, not the employer's stance — the same
 * filter the rules pass uses) and, when the posting is longer than the model's
 * input budget, leads with the eligibility-relevant sentences (plus a sentence of
 * context each side) so the key wording is never sliced off, then backfills the
 * remaining budget with the rest in original order. Short postings go as-is.
 */
function focusEligibilityText(raw: string, budget = AI_SCAN_BUDGET): string {
  const cleaned = stripQuestions(raw);
  if (cleaned.length <= budget) return cleaned;

  const sentences = cleaned.split(/(?<=[.?!])\s+/);
  const keep = new Set<number>();
  sentences.forEach((s, i) => {
    if (ELIGIBILITY_CUE.test(s)) {
      keep.add(i - 1);
      keep.add(i);
      keep.add(i + 1);
    }
  });

  let out = sentences.filter((_, i) => keep.has(i)).join(' ').slice(0, budget);
  if (out.length < budget) {
    const rest = sentences.filter((_, i) => !keep.has(i)).join(' ');
    out += `\n\n${rest}`.slice(0, budget - out.length);
  }
  return out.slice(0, budget);
}

/** Sends the current posting to the AI and caches the structured verdict. */
async function runAiCheck(): Promise<SponsorAnalysis> {
  const raw = getScanText();
  // Send a cleaned, eligibility-focused slice so the model judges the real
  // requirements, not page noise. Cache by the RAW text hash so the key matches
  // what renderFrom looks up (it hashes getScanText()).
  const res = await sendToBackground<AIResult>({
    type: 'AI_ANALYZE_JOB',
    text: focusEligibilityText(raw),
  });
  if (res.error) throw new Error(res.error);
  const analysis = parseEligibilityJson(res.text);
  // The AI's experience read is unreliable on labelled / structured fields
  // ("Required Years of Experience: None required"). Fill any field it left blank
  // from the local extractor, which reads those fields deterministically.
  const local = extractExperience(normalizeText(raw));
  analysis.experience.required ??= local.required;
  analysis.experience.preferred ??= local.preferred;
  aiCache.set(hash(raw), analysis);
  return analysis;
}

/**
 * Scans now and keeps the badge current on SPA boards (LinkedIn, Handshake)
 * that swap the detail pane without a full reload — driven by content changes,
 * not just the URL.
 */
export function startSponsorshipWatch(): void {
  scanSponsorship();
  setTimeout(scanSponsorship, 800);
  setTimeout(scanSponsorship, 1800);

  if (document.body) {
    observer = new MutationObserver(() => {
      mutationDirty = true;
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(tick, 600);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  // Fallback for history changes that mutate little. tick() short-circuits to a
  // string compare unless a mutation or URL change happened, so this stays cheap.
  setInterval(tick, 1200);
  // tick() skips hidden tabs; catch up the moment the tab is focused so a job
  // page opened in the background still gets its badge.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tick();
  });
  // An iframe finishing to load is invisible to the top-document MutationObserver
  // (its content mutates inside its own document), but ATSes like iCIMS deliver
  // the posting exactly that way — the scan reads it via sameOriginFrameText(),
  // so a late-loading frame must count as a content change or the badge sticks
  // on the pre-frame verdict. `load` doesn't bubble, but capture-phase listeners
  // on window still see subresource loads.
  window.addEventListener(
    'load',
    (e) => {
      if (e.target instanceof HTMLIFrameElement) {
        mutationDirty = true;
        window.clearTimeout(debounceTimer);
        debounceTimer = window.setTimeout(tick, 600);
      }
    },
    true,
  );
}

// --- Badge rendering ---

const STYLES: Record<Verdict, { color: string; word: string; title: string }> = {
  yes: { color: '#16a34a', word: 'YES', title: 'Sponsorship looks available' },
  no: { color: '#dc2626', word: 'NO', title: 'Eligibility restrictions found' },
  caution: { color: '#d97706', word: 'MAYBE', title: 'Eligibility preference noted' },
  unknown: { color: '#6b7280', word: '—', title: 'No eligibility info detected' },
};

let removeBadgeKeydownListener: (() => void) | null = null;

/** Removes every instance of the badge host (guards against duplicates). */
function removeBadge(): void {
  renderedSig = ''; // whatever renders next is a fresh mount, never skipped
  removeBadgeKeydownListener?.();
  removeBadgeKeydownListener = null;
  document.querySelectorAll(`#${BANNER_ID}`).forEach((n) => n.remove());
}

/** Whether a badge-scoped keyboard event should dismiss the badge. */
export function isBadgeDismissKey(event: Pick<KeyboardEvent, 'key'>): boolean {
  return event.key === 'Escape';
}

/** Whether a document keyboard event should dismiss the currently mounted badge. */
export function shouldDismissBadge(
  event: Pick<KeyboardEvent, 'key'>,
  badgeMounted: boolean,
): boolean {
  return badgeMounted && isBadgeDismissKey(event);
}

/** Registers document-level Escape dismissal and returns its teardown callback. */
export function addBadgeDismissListener(
  target: EventTarget,
  badgeMounted: () => boolean,
  dismissBadge: () => void,
): () => void {
  const onKeydown = (event: Event): void => {
    if (shouldDismissBadge(event as KeyboardEvent, badgeMounted())) dismissBadge();
  };
  target.addEventListener('keydown', onKeydown);
  return () => target.removeEventListener('keydown', onKeydown);
}

function el(tag: string, cls: string, text: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  node.textContent = text;
  return node;
}

/**
 * Best-effort company + role for the open posting (works on any site — the
 * inputs are editable, so a miss just means the user types it). Role comes from
 * the main heading; company is read from the employer logo's alt text or an
 * employer link.
 */
function getJobMeta(): { company: string; role: string } {
  const clean = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, 120);

  // LinkedIn renders several headings across the page (left job-list, feedback
  // widgets, "how you compare" upsell), so a generic "first h1" grabs the wrong
  // one — on collections/split views it picks the left column's page heading
  // ("Top job picks for you"). Scope to the selected job's detail pane and read
  // its stable top-card containers instead.
  if (hostMatches(location.hostname, 'linkedin.com')) {
    const pick = (sels: string[]): string => {
      for (const sel of sels) {
        const t = clean(document.querySelector<HTMLElement>(sel)?.textContent || '');
        if (t) return t;
      }
      return '';
    };
    // Most reliable + fully layout-independent: LinkedIn sets document.title to
    // "Role | Company | LinkedIn" (sometimes "(N) Role | Company | LinkedIn") on
    // every job surface, hashed-class layouts included.
    let role = '';
    let company = '';
    const bits = document.title
      .replace(/^\(\d+\)\s*/, '')
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    if (bits.length >= 3 && /linkedin/i.test(bits[bits.length - 1])) {
      role = clean(bits[0]);
      company = clean(bits[1]);
    }
    // DOM fallback (older top-card markup) if the title wasn't a job title.
    if (!role) role = pick(['[class*="top-card__job-title" i]', '[class*="topcard__title" i]']);
    if (!company) {
      company = pick([
        '[class*="top-card__company-name" i] a',
        '[class*="top-card__company-name" i]',
        '[class*="topcard__org-name" i]',
      ]);
    }
    // Never fall through to the generic page reader on LinkedIn — it grabs nav
    // headings (e.g. "0 notifications"). Empty meta is fine; the save is gated on
    // getScanText() finding real detail text anyway.
    return { company, role };
  }

  // Role: the job-title heading in the detail pane.
  const titleEl =
    document.querySelector<HTMLElement>('main h1, [role="main"] h1') ||
    document.querySelector<HTMLElement>('main h2, [role="main"] h2') ||
    document.querySelector<HTMLElement>('h1');
  const role = clean(titleEl?.textContent || '');

  // Company: class names are often build-hashed, so key off stable semantics
  // instead — the employer logo's alt text ("<Company> logo") or an employer
  // link (Handshake exposes /e/ links). Walk UP from the title so we read the
  // open posting's employer, not a logo from a list item elsewhere on the page.
  let company = '';
  for (let node: HTMLElement | null = titleEl; node && !company; node = node.parentElement) {
    // Employer link: <a href="/e/<id>" aria-label="<Company>">. The OUTER link
    // always carries the aria-label even when the inner duplicate is blank (the
    // case that previously failed), so prefer that.
    const aria = node
      .querySelector<HTMLElement>('a[href*="/e/"][aria-label]')
      ?.getAttribute('aria-label')
      ?.trim();
    if (aria) {
      company = clean(aria.replace(/\s*logo\s*$/i, ''));
      break;
    }
    // Fallbacks: the logo's alt ("<Company> logo"), then any employer link text.
    const logo = node.querySelector<HTMLImageElement>('img[alt$="logo" i]');
    if (logo?.alt) {
      company = clean(logo.alt.replace(/\s*logo\s*$/i, ''));
      break;
    }
    const link = node.querySelector<HTMLElement>('a[href*="/e/"]');
    if (link?.textContent?.trim()) {
      company = clean(link.textContent);
      break;
    }
    if (node === document.body) break;
  }
  return { company, role };
}

/**
 * Generator expander (cover letter or tailored resume): an editable company/role
 * pair pre-filled from the posting, plus a button that asks the AI for the
 * document and downloads it as a PDF.
 */
function buildGeneratorSection(cfg: {
  toggleLabel: string;
  meta: JobMeta;
  request: (company: string, role: string, jobText: string) => Promise<AIResult>;
  download: (text: string, company: string, role: string) => void;
}): HTMLElement {
  const meta = cfg.meta;
  const wrap = document.createElement('div');
  wrap.className = 'cl';

  const toggle = document.createElement('button');
  toggle.className = 'clbtn';
  toggle.textContent = cfg.toggleLabel;

  const form = document.createElement('div');
  form.className = 'clform hidden';

  const company = document.createElement('input');
  company.placeholder = 'Company';
  company.value = meta.company;
  const role = document.createElement('input');
  role.placeholder = 'Role';
  role.value = meta.role;

  const gen = document.createElement('button');
  gen.className = 'clbtn';
  gen.textContent = 'Generate & download PDF';

  const status = el('div', 'clstatus', '');

  toggle.addEventListener('click', () => form.classList.toggle('hidden'));

  gen.addEventListener('click', async () => {
    gen.disabled = true;
    const orig = gen.textContent;
    gen.textContent = 'Generating…';
    status.textContent = '';
    try {
      const res = await cfg.request(company.value.trim(), role.value.trim(), getScanText());
      if (res.error) throw new Error(res.error);
      cfg.download(res.text, company.value.trim(), role.value.trim());
      status.textContent = '✓ Downloaded PDF';
    } catch (e) {
      status.textContent = '⚠ ' + String((e as Error).message).slice(0, 60);
    } finally {
      gen.disabled = false;
      gen.textContent = orig;
    }
  });

  form.append(company, role, gen, status);
  wrap.append(toggle, form);
  return wrap;
}

function buildCoverLetterSection(meta: JobMeta): HTMLElement {
  return buildGeneratorSection({
    toggleLabel: '📄 Cover letter',
    meta,
    request: (company, role, jobText) =>
      sendToBackground<AIResult>({ type: 'AI_GENERATE_COVER_LETTER', company, role, jobText }),
    download: downloadLetter,
  });
}

function buildResumeSection(meta: JobMeta): HTMLElement {
  return buildGeneratorSection({
    toggleLabel: '🧾 Tailored resume',
    meta,
    request: (company, role, jobText) =>
      sendToBackground<AIResult>({ type: 'AI_GENERATE_RESUME', company, role, jobText }),
    download: downloadResume,
  });
}

/**
 * Renders the badge inside a Shadow DOM so the host page's CSS can't bleed in
 * (which otherwise garbles/duplicates the text). Returns the host element.
 */
function renderBadge(a: SponsorAnalysis, meta: JobMeta): HTMLElement {
  const s = STYLES[a.verdict];

  const host = document.createElement('div');
  host.id = BANNER_ID;
  const root = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .wrap {
      position: fixed; top: 14px; right: 14px; z-index: 2147483646;
      display: flex; flex-direction: column; align-items: flex-end; gap: 10px;
      max-height: calc(100vh - 28px);
      font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    }
    .card {
      width: 230px; box-sizing: border-box; padding: 12px 14px;
      background: #fff; color: #0f172a; border: 1px solid #e2e8f0;
      border-left: 6px solid ${s.color}; border-radius: 10px;
      box-shadow: 0 6px 24px rgba(0,0,0,.16);
      /* .wrap bounds the whole column to the viewport; the card is the flex
         item that shrinks and scrolls internally so a tall card can't push
         the coachmark (or itself) off-screen. min-height: 0 overrides the
         flex default that would otherwise keep it at its full content height. */
      min-height: 0; overflow-y: auto;
    }
    .head { display: flex; align-items: center; gap: 8px;
            cursor: grab; touch-action: none; }
    .head:focus-visible { outline: 2px solid #44506b; outline-offset: 2px; border-radius: 4px; }
    .word { font-size: 20px; font-weight: 800; color: ${s.color}; letter-spacing: .5px; }
    .title { font-weight: 700; flex: 1; }
    .x { border: none; background: transparent; cursor: pointer; font-size: 18px;
         line-height: 1; color: #94a3b8; padding: 0 2px; }
    ul { margin: 8px 0 0; padding: 0 0 0 16px; color: #475569; }
    li { margin: 0; }
    .note { margin-top: 6px; color: #64748b; }
    .reason { margin-top: 8px; color: #475569; font-style: italic; }
    .exp { margin-top: 8px; font-weight: 600; color: #334155; }
    .row { margin-top: 10px; display: flex; align-items: center; gap: 8px; }
    .ai { border: none; background: #44506b; color: #fff; border-radius: 6px;
          padding: 5px 10px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .ai:disabled { opacity: .7; cursor: default; }
    .aitag { font-size: 11px; color: #44506b; font-weight: 700; }
    .tag { margin-top: 8px; font-size: 11px; color: #94a3b8;
           display: flex; justify-content: space-between; align-items: center; gap: 8px;
           border-top: 1px solid #eef2f7; padding-top: 7px; }
    .off { appearance: none; border: 0; background: transparent; padding: 0; font: inherit;
           color: #44506b; font-weight: 600; cursor: pointer; white-space: nowrap; }
    .off:hover { text-decoration: underline; }
    .off:focus-visible { outline: 2px solid #44506b; outline-offset: 2px; border-radius: 2px; }
    .coach { position: relative; width: 252px; box-sizing: border-box;
             background: #44506b; color: #fff; border-radius: 12px; padding: 14px 15px;
             box-shadow: 0 10px 30px rgba(15,23,42,.3); }
    .coach::before { content: ''; position: absolute; top: -6px; right: 34px;
                     width: 14px; height: 14px; background: #44506b; transform: rotate(45deg); }
    /* Corner variants: bottom corners stack the coachmark ABOVE the card (arrow
       points down at it); left corners anchor the arrow on the left side. */
    .wrap--above .coach::before { top: auto; bottom: -6px; }
    .wrap--left .coach::before { right: auto; left: 34px; }
    .coach-t { font-weight: 700; font-size: 14px; margin-bottom: 5px; }
    .coach-d { font-size: 12px; line-height: 1.5; color: #dbe1ec; }
    .coach-row { display: flex; gap: 8px; margin-top: 12px; }
    .coach-off { flex: 1; background: #fff; color: #44506b; border: none; border-radius: 7px;
                 padding: 8px 10px; font-size: 12px; font-weight: 700; cursor: pointer; }
    .coach-ok { background: rgba(255,255,255,.16); color: #fff; border: none; border-radius: 7px;
                padding: 8px 14px; font-size: 12px; font-weight: 700; cursor: pointer; }
    .cl { margin-top: 10px; border-top: 1px solid #eef2f7; padding-top: 8px; }
    .clbtn { border: none; background: #0f172a; color: #fff; border-radius: 6px;
             padding: 5px 10px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .clbtn:disabled { opacity: .7; cursor: default; }
    .clform { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
    .clform input { width: 100%; box-sizing: border-box; padding: 5px 7px; font-size: 12px;
                    border: 1px solid #cbd5e1; border-radius: 5px; font-family: inherit; color: #0f172a; }
    .clstatus { font-size: 11px; color: #64748b; }
    .hidden { display: none; }
  `;
  root.appendChild(style);

  const card = document.createElement('div');
  card.className = 'card';

  const head = document.createElement('div');
  head.className = 'head';
  const close = document.createElement('button');
  close.className = 'x';
  close.textContent = '×';
  close.title = 'Dismiss';
  close.setAttribute('aria-label', 'Dismiss eligibility badge');
  const dismissBadge = (): void => {
    dismissed = true;
    removeBadge();
  };
  close.addEventListener('click', dismissBadge);
  // Listen on the document so Escape works without moving focus into the badge.
  // Do not consume the event: the host page must retain its own Escape handling.
  removeBadgeKeydownListener = addBadgeDismissListener(
    document,
    () => document.contains(host),
    dismissBadge,
  );
  head.append(el('span', 'word', s.word), el('span', 'title', s.title), close);
  card.appendChild(head);

  const signals = a.restrictions.length
    ? a.restrictions
    : a.cautions.length
      ? a.cautions
      : a.positives;
  if (signals.length) {
    const list = document.createElement('ul');
    for (const sig of signals) list.appendChild(el('li', '', sig));
    card.appendChild(list);
  } else {
    card.appendChild(
      el('div', 'note', 'No sponsorship or citizenship requirements mentioned. Verify manually.'),
    );
  }

  if (a.reason) card.appendChild(el('div', 'reason', a.reason));

  const exp = a.experience;
  const expParts: string[] = [];
  if (exp.required) expParts.push(`${exp.required} required`);
  if (exp.preferred) expParts.push(`${exp.preferred} preferred`);
  card.appendChild(
    el('div', 'exp', `Experience: ${expParts.length ? expParts.join(' · ') : 'Not Found'}`),
  );

  // Rules result → offer an AI re-read; AI result → just tag it.
  const row = document.createElement('div');
  row.className = 'row';
  if (a.source === 'rules') {
    const ai = document.createElement('button');
    ai.className = 'ai';
    ai.textContent = 'AI check';
    ai.title = 'Re-read this posting with AI (more accurate on odd wording)';
    ai.addEventListener('click', async () => {
      ai.textContent = 'Analyzing…';
      ai.disabled = true;
      try {
        const analysis = await runAiCheck();
        // Pin it to this posting so the watcher's re-renders don't revert to rules.
        pinnedAi = analysis;
        pinnedAiUrl = location.href;
        removeBadge();
        // Same posting the badge was built for, so reuse its meta rather than
        // re-reading the DOM and risking a different posting's company/role.
        if (document.body && enabled && !dismissed) {
          document.body.appendChild(renderBadge(analysis, meta));
        }
      } catch (e) {
        ai.textContent = `⚠ ${String((e as Error).message).slice(0, 32)}`;
        ai.disabled = false;
        setTimeout(() => {
          ai.textContent = 'AI check';
        }, 4000);
      }
    });
    row.appendChild(ai);
  } else {
    row.appendChild(el('span', 'aitag', '✓ AI reading'));
  }
  card.appendChild(row);

  // Offer one-click tailor-and-download for a cover letter + resume right here,
  // below the AI check, on any posting. Each generator is shown unless the user
  // turned it off in settings.
  if (showCoverLetterInBadge) card.appendChild(buildCoverLetterSection(meta));
  if (showResumeInBadge) card.appendChild(buildResumeSection(meta));

  // Footer: brand tag + an always-available "turn the scanner off everywhere"
  // link, so the global off-switch is reachable from the badge itself (not only
  // the side-panel toggle a new user may never open).
  const foot = document.createElement('div');
  foot.className = 'tag';
  foot.appendChild(el('span', '', 'Little AI Helper'));
  const off = el('button', 'off', '⚙ Turn off on all sites');
  off.setAttribute('type', 'button');
  off.title = 'Stop showing this badge on every page';
  off.setAttribute('aria-label', 'Turn off the eligibility badge on all sites');
  off.addEventListener('click', () => void disableScannerEverywhere());
  foot.appendChild(off);
  card.appendChild(foot);

  // Stack the card and (optionally) the coachmark in a fixed column anchored to
  // the user's chosen corner (default top-right).
  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  wrap.appendChild(card);
  applyCorner(wrap, badgeCorner);

  // --- Move the badge: drag the header to any corner (or use arrow keys). ---
  head.title = 'Drag to move this badge to another corner';
  head.setAttribute('tabindex', '0');
  head.setAttribute('role', 'button');
  head.setAttribute('aria-label', 'Move badge: drag it, or press an arrow key');

  let dragFrom: { x: number; y: number; left: number; top: number; w: number; h: number } | null =
    null;
  let dragging = false;
  head.addEventListener('pointerdown', (e) => {
    // The × close (and any other control) keeps its normal click behavior.
    if ((e.target as HTMLElement).closest('button, a')) return;
    const r = wrap.getBoundingClientRect();
    dragFrom = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, w: r.width, h: r.height };
    // Capture so moves keep streaming to us even over iframes / out of the card.
    // A failed capture (stale pointer id) just means a less-sticky drag.
    try {
      head.setPointerCapture(e.pointerId);
    } catch {
      // proceed uncaptured
    }
  });
  head.addEventListener('pointermove', (e) => {
    if (!dragFrom) return;
    const dx = e.clientX - dragFrom.x;
    const dy = e.clientY - dragFrom.y;
    // A real drag needs ~5px of travel; below that it's just a sloppy click.
    if (!dragging && Math.hypot(dx, dy) < 5) return;
    dragging = true;
    const st = wrap.style;
    st.right = 'auto';
    st.bottom = 'auto';
    // Clamp to the viewport so the badge can never be dragged fully off-screen
    // (and thus stranded, since its handle would go with it).
    st.left = `${clampAxis(dragFrom.left + dx, dragFrom.w, innerWidth)}px`;
    st.top = `${clampAxis(dragFrom.top + dy, dragFrom.h, innerHeight)}px`;
    st.userSelect = 'none';
    head.style.cursor = 'grabbing';
  });
  const endDrag = (): void => {
    if (dragging) {
      const r = wrap.getBoundingClientRect();
      saveCorner(nearestCorner(r.left + r.width / 2, r.top + r.height / 2, innerWidth, innerHeight));
      applyCorner(wrap, badgeCorner);
    }
    wrap.style.userSelect = '';
    head.style.cursor = '';
    dragFrom = null;
    dragging = false;
  };
  head.addEventListener('pointerup', endDrag);
  head.addEventListener('pointercancel', endDrag);
  // Safety net: if the pointer is released outside the window, pointerup /
  // pointercancel can be dropped — losing capture still fires, so snap here too.
  head.addEventListener('lostpointercapture', endDrag);

  head.addEventListener('keydown', (e) => {
    // Only navigate when the header handle itself has focus — an arrow key
    // pressed while a child control (the × close) is focused bubbles here and
    // must not move the badge.
    if (e.target !== head) return;
    const c = badgeCorner;
    const next: BadgeCorner | null =
      e.key === 'ArrowLeft' ? (c === 'tr' ? 'tl' : c === 'br' ? 'bl' : null)
      : e.key === 'ArrowRight' ? (c === 'tl' ? 'tr' : c === 'bl' ? 'br' : null)
      : e.key === 'ArrowUp' ? (c === 'bl' ? 'tl' : c === 'br' ? 'tr' : null)
      : e.key === 'ArrowDown' ? (c === 'tl' ? 'bl' : c === 'tr' ? 'br' : null)
      : null;
    if (!next) return;
    e.preventDefault(); // moving the badge, not scrolling the page
    saveCorner(next);
    applyCorner(wrap, next);
  });

  // One-time coachmark: a separate bubble below the badge the first time it ever
  // appears, explaining what it is with a one-click global off. Removed (and never
  // shown again) on dismissal.
  if (!introSeen) {
    const coach = document.createElement('div');
    coach.className = 'coach';
    coach.appendChild(el('div', 'coach-t', 'First time seeing this?'));
    coach.appendChild(
      el(
        'div',
        'coach-d',
        'I flag visa / citizenship / clearance requirements on pages that look like job ' +
          "postings — so you don't waste time on a role you can't take.",
      ),
    );
    const row = document.createElement('div');
    row.className = 'coach-row';
    const turnOff = el('button', 'coach-off', 'Turn off everywhere');
    turnOff.addEventListener('click', () => {
      markIntroSeen();
      void disableScannerEverywhere();
    });
    const gotIt = el('button', 'coach-ok', 'Got it');
    gotIt.addEventListener('click', () => {
      markIntroSeen();
      coach.remove();
    });
    row.append(turnOff, gotIt);
    coach.appendChild(row);
    wrap.appendChild(coach);
  }

  root.appendChild(wrap);
  return host;
}
