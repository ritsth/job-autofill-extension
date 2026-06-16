// Scans the job page for work-eligibility signals (visa sponsorship, U.S.
// citizenship, security clearance, export control) and shows a bold YES / NO /
// amber-MAYBE badge so you can triage a posting at a glance. Works on single-page
// boards (LinkedIn, Handshake) by re-checking the selected posting as you switch.
// The instant result is rules-based; an on-demand "AI check" reads odd wording.

import { sendToBackground } from '../lib/messages';
import type { AIResult } from '../lib/messages';
import { parseEligibilityJson } from '../lib/jobEligibility';
import { downloadLetter } from '../lib/coverLetter';

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
      return true;
    })
    .join(' ');
}

/** Pulls required / preferred years-of-experience figures from the posting. */
function extractExperience(text: string): { required: string | null; preferred: string | null } {
  const lower = text.toLowerCase();
  const YR = '(\\d{1,2})\\s*\\+?\\s*(?:to|–|—|-)?\\s*(\\d{1,2})?\\+?\\s*years?';
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

  const preferred = findNear('preferred|a plus|nice to have|ideally|desirable');
  let required = findNear('minimum|min\\.?|at least|required|must have|or more');
  // Fall back to any "<n> years of experience" mention as the baseline requirement.
  if (!required) {
    const generic = lower.match(new RegExp(`${YR}\\s+(?:of\\s+)?(?:experience|exp\\b|relevant|professional|industry)`));
    if (generic) required = fmt(generic);
  }
  return { required, preferred };
}

// --- Reading the right text ---

// Per-host containers for the *selected* job's detail pane, so split list+detail
// boards check the posting you're viewing rather than the whole page.
const DETAIL_SELECTORS: Record<string, string[]> = {
  'linkedin.com': [
    '#job-details',
    '.jobs-description__content',
    '.jobs-search__job-details',
    '.job-view-layout',
  ],
  'joinhandshake.com': ['[data-hook="details-container"]', 'main', '[role="main"]'],
};

const MAX_CHARS = 200_000;

// Boards that collapse the job description behind a "More"/"Show more" toggle
// which only injects the full text into the DOM once expanded — so eligibility
// wording stays hidden until then. We auto-click it (scoped to the detail pane).
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
  if (!EXPAND_HOSTS.some((d) => location.hostname.endsWith(d))) return;
  for (const el of root.querySelectorAll<HTMLElement>('button, a, [role="button"]')) {
    if (el.getAttribute('data-jaf-expanded')) continue;
    if (!isExpandLabel(el.textContent || '')) continue;
    el.setAttribute('data-jaf-expanded', '1');
    el.click(); // DOM updates async; the watcher re-scans the full text after.
  }
}

export function getScanText(): string {
  const host = location.hostname;
  const key = Object.keys(DETAIL_SELECTORS).find((d) => host.endsWith(d));
  if (key) {
    autoExpandDescription(document); // reveal collapsed descriptions before reading
    for (const sel of DETAIL_SELECTORS[key]) {
      const el = document.querySelector<HTMLElement>(sel);
      const t = el?.innerText?.trim();
      if (t && t.length > 80) return t.slice(0, MAX_CHARS);
    }
  }
  // Badge text lives in a Shadow DOM, so innerText excludes it (no feedback loop).
  return (document.body?.innerText || '').slice(0, MAX_CHARS);
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
// AI results cached per posting (by scanned-text hash) so revisiting a job — or
// a re-render from the watcher — reuses the AI verdict without another call.
const aiCache = new Map<number, SponsorAnalysis>();

/** Turns the scanner on/off globally (driven by the user's setting). */
export function setScannerEnabled(value: boolean): void {
  enabled = value;
  if (!enabled) removeBadge();
  else scanSponsorship();
}

/** Forced scan (used on load / enable): renders regardless of the hash gate. */
export function scanSponsorship(): void {
  watchUrl = location.href;
  const text = getScanText();
  lastHash = hash(text);
  renderFrom(text);
}

/** Re-scans only when the viewed content (or URL) changed — used by the watcher. */
function tick(): void {
  if (!enabled) return;
  const text = getScanText();
  const h = hash(text);
  const urlChanged = location.href !== watchUrl;
  if (h === lastHash && !urlChanged) return;
  if (urlChanged) {
    watchUrl = location.href;
    dismissed = false; // a newly opened posting gets a fresh badge
  }
  lastHash = h;
  renderFrom(text);
}

function renderFrom(text: string): void {
  if (!enabled || dismissed) return;
  removeBadge();
  if (!document.body) return;
  const cached = aiCache.get(hash(text));
  document.body.appendChild(renderBadge(cached ?? analyze(text)));
}

/** Sends the current posting to the AI and caches the structured verdict. */
async function runAiCheck(): Promise<SponsorAnalysis> {
  const text = getScanText();
  const res = await sendToBackground<AIResult>({ type: 'AI_ANALYZE_JOB', text });
  if (res.error) throw new Error(res.error);
  const analysis = parseEligibilityJson(res.text);
  aiCache.set(hash(text), analysis);
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
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(tick, 600);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  // Fallback for history changes that mutate little.
  setInterval(tick, 1200);
}

// --- Badge rendering ---

const STYLES: Record<Verdict, { color: string; word: string; title: string }> = {
  yes: { color: '#16a34a', word: 'YES', title: 'Sponsorship looks available' },
  no: { color: '#dc2626', word: 'NO', title: 'Eligibility restrictions found' },
  caution: { color: '#d97706', word: 'MAYBE', title: 'Eligibility preference noted' },
  unknown: { color: '#6b7280', word: '—', title: 'No eligibility info detected' },
};

/** Removes every instance of the badge host (guards against duplicates). */
function removeBadge(): void {
  document.querySelectorAll(`#${BANNER_ID}`).forEach((n) => n.remove());
}

function el(tag: string, cls: string, text: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  node.textContent = text;
  return node;
}

const isHandshake = (): boolean => location.hostname.endsWith('joinhandshake.com');

/** Best-effort company + role for the open Handshake posting (inputs are editable). */
function getHandshakeJobMeta(): { company: string; role: string } {
  const clean = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, 120);

  // Role: the job-title heading in the detail pane.
  const titleEl =
    document.querySelector<HTMLElement>('main h1, [role="main"] h1') ||
    document.querySelector<HTMLElement>('main h2, [role="main"] h2') ||
    document.querySelector<HTMLElement>('h1');
  const role = clean(titleEl?.textContent || '');

  // Company: Handshake's class names are styled-component hashes that change every
  // build, so key off stable semantics instead — the employer logo's alt text
  // ("<Company> logo") or an employer link. Walk UP from the title so we read the
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
 * Handshake-only: a "Cover letter" expander that fills the user's template
 * (company/role/date swapped, first paragraph tailored to the posting) and
 * downloads it as a PDF — Handshake requires one on nearly every application.
 */
function buildCoverLetterSection(): HTMLElement {
  const meta = getHandshakeJobMeta();
  const wrap = document.createElement('div');
  wrap.className = 'cl';

  const toggle = document.createElement('button');
  toggle.className = 'clbtn';
  toggle.textContent = '📄 Cover letter';

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
      const res = await sendToBackground<AIResult>({
        type: 'AI_GENERATE_COVER_LETTER',
        company: company.value.trim(),
        role: role.value.trim(),
        jobText: getScanText(),
      });
      if (res.error) throw new Error(res.error);
      downloadLetter(res.text, company.value.trim(), role.value.trim());
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

/**
 * Renders the badge inside a Shadow DOM so the host page's CSS can't bleed in
 * (which otherwise garbles/duplicates the text). Returns the host element.
 */
function renderBadge(a: SponsorAnalysis): HTMLElement {
  const s = STYLES[a.verdict];

  const host = document.createElement('div');
  host.id = BANNER_ID;
  const root = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .card {
      position: fixed; top: 14px; right: 14px; z-index: 2147483646;
      width: 230px; box-sizing: border-box; padding: 12px 14px;
      background: #fff; color: #0f172a; border: 1px solid #e2e8f0;
      border-left: 6px solid ${s.color}; border-radius: 10px;
      box-shadow: 0 6px 24px rgba(0,0,0,.16);
      font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    }
    .head { display: flex; align-items: center; gap: 8px; }
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
    .ai { border: none; background: #4f46e5; color: #fff; border-radius: 6px;
          padding: 5px 10px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .ai:disabled { opacity: .7; cursor: default; }
    .aitag { font-size: 11px; color: #4f46e5; font-weight: 700; }
    .tag { margin-top: 8px; font-size: 11px; color: #94a3b8; }
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
  close.addEventListener('click', () => {
    dismissed = true;
    removeBadge();
  });
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
    el('div', 'exp', `Experience: ${expParts.length ? expParts.join(' · ') : 'Not mentioned'}`),
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
        removeBadge();
        if (document.body && enabled && !dismissed) document.body.appendChild(renderBadge(analysis));
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

  // Handshake requires a cover letter on nearly every application — offer a
  // one-click tailor-and-download right here, below the AI check.
  if (isHandshake()) card.appendChild(buildCoverLetterSection());

  card.appendChild(el('div', 'tag', 'Job Autofill · auto-detected, double-check the posting'));

  root.appendChild(card);
  return host;
}
