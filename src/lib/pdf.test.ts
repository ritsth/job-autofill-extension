import { describe, it, expect } from 'vitest';
import { glyph, wrapLine, encodeText } from './pdf';

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
