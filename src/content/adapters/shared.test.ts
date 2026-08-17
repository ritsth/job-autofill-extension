import { describe, it, expect } from 'vitest';
import { looksLikeQuestion, needsReplaceConfirm, normalize, RULES } from './shared';
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

describe('looksLikeQuestion — which text inputs earn an AI-answer button', () => {
  // Only <input> is filtered by this; a <textarea> is an essay box by
  // definition. The point is to light up real questions without putting a
  // button beside every short data field on the form.
  const asks = (label: string) => looksLikeQuestion(normalize(label));

  it('accepts anything phrased as a question', () => {
    // Verified live on an Ashby posting — this is the field that had no button.
    expect(asks('What piece of physical technology invented in the last 500 years do you most admire?')).toBe(true);
    expect(asks('How did you hear about us?')).toBe(true);
    expect(asks('Why us?')).toBe(true);
  });

  it('accepts an unpunctuated prompt that is long enough to be an essay', () => {
    expect(asks('Tell us about yourself')).toBe(true);
    expect(asks('Describe a project you are proud of')).toBe(true);
  });

  it('rejects the short data fields that would just be clutter', () => {
    expect(asks('Pronouns')).toBe(false);
    expect(asks('Referral code')).toBe(false);
    expect(asks('Preferred name')).toBe(false);
    expect(asks('Start date')).toBe(false);
  });

  it('is not fooled by the padding getLabelText would add', () => {
    // getLabelText appends id/name/placeholder, so "Pronouns" becomes
    // "pronouns pronouns type here" — 5 words, which would sail past the
    // word-count gate. This is why the caller must pass getQuestionText().
    expect(asks('Pronouns')).toBe(false);
    expect(looksLikeQuestion(normalize('pronouns pronouns type here'))).toBe(true);
  });

  it('treats an empty label as not a question', () => {
    expect(asks('')).toBe(false);
    expect(asks('   ')).toBe(false);
  });
});

describe('needsReplaceConfirm — guarding the applicant\'s own text', () => {
  it('generates straight away when the field is empty', () => {
    expect(needsReplaceConfirm('', false)).toBe(false);
    expect(needsReplaceConfirm('   \n\t ', false)).toBe(false);
  });

  it('asks first when the field already holds something', () => {
    // fillInput() writes through the native value setter, so a replaced draft
    // is not recoverable via the browser's undo stack. The second click is the
    // only chance to notice.
    expect(needsReplaceConfirm('My own draft answer', false)).toBe(true);
    expect(needsReplaceConfirm('a', false)).toBe(true);
  });

  it('does not ask twice — an armed button proceeds on the confirming click', () => {
    // Otherwise the button could never regenerate at all.
    expect(needsReplaceConfirm('My own draft answer', true)).toBe(false);
  });
});

describe('RULES — question prose must not be mistaken for a data field', () => {
  // The employer/title rules read the applicant's CURRENT job. Inside a question
  // their keywords mean the opposite — the job being applied FOR — so matching
  // there suppressed the AI-answer button and typed the wrong value into an
  // essay box. Reported live on a BambooHR form.
  const P: Profile = {
    ...DEFAULT_PROFILE,
    workHistory: [
      { company: 'Acme', title: 'Data Analyst', startDate: '2024', endDate: '', description: '' },
    ],
  };
  const valueFor = (raw: string): string | undefined =>
    RULES.find((r) => r.test.test(normalize(raw)))?.value(P);

  it('leaves "why are you interested in this position?" to the AI', () => {
    expect(valueFor('Why are you interested in this position?')).toBeUndefined();
    expect(valueFor('Why are you interested in the position?')).toBeUndefined();
    expect(valueFor('Why this position?')).toBeUndefined();
    expect(valueFor('Why do you want this role?')).toBeUndefined();
    expect(valueFor('How did you hear about this position?')).toBeUndefined();
  });

  it('leaves "why do you want to work at our company?" to the AI', () => {
    expect(valueFor('Why do you want to work at our company?')).toBeUndefined();
    expect(valueFor('Why our company?')).toBeUndefined();
  });

  it('still autofills genuine current-employer and current-title fields', () => {
    expect(valueFor('Current Title')).toBe('Data Analyst');
    expect(valueFor('Job Title')).toBe('Data Analyst');
    expect(valueFor('Position')).toBe('Data Analyst');
    expect(valueFor('Current Role')).toBe('Data Analyst');
    expect(valueFor('Current Company')).toBe('Acme');
    expect(valueFor('Employer name')).toBe('Acme');
  });

  it('still autofills a data field that happens to be phrased as a question', () => {
    // The guard keys off the determiner, not the question mark, so this keeps
    // working — a blunter "questions never autofill" rule would have broken it.
    expect(valueFor('What is your current job title?')).toBe('Data Analyst');
  });
});
