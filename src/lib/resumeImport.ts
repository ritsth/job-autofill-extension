import type { EducationEntry, PersonalInfo, WorkEntry } from './profile';

export interface ParsedResume {
  /** Only fields the AI actually found; merge over existing values. */
  personal: Partial<PersonalInfo>;
  work: WorkEntry[];
  education: EducationEntry[];
  skills: string[];
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Parses the model's JSON response into typed profile sections. Tolerates code
 * fences and stray prose around the JSON object.
 */
export function parseResumeJson(raw: string): ParsedResume {
  const json = extractJsonObject(raw);
  if (!json) throw new Error('The AI did not return readable JSON. Try again.');

  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('Could not parse the AI response as JSON. Try again.');
  }

  const obj = (data ?? {}) as Record<string, unknown>;
  const personalIn = (obj.personal ?? {}) as Record<string, unknown>;
  const workIn = Array.isArray(obj.work) ? obj.work : [];
  const eduIn = Array.isArray(obj.education) ? obj.education : [];
  const skillsIn = Array.isArray(obj.skills) ? obj.skills : [];

  // Keep only non-empty personal fields so we never clobber existing data.
  const personalKeys: (keyof PersonalInfo)[] = [
    'firstName', 'lastName', 'email', 'phone', 'city', 'state', 'country',
    'linkedin', 'github', 'portfolio',
  ];
  const personal: Partial<PersonalInfo> = {};
  for (const key of personalKeys) {
    const v = str(personalIn[key]);
    if (v) personal[key] = v;
  }

  const work: WorkEntry[] = workIn
    .map((w) => {
      const e = (w ?? {}) as Record<string, unknown>;
      return {
        title: str(e.title),
        company: str(e.company),
        startDate: str(e.startDate),
        endDate: str(e.endDate),
        description: str(e.description),
      };
    })
    .filter((w) => w.title || w.company);

  const education: EducationEntry[] = eduIn
    .map((ed) => {
      const e = (ed ?? {}) as Record<string, unknown>;
      return {
        school: str(e.school),
        degree: str(e.degree),
        field: str(e.field),
        graduationYear: str(e.graduationYear),
      };
    })
    .filter((e) => e.school || e.degree);

  const skills = skillsIn.map(str).filter(Boolean);

  return { personal, work, education, skills };
}

/** Pulls the first balanced {...} block out of a possibly-fenced string. */
export function extractJsonObject(raw: string): string | null {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return cleaned.slice(start, end + 1);
}
