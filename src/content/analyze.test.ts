import { describe, it, expect } from 'vitest';
import { buildJobEligibilityPrompt } from '../lib/ai/prompts';
import { MAX_TEXT } from '../lib/savedJobs';
import {
  AI_SCAN_BUDGET,
  addBadgeDismissListener,
  analyze,
  badgeSignature,
  clampAxis,
  focusEligibilityText,
  isBadgeDismissKey,
  nearestCorner,
  shouldDismissBadge,
} from './sponsorship';

describe('focusEligibilityText — what the AI actually reads on long postings', () => {
  // Filler sized so a few sentences already blow a small test budget; the real
  // budget is 12,000 chars, which is impractical to build by hand in a test.
  const filler = (n: number) => `Filler sentence number ${n} about the team and the office.`;

  it('passes a short posting through, minus the screening questions', () => {
    // Under budget there is no selection to do — the only transform is the
    // question strip the rules pass also uses.
    const out = focusEligibilityText(
      'We build developer tools. Are you authorized to work without sponsorship?',
    );
    expect(out).toContain('We build developer tools.');
    expect(out.toLowerCase()).not.toContain('are you authorized');
  });

  it('leads with the cue sentence and one sentence of context each side', () => {
    // The whole point of the function: on an oversized posting the eligibility
    // wording must survive the cut, and a flat first-N-chars slice would drop it
    // because it sits after the filler.
    const text = [
      filler(1),
      filler(2),
      filler(3),
      'Context immediately before.',
      'We do not provide visa sponsorship for this role.',
      'Context immediately after.',
      filler(4),
    ].join(' ');
    const budget = 160;

    const out = focusEligibilityText(text, budget);
    const head = out.slice(0, budget);
    expect(head).toContain('We do not provide visa sponsorship for this role.');
    expect(head).toContain('Context immediately before.');
    expect(head).toContain('Context immediately after.');
    // The kept window must lead, ahead of the filler that preceded it on the page.
    expect(out.indexOf('We do not provide visa sponsorship')).toBeLessThan(
      out.indexOf('Filler sentence number 1'),
    );
  });

  it('never returns more than the budget, including after the backfill', () => {
    // Two-stage path: the kept window is shorter than the budget, so the rest of
    // the posting is appended — the append must not push the result over.
    const text = [
      'Sponsorship is available.',
      ...Array.from({ length: 40 }, (_, i) => filler(i)),
    ].join(' ');
    for (const budget of [40, 200, 1_000]) {
      expect(focusEligibilityText(text, budget).length).toBeLessThanOrEqual(budget);
    }
  });

  it('handles a cue in the first or last sentence without an off-by-one', () => {
    // keep.add(i - 1) at i === 0 adds -1, and keep.add(i + 1) at the end adds an
    // index past the array: both must be harmless no-ops, not a wrapped or
    // wrongly kept sentence.
    const first = [
      'Visa sponsorship is available.',
      ...Array.from({ length: 20 }, (_, i) => filler(i)),
    ].join(' ');
    const firstOut = focusEligibilityText(first, 120);
    expect(firstOut.startsWith('Visa sponsorship is available.')).toBe(true);
    expect(firstOut.length).toBeLessThanOrEqual(120);

    const last = [
      ...Array.from({ length: 20 }, (_, i) => filler(i)),
      'Applicants must hold an active security clearance.',
    ].join(' ');
    const lastOut = focusEligibilityText(last, 160);
    expect(lastOut.slice(0, 160)).toContain('Applicants must hold an active security clearance.');
    expect(lastOut.length).toBeLessThanOrEqual(160);
  });

  it('degrades to plain ordered truncation when the posting has no cue', () => {
    // No cue means nothing is kept, so the result is the ordinary posting in its
    // original order — the same thing a naive cut would produce.
    const text = Array.from({ length: 30 }, (_, i) => filler(i)).join(' ');
    const out = focusEligibilityText(text, 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.trimStart().startsWith('Filler sentence number 0')).toBe(true);
  });

  it('matches the cue case-insensitively', () => {
    // ELIGIBILITY_CUE carries the `i` flag; postings shout these words in
    // headings, so dropping the flag would silently stop focusing them.
    for (const cue of ['VISA status is discussed below.', 'A SECRET clearance is required.']) {
      const text = [
        ...Array.from({ length: 20 }, (_, i) => filler(i)),
        cue,
        ...Array.from({ length: 20 }, (_, i) => filler(100 + i)),
      ].join(' ');
      expect(focusEligibilityText(text, 300).slice(0, 300)).toContain(cue);
    }
  });
});

describe('badgeSignature — what forces a badge rebuild', () => {
  // Two postings that analyse identically. Very common: any two postings with no
  // eligibility wording both come back "unknown/rules", so the analysis alone
  // cannot distinguish them.
  const same = analyze('We are seeking a new grad to join the team.');
  const acme = { company: 'Acme Corp', role: 'Software Engineer' };

  it('changes when the posting company/role changes', () => {
    // The bug: the generator forms are seeded once at build time, so if the
    // signature ignores company/role, switching jobs in a split view keeps the
    // previous posting's values in the cover-letter form.
    expect(badgeSignature(same, acme, true, true)).not.toBe(
      badgeSignature(same, { company: 'Saroot Labs', role: 'Software Engineer' }, true, true),
    );
    expect(badgeSignature(same, acme, true, true)).not.toBe(
      badgeSignature(same, { company: 'Acme Corp', role: 'Data Analyst' }, true, true),
    );
  });

  it('is stable for the same posting and settings', () => {
    // Guards the perf win: mutation-happy pages must not rebuild every debounce.
    expect(badgeSignature(same, acme, true, true)).toBe(badgeSignature(same, acme, true, true));
  });

  it('still changes when the verdict or generator toggles change', () => {
    const restricted = analyze('Must be a U.S. citizen. No visa sponsorship.');
    expect(badgeSignature(same, acme, true, true)).not.toBe(
      badgeSignature(restricted, acme, true, true),
    );
    expect(badgeSignature(same, acme, true, true)).not.toBe(
      badgeSignature(same, acme, false, true),
    );
    expect(badgeSignature(same, acme, true, true)).not.toBe(
      badgeSignature(same, acme, true, false),
    );
  });

  it('does not collide when a delimiter character sits in scraped company/role text', () => {
    // Regression guard: company/role come from unsanitized DOM text, so a plain
    // join('|') let company "A|B" + role "C" collide with company "A" + role
    // "B|C" — two different postings would be treated as the same one and the
    // rebuild (with it, the generator forms) would be skipped.
    expect(badgeSignature(same, { company: 'A|B', role: 'C' }, true, true)).not.toBe(
      badgeSignature(same, { company: 'A', role: 'B|C' }, true, true),
    );
  });
});

describe('nearestCorner — badge drag snapping', () => {
  it('maps each viewport quadrant to its corner', () => {
    expect(nearestCorner(10, 10, 1000, 800)).toBe('tl');
    expect(nearestCorner(990, 10, 1000, 800)).toBe('tr');
    expect(nearestCorner(10, 790, 1000, 800)).toBe('bl');
    expect(nearestCorner(990, 790, 1000, 800)).toBe('br');
  });

  it('breaks exact-center ties toward the bottom-right', () => {
    // Center is not < half, so ties resolve to bottom/right — deterministic,
    // and matches the badge's historical right-side home.
    expect(nearestCorner(500, 400, 1000, 800)).toBe('br');
  });
});

describe('clampAxis — keep the dragged badge on-screen', () => {
  it('leaves an in-range position unchanged', () => {
    expect(clampAxis(100, 200, 1000)).toBe(100);
  });

  it('clamps a negative position to the near edge', () => {
    expect(clampAxis(-50, 200, 1000)).toBe(0);
  });

  it('clamps past the far edge to viewport - len', () => {
    // 200-wide badge in a 1000 viewport can sit at most at 800.
    expect(clampAxis(950, 200, 1000)).toBe(800);
    expect(clampAxis(800, 200, 1000)).toBe(800);
  });

  it('pins to 0 when the badge is larger than the viewport', () => {
    // viewport - len is negative; the badge pins to the top/left edge instead
    // of being pushed off-screen by a negative upper bound.
    expect(clampAxis(100, 1200, 1000)).toBe(0);
    expect(clampAxis(-100, 1200, 1000)).toBe(0);
  });
});

describe('eligibility badge keyboard dismissal', () => {
  it('dismisses only for Escape', () => {
    expect(isBadgeDismissKey({ key: 'Escape' })).toBe(true);
    expect(isBadgeDismissKey({ key: 'Enter' })).toBe(false);
    expect(isBadgeDismissKey({ key: 'Esc' })).toBe(false);
  });

  it('dismisses only while the badge is mounted', () => {
    expect(shouldDismissBadge({ key: 'Escape' }, true)).toBe(true);
    expect(shouldDismissBadge({ key: 'Escape' }, false)).toBe(false);
    expect(shouldDismissBadge({ key: 'Enter' }, true)).toBe(false);
  });

  it('registers and cleans up unconsumed Escape dismissal', () => {
    const target = new EventTarget();
    let mounted = true;
    let dismissals = 0;
    const cleanup = addBadgeDismissListener(
      target,
      () => mounted,
      () => {
        dismissals += 1;
        mounted = false;
      },
    );

    const escape = Object.assign(new Event('keydown', { cancelable: true }), {
      key: 'Escape',
    });
    target.dispatchEvent(escape);

    expect(dismissals).toBe(1);
    expect(escape.defaultPrevented).toBe(false);

    cleanup();
    mounted = true;
    const afterTeardown = Object.assign(new Event('keydown', { cancelable: true }), {
      key: 'Escape',
    });
    target.dispatchEvent(afterTeardown);
    expect(dismissals).toBe(1);
    expect(afterTeardown.defaultPrevented).toBe(false);
  });
});

describe('analyze — eligibility verdict', () => {
  it('flags a hard citizenship requirement as NO', () => {
    const a = analyze('Applicants must be a U.S. citizen to be considered for this role.');
    expect(a.verdict).toBe('no');
    expect(a.restrictions).toContain('U.S. citizenship required');
  });

  it('flags an explicit no-sponsorship statement as NO', () => {
    const a = analyze('We are unable to provide visa sponsorship for this position.');
    expect(a.verdict).toBe('no');
    expect(a.restrictions).toContain('No visa sponsorship');
  });

  it('flags "do not provide/offer VISA sponsorship" as NO', () => {
    // Regression guard. The "do/does not … sponsor" rule allowed only an
    // immediate verb ("do not provide sponsorship"), so the far more common
    // wording with a qualifier in between — "do not provide VISA sponsorship" —
    // matched nothing and the badge reported "no eligibility info detected".
    for (const text of [
      'We do not provide visa sponsorship.',
      'We do not offer visa sponsorship at this time.',
      'We do not offer employer sponsorship.',
      'We do not support visa sponsorship.',
      'This company does not provide visa sponsorship.',
      'We are not currently offering visa sponsorship.',
      // Every enumerated qualifier and verb form gets its own case so a typo'd
      // alternative in the regex fails here instead of shipping silently.
      'We are not supporting H-1B sponsorship.',
      'We do not support work sponsorship.',
      'We do not provide immigration sponsorship.',
      "This company doesn't provide visa sponsorship.",
      "We don't offer visa sponsorship.",
    ]) {
      const a = analyze(text);
      expect(a.verdict, text).toBe('no');
      expect(a.restrictions, text).toContain('No visa sponsorship');
    }
  });

  it('keeps the sponsorship negation narrow enough to skip "do not hesitate"', () => {
    // The rule enumerates verbs/qualifiers instead of using a wildcard gap
    // precisely so an unrelated "do not" near the word "sponsor" is not a NO.
    const a = analyze('Please do not hesitate to contact us about our sponsor program.');
    expect(a.verdict).not.toBe('no');
  });

  it('marks an employer that will sponsor as YES', () => {
    const a = analyze('We will sponsor visas for the right candidate.');
    expect(a.verdict).toBe('yes');
    expect(a.positives.length).toBeGreaterThan(0);
  });

  // A company sponsors conferences, bootcamps and football teams as well as
  // visas, and a careers page says all of it in the same first person. Reading
  // the bare verb as an immigration offer turned every perk into a green YES —
  // the costly direction, since the applicant then invests in a job that will
  // screen them out for the reason the badge said not to worry about (#368).
  describe('the verb "sponsor" alone is not a sponsorship offer', () => {
    it('does not read a non-visa sponsorship as YES', () => {
      for (const text of [
        'We sponsor conferences and meetups for our engineers.',
        'We sponsor the local football team.',
        'We are happy to sponsor conference attendance.',
        'We will sponsor your continuing education.',
        'We do sponsor a coding bootcamp for career changers.',
        'We are willing to sponsor employee volunteering days.',
        'We are open to sponsor a hackathon this year.',
        'We sponsor charity events in our community.',
      ]) {
        const a = analyze(text);
        expect(a.verdict, text).not.toBe('yes');
        expect(a.positives, text).toEqual([]);
      }
    });

    it('does not match a non-visa word that merely starts like one', () => {
      // "optional" must not satisfy the OPT branch, "international conferences"
      // must not satisfy the international-candidates one.
      for (const text of [
        'We sponsor optional training for new hires.',
        'We sponsor international conferences each year.',
        // A word boundary sits between "opt" and the hyphen, so `opt\b` alone
        // would match this (raised in review of #368).
        'We sponsor opt-in wellness programs.',
      ]) {
        expect(analyze(text).verdict, text).not.toBe('yes');
      }
    });

    it('does not let another sponsored object smuggle in an audience noun', () => {
      // "candidates"/"applicants" only count as the DIRECT object of the verb.
      // Allowed anywhere in a window, a company sponsoring something else FOR
      // candidates reads as a visa offer (raised in review of #368).
      for (const text of [
        'We sponsor hackathons for qualified candidates.',
        'We sponsor conference travel for our applicants.',
      ]) {
        const a = analyze(text);
        expect(a.verdict, text).not.toBe('yes');
        expect(a.positives, text).toEqual([]);
      }
    });

    it('still reads a genuine sponsorship offer as YES', () => {
      // The fix must not be "require the noun" — these are all verb phrasings
      // that genuinely mean immigration.
      for (const text of [
        'We will sponsor visas for the right candidate.',
        'We are happy to sponsor H-1B visas for this role.',
        'We can sponsor work visas.',
        'We are able to sponsor candidates who need work authorization.',
        'We sponsor employment-based green cards.',
        'We are willing to sponsor the right candidate.',
        'We will sponsor qualified applicants.',
        'We are open to sponsor international candidates.',
        'We sponsor permanent residency applications.',
        'We can sponsor OPT students.',
        'We sponsor an applicant who requires a visa.',
      ]) {
        const a = analyze(text);
        expect(a.verdict, text).toBe('yes');
        expect(a.positives.length, text).toBeGreaterThan(0);
      }
    });
  });

  it('treats a citizenship preference as a caution, not a hard NO', () => {
    const a = analyze('U.S. citizenship preferred but not required.');
    expect(a.verdict).toBe('caution');
  });

  it('treats a work-authorization requirement as a caution, not a hard NO', () => {
    // Someone on F-1/OPT is already authorized, so this mainly rules out people
    // needing sponsorship from scratch — a MAYBE, not a NO.
    for (const text of [
      'US work authorization required',
      'U.S. work authorization required',
      'Work authorization is required for this role.',
      'Must be authorized to work in the United States.',
    ]) {
      const a = analyze(text);
      expect(a.verdict, text).toBe('caution');
      expect(a.cautions, text).toContain('U.S. work authorization required');
    }
  });

  it('marks an explicit OPT/CPT welcome as YES', () => {
    for (const text of ['Open to candidates with OPT/CPT', 'We welcome OPT and CPT candidates']) {
      const a = analyze(text);
      expect(a.verdict, text).toBe('yes');
      expect(a.positives, text).toContain('Open to OPT/CPT');
    }
  });

  it('does not read a REFUSED OPT/CPT as friendly', () => {
    // The affirmative cue has to lead and "not" is excluded, so a refusal can't
    // masquerade as a positive.
    expect(analyze('We do not accept OPT/CPT').verdict).not.toBe('yes');
    expect(analyze('This role is not open to candidates with OPT/CPT').verdict).not.toBe('yes');
  });

  it('lets an explicit positive outrank the work-authorization boilerplate', () => {
    // A caution normally beats a positive. "Work authorization required" is
    // boilerplate on a huge share of US postings, so on its own it would drag
    // genuinely sponsor-friendly postings down to MAYBE.
    const optCpt = analyze('US work authorization required. Open to candidates with OPT/CPT.');
    expect(optCpt.verdict).toBe('yes');
    expect(optCpt.cautions).not.toContain('U.S. work authorization required');

    expect(analyze('US work authorization required. Sponsorship is available.').verdict).toBe('yes');
  });

  it('still lets a hard restriction outrank both', () => {
    expect(analyze('Must be a U.S. citizen. US work authorization required.').verdict).toBe('no');
    expect(
      analyze('We are unable to provide visa sponsorship. US work authorization required.').verdict,
    ).toBe('no');
  });

  it('returns unknown when no eligibility signal is present', () => {
    const a = analyze('We are a small team building developer tools in San Francisco.');
    expect(a.verdict).toBe('unknown');
  });

  it('does not flip to NO on a screening QUESTION about sponsorship', () => {
    // Screening questions describe the FORM, not the employer's stance — they must
    // be stripped before matching so they do not produce a false NO.
    const a = analyze('Are you authorized to work without sponsorship?');
    expect(a.verdict).not.toBe('no');
  });

  it('does not flag the export-control citizenship SCREENING QUESTION as NO', () => {
    // Imperative form prompt (no "?", not "are you…") that mentions "export
    // control" — carried by nearly every US application. It must be stripped so
    // it doesn't trip the ITAR rule into a false NO.
    const a = analyze(
      'Solely for the purpose of determining if an export control license is needed, ' +
        'please indicate "Yes" if you are currently a citizen of any of the following ' +
        'countries: Iran, Syria, N. Korea, Cuba, Ukraine, People’s Republic of China, ' +
        'Hong Kong (China), Macau (China) or Russia.',
    );
    expect(a.verdict).not.toBe('no');
    expect(a.restrictions).not.toContain('ITAR / export-controlled');
  });

  it('still flags a GENUINE export-control restriction in the posting prose as NO', () => {
    // Regression guard: only the form's screening question is dropped — a real
    // employer-stated ITAR restriction must still be a hard NO.
    const a = analyze('This position is subject to ITAR; only U.S. persons are eligible.');
    expect(a.verdict).toBe('no');
    expect(a.restrictions).toContain('ITAR / export-controlled');
  });

  it('flags a citizenship + clearance qualification bullet as NO', () => {
    // Real-world DoD-contractor phrasing (iCIMS posting). The rules must catch
    // this whenever the scan can read it — the historical miss on iCIMS was the
    // posting living in an iframe the scan never saw, not a rules gap.
    const a = analyze(
      'Must be a U.S. citizen, eligible for U.S. Department of Defense (DoD) SECRET security clearance*',
    );
    expect(a.verdict).toBe('no');
    expect(a.restrictions).toContain('U.S. citizenship required');
  });
});

describe('analyze — experience extraction', () => {
  it('pulls a required years-of-experience figure', () => {
    const a = analyze('We require a minimum of 5 years of experience in backend engineering.');
    expect(a.experience.required).toBe('5+ yrs');
  });

  it('reads spelled-out numbers', () => {
    const a = analyze('At least three years of professional experience is required.');
    expect(a.experience.required).toBe('3+ yrs');
  });

  it('leaves experience null when the posting states none', () => {
    const a = analyze('A fun role for anyone excited about the mission.');
    expect(a.experience.required).toBeNull();
  });

  // The badge exists to help someone decide whether a posting is worth
  // applying to. Reporting a requirement the employer never stated pushes in
  // the one direction that costs them the job, and it is invisible: the number
  // looks plausible and the question that produced it lives in the application
  // form, not the posting body (#366).
  describe('application screening questions are not requirements', () => {
    it('ignores a years-of-experience question the form asks', () => {
      const a = analyze(
        [
          'Data Analyst at Acme. Join our team.',
          'Do you have at least 3 years of experience? *',
        ].join('\n'),
      );

      expect(a.experience.required).toBeNull();
    });

    it('ignores a "how many years" question', () => {
      const a = analyze(
        [
          'Software Engineer at Acme. We build great products.',
          'Application Questions',
          'How many years of experience do you have with React? *',
        ].join('\n'),
      );

      expect(a.experience.required).toBeNull();
    });

    it('still reads a real requirement stated alongside a screening question', () => {
      // The fix must not be "strip everything" — the employer's own requirement
      // has to survive next to the form's question.
      const a = analyze(
        [
          'Senior Engineer at Acme. Requirements: 5+ years of experience with Go.',
          'Do you have at least 2 years of experience? *',
        ].join('\n'),
      );

      expect(a.experience.required).toBe('5+ yrs');
    });

    it('does not let a labelled field swallow the line beneath it', () => {
      // Regression from the first cut of this fix: stripping questions joined
      // the surviving segments with spaces, collapsing the newline that bounds
      // a labelled value. "Required years of experience: TBD" then ran on into
      // the next line and reported its number as the requirement.
      const a = analyze('Required years of experience: TBD\n5 years preferred');

      expect(a.experience.required).toBeNull();
      expect(a.experience.preferred).toBe('5+ yrs');
    });

    it('still reads a labelled experience field, which is not a question', () => {
      // Workday-style label/value pairs must survive stripQuestions — they are
      // neither interrogative nor an imperative form prompt.
      const a = analyze('Required Years of Experience: 3-5\nDo you have a degree? *');

      expect(a.experience.required).toBe('3–5 yrs');
    });
  });
});

describe('the AI eligibility budget survives the downstream prompt cut', () => {
  // focusEligibilityText spends real effort choosing WHICH text fits in
  // AI_SCAN_BUDGET, and buildJobEligibilityPrompt then slices the same text to
  // MAX_TEXT. If AI_SCAN_BUDGET ever exceeds MAX_TEXT, that second cut throws
  // away part of the curated selection — and the loss is invisible at the edit
  // site, because both constants look correct in their own file.
  it('keeps AI_SCAN_BUDGET equal to the prompt builder cap', () => {
    expect(AI_SCAN_BUDGET).toBe(MAX_TEXT);
  });

  it('reaches the eligibility prompt whole, with nothing trimmed twice', () => {
    // End to end over the real call path's two caps: text selected at budget
    // must appear in the built prompt unshortened.
    const posting =
      'We sponsor H-1B visas for this role. '.repeat(50) +
      'Filler about the team and the office. '.repeat(Math.ceil(AI_SCAN_BUDGET / 20));
    const focused = focusEligibilityText(posting);

    expect(focused.length).toBe(AI_SCAN_BUDGET);
    expect(buildJobEligibilityPrompt(focused).prompt).toContain(focused);
  });
});

describe('restriction keywords need a requirement cue, not just a mention (#370)', () => {
  it('does not say NO when the restriction vocabulary is only the product domain', () => {
    for (const text of [
      'We are building public trust in artificial intelligence.',
      'Our mission is to restore public trust in institutions.',
      'Public trust must be earned every day.',
      'Five years of experience required; our secret sauce is the team.',
      'Join the team building secret clearance workflow software.',
      'You will build export control compliance tooling for our customers.',
      'We help exporters navigate ITAR and EAR regulations for their clients.',
      'Our platform serves U.S. persons and small businesses.',
      'We build software that automates export control screening for U.S. persons and foreign nationals alike.',
      'Under ITAR and EAR, our customers face complex rules; we make it simple.',
    ]) {
      const a = analyze(text);
      expect(a.restrictions, text).toEqual([]);
      expect(a.verdict, text).not.toBe('no');
    }
  });

  it('still says NO for genuinely stated restrictions', () => {
    for (const [text, label] of [
      ['TS/SCI with polygraph required.', 'Security clearance'],
      ['Active Secret clearance.', 'Security clearance'],
      ['Must be able to obtain a Public Trust clearance.', 'Security clearance'],
      ['Public Trust position; background investigation required.', 'Security clearance'],
      ['This position is subject to ITAR.', 'ITAR / export-controlled'],
      ['Subject to U.S. export control regulations.', 'ITAR / export-controlled'],
      ['This role requires access to export-controlled technology.', 'ITAR / export-controlled'],
      ['This position is open to U.S. persons only.', 'U.S. person (export control)'],
      ['Applicants must be U.S. persons under ITAR.', 'U.S. person (export control)'],
      ['Clearance: Secret.', 'Security clearance'],
      // Both read as NO before #370; the narrowed rules must not lose them.
      // The full regulation name pushes "ITAR" past a short cue window, and the
      // periods in "U.S." used to end the sentence window mid-phrase.
      ['This position requires access to information subject to the International Traffic in Arms Regulations (ITAR).', 'ITAR / export-controlled'],
      ['Only U.S. citizens or permanent residents (U.S. persons) will be considered.', 'U.S. person (export control)'],
      ['Applicants must be a U.S. citizen or U.S. person.', 'U.S. person (export control)'],
    ] as const) {
      const a = analyze(text);
      expect(a.restrictions, text).toContain(label);
      expect(a.verdict, text).toBe('no');
    }
  });
});

describe('a clearance stated as a preference is a caution, not NO (#373)', () => {
  it('demotes a named level or "active" clearance to MAYBE when the clause only prefers it', () => {
    for (const text of [
      'Top Secret clearance preferred.',
      'TS/SCI clearance is a plus.',
      'An active TS/SCI is nice to have.',
      'Active security clearance preferred.',
      'Secret clearance preferred but not required.',
      'Clearance is not required, but a Top Secret clearance is a plus.',
      'A Top Secret clearance, while not required, is a plus.',
      // Waived AND preferred: still a preference. No "clearance" word here, so
      // the caution can only come from the demoted level match.
      'An active TS/SCI, while not required, is nice to have.',
      'Preferred: Active Secret clearance.',
      "You don't need to hold a Secret clearance, but it's a plus.",
      // "but" ends the clause, so the unrelated "required" can't claim the TS/SCI.
      'Python is required, but an active TS/SCI is a plus.',
      // A requirement cue must not reach across a semicolon to a clearance the
      // next clause only prefers.
      'Must hold a degree; Secret clearance preferred.',
      'Requires a bachelor degree; Top Secret clearance preferred.',
    ]) {
      const a = analyze(text);
      expect(a.verdict, text).toBe('caution');
      expect(a.restrictions, text).toEqual([]);
      expect(a.cautions, text).toContain('Clearance preferred');
    }
  });

  it('does not read a waived clearance as a requirement', () => {
    for (const text of [
      'This role does not require a security clearance.',
      'This role does not require a Secret clearance.',
      // Bare levels match on their own, so the clause has to waive them.
      'This role does not require a Top Secret clearance.',
      'This role does not require a TS/SCI.',
      'No security clearance is required.',
      'A TS/SCI is not necessary for this role.',
      "You don't need a Top Secret clearance to apply.",
    ]) {
      expect(analyze(text).restrictions, text).toEqual([]);
    }
  });

  it('stays NO when the clearance itself is required, even beside a preference', () => {
    for (const text of [
      'TS/SCI required.',
      'Active Secret clearance.',
      // One posting can require one level and prefer a higher one.
      'Secret required; TS/SCI a plus.',
      'Secret clearance required; TS/SCI clearance is a plus.',
      // A requirement word in the same clause outranks the preference word.
      'Must hold an active TS/SCI clearance, polygraph preferred.',
      'Active TS/SCI required, polygraph preferred.',
      // The period in "U.S." must not split "Must" off from the clearance.
      'Must be a U.S. citizen with an active Secret clearance, TS/SCI preferred.',
      // A preference in the NEXT sentence says nothing about this one.
      'Candidates must have a Top Secret clearance. Experience with AWS is a plus.',
      'Top Secret clearance with SCI eligibility. Python experience preferred.',
      // Negating "hold" is a requirement stated in the negative, not a waiver.
      'Applicants who do not hold an active TS/SCI will not be considered.',
      // The waiver is about the degree, in its own clause.
      'A degree is not required, but an active TS/SCI clearance is.',
    ]) {
      const a = analyze(text);
      expect(a.verdict, text).toBe('no');
      expect(a.restrictions, text).toContain('Security clearance');
    }
  });
});
