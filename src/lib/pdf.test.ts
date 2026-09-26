import { describe, it, expect } from 'vitest';
import { glyph, wrapLine, encodeText, textToPdf } from './pdf';

describe('PDF Helpers', () => {
  describe('glyph', () => {
    it('returns correct byte and Helvetica width for printable ASCII characters', () => {
      // Space (ASCII 32): width should be 278
      expect(glyph(' ')).toEqual({ byte: 32, width: 278 });

      // 'A' (ASCII 65): width should be 667
      expect(glyph('A')).toEqual({ byte: 65, width: 667 });

      // 'a' (ASCII 97): width should be 556
      expect(glyph('a')).toEqual({ byte: 97, width: 556 });
    });

    it('maps typographic Unicode characters to WinAnsi bytes and correct widths', () => {
      // Left single quote (0x2018) -> 0x91, width 222
      expect(glyph('‘')).toEqual({ byte: 0x91, width: 222 });

      // Right single quote (0x2019) -> 0x92, width 222
      expect(glyph('’')).toEqual({ byte: 0x92, width: 222 });

      // Left double quote (0x201c) -> 0x93, width 333
      expect(glyph('“')).toEqual({ byte: 0x93, width: 333 });

      // Right double quote (0x201d) -> 0x94, width 333
      expect(glyph('”')).toEqual({ byte: 0x94, width: 333 });

      // Bullet (0x2022) -> 0x95, width 350
      expect(glyph('•')).toEqual({ byte: 0x95, width: 350 });

      // En dash (0x2013) -> 0x96, width 556
      expect(glyph('–')).toEqual({ byte: 0x96, width: 556 });

      // Em dash (0x2014) -> 0x97, width 1000
      expect(glyph('—')).toEqual({ byte: 0x97, width: 1000 });

      // Ellipsis (0x2026) -> 0x85, width 1000
      expect(glyph('…')).toEqual({ byte: 0x85, width: 1000 });
    });

    it('maps non-breaking space to standard space', () => {
      // nbsp (U+00A0) -> 0x20, width 278
      expect(glyph('\u00A0')).toEqual({ byte: 0x20, width: 278 });
    });

    it('falls back to code for other characters below 256', () => {
      // newline (ASCII 10) -> byte 10, width 556
      expect(glyph('\n')).toEqual({ byte: 10, width: 556 });
    });

    it('returns fallback "?" (0x3F) for unsupported Unicode characters', () => {
      // Emoji
      expect(glyph('😊')).toEqual({ byte: 0x3f, width: 556 });

      // Chinese character
      expect(glyph('中')).toEqual({ byte: 0x3f, width: 556 });
    });
  });

  describe('encodeText', () => {
    it('leaves a plain ASCII string unchanged', () => {
      const ascii = 'Hello World 123!';
      expect(encodeText(ascii)).toBe(ascii);
    });

    it('escapes parentheses and backslashes', () => {
      // '(' -> '\(', ')' -> '\)', '\' -> '\\'
      expect(encodeText('hello (world) \\')).toBe('hello \\(world\\) \\\\');
    });

    it('correctly maps smart quotes and non-breaking spaces during encoding', () => {
      // '“' maps to 0x93, '”' maps to 0x94, nbsp maps to 0x20 (space)
      const encoded = encodeText('“hello”\u00A0world');
      expect(encoded).toBe(
        String.fromCharCode(0x93) +
        'hello' +
        String.fromCharCode(0x94) +
        ' ' +
        'world'
      );
    });
  });

  describe('wrapLine', () => {
    it('returns single empty string for empty or whitespace-only lines', () => {
      expect(wrapLine('', 12, 100)).toEqual(['']);
      expect(wrapLine('   ', 12, 100)).toEqual(['']);
    });

    it('does not wrap a short line that fits within the maximum width', () => {
      // "Hello World" is about 62 points at 12pt font.
      expect(wrapLine('Hello World', 12, 100)).toEqual(['Hello World']);
    });

    it('wraps a long line into multiple lines when it exceeds the maximum width', () => {
      // "Hello World" exceeds 50 points, so it should split at the space
      expect(wrapLine('Hello World', 12, 50)).toEqual(['Hello', 'World']);
    });

    it('breaks a single word that is wider than the maximum width across lines', () => {
      // "Supercalifragilisticexpialidocious" is very long.
      // Since maxW is small (50), the single word must be split internally so no line exceeds maxW.
      const result = wrapLine('Supercalifragilisticexpialidocious abc', 12, 50);
      expect(result).toEqual([
        'Supercal',
        'ifragilistic',
        'expialido',
        'cious',
        'abc'
      ]);
    });
  });
});

// textToPdf assembles the pieces above into a real PDF: pagination, the object
// graph, and a hand-serialized cross-reference table. It's pure (no DOM, unlike
// downloadTextPdf) but shipped untested (#342) — a wrong xref offset or a page
// missing from /Kids produces a file that silently won't open.
describe('textToPdf', () => {
  /** The document as text. Every byte is WinAnsi, so Latin1 is exact. */
  function decode(bytes: Uint8Array): string {
    return Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  }

  // (792 - 72*2) / (11 * 1.45) = 40.6 -> floor 40, +1 for the line sitting on
  // the top margin itself. Pinned because the page split depends on it.
  const LINES_PER_PAGE = 41;

  function pageCount(pdf: string): number {
    const count = /\/Count (\d+)/.exec(pdf);
    return count ? Number(count[1]) : 0;
  }

  it('produces a document with the PDF header and trailer', () => {
    const pdf = decode(textToPdf('Hello world'));

    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdf.endsWith('%%EOF')).toBe(true);
    expect(pdf).toContain('/Type /Catalog');
    expect(pdf).toContain('/Type /Pages');
    expect(pdf).toContain('/BaseFont /Helvetica');
  });

  it('emits only single-byte values, so the Latin1 copy is lossless', () => {
    // textToPdf builds a string then copies charCodeAt(i) & 0xff. Any char above
    // 255 would be silently truncated to a different byte.
    const bytes = textToPdf('Smart “quotes”, an em—dash and a bullet •');

    expect(bytes.every((b) => b >= 0 && b <= 255)).toBe(true);
    // Round-tripping the decoded text back through charCodeAt must reproduce it.
    const decoded = decode(bytes);
    expect(Array.from(decoded, (c) => c.charCodeAt(0) & 0xff)).toEqual(Array.from(bytes));
  });

  it('writes the wrapped lines, not the original long one', () => {
    const long = 'word '.repeat(60).trim();
    const pdf = decode(textToPdf(long));

    // Each wrapped line becomes its own show-text operator.
    const shown = [...pdf.matchAll(/\((.*)\) Tj/g)].map((m) => m[1]);
    expect(shown.length).toBeGreaterThan(1);
    expect(shown).not.toContain(long);
    expect(shown.join(' ')).toContain('word word');
  });

  it('escapes parentheses and backslashes in the content stream', () => {
    // Unescaped, these would terminate the PDF string literal early and corrupt
    // the document.
    const pdf = decode(textToPdf('a (b) c \\ d'));

    expect(pdf).toContain('(a \\(b\\) c \\\\ d) Tj');
  });

  it('declares a /Length matching the actual content stream', () => {
    const pdf = decode(textToPdf('Hello world'));
    const m = /<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/.exec(pdf);

    expect(m).not.toBeNull();
    expect(m![2].length).toBe(Number(m![1]));
  });

  describe('pagination', () => {
    it('keeps a document that exactly fills one page on one page', () => {
      const pdf = decode(textToPdf(Array.from({ length: LINES_PER_PAGE }, (_, i) => `L${i}`).join('\n')));

      expect(pageCount(pdf)).toBe(1);
    });

    it('spills to a second page one line later', () => {
      const lines = Array.from({ length: LINES_PER_PAGE + 1 }, (_, i) => `L${i}`);
      const pdf = decode(textToPdf(lines.join('\n')));

      expect(pageCount(pdf)).toBe(2);
    });

    it('lists every page in /Kids, matching /Count', () => {
      const lines = Array.from({ length: LINES_PER_PAGE * 3 }, (_, i) => `L${i}`);
      const pdf = decode(textToPdf(lines.join('\n')));
      const kids = /\/Kids \[([^\]]*)\]/.exec(pdf);

      expect(kids).not.toBeNull();
      const refs = [...kids![1].matchAll(/(\d+) 0 R/g)].map((m) => m[1]);
      expect(refs).toHaveLength(3);
      expect(pageCount(pdf)).toBe(3);
      // Every referenced page object must actually exist in the file.
      for (const num of refs) {
        expect(pdf).toContain(`\n${num} 0 obj\n`);
      }
    });

    it('treats CRLF the same as LF when splitting lines', () => {
      const crlf = decode(textToPdf('a\r\nb\r\nc'));
      const lf = decode(textToPdf('a\nb\nc'));

      expect([...crlf.matchAll(/\((.*)\) Tj/g)].map((m) => m[1])).toEqual(['a', 'b', 'c']);
      expect(crlf).toBe(lf);
    });

    it('still produces one valid page for empty text', () => {
      const pdf = decode(textToPdf(''));

      expect(pageCount(pdf)).toBe(1);
      expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
      expect(pdf.endsWith('%%EOF')).toBe(true);
    });
  });

  describe('cross-reference table', () => {
    // The xref offsets are hand-computed byte positions. If any is wrong the
    // file is malformed in a way nothing else here would reveal, so re-derive
    // them from the document independently and compare.
    function xrefOffsets(pdf: string): number[] {
      const start = pdf.indexOf('xref\n');
      const header = /xref\n0 (\d+)\n/.exec(pdf.slice(start));
      const count = Number(header![1]);
      const body = pdf.slice(start + header![0].length);
      const entries = [...body.matchAll(/(\d{10}) (\d{5}) ([nf]) \n/g)].slice(0, count);
      return entries.map((m) => Number(m[1]));
    }

    it('points each entry at the byte where that object actually starts', () => {
      const pdf = decode(textToPdf(Array.from({ length: LINES_PER_PAGE + 5 }, (_, i) => `L${i}`).join('\n')));
      const offsets = xrefOffsets(pdf);

      // Entry 0 is the free head; objects are numbered from 1.
      expect(offsets[0]).toBe(0);
      expect(offsets.length).toBeGreaterThan(1);
      offsets.slice(1).forEach((offset, i) => {
        expect(pdf.slice(offset)).toMatch(new RegExp(`^${i + 1} 0 obj\\n`));
      });
    });

    it('points startxref at the xref table itself', () => {
      const pdf = decode(textToPdf('Hello world'));
      const startxref = Number(/startxref\n(\d+)\n%%EOF$/.exec(pdf)![1]);

      expect(pdf.slice(startxref)).toMatch(/^xref\n0 \d+\n/);
    });

    it('declares a /Size covering every object in the file', () => {
      const pdf = decode(textToPdf('Hello world'));
      const size = Number(/\/Size (\d+)/.exec(pdf)![1]);
      const objectNumbers = [...pdf.matchAll(/\n(\d+) 0 obj\n/g)].map((m) => Number(m[1]));

      expect(objectNumbers.length).toBeGreaterThan(0);
      expect(Math.max(...objectNumbers)).toBe(size - 1);
    });
  });
});
