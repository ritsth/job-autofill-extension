// Tailored-resume helper: filename + PDF download. The AI-tailoring step itself
// runs in the background service worker (it owns the provider); this module just
// turns the generated text into a downloadable PDF, mirroring coverLetter.ts.

import { downloadTextPdf } from './pdf';

/** Builds a filesystem-safe filename (without extension) for the resume. */
export function resumeFilename(company: string, role: string): string {
  const slug = [company, role]
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `resume${slug ? '-' + slug : ''}`;
}

/** Triggers a .pdf download of the tailored resume from an extension page. */
export function downloadResume(text: string, company: string, role: string): void {
  downloadTextPdf(text, `${resumeFilename(company, role)}.pdf`);
}
