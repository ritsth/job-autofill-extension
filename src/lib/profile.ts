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

/**
 * Adds a document, replacing any existing one with the same filename
 * (case- and whitespace-insensitive, so "Resume.PDF" replaces "resume.pdf" —
 * filesystems are case-insensitive on macOS/Windows, so this matches user
 * expectations for "the same file, re-uploaded"). A re-uploaded document moves
 * to the end of the list — most-recently-uploaded last — which also changes
 * where it appears in the AI context; that's the behavior this already had
 * before being extracted here, now pinned as intentional rather than
 * accidental. A distinct filename is appended, never merged (see #267/#271).
 */
export function upsertDocument(docs: UploadedDoc[], name: string, text: string): UploadedDoc[] {
  const norm = name.trim().toLowerCase();
  const without = docs.filter((d) => d.name.trim().toLowerCase() !== norm);
  return [...without, { id: crypto.randomUUID(), name, text, addedAt: Date.now() }];
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
  // The scanner/badge/generator switches used to live here too. They moved to
  // their own storage key in ./settings.ts (#347): the content script reads them
  // on every page and on every change, and shipping them alongside the resume
  // and every uploaded document's text made that far more expensive than it
  // needed to be. getSettings() still falls back to the copies left in existing
  // profile records, so nothing is lost on upgrade.
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
};

/**
 * Exported only so ./settings.ts can read the pre-split copies of the switches
 * that used to live in here — importing the key beats re-typing the string in a
 * second file and hoping the two never drift.
 */
export const PROFILE_STORAGE_KEY = 'profile';
const STORAGE_KEY = PROFILE_STORAGE_KEY;

/**
 * Deep-merges stored data over defaults so new fields always have a value.
 *
 * The blanket `...stored` spread also carries through the settings fields that
 * moved out in #347. That's deliberate: until the user touches a setting there
 * is no `settings` record yet, so those legacy copies are still what
 * getSettings() reads — dropping them here would silently reset the user's
 * choices on their first profile save after upgrading.
 */
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

/** How much of a piece of source text actually makes it into the AI context. */
export interface TextUsage {
  /** Characters actually included in the AI context. */
  usedChars: number;
  /** Trimmed length of the source text (before any budget is applied). */
  totalChars: number;
  /** The exact slice sent to the AI — may be '' when nothing fit. */
  usedText: string;
}

export interface DocumentUsage extends TextUsage {
  id: string;
}

export interface ContextUsage {
  resume: TextUsage;
  /** One entry per Profile.documents, same order. */
  documents: DocumentUsage[];
}

/**
 * Computes exactly how much of the resume and each document ends up in the AI
 * context, given the shared, order-dependent budget below. profileToContext
 * builds its output from this (not a second, parallel walk of the same
 * budget), and Options.tsx uses it to show the real per-document usage instead
 * of a fixed per-document cap, which either wastes budget (one document, way
 * under a flat ceiling, with the rest of the pool sitting unused) or degrades
 * unevenly (a fixed cap ignores how many documents are actually competing for
 * the same pool).
 */
export function computeContextUsage(p: Profile): ContextUsage {
  const resumeFull = p.resumeText.trim();
  const resumeUsedText = resumeFull.slice(0, RESUME_TEXT_BUDGET);
  const resume: TextUsage = {
    usedChars: resumeUsedText.length,
    totalChars: resumeFull.length,
    usedText: resumeUsedText,
  };

  // Remaining shared budget after the resume's priority slice, divided
  // dynamically among documents rather than a fixed per-document cap: each
  // document gets an equal claim on whatever's left among the documents not
  // yet processed (itself included), in list order. A document that needs
  // less than its share leaves the rest for documents after it — one
  // document alone gets the whole remaining pool, two documents split it,
  // and so on — but a document already given its share can't be shrunk by a
  // later one, so earlier documents keep some priority over later ones.
  let remaining = CONTEXT_TEXT_BUDGET - resume.usedChars;
  let docsLeft = p.documents.filter((d) => d.text.trim().length > 0).length;
  const documents: DocumentUsage[] = p.documents.map((doc) => {
    const text = doc.text.trim();
    if (!text) {
      return { id: doc.id, usedChars: 0, totalChars: 0, usedText: '' };
    }
    const fairShare = Math.floor(remaining / docsLeft);
    const usedText = text.slice(0, fairShare);
    remaining -= usedText.length;
    docsLeft -= 1;
    return { id: doc.id, usedChars: usedText.length, totalChars: text.length, usedText };
  });

  return { resume, documents };
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

  const usage = computeContextUsage(p);
  if (usage.resume.usedChars > 0) {
    lines.push('\nResume:\n' + usage.resume.usedText);
  }

  p.documents.forEach((doc, i) => {
    const u = usage.documents[i];
    if (u.usedChars > 0) {
      lines.push(`\nDocument "${doc.name}":\n${u.usedText}`);
    }
  });

  return lines.join('\n');
}
