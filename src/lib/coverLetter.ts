// Cover-letter helpers: placeholder substitution and download. The AI-tailoring
// step itself is done in the background service worker (it owns the provider);
// this module prepares the base text and handles the file download.

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

/** Builds a filesystem-safe filename for the downloaded letter. */
export function letterFilename(company: string, role: string): string {
  const slug = [company, role]
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `cover-letter${slug ? '-' + slug : ''}.txt`;
}

/** Triggers a .txt download of the letter from an extension page (popup/options). */
export function downloadLetter(text: string, company: string, role: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = letterFilename(company, role);
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has time to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
