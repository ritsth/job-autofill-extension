// Extract plain text from an uploaded resume/document so it can be used as AI
// context. Runs in the options page (a normal extension page with DOM access).
// Supports PDF (pdfjs-dist), .docx (mammoth), and plain text/markdown.

import * as pdfjsLib from 'pdfjs-dist';
// Vite resolves this to a hashed URL string; we point pdf.js at it as its worker.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export interface ExtractResult {
  text: string;
  warning?: string;
}

/** One file's outcome from extractTextBatch, tagged with which file it was. */
export interface BatchExtractResult extends ExtractResult {
  name: string;
}

/**
 * Extracts text from several files, one after another.
 *
 * A failure on one file must NOT abandon the rest: with multi-select a user can
 * easily pick a scanned PDF alongside three good ones, and losing all four to
 * the first thrown error would be worse than reporting the one that failed. So
 * a throw is converted into that file's own `warning` and the loop continues.
 *
 * Sequential rather than Promise.all on purpose — PDF parsing is CPU-heavy, and
 * running several at once would jam the options page and make the progress
 * count meaningless.
 */
export async function extractTextBatch(
  files: readonly File[],
  onProgress?: (done: number, total: number) => void,
): Promise<BatchExtractResult[]> {
  const out: BatchExtractResult[] = [];
  for (const [i, file] of files.entries()) {
    onProgress?.(i, files.length);
    try {
      const { text, warning } = await extractText(file);
      out.push({ name: file.name, text, warning });
    } catch (err) {
      out.push({
        name: file.name,
        text: '',
        warning: `Could not read file: ${(err as Error).message}`,
      });
    }
  }
  onProgress?.(files.length, files.length);
  return out;
}

export async function extractText(file: File): Promise<ExtractResult> {
  const name = file.name.toLowerCase();
  let result: ExtractResult;

  if (name.endsWith('.pdf')) {
    result = await extractPdf(file);
  } else if (name.endsWith('.docx')) {
    result = await extractDocx(file);
  } else if (
    name.endsWith('.txt') ||
    name.endsWith('.md') ||
    file.type.startsWith('text/')
  ) {
    result = { text: await file.text() };
  } else if (name.endsWith('.doc')) {
    result = {
      text: '',
      warning: 'Legacy .doc is not supported — please upload a PDF or .docx.',
    };
  } else {
    result = { text: '', warning: `Unsupported file type: ${file.name}` };
  }

  if (!result.text.trim() && !result.warning) {
    return { text: '', warning: 'No text found in this file.' };
  }
  return result;
}

async function extractPdf(file: File): Promise<ExtractResult> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const parts: string[] = [];
  const links = new Set<string>();
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ');
    parts.push(pageText);
    // Hyperlinks (LinkedIn/GitHub/portfolio) live in link annotations, not the
    // visible text — collect their URLs so the AI gets the real address.
    const annotations = (await page.getAnnotations()) as Array<{
      subtype?: string;
      url?: string;
      unsafeUrl?: string;
    }>;
    for (const a of annotations) {
      const url = a.url || a.unsafeUrl;
      if (a.subtype === 'Link' && url) links.add(url);
    }
  }
  const base = parts.join('\n\n').replace(/[ \t]+\n/g, '\n').trim();
  if (!base) {
    return { text: '', warning: 'No selectable text found (scanned PDF?). Try a text-based PDF.' };
  }
  return { text: appendLinks(base, links) };
}

async function extractDocx(file: File): Promise<ExtractResult> {
  const mammoth = await import('mammoth');
  const buf = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  let text = result.value.trim();
  // Raw-text extraction drops hyperlink targets; pull them from the HTML.
  try {
    const html = (await mammoth.convertToHtml({ arrayBuffer: buf })).value;
    const urls = new Set<string>();
    for (const m of html.matchAll(/href="([^"]+)"/g)) urls.add(m[1]);
    text = appendLinks(text, urls);
  } catch {
    // ignore — raw text is still usable
  }
  return { text };
}

/** Appends a deduped list of http(s) URLs found in the document. */
function appendLinks(text: string, urls: Set<string>): string {
  const clean = [...urls].filter((u) => /^https?:\/\//i.test(u));
  if (!clean.length) return text;
  return `${text}\n\nLinks found in document:\n${clean.join('\n')}`;
}
