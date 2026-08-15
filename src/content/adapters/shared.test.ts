import { describe, it, expect } from 'vitest';
import { normalize, RULES } from './shared';
import { DEFAULT_PROFILE, type Profile } from '../../lib/profile';

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

describe('RULES — what a label resolves to', () => {
  // getLabelText joins the <label> text with the field's aria-label,
  // placeholder, name and id, then normalizes. So the string a rule is tested
  // against is almost never the bare label — which is exactly what the old
  // `^name$` (anchored at both ends) could not cope with.
  //
  // These drive the REAL RULES table rather than a copy of a regex, so a change
  // to shared.ts actually breaks them. Identifying the winning rule by the value
  // it produces also pins precedence: RULES is first-match-wins and ordered
  // most-specific-first.
  const P: Profile = {
    ...DEFAULT_PROFILE,
    personal: { ...DEFAULT_PROFILE.personal, firstName: 'Ada', lastName: 'Lovelace' },
  };
  const valueFor = (raw: string): string | undefined =>
    RULES.find((r) => r.test.test(normalize(raw)))?.value(P);

  it('resolves a single Name field once the id and name attrs are appended', () => {
    // Ashby: <label for="_systemfield_name">Name</label> — confirmed on a live
    // posting, where this was the only field that failed to autofill.
    expect(valueFor('Name _systemfield_name')).toBe('Ada Lovelace');
    // The far more common shape: <label>Name</label> + name="name" + id="name".
    expect(valueFor('Name name name')).toBe('Ada Lovelace');
    expect(valueFor('Name Your full name')).toBe('Ada Lovelace');
  });

  it('still resolves a bare label and an explicit "Full Name"', () => {
    expect(valueFor('Name')).toBe('Ada Lovelace');
    expect(valueFor('Full Name full_name')).toBe('Ada Lovelace');
  });

  it('lets the more specific first/last rules win over the full-name rule', () => {
    expect(valueFor('First Name first_name')).toBe('Ada');
    expect(valueFor('Last Name last_name')).toBe('Lovelace');
  });

  it('does not give the applicant name to fields that merely start with "name"', () => {
    // These ask for someone/something else's name, not the applicant's.
    for (const label of [
      'Name of School school_name',
      'Name of Current Employer',
      'Name of Reference',
      'Name Prefix',
      'Name Suffix',
    ]) {
      expect(valueFor(label)).not.toBe('Ada Lovelace');
    }
  });

  it('does not match when "name" is not the leading word, nor a plural', () => {
    expect(valueFor('Names')).toBeUndefined();
    // "Company Name" belongs to the employer rule further down RULES.
    expect(valueFor('Company Name')).not.toBe('Ada Lovelace');
  });
});
