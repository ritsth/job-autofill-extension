import { parseLooseJson } from './resumeImport';
import type { SponsorAnalysis } from '../content/sponsorship';

// Parses the AI's job-eligibility JSON into the same shape the rules pass uses,
// so the badge renders it identically (just marked source: 'ai').

interface RawEligibility {
  sponsorship?: string;
  citizenship?: string;
  clearance?: string;
  experienceRequired?: string | null;
  experiencePreferred?: string | null;
  summary?: string;
}

export function parseEligibilityJson(raw: string): SponsorAnalysis {
  const d = parseLooseJson(raw) as RawEligibility | null;
  if (!d) throw new Error('The AI did not return readable JSON.');

  const sponsorship = (d.sponsorship || '').toLowerCase();
  const citizenship = (d.citizenship || '').toLowerCase();
  const clearance = (d.clearance || '').toLowerCase();

  const restrictions: string[] = [];
  const cautions: string[] = [];
  const positives: string[] = [];

  if (citizenship === 'required') restrictions.push('U.S. citizenship required');
  else if (citizenship === 'preferred') cautions.push('U.S. citizenship preferred');

  if (clearance === 'required') restrictions.push('Security clearance required');
  else if (clearance === 'preferred') cautions.push('Clearance preferred');

  if (sponsorship === 'none') restrictions.push('No visa sponsorship');
  else if (sponsorship === 'available') positives.push('Sponsorship available');

  const verdict = restrictions.length
    ? 'no'
    : cautions.length
      ? 'caution'
      : positives.length
        ? 'yes'
        : 'unknown';

  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

  return {
    verdict,
    restrictions,
    cautions,
    positives,
    experience: { required: str(d.experienceRequired), preferred: str(d.experiencePreferred) },
    reason: str(d.summary) || undefined,
    source: 'ai',
  };
}
