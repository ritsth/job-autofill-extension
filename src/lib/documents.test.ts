import { describe, expect, it, vi } from 'vitest';

const { getDocumentMock } = vi.hoisted(() => ({ getDocumentMock: vi.fn() }));

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: getDocumentMock,
}));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.mjs' }));
vi.mock('mammoth', () => ({
  extractRawText: vi.fn().mockResolvedValue({ value: '' }),
  convertToHtml: vi.fn().mockResolvedValue({ value: '' }),
}));

import { extractText } from './documents';

describe('extractText', () => {
  it('warns when a text file is empty', async () => {
    const file = new File([], 'resume.txt', { type: 'text/plain' });

    await expect(extractText(file)).resolves.toEqual({
      text: '',
      warning: 'No text found in this file.',
    });
  });

  it('normalizes whitespace-only markdown before warning', async () => {
    const file = new File(['  \n\t'], 'notes.md', { type: 'text/markdown' });

    await expect(extractText(file)).resolves.toEqual({
      text: '',
      warning: 'No text found in this file.',
    });
  });

  it('warns when a document has no extractable text', async () => {
    const file = new File([], 'resume.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    await expect(extractText(file)).resolves.toEqual({
      text: '',
      warning: 'No text found in this file.',
    });
  });

  it('preserves the specific warning for a PDF with no selectable text', async () => {
    getDocumentMock.mockReturnValueOnce({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue({
          getTextContent: vi.fn().mockResolvedValue({ items: [] }),
          getAnnotations: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    const file = new File([], 'resume.pdf', { type: 'application/pdf' });

    await expect(extractText(file)).resolves.toEqual({
      text: '',
      warning: 'No selectable text found (scanned PDF?). Try a text-based PDF.',
    });
  });

  it('returns non-empty text without a warning', async () => {
    const file = new File(['Experienced TypeScript developer'], 'resume.txt', {
      type: 'text/plain',
    });

    await expect(extractText(file)).resolves.toEqual({
      text: 'Experienced TypeScript developer',
    });
  });

  it('preserves the specific warning for legacy documents', async () => {
    const file = new File([], 'resume.doc', { type: 'application/msword' });

    await expect(extractText(file)).resolves.toEqual({
      text: '',
      warning: 'Legacy .doc is not supported — please upload a PDF or .docx.',
    });
  });
});
