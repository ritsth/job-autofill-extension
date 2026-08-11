// Saved job postings + chrome.storage.local persistence. Kept separate from the
// profile because this list grows and is transient: when an application moves you
// off the posting (a later Workday step, a new tab, a different domain), the
// "active" saved job becomes the tailoring context for AI answers + cover letter
// + resume so they don't quietly lose the role.

const STORAGE_KEY = 'savedJobs';
/** The saved-jobs list is capped here; adding past it drops the oldest. */
export const MAX_JOBS = 20;
/** Captured posting text is capped at this many characters before storage. */
export const MAX_TEXT = 12_000;

/** True when `text` is longer than the cap and would be trimmed on save. */
export function isJobTextTruncated(text: string): boolean {
  return text.length > MAX_TEXT;
}

export interface SavedJob {
  id: string;
  company: string;
  role: string;
  url: string;
  /** Captured job-posting text, used as the AI tailoring context. */
  text: string;
  savedAt: number;
}

export interface SavedJobsState {
  jobs: SavedJob[];
  /** The job whose context AI tailoring uses; null = use the live page. */
  activeId: string | null;
}

const EMPTY: SavedJobsState = { jobs: [], activeId: null };

function withDefaults(stored: Partial<SavedJobsState> | undefined): SavedJobsState {
  if (!stored) return structuredClone(EMPTY);
  return { jobs: stored.jobs ?? [], activeId: stored.activeId ?? null };
}

export async function getSavedJobs(): Promise<SavedJobsState> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  // @types/chrome now types storage values as `unknown`; we control this key's
  // shape and withDefaults guards missing/partial data, so the assertion is safe.
  return withDefaults(result[STORAGE_KEY] as Partial<SavedJobsState> | undefined);
}

async function setSavedJobs(state: SavedJobsState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

/** The active saved job, or null when none is selected. */
export async function getActiveJob(): Promise<SavedJob | null> {
  const { jobs, activeId } = await getSavedJobs();
  return jobs.find((j) => j.id === activeId) ?? null;
}

export interface AddJobResult extends SavedJobsState {
  /**
   * Jobs pushed off the end by the MAX_JOBS cap. Reported so the UI can say the
   * oldest save was dropped instead of letting it vanish silently.
   */
  evicted: SavedJob[];
}

/** Adds or refreshes a captured job (newest first), makes it active, and returns the state. */
export async function addJob(
  partial: Omit<SavedJob, 'id' | 'savedAt'>,
): Promise<AddJobResult> {
  const state = await getSavedJobs();
  const existing = state.jobs.find((saved) => saved.url === partial.url);
  let job: SavedJob;
  let all: SavedJob[];
  if (existing) {
    job = {
      ...existing,
      ...partial,
      id: existing.id,
      // Re-saving from a later application step can capture form boilerplate.
      // Keep the known-good posting text instead of silently degrading it.
      text: existing.text,
      savedAt: Date.now(),
    };
    // Also heal duplicates created by releases that always minted a new id.
    all = [job, ...state.jobs.filter((saved) => saved.url !== partial.url)];
  } else {
    if (isJobTextTruncated(partial.text)) {
      console.warn(
        `[Little AI Helper] Saved posting trimmed from ${partial.text.length} to ${MAX_TEXT} chars for AI context.`,
      );
    }
    job = {
      ...partial,
      text: partial.text.slice(0, MAX_TEXT),
      id: crypto.randomUUID(),
      savedAt: Date.now(),
    };
    all = [job, ...state.jobs];
  }
  const next: SavedJobsState = {
    jobs: all.slice(0, MAX_JOBS),
    activeId: job.id,
  };
  await setSavedJobs(next);
  // Computed here rather than by comparing counts in the caller, whose copy of
  // the list can lag behind storage.
  return { ...next, evicted: all.slice(MAX_JOBS) };
}

export async function setActiveJob(id: string | null): Promise<void> {
  const state = await getSavedJobs();
  await setSavedJobs({ ...state, activeId: id });
}

export async function deleteJob(id: string): Promise<void> {
  const state = await getSavedJobs();
  await setSavedJobs({
    jobs: state.jobs.filter((j) => j.id !== id),
    activeId: state.activeId === id ? null : state.activeId,
  });
}

/** Subscribe to saved-job changes (keeps the side panel in sync). */
export function onSavedJobsChanged(cb: (state: SavedJobsState) => void): () => void {
  const listener = (
    changes: { [key: string]: chrome.storage.StorageChange },
    area: string,
  ) => {
    if (area === 'local' && changes[STORAGE_KEY]) {
      cb(withDefaults(changes[STORAGE_KEY].newValue as Partial<SavedJobsState> | undefined));
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
