// Profile schema + chrome.storage.local persistence.
// Everything here stays on the user's machine (storage.local, not sync) because
// it contains PII (résumé text, contact info, optional demographics).

export interface PersonalInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  country: string;
  linkedin: string;
  portfolio: string;
  github: string;
}

export interface WorkEntry {
  company: string;
  title: string;
  startDate: string;
  endDate: string;
  description: string;
}

export interface EducationEntry {
  school: string;
  degree: string;
  field: string;
  graduationYear: string;
}

export interface UploadedDoc {
  id: string;
  name: string;
  /** Plain-text extracted from the upload; this is what gets sent to the AI. */
  text: string;
  addedAt: number;
}

export interface Preferences {
  workAuthorization: string;
  requiresSponsorship: string;
  salaryExpectation: string;
  /** Optional, user-controlled EEO/demographic answers. Empty by default. */
  gender: string;
  ethnicity: string;
  veteranStatus: string;
  disabilityStatus: string;
}

export type AIProviderId = 'gemini' | 'onDevice' | 'proxy';

export interface AISettings {
  provider: AIProviderId;
  apiKey: string;
  model: string;
  /** Managed-proxy mode (Cloud Run → Vertex AI). */
  proxyUrl: string;
  proxyToken: string;
}

export interface Profile {
  personal: PersonalInfo;
  workHistory: WorkEntry[];
  education: EducationEntry[];
  skills: string[];
  /** Free-text résumé, used as primary AI context. */
  resumeText: string;
  documents: UploadedDoc[];
  preferences: Preferences;
  baseCoverLetter: string;
  ai: AISettings;
  /** Master on/off for the eligibility scanner (runs on every page when on). */
  scanEnabled: boolean;
}

export const DEFAULT_PROFILE: Profile = {
  personal: {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    city: '',
    state: '',
    country: '',
    linkedin: '',
    portfolio: '',
    github: '',
  },
  workHistory: [],
  education: [],
  skills: [],
  resumeText: '',
  documents: [],
  preferences: {
    workAuthorization: '',
    requiresSponsorship: '',
    salaryExpectation: '',
    gender: '',
    ethnicity: '',
    veteranStatus: '',
    disabilityStatus: '',
  },
  baseCoverLetter:
    'Dear {{company}} Hiring Team,\n\n' +
    'I am excited to apply for the {{role}} position. ' +
    '[Write a couple of sentences about why you are a great fit.]\n\n' +
    'Sincerely,\n[Your Name]',
  ai: {
    provider: 'gemini',
    apiKey: '',
    model: 'gemini-2.0-flash',
    proxyUrl: '',
    proxyToken: '',
  },
  scanEnabled: true,
};

const STORAGE_KEY = 'profile';

/** Deep-merges stored data over defaults so new fields always have a value. */
function withDefaults(stored: Partial<Profile> | undefined): Profile {
  if (!stored) return structuredClone(DEFAULT_PROFILE);
  return {
    ...DEFAULT_PROFILE,
    ...stored,
    personal: { ...DEFAULT_PROFILE.personal, ...stored.personal },
    preferences: { ...DEFAULT_PROFILE.preferences, ...stored.preferences },
    ai: { ...DEFAULT_PROFILE.ai, ...stored.ai },
    workHistory: stored.workHistory ?? DEFAULT_PROFILE.workHistory,
    education: stored.education ?? DEFAULT_PROFILE.education,
    skills: stored.skills ?? DEFAULT_PROFILE.skills,
    documents: stored.documents ?? DEFAULT_PROFILE.documents,
    scanEnabled: stored.scanEnabled ?? DEFAULT_PROFILE.scanEnabled,
  };
}

export async function getProfile(): Promise<Profile> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return withDefaults(result[STORAGE_KEY]);
}

export async function saveProfile(profile: Profile): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: profile });
}

/** Subscribe to profile changes (e.g. options page edits reflected in popup). */
export function onProfileChanged(cb: (profile: Profile) => void): () => void {
  const listener = (
    changes: { [key: string]: chrome.storage.StorageChange },
    area: string,
  ) => {
    if (area === 'local' && changes[STORAGE_KEY]) {
      cb(withDefaults(changes[STORAGE_KEY].newValue));
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/**
 * Flattens the profile into a single context string the AI can read when
 * answering open-ended questions or tailoring a cover letter.
 */
export function profileToContext(p: Profile): string {
  const lines: string[] = [];
  const { personal: pi } = p;
  lines.push(`Name: ${pi.firstName} ${pi.lastName}`.trim());
  if (pi.email) lines.push(`Email: ${pi.email}`);
  if (pi.city || pi.state || pi.country)
    lines.push(`Location: ${[pi.city, pi.state, pi.country].filter(Boolean).join(', ')}`);
  if (pi.linkedin) lines.push(`LinkedIn: ${pi.linkedin}`);
  if (pi.github) lines.push(`GitHub: ${pi.github}`);
  if (pi.portfolio) lines.push(`Portfolio: ${pi.portfolio}`);

  if (p.skills.length) lines.push(`\nSkills: ${p.skills.join(', ')}`);

  if (p.workHistory.length) {
    lines.push('\nWork history:');
    for (const w of p.workHistory) {
      lines.push(
        `- ${w.title} at ${w.company} (${w.startDate || '?'}–${w.endDate || 'present'})` +
          (w.description ? `: ${w.description}` : ''),
      );
    }
  }

  if (p.education.length) {
    lines.push('\nEducation:');
    for (const e of p.education) {
      lines.push(
        `- ${e.degree} ${e.field ? `in ${e.field}` : ''} from ${e.school}` +
          (e.graduationYear ? ` (${e.graduationYear})` : ''),
      );
    }
  }

  if (p.resumeText.trim()) {
    lines.push('\nRésumé:\n' + p.resumeText.trim());
  }

  for (const doc of p.documents) {
    if (doc.text.trim()) lines.push(`\nDocument "${doc.name}":\n${doc.text.trim()}`);
  }

  return lines.join('\n');
}
