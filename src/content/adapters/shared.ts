// Generic, site-agnostic field handling shared by all adapters: reading a
// field's human label, matching it to a profile value, and filling it in a way
// that React-based forms (Greenhouse, Lever) actually register.

import type { Profile } from '../../lib/profile';

export type FillableField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

// Zero-width characters that JS `\s` does NOT match: ZWSP, ZWNJ, ZWJ, word
// joiner, and the BOM / zero-width no-break space. They turn up in scraped
// label markup (line-break hints inside long identifiers, copy-pasted text).
const ZERO_WIDTH = '\\u200b-\\u200d\\u2060\\ufeff';
const SEPARATORS = new RegExp(`[\\s${ZERO_WIDTH}]+`, 'g');

/**
 * Canonicalises label text for rule matching: lowercase, all runs of separators
 * collapsed to one space, trimmed.
 *
 * Zero-width characters collapse to a space rather than being deleted, even
 * though they render as no gap at all. Deleting them would weld the surrounding
 * words together and destroy the `\b` boundary that most rules in `RULES` rely
 * on — "Email<ZWSP>Address" would become "emailaddress", which `/\be-?mail\b/`
 * no longer matches. Collapsing keeps every rule matching, and mirrors how `\s`
 * already treats the non-breaking space.
 */
export function normalize(s: string): string {
  return s.toLowerCase().replace(SEPARATORS, ' ').trim();
}

/**
 * Turns camelCase / snake_case / kebab identifiers into space-separated words,
 * so id-style attributes (e.g. Workday's data-automation-id="legalNameSection_
 * firstName") read like a label and match the standard rules.
 */
function humanizeId(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The label sources a human actually reads. Kept separate from the attribute
 * noise below because two callers want different things: rule matching wants
 * every scrap of text it can get, while the AI-answer feature wants the question
 * as written — not the question with a UUID glued to the end.
 */
function visibleLabelParts(el: FillableField): string[] {
  const parts: string[] = [];

  if (el.id) {
    const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (lbl?.textContent) parts.push(lbl.textContent);
  }
  const wrapping = el.closest('label');
  if (wrapping?.textContent) parts.push(wrapping.textContent);

  const labelledby = el.getAttribute('aria-labelledby');
  if (labelledby) {
    for (const id of labelledby.split(/\s+/)) {
      const ref = document.getElementById(id);
      if (ref?.textContent) parts.push(ref.textContent);
    }
  }

  const aria = el.getAttribute('aria-label');
  if (aria) parts.push(aria);

  return parts;
}

/**
 * The question as the applicant sees it, with none of the id/name/placeholder
 * text getLabelText folds in. That noise is fine for regex matching but ruins
 * anything that reads the label as prose: on Ashby the field id is a UUID, so
 * getLabelText yields "…do you most admire? b2a0a4af-ab88-43f6-…".
 */
export function getQuestionText(el: FillableField): string {
  return normalize(visibleLabelParts(el).join(' '));
}

/** Best-effort human label for a form control. */
export function getLabelText(el: FillableField): string {
  const parts = visibleLabelParts(el);

  parts.push(
    el.getAttribute('placeholder') ?? '',
    el.getAttribute('name') ?? '',
    el.id ?? '',
    // Workday and similar component frameworks identify fields here, not via
    // <label>. Humanize so "legalNameSection_firstName" → "first name" matches.
    humanizeId(el.getAttribute('data-automation-id') ?? ''),
    humanizeId(el.getAttribute('data-fkit-id') ?? ''),
  );

  return normalize(parts.join(' '));
}

/**
 * Sets an input/textarea value via the native prototype setter so React's
 * onChange fires, then dispatches input + change events.
 */
export function fillInput(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** One `<option>` reduced to the two strings the matcher reads. */
export interface OptionText {
  text: string;
  value: string;
}

/**
 * True when `needle` occurs inside `haystack` as a self-contained phrase.
 *
 * Plain `includes` is what let a dropdown be answered with the OPPOSITE of the
 * profile value: "no" is a substring of "not at this time", and "us citizen" is
 * a substring of "non-us citizen". A bare `\b` boundary doesn't help with the
 * second one — the hyphen in "non-us" IS a word boundary, so `\bus citizen\b`
 * still matches the negated option.
 *
 * So a neighbouring character disqualifies a match when it's alphanumeric OR a
 * hyphen: alphanumeric catches "no" inside "not", and the hyphen catches a
 * negating prefix. Other punctuation stays allowed, which is what keeps the
 * common elaborated option working — "Yes, I require sponsorship" is still
 * matched by "Yes", because the comma is a legitimate phrase end.
 */
function containsPhrase(haystack: string, needle: string): boolean {
  // An empty needle is never a match. This is what keeps a blank placeholder row
  // ("<option value=''></option>") from being selected: the old loop tested
  // `target.includes(text)`, which is unconditionally true for empty option
  // text, so a select opening with one had its placeholder chosen outright and
  // the field still counted as filled.
  if (!needle) return false;
  const blocks = (c: string) => c !== '' && /[a-z0-9-]/.test(c);
  for (let from = 0; from <= haystack.length; ) {
    const i = haystack.indexOf(needle, from);
    if (i === -1) return false;
    const before = i === 0 ? '' : haystack[i - 1];
    const after = haystack[i + needle.length] ?? '';
    if (!blocks(before) && !blocks(after)) return true;
    // Overlapping occurrences matter: "no" appears twice in "no-nonsense".
    from = i + 1;
  }
  return false;
}

/**
 * Index of the option best matching `rawTarget`, or -1 when none matches
 * confidently.
 *
 * Exact matches are resolved across EVERY option before any fuzzy match is
 * considered. The old single pass took the first option satisfying either test
 * in DOM order, so an exact "No" sitting below "Not at this time" never won —
 * correctness depended purely on the order the site happened to list options in.
 *
 * Returning -1 rather than guessing is deliberate: these dropdowns include work
 * authorization and sponsorship, where a wrong answer is a false statement on an
 * application. An unanswered select is visible to the applicant; a confidently
 * wrong one is not.
 *
 * Split out of fillSelect so it can be unit-tested — the test env is `node` with
 * no DOM, so anything touching real <option> elements is untestable.
 */
export function chooseOption(rawTarget: string, options: readonly OptionText[]): number {
  const target = normalize(rawTarget);
  if (!target) return -1;

  const norm = options.map((o) => ({ text: normalize(o.text), value: normalize(o.value) }));

  for (let i = 0; i < norm.length; i++) {
    if (norm[i].text === target || norm[i].value === target) return i;
  }

  for (let i = 0; i < norm.length; i++) {
    const { text } = norm[i];
    if (containsPhrase(text, target) || containsPhrase(target, text)) return i;
  }

  return -1;
}

/** Selects the option whose text/value best matches `value`. */
export function fillSelect(el: HTMLSelectElement, value: string): boolean {
  const opts = Array.from(el.options);
  const i = chooseOption(
    value,
    opts.map((o) => ({ text: o.textContent ?? '', value: o.value })),
  );
  if (i === -1) return false;
  el.value = opts[i].value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

interface Rule {
  test: RegExp;
  /** Returns the value to fill, or '' to skip. */
  value: (p: Profile) => string;
  /** Avoid filling free-text essays from short rules. */
  selectOk?: boolean;
}

// Ordered: earlier, more specific rules win.
// Exported for tests: matchRule() needs a real element, so the rule table is the
// only way to exercise the regexes and their precedence under `environment: node`.
export const RULES: Rule[] = [
  { test: /\b(first|given)\s*name\b/, value: (p) => p.personal.firstName },
  { test: /\b(last|family|sur)\s*name\b/, value: (p) => p.personal.lastName },
  // `^name$` never fired in practice: getLabelText CONCATENATES the label with
  // the field's id/name/placeholder, so a plain "Name" field reads as
  // "name name name" (or "name _systemfield_name" on Ashby), never bare "name".
  // Anchor only the start, and exclude the qualifiers that make it a different
  // field entirely — "Name of School/Employer/Reference", "Name Prefix/Suffix".
  {
    test: /\bfull\s*name\b|^name\b(?!\s+(?:of|prefix|suffix|title)\b)/,
    value: (p) => `${p.personal.firstName} ${p.personal.lastName}`.trim(),
  },
  { test: /\be-?mail\b/, value: (p) => p.personal.email },
  { test: /\b(phone|mobile|tel)\b/, value: (p) => p.personal.phone },
  { test: /\blinkedin\b/, value: (p) => p.personal.linkedin },
  { test: /\bgithub\b/, value: (p) => p.personal.github },
  { test: /\b(portfolio|website|personal site)\b/, value: (p) => p.personal.portfolio },
  { test: /\bcity\b/, value: (p) => p.personal.city },
  { test: /\b(state|province|region)\b/, value: (p) => p.personal.state, selectOk: true },
  { test: /\bcountry\b/, value: (p) => p.personal.country, selectOk: true },
  // These two read the applicant's CURRENT employer/title, but their keywords
  // flip referent inside question prose: in "Why are you interested in this
  // position?" the position is the *employer's* job, and in "Why do you want to
  // work at our company?" the company is theirs too. Matching there both hid the
  // AI-answer button and typed the applicant's current job into an essay box.
  //
  // A trailing lookbehind isn't enough on its own: the regex engine retries the
  // whole pattern starting after the determiner, so "this current position"
  // matches "position" with "current " (not "this ") as its immediate prefix —
  // the very phrasing this rule exists to exclude. A leading negative lookahead
  // over the WHOLE determiner-phrase, scanned across the entire label rather
  // than anchored to one match attempt, closes that gap; "current" is optional
  // inside it for the same reason.
  {
    test: /^(?!.*\b(?:this|the|that|our|a|an)\s+(?:current\s+)?(?:company|employer)\b).*?\b(current\s*)?(company|employer)\b/,
    value: (p) => p.workHistory[0]?.company ?? '',
  },
  {
    test: /^(?!.*\b(?:this|the|that|our|a|an)\s+(?:current\s+)?(?:title|role|position)\b).*?\b(current\s*)?(title|role|position)\b/,
    value: (p) => p.workHistory[0]?.title ?? '',
  },
  { test: /\b(salary|compensation|pay)\b/, value: (p) => p.preferences.salaryExpectation },
  {
    test: /\b(work\s*authoriz|authoriz.*work|legally.*work|eligible.*work)\b/,
    value: (p) => p.preferences.workAuthorization,
    selectOk: true,
  },
  {
    test: /\b(sponsor|visa\s*sponsor|require.*sponsor)\b/,
    value: (p) => p.preferences.requiresSponsorship,
    selectOk: true,
  },
];

function matchRule(label: string, el: FillableField): Rule | undefined {
  // Standard rules fill short, known values (name, title, company…). A textarea
  // is always a free-text/essay question, so no standard rule applies — e.g.
  // "describe your role" must NOT be filled with the job title. This also lets
  // findOpenQuestions give every textarea an AI-answer button.
  if (el instanceof HTMLTextAreaElement) return undefined;
  for (const rule of RULES) {
    if (!rule.test.test(label)) continue;
    if (el instanceof HTMLSelectElement && !rule.selectOk) continue;
    return rule;
  }
  return undefined;
}

export interface FillSummary {
  filled: number;
  total: number;
  /** Recognised fields left untouched because they already held a value. */
  alreadyFilled: number;
}

/** Fills every recognised, empty field within `root`. */
export function applyStandardFills(profile: Profile, root: ParentNode = document): FillSummary {
  const fields = Array.from(
    root.querySelectorAll<FillableField>('input, textarea, select'),
  ).filter(isFillable);

  let filled = 0;
  let total = 0;
  let alreadyFilled = 0;

  for (const el of fields) {
    const label = getLabelText(el);
    const rule = matchRule(label, el);
    if (!rule) continue;
    const value = rule.value(profile);
    if (!value) continue;
    total++;

    if (el instanceof HTMLSelectElement) {
      if (fillSelect(el, value)) filled++;
    } else {
      if (el.value.trim()) {
        alreadyFilled++;
        continue; // don't clobber existing input
      }
      fillInput(el, value);
      filled++;
    }
  }

  return { filled, total, alreadyFilled };
}

function isFillable(el: FillableField): boolean {
  if (el instanceof HTMLInputElement) {
    const skip = ['hidden', 'file', 'submit', 'button', 'password', 'checkbox', 'radio'];
    if (skip.includes(el.type)) return false;
  }
  if (el.disabled || (el as HTMLInputElement).readOnly) return false;
  // Visible-ish check
  if (el.offsetParent === null && el.getClientRects().length === 0) return false;
  return true;
}

export interface OpenQuestion {
  el: HTMLTextAreaElement | HTMLInputElement;
  label: string;
}

/**
 * Input types that hold prose. Everything else an <input> can be (email, tel,
 * url, number, date…) is a structured value the AI has no business drafting,
 * even when the label reads like a question.
 */
const FREE_TEXT_INPUT_TYPES = new Set(['text', 'search']);

/** Words a non-question label needs before it counts as an essay prompt. */
const QUESTION_MIN_WORDS = 4;

/**
 * Attributes that mark an <input> as the text box of a dropdown widget rather
 * than a free-text field. A native <select> is never a candidate (it isn't in
 * findOpenQuestions' selector), but React combobox libraries render a real
 * <input type="text"> with a styled option list — and its label is usually a
 * question, so it would otherwise pass looksLikeQuestion.
 *
 * `list` is the native pairing with <datalist>; the rest are the ARIA combobox
 * pattern, which any of these widgets sets in order to be operable at all.
 */
const COMBOBOX_ATTRS = ['aria-haspopup', 'aria-autocomplete', 'aria-expanded', 'aria-controls', 'list'];

/**
 * Whether an input is really a dropdown in disguise. Pure so the rule is
 * testable without a DOM; isCombobox() below feeds it from a live element.
 *
 * An AI-drafted sentence is never a valid answer to a fixed option list, and
 * the button also lands on top of the control, so these get no button at all.
 */
export function isComboboxLike(el: {
  role: string | null;
  attributeNames: readonly string[];
  hasComboboxAncestor: boolean;
}): boolean {
  if (el.role === 'combobox' || el.role === 'listbox') return true;
  if (el.attributeNames.some((a) => COMBOBOX_ATTRS.includes(a.toLowerCase()))) return true;
  return el.hasComboboxAncestor;
}

function isCombobox(el: HTMLInputElement): boolean {
  return isComboboxLike({
    role: el.getAttribute('role'),
    attributeNames: el.getAttributeNames(),
    // Widgets that put the role on a wrapper instead of the input itself.
    hasComboboxAncestor: el.closest('[role="combobox"], [role="listbox"]') !== null,
  });
}

/**
 * True when a label reads like a free-text question rather than a short data
 * field. Only consulted for <input>: a <textarea> is a question by definition.
 *
 * Must be given getQuestionText(), NOT getLabelText() — the latter appends the
 * id/name/placeholder, which inflates the word count enough that "Pronouns"
 * ("pronouns pronouns type here") would pass on padding alone.
 */
/**
 * Whether a click on the AI-answer button should ask before replacing what is
 * already in the field, instead of generating straight away.
 *
 * Writing into an empty field is harmless, so that stays a single click. Once
 * the field holds anything — the applicant's own draft, or an AI answer they
 * have since edited — generating would destroy it, and fillInput() assigns
 * through the native value setter, so the browser's undo stack cannot bring it
 * back. The second click is the only chance to notice.
 */
export function needsReplaceConfirm(currentValue: string, alreadyArmed: boolean): boolean {
  return !alreadyArmed && currentValue.trim() !== '';
}

export function looksLikeQuestion(question: string): boolean {
  if (question.includes('?')) return true;
  return question.split(' ').filter(Boolean).length >= QUESTION_MIN_WORDS;
}

/** Finds free-text questions that aren't covered by a standard rule. */
export function findOpenQuestions(root: ParentNode = document): OpenQuestion[] {
  const out: OpenQuestion[] = [];
  const fields = root.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>('textarea, input');

  for (const el of Array.from(fields)) {
    if (!isFillable(el)) continue;

    const isInput = el instanceof HTMLInputElement;
    if (isInput && !FREE_TEXT_INPUT_TYPES.has((el.getAttribute('type') || 'text').toLowerCase())) {
      continue;
    }
    // A dropdown's answer comes from its option list, never from the AI.
    if (isInput && isCombobox(el)) continue;

    const label = getLabelText(el);
    if (matchRule(label, el)) continue; // a standard field, not an essay question

    // A textarea is an essay box by definition. An input is only one when it
    // reads like a question — otherwise every "Pronouns" or "Referral code" box
    // would sprout a button.
    const question = getQuestionText(el);
    if (isInput && !looksLikeQuestion(question)) continue;

    // Prefer the clean question for the AI prompt; fall back to the matching
    // label on markup that exposes no real label at all.
    out.push({ el, label: question || label });
  }
  return out;
}
