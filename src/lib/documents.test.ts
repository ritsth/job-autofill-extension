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

import { extractText, extractTextBatch } from './documents';

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

describe('extractTextBatch — multi-file upload', () => {
  const txt = (name: string, body: string) =>
    new File([body], name, { type: 'text/plain' });

  it('extracts every file in the batch, tagged with its own name', async () => {
    const results = await extractTextBatch([
      txt('a.txt', 'first document'),
      txt('b.txt', 'second document'),
      txt('c.txt', 'third document'),
    ]);

    expect(results.map((r) => r.name)).toEqual(['a.txt', 'b.txt', 'c.txt']);
    expect(results.map((r) => r.text)).toEqual([
      'first document',
      'second document',
      'third document',
    ]);
    expect(results.every((r) => r.warning === undefined)).toBe(true);
  });

  it('keeps going after a bad file instead of losing the whole batch', async () => {
    // The point of the batch helper: picking one scanned/unsupported PDF
    // alongside three good files must not discard the three good ones.
    const results = await extractTextBatch([
      txt('good-1.txt', 'kept'),
      new File([], 'legacy.doc', { type: 'application/msword' }),
      txt('good-2.txt', 'also kept'),
    ]);

    expect(results).toHaveLength(3);
    expect(results[0].text).toBe('kept');
    expect(results[2].text).toBe('also kept');
    // The bad one is reported, not silently dropped, and names itself.
    expect(results[1].text).toBe('');
    expect(results[1].name).toBe('legacy.doc');
    expect(results[1].warning).toMatch(/Legacy \.doc is not supported/);
  });

  it('converts a thrown error into that file\'s warning rather than rejecting', async () => {
    // A PDF whose parse throws would previously abort the entire upload.
    getDocumentMock.mockReturnValueOnce({
      promise: Promise.reject(new Error('corrupt pdf')),
    });
    const results = await extractTextBatch([
      new File([], 'broken.pdf', { type: 'application/pdf' }),
      txt('fine.txt', 'survives'),
    ]);

    expect(results[0].warning).toMatch(/could not read file/i);
    expect(results[0].warning).toMatch(/corrupt pdf/);
    expect(results[1].text).toBe('survives');
  });

  it('reports progress as each file completes', async () => {
    const seen: Array<[number, number]> = [];
    await extractTextBatch([txt('a.txt', 'one'), txt('b.txt', 'two')], (done, total) =>
      seen.push([done, total]),
    );
    // Fires before each file, then once more at the end so the UI can settle
    // on "2 of 2" rather than stalling at "1 of 2".
    expect(seen).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
  });

  it('handles an empty selection without calling through', async () => {
    await expect(extractTextBatch([])).resolves.toEqual([]);
  });
});
