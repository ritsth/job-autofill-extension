import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// #354, the wiring half: scannerWatch.test.ts proves the controller releases
// everything it armed; this proves sponsorship.ts actually calls it at the right
// moments — stop on disable, one start on enable, and no start at all when the
// scanner is already off at init (the global switch, or this host opted out).
//
// The real module, with `body: null` so a scan returns before it would render:
// the point here is what gets armed, not what the badge shows.

type Sponsorship = typeof import('./sponsorship');

function stubPage() {
  const doc = {
    body: null,
    hidden: false,
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const win = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('location', { href: 'https://example.test/job', hostname: 'example.test' });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  return { doc, win };
}

describe('scanner on/off wiring (#354)', () => {
  let page: ReturnType<typeof stubPage>;
  let s: Sponsorship;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules(); // the watch is module state; every test starts un-started
    page = stubPage();
    s = await import('./sponsorship');
  });
  afterEach(() => {
    s.setScannerEnabled(false); // never leave timers for the next test
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('starts nothing when the scanner is already off at init', () => {
    s.setScannerEnabled(false); // index.ts applies settings first…
    s.startSponsorshipWatch(); //  …then starts the watch

    expect(vi.getTimerCount()).toBe(0);
    expect(page.doc.addEventListener).not.toHaveBeenCalled();
    expect(page.win.addEventListener).not.toHaveBeenCalled();
  });

  it('starts the watch at init when the scanner is on', () => {
    s.setScannerEnabled(true);
    s.startSponsorshipWatch();

    // interval + the two startup re-reads, plus both listeners
    expect(vi.getTimerCount()).toBe(3);
    expect(page.doc.addEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(page.win.addEventListener).toHaveBeenCalledWith('load', expect.any(Function), true);
  });

  it('rescans (without re-arming) when switched on while already running', () => {
    s.setScannerEnabled(true);
    s.startSponsorshipWatch();
    page.doc.querySelector.mockClear();
    page.doc.querySelectorAll.mockClear();

    s.setScannerEnabled(true); // e.g. an unrelated setting changed in Options

    // A scan reads the page; re-arming would have shown up as extra timers.
    const reads = page.doc.querySelector.mock.calls.length + page.doc.querySelectorAll.mock.calls.length;
    expect(reads).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBe(3);
  });

  it('releases the timers and both listeners when the scanner is switched off', () => {
    s.setScannerEnabled(true);
    s.startSponsorshipWatch();
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    s.setScannerEnabled(false);

    expect(vi.getTimerCount()).toBe(0);
    expect(page.doc.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(page.win.removeEventListener).toHaveBeenCalledWith('load', expect.any(Function), true);
  });

  it('re-enabling arms one watch, however many settings changes arrive', () => {
    s.setScannerEnabled(true);
    s.startSponsorshipWatch();
    const armed = vi.getTimerCount();

    // applySettings runs on EVERY settings change, not only on a scanEnabled flip.
    s.setScannerEnabled(true);
    s.setScannerEnabled(true);
    s.startSponsorshipWatch();
    expect(vi.getTimerCount()).toBe(armed);
    expect(page.doc.addEventListener).toHaveBeenCalledTimes(1);

    s.setScannerEnabled(false);
    s.setScannerEnabled(false); // and repeated "off" is harmless
    expect(vi.getTimerCount()).toBe(0);

    s.setScannerEnabled(true);
    s.setScannerEnabled(true);
    expect(vi.getTimerCount()).toBe(armed);
    expect(page.doc.addEventListener).toHaveBeenCalledTimes(2); // one per enable, not per call
  });

  it('turning it on after init (the per-site opt-out undone) starts the watch', () => {
    s.setScannerEnabled(false);
    s.startSponsorshipWatch();
    expect(vi.getTimerCount()).toBe(0);

    s.setScannerEnabled(true); // a settings change arrives from another tab

    expect(vi.getTimerCount()).toBe(3);
  });
});
