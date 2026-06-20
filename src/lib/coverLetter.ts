// Cover-letter helpers: placeholder substitution and download. The cover letter
// is placeholder-only — the background service worker substitutes
// {{company}}/{{role}}/{{date}} with no AI rewrite; this module prepares the
// base text and handles the file download.

import { downloadTextPdf } from './pdf';

export interface LetterVars {
  company: string;
  role: string;
  /** Defaults to today in the user's locale. */
  date?: string;
}

/** Replaces {{company}}, {{role}}, {{date}} (case-insensitive) in the template. */
export function substitutePlaceholders(template: string, vars: LetterVars): string {
  const date = vars.date ?? new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const map: Record<string, string> = {
    company: vars.company || '',
    role: vars.role || '',
    date,
  };
  return template.replace(/\{\{\s*(company|role|date)\s*\}\}/gi, (m, key: string) => {
    // Leave the placeholder visible if we don't have a value, so a missing
    // company/role is obvious instead of silently becoming a blank gap.
    return map[key.toLowerCase()] || m;
  });
}

/** Builds a filesystem-safe filename (without extension) for the letter. */
export function letterFilename(company: string, role: string): string {
  const slug = [company, role]
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `cover-letter${slug ? '-' + slug : ''}`;
}

/** Triggers a .pdf download of the letter from an extension page (popup/options). */
export function downloadLetter(text: string, company: string, role: string): void {
  downloadTextPdf(text, `${letterFilename(company, role)}.pdf`);
}
