import { describe, it, expect } from 'vitest';
import {
  chooseOption,
  isComboboxLike,
  looksLikeQuestion,
  needsReplaceConfirm,
  normalize,
  RULES,
} from './shared';
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

  it('is not fooled by "current" sitting between the determiner and the keyword', () => {
    // Caught in review: a trailing lookbehind only inspects the text right
    // before wherever the match attempt starts, and the regex engine retries
    // starting AFTER "current" — so "this current position" matched with
    // "current " as the immediate prefix instead of "this ", slipping past a
    // lookbehind that only knew to reject "this ". Same failure for company.
    expect(valueFor('Why are you interested in this current position?')).toBeUndefined();
    expect(valueFor('Tell us why you want this current role?')).toBeUndefined();
    expect(valueFor('What are you looking for in our current company?')).toBeUndefined();
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

describe('isComboboxLike — dropdowns never get an AI-answer button', () => {
  // Reported live: "Have you previously worked at NISC…?" and "How did you hear
  // about this job?" are dropdowns, but the widget renders a real
  // <input type="text">, so the question-shaped label let it through and the
  // button landed on top of the control. An AI sentence is never a valid answer
  // to a fixed option list.
  const plain = { role: null, attributeNames: ['type', 'name', 'id'], hasComboboxAncestor: false };

  it('leaves a genuine free-text input alone', () => {
    expect(isComboboxLike(plain)).toBe(false);
    expect(isComboboxLike({ ...plain, attributeNames: ['type', 'placeholder', 'required'] })).toBe(false);
  });

  it('detects the ARIA combobox role on the input itself', () => {
    expect(isComboboxLike({ ...plain, role: 'combobox' })).toBe(true);
    expect(isComboboxLike({ ...plain, role: 'listbox' })).toBe(true);
  });

  it('detects the ARIA combobox attributes', () => {
    for (const attr of ['aria-haspopup', 'aria-autocomplete', 'aria-expanded', 'aria-controls']) {
      expect(isComboboxLike({ ...plain, attributeNames: ['type', attr] })).toBe(true);
    }
  });

  it('detects a native <datalist> pairing', () => {
    expect(isComboboxLike({ ...plain, attributeNames: ['type', 'list'] })).toBe(true);
  });

  it('detects widgets that put the role on a wrapper instead of the input', () => {
    expect(isComboboxLike({ ...plain, hasComboboxAncestor: true })).toBe(true);
  });

  it('is case-insensitive about attribute names', () => {
    expect(isComboboxLike({ ...plain, attributeNames: ['ARIA-EXPANDED'] })).toBe(true);
  });
});

describe('RULES — the remaining field rules, against realistic concatenated labels', () => {
  // getLabelText concatenates the visible label with the field's aria-label,
  // placeholder, name and id. So the realistic input is never the bare word —
  // "Email" isn't what a rule sees, "email email_address candidate[email]" is.
  // That distinction is exactly what hid #220 for so long, so every label here
  // is written in the concatenated shape a real form produces.
  const P: Profile = {
    ...DEFAULT_PROFILE,
    personal: {
      ...DEFAULT_PROFILE.personal,
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phone: '555-0100',
      linkedin: 'linkedin.com/in/ada',
      github: 'github.com/ada',
      portfolio: 'ada.dev',
      city: 'Granville',
      state: 'Ohio',
      country: 'USA',
    },
    preferences: {
      ...DEFAULT_PROFILE.preferences,
      salaryExpectation: '100000',
      workAuthorization: 'Yes',
      requiresSponsorship: 'No',
    },
    workHistory: [
      { company: 'Acme', title: 'Data Analyst', startDate: '2024', endDate: '', description: '' },
    ],
  };
  const ruleFor = (raw: string) => RULES.find((r) => r.test.test(normalize(raw)));
  const valueFor = (raw: string): string | undefined => ruleFor(raw)?.value(P);

  it('resolves the contact-detail rules', () => {
    expect(valueFor('Email email_address candidate[email]')).toBe('ada@example.com');
    expect(valueFor('Phone Number phone candidate[phone]')).toBe('555-0100');
    expect(valueFor('LinkedIn Profile linkedin_url')).toBe('linkedin.com/in/ada');
    expect(valueFor('GitHub github_url')).toBe('github.com/ada');
  });

  it('resolves "Your Personal Website" to the portfolio', () => {
    // Live-verified working on an Ashby posting, so this is a regression anchor
    // rather than a guess about intended behaviour.
    expect(valueFor('Your Personal Website website_url')).toBe('ada.dev');
    expect(valueFor('Portfolio portfolio')).toBe('ada.dev');
  });

  it('resolves the location rules', () => {
    expect(valueFor('City city candidate[city]')).toBe('Granville');
    expect(valueFor('State state candidate[state]')).toBe('Ohio');
    expect(valueFor('Country country')).toBe('USA');
  });

  it('resolves salary and the current-job rules', () => {
    expect(valueFor('Salary Expectation salary')).toBe('100000');
    expect(valueFor('Job Title job_title')).toBe('Data Analyst');
    expect(valueFor('Current Employer employer_name')).toBe('Acme');
  });

  it('gives "Company Name" to the employer rule, not the applicant-name rule', () => {
    // Both rules contain the word "name"; the full-name rule is earlier in the
    // table, so this pins that it correctly declines rather than winning.
    expect(valueFor('Company Name company_name')).toBe('Acme');
    expect(valueFor('Company Name company_name')).not.toBe('Ada Lovelace');
  });

  it('only lets the four intended rules fill a <select>', () => {
    // matchRule() skips a non-selectOk rule for a <select> element, so this
    // flag decides whether a dropdown can be autofilled at all. Asserting it
    // directly means it can't be dropped from a rule silently.
    expect(ruleFor('State state')?.selectOk).toBe(true);
    expect(ruleFor('Country country')?.selectOk).toBe(true);
    expect(ruleFor('Are you legally authorized to work in the US?')?.selectOk).toBe(true);

    expect(ruleFor('Email email')?.selectOk).toBeUndefined();
    expect(ruleFor('City city')?.selectOk).toBeUndefined();
    expect(ruleFor('Salary salary')?.selectOk).toBeUndefined();
  });

  it('does not let a rule claim a label that merely shares one of its words', () => {
    expect(valueFor('Name of Current Employer')).not.toBe('Ada Lovelace');
    expect(valueFor('Preferred Name preferred_name')).not.toBe('Ada Lovelace');
    // "Emergency contact" is not an email/phone field for the applicant.
    expect(valueFor('Emergency Contact Name')).not.toBe('Ada Lovelace');
  });

  it('documents two rules that currently match NOTHING — known bug, see #232', () => {
    // NOT an endorsement. Both rules end a truncated stem with \b, which
    // requires a non-word char next — but real labels continue the word
    // ("authoriz" + "ation", "sponsor" + "ship"), so the boundary never occurs.
    // These assertions exist so the fix in #232 visibly flips them.
    expect(valueFor('Work Authorization work_authorization')).toBeUndefined();
    expect(valueFor('Will you now or in the future require visa sponsorship?')).toBeUndefined();
    expect(valueFor('Sponsorship sponsorship')).toBeUndefined();

    // The work-auth rule DOES fire on this phrasing, but only via its
    // `legally.*work` arm — which ends on a complete word.
    expect(valueFor('Are you legally authorized to work in the United States?')).toBe('Yes');
  });
});

describe('chooseOption — which dropdown option answers the question', () => {
  /** Options as a plain list of labels, the shape most real selects have. */
  const opts = (...labels: string[]) => labels.map((text) => ({ text, value: text }));
  const pick = (target: string, labels: string[]) => {
    const i = chooseOption(target, opts(...labels));
    return i === -1 ? null : labels[i];
  };

  describe('the opposite-answer bug (#223)', () => {
    it('prefers an exact "No" over an earlier option merely containing it', () => {
      // "no" is a substring of "not". The old single pass took DOM order, so the
      // first option won and the applicant was marked unauthorised to work.
      expect(pick('No', ['I am not authorized to work in the US', 'No', 'Yes'])).toBe('No');
      expect(pick('No', ['Not at this time', 'No'])).toBe('No');
    });

    it('never answers "US Citizen" with "Non-US Citizen"', () => {
      // The worst case: a materially false statement on an application.
      expect(pick('US Citizen', ['Non-US Citizen', 'US Citizen'])).toBe('US Citizen');
    });

    it('refuses the negated option even when it is the only candidate', () => {
      // Nothing correct to choose, so leaving the select alone beats guessing —
      // an unanswered dropdown is visible to the applicant, a wrong one is not.
      expect(pick('US Citizen', ['Non-US Citizen', 'Other'])).toBeNull();
    });

    it('does not treat a hyphen as a phrase boundary', () => {
      // A bare \b boundary passes here — the hyphen IS a word boundary — which
      // is why the fix disqualifies a hyphen neighbour specifically.
      expect(pick('authorized', ['non-authorized'])).toBeNull();
    });
  });

  describe('blank placeholder rows', () => {
    it('skips the empty first option instead of selecting it', () => {
      // `target.includes('')` is always true, so the old loop chose this row
      // outright and still reported the field as filled.
      const options = [
        { text: '', value: '' },
        { text: 'United States', value: 'US' },
      ];
      expect(chooseOption('United States', options)).toBe(1);
    });

    it('still reports no match when only a blank row is available', () => {
      expect(chooseOption('United States', [{ text: '', value: '' }])).toBe(-1);
    });
  });

  describe('matches that must keep working', () => {
    it('accepts an option that elaborates on the answer', () => {
      // The comma ends the phrase legitimately, unlike the letter in "not".
      expect(pick('Yes', ['Yes, I require sponsorship', 'No'])).toBe('Yes, I require sponsorship');
    });

    it('accepts an option narrower than the profile value', () => {
      // The reverse direction, kept for exactly this case.
      expect(pick('United States of America', ['United States', 'Canada'])).toBe('United States');
    });

    it('accepts the answer embedded mid-phrase', () => {
      expect(pick('US Citizen', ['Other', 'I am a US Citizen'])).toBe('I am a US Citizen');
    });

    it('matches on an option value when the label differs', () => {
      expect(chooseOption('US', [{ text: 'United States', value: 'US' }])).toBe(0);
    });

    it('is case- and whitespace-insensitive, like every other label match', () => {
      expect(pick('california', ['  CALIFORNIA  '])).toBe('  CALIFORNIA  ');
    });
  });

  describe('refusing to guess', () => {
    it('refuses when two options both fuzzily match', () => {
      // The same failure this whole function guards against, one pass later: a
      // work-authorization dropdown where both options begin "Yes" would other-
      // wise have its sponsorship answer decided by DOM order.
      expect(
        pick('Yes', ['Yes, I am authorized to work in the US', 'Yes, but I require sponsorship']),
      ).toBeNull();
      expect(
        pick('United States', ['United States Citizen', 'United States Permanent Resident']),
      ).toBeNull();
    });

    it('still answers when an exact match sits alongside fuzzy ones', () => {
      // Ambiguity in the fuzzy pass must not suppress a definite exact answer.
      expect(
        pick('Yes', ['Yes, I am authorized', 'Yes', 'Yes, with sponsorship']),
      ).toBe('Yes');
    });

    it('does not expand an abbreviation into a longer word', () => {
      // "CA" inside "California" is also "CA" inside "Canada" — the old code
      // picked whichever came first, which is a coin flip, not a match.
      expect(pick('CA', ['Canada', 'California'])).toBeNull();
    });

    it('returns -1 for an empty profile value', () => {
      expect(chooseOption('', ['Yes', 'No'].map((t) => ({ text: t, value: t })))).toBe(-1);
    });

    it('returns -1 when nothing resembles the value', () => {
      expect(pick('Germany', ['United States', 'Canada'])).toBeNull();
    });
  });
});
