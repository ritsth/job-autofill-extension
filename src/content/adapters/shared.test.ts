import { describe, it, expect } from 'vitest';
import { normalize } from './shared';

describe('normalize — label text canonicalisation', () => {
  it('lowercases and otherwise leaves a whitespace-free string alone', () => {
    expect(normalize('FIRsTName')).toBe('firstname');
    expect(normalize('E-Mail')).toBe('e-mail');
    expect(normalize('firstname')).toBe('firstname');
  });

  it('collapses consecutive internal spaces to one', () => {
    expect(normalize('First   Name')).toBe('first name');
    expect(normalize('First     Na    me')).toBe('first na me');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalize('  First Name  ')).toBe('first name');
    expect(normalize('\t\n First Name \n\t')).toBe('first name');
  });

  it('treats tabs and newlines like spaces', () => {
    // Label text read off the DOM is indented markup, so the separator between
    // two words is usually "\n      " rather than a single space.
    expect(normalize('First\tName')).toBe('first name');
    expect(normalize('First\n      Name')).toBe('first name');
    expect(normalize('First \t\n\n  Name')).toBe('first name');
  });

  it('collapses a non-breaking space like ordinary whitespace', () => {
    // The case that makes this function worth pinning: Workday & co. emit
    // &nbsp; inside label text. JS \s matches U+00A0, so rewriting the regex
    // to / +/g or to split(' ') would silently stop matching those labels.
    expect(normalize('First\u00A0Name')).toBe('first name');
    expect(normalize('\u00A0First Name\u00A0')).toBe('first name');
  });

  it('returns an empty string for empty and whitespace-only input', () => {
    expect(normalize('')).toBe('');
    expect(normalize(' ')).toBe('');
    expect(normalize('\n')).toBe('');
    expect(normalize('   \t\n  ')).toBe('');
  });

  it('is idempotent', () => {
    const label = '  First \n  Name ';
    expect(normalize(normalize(label))).toBe(normalize(label));
  });

  // Pins current (incorrect) behaviour: \s does not match U+200B, so the ZWSP
  // survives normalization and breaks multi-word rule matching in matchRule.
  // Tracked in https://github.com/ritsth/job-autofill-extension/issues/176
  it('documents a known bug — zero-width space is not a separator (see #176)', () => {
    expect(normalize('First\u200BName')).toBe('first\u200Bname');
  });

});