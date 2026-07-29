import { describe, it, expect } from 'vitest';
import {
  addBadgeDismissListener,
  analyze,
  badgeSignature,
  clampAxis,
  isBadgeDismissKey,
  nearestCorner,
  shouldDismissBadge,
} from './sponsorship';

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
});
