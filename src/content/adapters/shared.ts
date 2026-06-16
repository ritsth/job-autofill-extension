// Generic, site-agnostic field handling shared by all adapters: reading a
// field's human label, matching it to a profile value, and filling it in a way
// that React-based forms (Greenhouse, Lever) actually register.

import type { Profile } from '../../lib/profile';

export type FillableField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Best-effort human label for a form control. */
export function getLabelText(el: FillableField): string {
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

  parts.push(
    el.getAttribute('aria-label') ?? '',
    el.getAttribute('placeholder') ?? '',
    el.getAttribute('name') ?? '',
    el.id ?? '',
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

/** Selects the option whose text/value best matches `value`. */
export function fillSelect(el: HTMLSelectElement, value: string): boolean {
  const target = normalize(value);
  if (!target) return false;
  let chosen: HTMLOptionElement | undefined;
  for (const opt of Array.from(el.options)) {
    const text = normalize(opt.textContent ?? '');
    const val = normalize(opt.value);
    if (text === target || val === target || text.includes(target) || target.includes(text)) {
      chosen = opt;
      break;
    }
  }
  if (!chosen) return false;
  el.value = chosen.value;
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
const RULES: Rule[] = [
  { test: /\b(first|given)\s*name\b/, value: (p) => p.personal.firstName },
  { test: /\b(last|family|sur)\s*name\b/, value: (p) => p.personal.lastName },
  { test: /\bfull\s*name\b|^name$/, value: (p) => `${p.personal.firstName} ${p.personal.lastName}`.trim() },
  { test: /\be-?mail\b/, value: (p) => p.personal.email },
  { test: /\b(phone|mobile|tel)\b/, value: (p) => p.personal.phone },
  { test: /\blinkedin\b/, value: (p) => p.personal.linkedin },
  { test: /\bgithub\b/, value: (p) => p.personal.github },
  { test: /\b(portfolio|website|personal site)\b/, value: (p) => p.personal.portfolio },
  { test: /\bcity\b/, value: (p) => p.personal.city },
  { test: /\b(state|province|region)\b/, value: (p) => p.personal.state, selectOk: true },
  { test: /\bcountry\b/, value: (p) => p.personal.country, selectOk: true },
  { test: /\b(current\s*)?(company|employer)\b/, value: (p) => p.workHistory[0]?.company ?? '' },
  { test: /\b(current\s*)?(title|role|position)\b/, value: (p) => p.workHistory[0]?.title ?? '' },
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
}

/** Fills every recognised, empty field within `root`. */
export function applyStandardFills(profile: Profile, root: ParentNode = document): FillSummary {
  const fields = Array.from(
    root.querySelectorAll<FillableField>('input, textarea, select'),
  ).filter(isFillable);

  let filled = 0;
  let total = 0;

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
      if (el.value.trim()) continue; // don't clobber existing input
      fillInput(el, value);
      filled++;
    }
  }

  return { filled, total };
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
  el: HTMLTextAreaElement;
  label: string;
}

/** Finds free-text (textarea) questions that aren't covered by a standard rule. */
export function findOpenQuestions(root: ParentNode = document): OpenQuestion[] {
  const out: OpenQuestion[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLTextAreaElement>('textarea'))) {
    if (!isFillable(el)) continue;
    const label = getLabelText(el);
    if (matchRule(label, el)) continue; // a standard field, not an essay question
    out.push({ el, label });
  }
  return out;
}
