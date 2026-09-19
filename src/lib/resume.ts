// Tailored-resume helper: filename + PDF download. The AI-tailoring step itself
// runs in the background service worker (it owns the provider); this module just
// turns the generated text into a downloadable PDF, mirroring coverLetter.ts.

import { documentFilename } from './filename';
import { downloadTextPdf } from './pdf';

/** Builds a filesystem-safe filename (without extension) for the resume. */
export function resumeFilename(company: string, role: string): string {
  return documentFilename('resume', company, role);
}

/** Triggers a .pdf download of the tailored resume from an extension page. */
export function downloadResume(text: string, company: string, role: string): void {
  downloadTextPdf(text, `${resumeFilename(company, role)}.pdf`);
}
