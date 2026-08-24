// Tiny dependency-free PDF writer for plain text (cover letters).
// Emits a single-font (Helvetica) document with real proportional line
// wrapping and page breaks — enough for a clean letter without pulling in a
// ~350 KB PDF library. PDF spec: a Catalog → Pages → Page(s), each Page with a
// content stream that draws text via BT/Tf/TL/Td/Tj/T*/ET operators.

// Helvetica glyph advance widths (per 1000 units) for ASCII 32–126.
const HELV: number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

// Common typographic Unicode → WinAnsi byte, so smart quotes / dashes survive.
const UNI_TO_WIN: Record<number, number> = {
  0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94,
  0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2026: 0x85,
};
// Widths for those WinAnsi high bytes.
const EXTRA_W: Record<number, number> = {
  0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x95: 350, 0x96: 556, 0x97: 1000, 0x85: 1000,
};

export function glyph(ch: string): { byte: number; width: number } {
  let code = ch.charCodeAt(0);
  if (UNI_TO_WIN[code] !== undefined) code = UNI_TO_WIN[code];
  if (code >= 32 && code <= 126) return { byte: code, width: HELV[code - 32] };
  if (EXTRA_W[code] !== undefined) return { byte: code, width: EXTRA_W[code] };
  if (code === 0xa0) return { byte: 0x20, width: 278 }; // nbsp → space
  if (code < 256) return { byte: code, width: 556 };
  return { byte: 0x3f, width: 556 }; // unsupported → '?'
}

function measure(s: string, fontSize: number): number {
  let w = 0;
  for (const ch of s) w += glyph(ch).width;
  return (w / 1000) * fontSize;
}

export function wrapLine(line: string, fontSize: number, maxW: number): string[] {
  if (line.trim() === '') return [''];
  const out: string[] = [];
  let cur = '';

  for (let word of line.split(' ')) {
    if (cur !== '' && measure(`${cur} ${word}`, fontSize) <= maxW) {
      cur = `${cur} ${word}`;
    } else {
      if (cur !== '') {
        out.push(cur);
      }
      while (measure(word, fontSize) > maxW) {
        let len = 1;
        while (len < word.length && measure(word.slice(0, len + 1), fontSize) <= maxW) {
          len++;
        }
        out.push(word.slice(0, len));
        word = word.slice(len);
      }
      cur = word;
    }
  }

  if (cur !== '') out.push(cur);
  return out.length ? out : [''];
}

/** Escapes a string into PDF WinAnsi bytes (handling ( ) \ and high bytes). */
export function encodeText(s: string): string {
  let out = '';
  for (const ch of s) {
    const { byte } = glyph(ch);
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += '\\';
    out += String.fromCharCode(byte);
  }
  return out;
}

/**
 * Renders text to a PDF and triggers a browser download. Safe to call from any
 * page with a DOM (the side panel/options pages and content scripts).
 */
export function downloadTextPdf(text: string, filename: string): void {
  const bytes = textToPdf(text);
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has time to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Renders plain text (with its own line breaks) to a US-Letter PDF. */
export function textToPdf(text: string): Uint8Array {
  const pageW = 612;
  const pageH = 792;
  const margin = 72;
  const fontSize = 11;
  const lineH = fontSize * 1.45;
  const maxW = pageW - margin * 2;

  // Wrap every source line, preserving blank lines as spacing.
  const lines: string[] = [];
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    lines.push(...wrapLine(raw, fontSize, maxW));
  }

  const linesPerPage = Math.max(1, Math.floor((pageH - margin * 2) / lineH) + 1);
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += linesPerPage) {
    pages.push(lines.slice(i, i + linesPerPage));
  }
  if (pages.length === 0) pages.push(['']);

  // Build objects. 1=Catalog, 2=Pages, 3=Font, then per page: content + page.
  const objs: string[] = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';

  const pageObjNums: number[] = [];
  let next = 4;
  for (const pageLines of pages) {
    const startY = pageH - margin;
    let stream = `BT\n/F1 ${fontSize} Tf\n${lineH.toFixed(2)} TL\n${margin} ${startY.toFixed(2)} Td\n`;
    for (const line of pageLines) stream += `(${encodeText(line)}) Tj\nT*\n`;
    stream += 'ET';

    const contentNum = next++;
    const pageNum = next++;
    objs[contentNum] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    objs[pageNum] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNum} 0 R >>`;
    pageObjNums.push(pageNum);
  }

  objs[2] =
    `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] ` +
    `/Count ${pageObjNums.length} >>`;

  // Serialize with a cross-reference table.
  const count = next; // object numbers 1..next-1
  let body = '%PDF-1.4\n';
  const offsets: number[] = new Array(count).fill(0);
  for (let i = 1; i < count; i++) {
    offsets[i] = body.length;
    body += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefStart = body.length;
  body += `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) {
    body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  body +=
    `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  // Each char is a single byte (WinAnsi), so a Latin1 byte copy is exact.
  const bytes = new Uint8Array(body.length);
  for (let i = 0; i < body.length; i++) bytes[i] = body.charCodeAt(i) & 0xff;
  return bytes;
}
