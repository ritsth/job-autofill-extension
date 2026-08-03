import { describe, expect, it } from 'vitest';
import { parseEligibilityJson } from './jobEligibility';

describe('parseEligibilityJson', () => {
  it('maps eligibility fields and marks the result as AI-derived', () => {
    const result = parseEligibilityJson(
      JSON.stringify({
        citizenship: 'required',
        clearance: 'preferred',
        sponsorship: 'none',
        experienceRequired: '3 years',
        experiencePreferred: '  fintech  ',
        summary: 'Review the work authorization language.',
      }),
    );

    expect(result).toEqual({
      verdict: 'no',
      restrictions: ['U.S. citizenship required', 'No visa sponsorship'],
      cautions: ['Clearance preferred'],
      positives: [],
      experience: { required: '3 years', preferred: 'fintech' },
      reason: 'Review the work authorization language.',
      source: 'ai',
    });
  });

  it('gives restrictions precedence over cautions and positives', () => {
    const result = parseEligibilityJson(
      JSON.stringify({ citizenship: 'preferred', clearance: 'required', sponsorship: 'available' }),
    );

    expect(result.verdict).toBe('no');
    expect(result.restrictions).toEqual(['Security clearance required']);
    expect(result.cautions).toEqual(['U.S. citizenship preferred']);
    expect(result.positives).toEqual(['Sponsorship available']);
  });

  it('gives cautions precedence over positives', () => {
    const result = parseEligibilityJson(
      JSON.stringify({ citizenship: 'preferred', sponsorship: 'available' }),
    );

    expect(result.verdict).toBe('caution');
    expect(result.cautions).toEqual(['U.S. citizenship preferred']);
    expect(result.positives).toEqual(['Sponsorship available']);
  });

  it('returns yes when sponsorship is available without restrictions or cautions', () => {
    expect(parseEligibilityJson('{"sponsorship":"available"}').verdict).toBe('yes');
  });

  it('returns unknown when no recognized eligibility value is present', () => {
    expect(parseEligibilityJson('{}').verdict).toBe('unknown');
    expect(parseEligibilityJson('{"sponsorship":"maybe"}').verdict).toBe('unknown');
  });

  it('matches eligibility values case-insensitively', () => {
    const result = parseEligibilityJson(
      JSON.stringify({ citizenship: 'REQUIRED', clearance: 'Preferred', sponsorship: 'AVAILABLE' }),
    );

    expect(result.verdict).toBe('no');
    expect(result.restrictions).toEqual(['U.S. citizenship required']);
    expect(result.cautions).toEqual(['Clearance preferred']);
    expect(result.positives).toEqual(['Sponsorship available']);
  });

  it('trims text fields and converts empty or non-string values to null', () => {
    const result = parseEligibilityJson(
      JSON.stringify({
        experienceRequired: '  3 years  ',
        experiencePreferred: '   ',
        summary: 42,
      }),
    );

    expect(result.experience).toEqual({ required: '3 years', preferred: null });
    expect(result.reason).toBeUndefined();
  });

  it('accepts the fenced JSON returned by some model responses', () => {
    expect(parseEligibilityJson('```json\n{"sponsorship":"available"}\n```').verdict).toBe('yes');
  });

  it('throws when the response does not contain readable JSON', () => {
    expect(() => parseEligibilityJson('The model returned no JSON.')).toThrow(
      'The AI did not return readable JSON.',
    );
  });
});
