/**
 * Owns every long-lived thing the eligibility scanner keeps running on a page,
 * so that turning the scanner off actually stops it (#354).
 *
 * `setScannerEnabled(false)` used to only hide the badge. The machinery behind
 * it kept going on every page in every tab, for the tab's lifetime: a
 * `subtree: true` MutationObserver on <body> (a callback per DOM mutation batch
 * on a chat app or live dashboard), its 600 ms debounce timer, the 1200 ms
 * polling interval, the two startup re-scans at 800 and 1800 ms, and the
 * `visibilitychange` and `load` listeners. Both off-switches — the global toggle
 * and "Turn off on this site only" — reach it through the same path, and the
 * per-site one is the sharper case: the user switched it off on a noisy site
 * precisely to stop the extension working there.
 *
 * Everything is armed in start() and released in stop(), from one place, so the
 * two can't drift apart the way a hand-written teardown beside the setup code
 * would. start() is idempotent, so enabling twice never doubles anything up.
 *
 * Takes its work as callbacks rather than importing the scanner, which keeps
 * this testable without the rest of the content script. The shape follows the
 * controller proposed in #389.
 */
export interface ScannerWatch {
  /** True between start() and stop(). */
  readonly active: boolean;
  /** Scans now, then arms the observer, timers and listeners. No-op if active. */
  start(): void;
  /** Releases everything start() armed. No-op if not active. */
  stop(): void;
}

export interface ScannerWatchOptions {
  /** A full, forced scan: the first read on start and the two startup re-reads. */
  scan: () => void;
  /** The guarded re-check run by the interval, the observer and the listeners. */
  tick: () => void;
  /** Called on every DOM mutation / iframe load, before the debounced tick. */
  markDirty: () => void;
  debounceMs?: number;
  intervalMs?: number;
  startupDelaysMs?: readonly number[];
}

export function createScannerWatch({
  scan,
  tick,
  markDirty,
  debounceMs = 600,
  intervalMs = 1200,
  startupDelaysMs = [800, 1800],
}: ScannerWatchOptions): ScannerWatch {
  let active = false;
  let observer: MutationObserver | null = null;
  let debounceTimer = 0;
  let intervalTimer = 0;
  let startupTimers: number[] = [];

  const scheduleTick = (): void => {
    markDirty();
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(tick, debounceMs);
  };

  // tick() skips hidden tabs; catch up the moment the tab is focused so a job
  // page opened in the background still gets its badge.
  const onVisibilityChange = (): void => {
    if (!document.hidden) tick();
  };

  // An iframe finishing to load is invisible to the top-document MutationObserver
  // (its content mutates inside its own document), but ATSes like iCIMS deliver
  // the posting exactly that way — the scan reads it via sameOriginFrameText(),
  // so a late-loading frame must count as a content change or the badge sticks
  // on the pre-frame verdict. `load` doesn't bubble, but capture-phase listeners
  // on window still see subresource loads.
  const onLoad = (e: Event): void => {
    if (e.target instanceof HTMLIFrameElement) scheduleTick();
  };

  // Named handlers above, not inline arrows: removeEventListener needs the very
  // reference that was added, and the capture flag must match.
  function release(): void {
    observer?.disconnect();
    observer = null;
    window.clearTimeout(debounceTimer);
    debounceTimer = 0;
    startupTimers.forEach((t) => window.clearTimeout(t));
    startupTimers = [];
    window.clearInterval(intervalTimer);
    intervalTimer = 0;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('load', onLoad, true);
  }

  return {
    get active() {
      return active;
    },

    start(): void {
      if (active) return;
      // The first read happens before anything is armed, as it always did: if it
      // throws, nothing is left half-armed and a later start() can retry.
      scan();
      active = true;
      try {
        startupTimers = startupDelaysMs.map((ms) => window.setTimeout(scan, ms));
        if (document.body) {
          observer = new MutationObserver(scheduleTick);
          observer.observe(document.body, { childList: true, subtree: true });
        }
        // Fallback for history changes that mutate little. tick() short-circuits
        // to a string compare unless a mutation or URL change happened, so this
        // stays cheap.
        intervalTimer = window.setInterval(tick, intervalMs);
        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('load', onLoad, true);
      } catch (e) {
        release();
        active = false;
        throw e;
      }
    },

    stop(): void {
      if (!active) return;
      active = false;
      release();
    },
  };
}
