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

  it('treats a zero-width space as a word separator', () => {
    // JS \s does not match U+200B, so it needs explicit handling (#176).
    // Collapsing to a space rather than deleting is deliberate — see the
    // boundary-preservation test below.
    expect(normalize('First​Name')).toBe('first name');
    expect(normalize('​First Name​')).toBe('first name');
  });

  it('treats the other zero-width characters as separators too', () => {
    // ZWNJ, ZWJ, word joiner and the BOM / zero-width no-break space are all
    // invisible and all unmatched by \s, so they fail identically to U+200B.
    expect(normalize('First‌Name')).toBe('first name');
    expect(normalize('First‍Name')).toBe('first name');
    expect(normalize('First⁠Name')).toBe('first name');
    expect(normalize('First﻿Name')).toBe('first name');
  });

  it('collapses a zero-width run mixed with ordinary whitespace to one space', () => {
    expect(normalize('First​ ​\tName')).toBe('first name');
  });

  it('keeps the word boundary that the fill rules match on', () => {
    // This is *why* zero-width chars collapse to a space instead of being
    // removed. Deleting them yields "emailaddress", which /\be-?mail\b/ cannot
    // match, so the field would silently never autofill — and the same breaks
    // every single-word rule (city, github, phone...). Guards that choice.
    expect(normalize('Email​Address')).toBe('email address');
    expect(/\be-?mail\b/.test(normalize('Email​Address'))).toBe(true);
    expect(/\bcity\b/.test(normalize('City​Field'))).toBe(true);
    expect(/\bgithub\b/.test(normalize('GitHub​URL'))).toBe(true);
  });

});
