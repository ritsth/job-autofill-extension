// Cover-letter helpers: placeholder substitution and download. The AI-tailoring
// step itself is done in the background service worker (it owns the provider);
// this module prepares the base text and handles the file download.

import { textToPdf } from './pdf';

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
  return template.replace(/\{\{\s*(company|role|date)\s*\}\}/gi, (_m, key: string) => {
    return map[key.toLowerCase()] ?? '';
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
  const bytes = textToPdf(text);
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${letterFilename(company, role)}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has time to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
