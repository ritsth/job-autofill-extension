// Profile schema + chrome.storage.local persistence.
// Everything here stays on the user's machine (storage.local, not sync) because
// it contains PII (resume text, contact info, optional demographics).

import { DEFAULT_MODEL, isKnownModel } from './ai/models';

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
  /**
   * Optional admin token. Normal users leave this blank and sign in with Google
   * (the proxy meters them per user); the proxy owner can paste the shared
   * PROXY_TOKEN here to bypass sign-in and the daily quota.
   */
  proxyToken: string;
}

export interface Profile {
  personal: PersonalInfo;
  workHistory: WorkEntry[];
  education: EducationEntry[];
  skills: string[];
  /** Free-text resume, used as primary AI context. */
  resumeText: string;
  documents: UploadedDoc[];
  preferences: Preferences;
  baseCoverLetter: string;
  ai: AISettings;
  /** Master on/off for the eligibility scanner (runs on every page when on). */
  scanEnabled: boolean;
  /**
   * Hostnames the eligibility badge is switched off on ("turn off on this site
   * only"), matched via hostMatches (exact-or-subdomain) in src/lib/host.ts.
   * Independent of scanEnabled — this narrows where the scanner runs while
   * scanEnabled is the global master switch.
   */
  disabledHosts: string[];
  /** Show the tailored-resume generator in the side panel. */
  tailoredResumeEnabled: boolean;
  /** Show the tailored cover-letter generator in the side panel. */
  coverLetterEnabled: boolean;
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
    // Defaults to the managed proxy (Vertex AI via Cloud Run). The URL is
    // pre-filled; users sign in with Google (the proxy meters per user), so no
    // secret is baked into the source. proxyToken stays blank — it's only for the
    // proxy owner's admin override.
    provider: 'proxy',
    apiKey: '',
    model: DEFAULT_MODEL,
    proxyUrl: 'https://job-autofill-proxy-rz75fufhtq-uc.a.run.app/generate',
    proxyToken: '',
  },
  scanEnabled: true,
  disabledHosts: [],
  tailoredResumeEnabled: true,
  coverLetterEnabled: true,
};

const STORAGE_KEY = 'profile';

/** Deep-merges stored data over defaults so new fields always have a value. */
function withDefaults(stored: Partial<Profile> | undefined): Profile {
  if (!stored) return structuredClone(DEFAULT_PROFILE);
  const ai = { ...DEFAULT_PROFILE.ai, ...stored.ai };
  // Old/hand-typed model ids (e.g. the previous gemini-2.0-flash default) may not
  // be in the curated dropdown — snap them to the default so the picker is never
  // blank and the proxy never gets an unknown id.
  if (!isKnownModel(ai.model)) ai.model = DEFAULT_MODEL;
  return {
    ...DEFAULT_PROFILE,
    ...stored,
    personal: { ...DEFAULT_PROFILE.personal, ...stored.personal },
    preferences: { ...DEFAULT_PROFILE.preferences, ...stored.preferences },
    ai,
    workHistory: stored.workHistory ?? DEFAULT_PROFILE.workHistory,
    education: stored.education ?? DEFAULT_PROFILE.education,
    skills: stored.skills ?? DEFAULT_PROFILE.skills,
    documents: stored.documents ?? DEFAULT_PROFILE.documents,
    scanEnabled: stored.scanEnabled ?? DEFAULT_PROFILE.scanEnabled,
    disabledHosts: stored.disabledHosts ?? DEFAULT_PROFILE.disabledHosts,
    tailoredResumeEnabled: stored.tailoredResumeEnabled ?? DEFAULT_PROFILE.tailoredResumeEnabled,
    coverLetterEnabled: stored.coverLetterEnabled ?? DEFAULT_PROFILE.coverLetterEnabled,
  };
}

export async function getProfile(): Promise<Profile> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  // @types/chrome now types storage values as `unknown`; we control what's written
  // to this key, and withDefaults guards missing/partial data, so the assertion is safe.
  return withDefaults(result[STORAGE_KEY] as Partial<Profile> | undefined);
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
      cb(withDefaults(changes[STORAGE_KEY].newValue as Partial<Profile> | undefined));
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/**
 * Character budget for resume + uploaded documents COMBINED in the AI context
 * (see #251). The proxy hard-rejects any prompt over MAX_PROMPT_CHARS = 200_000
 * (server/index.js), and every prompt builder also adds capped job text
 * (MAX_TEXT = 12_000, savedJobs.ts) plus a system prompt on top — this stays
 * comfortably under that ceiling with room to spare for future growth.
 */
export const CONTEXT_TEXT_BUDGET = 60_000;

/**
 * The resume is the highest-value context for tailoring, so it gets a generous
 * budget of its own — taken from CONTEXT_TEXT_BUDGET first, ahead of documents,
 * so it's the last thing to get trimmed.
 */
export const RESUME_TEXT_BUDGET = 20_000;

/**
 * Per-document cap. Applied before the shared remaining budget so one oversized
 * upload can't crowd out the others — every document degrades a little instead
 * of a tail-truncate silently dropping whichever documents sort last.
 */
export const DOCUMENT_TEXT_BUDGET = 8_000;

/**
 * True when this document's own text is long enough that profileToContext will
 * trim it. Options.tsx shows this next to the document instead of trimming
 * silently — see #251. (A document under this cap can still end up dropped
 * entirely if enough earlier resume/document text has already used up
 * CONTEXT_TEXT_BUDGET; this only flags the common, per-document case.)
 */
export function isDocumentTrimmed(doc: UploadedDoc): boolean {
  return doc.text.trim().length > DOCUMENT_TEXT_BUDGET;
}

/**
 * Flattens the profile into a single context string the AI can read when
 * answering open-ended questions or tailoring a cover letter.
 */
export function profileToContext(p: Profile): string {
  const lines: string[] = [];
  const { personal: pi } = p;
  const fullName = [pi.firstName, pi.lastName].filter(Boolean).join(' ');
  if (fullName) lines.push(`Name: ${fullName}`);
  if (pi.email) lines.push(`Email: ${pi.email}`);
  if (pi.phone) lines.push(`Phone: ${pi.phone}`);
  if (pi.city || pi.state || pi.country)
    lines.push(`Location: ${[pi.city, pi.state, pi.country].filter(Boolean).join(', ')}`);
  if (pi.linkedin) lines.push(`LinkedIn: ${pi.linkedin}`);
  if (pi.github) lines.push(`GitHub: ${pi.github}`);
  if (pi.portfolio) lines.push(`Portfolio: ${pi.portfolio}`);

  if (p.skills.length) lines.push(`\nSkills: ${p.skills.join(', ')}`);

  if (p.workHistory.length) {
    lines.push('\nWork history:');
    for (const w of p.workHistory) {
      const header = [w.title, w.company].filter(Boolean).join(' at ');
      const range = w.startDate ? ` (${w.startDate}–${w.endDate || 'present'})` : '';
      lines.push(`- ${header}${range}${w.description ? `: ${w.description}` : ''}`);
    }
  }

  if (p.education.length) {
    lines.push('\nEducation:');
    for (const e of p.education) {
      const degreeTitle = [e.degree, e.field].filter(Boolean).join(' in ');
      const header = [degreeTitle, e.school].filter(Boolean).join(' from ');
      lines.push(`- ${header}${e.graduationYear ? ` (${e.graduationYear})` : ''}`);
    }
  }

  const resume = p.resumeText.trim();
  if (resume) {
    lines.push('\nResume:\n' + resume.slice(0, RESUME_TEXT_BUDGET));
  }

  // Remaining shared budget after the resume's priority slice. Each document is
  // further capped at DOCUMENT_TEXT_BUDGET so a single huge upload can't eat the
  // whole thing; once the shared budget itself runs out, later documents (in
  // list order) are dropped entirely rather than appended as a useless sliver.
  let remaining = CONTEXT_TEXT_BUDGET - Math.min(resume.length, RESUME_TEXT_BUDGET);
  for (const doc of p.documents) {
    if (remaining <= 0) break;
    const text = doc.text.trim();
    if (!text) continue;
    const cap = Math.min(DOCUMENT_TEXT_BUDGET, remaining);
    lines.push(`\nDocument "${doc.name}":\n${text.slice(0, cap)}`);
    remaining -= Math.min(text.length, cap);
  }

  return lines.join('\n');
}
