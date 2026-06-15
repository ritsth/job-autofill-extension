// Extract plain text from an uploaded résumé/document so it can be used as AI
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

export async function extractText(file: File): Promise<ExtractResult> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return extractPdf(file);
  if (name.endsWith('.docx')) return extractDocx(file);
  if (name.endsWith('.txt') || name.endsWith('.md') || file.type.startsWith('text/')) {
    return { text: await file.text() };
  }
  if (name.endsWith('.doc')) {
    return { text: '', warning: 'Legacy .doc is not supported — please upload a PDF or .docx.' };
  }
  return { text: '', warning: `Unsupported file type: ${file.name}` };
}

async function extractPdf(file: File): Promise<ExtractResult> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ');
    parts.push(pageText);
  }
  const text = parts.join('\n\n').replace(/[ \t]+\n/g, '\n').trim();
  if (!text) {
    return { text: '', warning: 'No selectable text found (scanned PDF?). Try a text-based PDF.' };
  }
  return { text };
}

async function extractDocx(file: File): Promise<ExtractResult> {
  const mammoth = await import('mammoth');
  const buf = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  return { text: result.value.trim() };
}
