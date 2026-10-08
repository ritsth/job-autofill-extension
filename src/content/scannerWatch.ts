export interface ScannerWatchController {
  readonly active: boolean;
  start(): void;
  stop(): void;
}

interface ScannerWatchOptions {
  scan: () => void;
  tick: () => void;
  markDirty?: () => void;
  debounceMs?: number;
  intervalMs?: number;
  startupDelaysMs?: readonly number[];
}

/**
 * Owns every long-lived resource used by the eligibility scanner.
 *
 * Keeping this lifecycle in one place makes disabling the scanner a real stop:
 * no observer callbacks, polling interval, delayed startup scans, or global
 * event listeners survive until it is enabled again.
 */
export function createScannerWatchController({
  scan,
  tick,
  markDirty = () => {},
  debounceMs = 600,
  intervalMs = 1200,
  startupDelaysMs = [800, 1800],
}: ScannerWatchOptions): ScannerWatchController {
  let observer: MutationObserver | null = null;
  let debounceTimer = 0;
  let interval = 0;
  let startupTimers: number[] = [];
  let active = false;

  const scheduleTick = (): void => {
    markDirty();
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      debounceTimer = 0;
      tick();
    }, debounceMs);
  };

  const onVisibilityChange = (): void => {
    if (!document.hidden) tick();
  };

  const onLoad = (event: Event): void => {
    if (event.target instanceof HTMLIFrameElement) scheduleTick();
  };

  const clearResources = (): void => {
    observer?.disconnect();
    observer = null;
    window.clearTimeout(debounceTimer);
    debounceTimer = 0;
    startupTimers.forEach(timer => window.clearTimeout(timer));
    startupTimers = [];
    window.clearInterval(interval);
    interval = 0;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('load', onLoad, true);
  };

  return {
    get active() {
      return active;
    },

    start(): void {
      if (active) return;

      scan();
      active = true;
      try {
        startupTimers = startupDelaysMs.map(delay =>
          window.setTimeout(scan, delay),
        );

        if (document.body) {
          observer = new MutationObserver(scheduleTick);
          observer.observe(document.body, { childList: true, subtree: true });
        }

        interval = window.setInterval(tick, intervalMs);
        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('load', onLoad, true);
      } catch (error) {
        clearResources();
        active = false;
        throw error;
      }
    },

    stop(): void {
      if (!active) return;
      active = false;
      clearResources();
    },
  };
}
