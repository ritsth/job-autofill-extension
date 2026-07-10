import { describe, it, expect } from 'vitest';
import { analyze, isBadgeDismissKey } from './sponsorship';

describe('eligibility badge keyboard dismissal', () => {
  it('dismisses only for Escape', () => {
    expect(isBadgeDismissKey({ key: 'Escape' })).toBe(true);
    expect(isBadgeDismissKey({ key: 'Enter' })).toBe(false);
    expect(isBadgeDismissKey({ key: 'Esc' })).toBe(false);
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

  it('marks an employer that will sponsor as YES', () => {
    const a = analyze('We will sponsor visas for the right candidate.');
    expect(a.verdict).toBe('yes');
    expect(a.positives.length).toBeGreaterThan(0);
  });

  it('treats a citizenship preference as a caution, not a hard NO', () => {
    const a = analyze('U.S. citizenship preferred but not required.');
    expect(a.verdict).toBe('caution');
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
