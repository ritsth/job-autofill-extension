// Saved job postings + chrome.storage.local persistence. Kept separate from the
// profile because this list grows and is transient: when an application moves you
// off the posting (a later Workday step, a new tab, a different domain), the
// "active" saved job becomes the tailoring context for AI answers + cover letter
// + resume so they don't quietly lose the role.

const STORAGE_KEY = 'savedJobs';
const MAX_JOBS = 20;
const MAX_TEXT = 12_000;

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
  return withDefaults(result[STORAGE_KEY]);
}

async function setSavedJobs(state: SavedJobsState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

/** The active saved job, or null when none is selected. */
export async function getActiveJob(): Promise<SavedJob | null> {
  const { jobs, activeId } = await getSavedJobs();
  return jobs.find((j) => j.id === activeId) ?? null;
}

/** Adds a captured job (newest first), makes it active, and returns the new state. */
export async function addJob(
  partial: Omit<SavedJob, 'id' | 'savedAt'>,
): Promise<SavedJobsState> {
  const state = await getSavedJobs();
  const job: SavedJob = {
    ...partial,
    text: partial.text.slice(0, MAX_TEXT),
    id: crypto.randomUUID(),
    savedAt: Date.now(),
  };
  const next: SavedJobsState = {
    jobs: [job, ...state.jobs].slice(0, MAX_JOBS),
    activeId: job.id,
  };
  await setSavedJobs(next);
  return next;
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
      cb(withDefaults(changes[STORAGE_KEY].newValue));
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
