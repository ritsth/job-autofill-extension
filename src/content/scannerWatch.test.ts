import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScannerWatch } from './scannerWatch';

// #354: turning the scanner off must release the observer, every timer and both
// listeners — not just hide the badge. Vitest runs in `node` here, so the few
// DOM pieces the controller touches are stand-ins that record what was armed
// and released.

class FakeObserver {
  static instances: FakeObserver[] = [];
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(public callback: () => void) {
    FakeObserver.instances.push(this);
  }
}
class FakeIframe {}

function stubDom(opts: { body?: unknown; hidden?: boolean } = {}) {
  FakeObserver.instances = [];
  const doc = {
    body: 'body' in opts ? opts.body : {},
    hidden: opts.hidden ?? false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const win = {
    // Captured AFTER vi.useFakeTimers(), so these are the fake timer functions.
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  vi.stubGlobal('MutationObserver', FakeObserver);
  vi.stubGlobal('HTMLIFrameElement', FakeIframe);
  return { doc, win };
}

function makeWatch(over: Partial<Parameters<typeof createScannerWatch>[0]> = {}) {
  const scan = vi.fn();
  const tick = vi.fn();
  const markDirty = vi.fn();
  const watch = createScannerWatch({ scan, tick, markDirty, ...over });
  return { watch, scan, tick, markDirty };
}

/** The handler registered for `event` on a recorded add/removeEventListener. */
const handlerFor = (fn: ReturnType<typeof vi.fn>, event: string) =>
  fn.mock.calls.find(([name]) => name === event)?.[1];

describe('createScannerWatch', () => {
  let dom: ReturnType<typeof stubDom>;

  beforeEach(() => {
    vi.useFakeTimers();
    dom = stubDom();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('arms one observer, one interval, two startup scans and both listeners', () => {
    const { watch, scan } = makeWatch();
    watch.start();

    expect(watch.active).toBe(true);
    expect(scan).toHaveBeenCalledTimes(1); // the immediate read
    expect(FakeObserver.instances).toHaveLength(1);
    expect(FakeObserver.instances[0].observe).toHaveBeenCalledWith(dom.doc.body, {
      childList: true,
      subtree: true,
    });
    expect(dom.doc.addEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(dom.win.addEventListener).toHaveBeenCalledWith('load', expect.any(Function), true);
    // interval + two startup timeouts
    expect(vi.getTimerCount()).toBe(3);

    vi.advanceTimersByTime(1800);
    expect(scan).toHaveBeenCalledTimes(3); // + the 800 ms and 1800 ms re-reads
  });

  it('is idempotent: starting twice arms and scans once', () => {
    const { watch, scan } = makeWatch();
    watch.start();
    watch.start();

    expect(scan).toHaveBeenCalledTimes(1);
    expect(FakeObserver.instances).toHaveLength(1);
    expect(dom.doc.addEventListener).toHaveBeenCalledTimes(1);
    expect(dom.win.addEventListener).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(3);
  });

  it('releases the observer, every timer and both listeners on stop', () => {
    const { watch } = makeWatch();
    watch.start();
    watch.stop();

    expect(watch.active).toBe(false);
    expect(FakeObserver.instances[0].disconnect).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    // The SAME handler references that were added, and the same capture flag.
    expect(dom.doc.removeEventListener).toHaveBeenCalledWith(
      'visibilitychange',
      handlerFor(dom.doc.addEventListener, 'visibilitychange'),
    );
    expect(dom.win.removeEventListener).toHaveBeenCalledWith(
      'load',
      handlerFor(dom.win.addEventListener, 'load'),
      true,
    );
  });

  it('does no further work after stop, however long it runs', () => {
    const { watch, scan, tick } = makeWatch();
    watch.start();
    watch.stop();
    scan.mockClear();

    vi.advanceTimersByTime(60_000);
    expect(scan).not.toHaveBeenCalled(); // the startup re-reads were cancelled
    expect(tick).not.toHaveBeenCalled(); // and so was the interval
  });

  it('drops a debounced tick that was already queued when stop arrived', () => {
    const { watch, tick } = makeWatch();
    watch.start();
    FakeObserver.instances[0].callback(); // a mutation: tick is now queued 600 ms out
    watch.stop();

    vi.advanceTimersByTime(5000);
    expect(tick).not.toHaveBeenCalled();
  });

  it('stop on a watch that never started is a no-op', () => {
    const { watch } = makeWatch();
    watch.stop();
    expect(watch.active).toBe(false);
    expect(dom.doc.removeEventListener).not.toHaveBeenCalled();
  });

  it('can be started again after a stop, with nothing left over from before', () => {
    const { watch, scan, tick } = makeWatch();
    watch.start();
    FakeObserver.instances[0].callback(); // queue a tick, then…
    watch.stop();
    watch.start(); // …restart inside the debounce window

    expect(scan).toHaveBeenCalledTimes(2);
    expect(FakeObserver.instances).toHaveLength(2);
    expect(FakeObserver.instances[1].observe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(3); // exactly one set, not two

    vi.advanceTimersByTime(600);
    expect(tick).not.toHaveBeenCalled(); // the old queued tick did not survive
  });

  it('stopping a restarted watch releases the second set too', () => {
    const { watch } = makeWatch();
    watch.start();
    watch.stop();
    watch.start();
    watch.stop();

    expect(FakeObserver.instances[0].disconnect).toHaveBeenCalledTimes(1);
    expect(FakeObserver.instances[1].disconnect).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  describe('while running', () => {
    it('marks dirty on each mutation and coalesces them into one tick', () => {
      const { watch, tick, markDirty } = makeWatch();
      watch.start();
      const mutate = FakeObserver.instances[0].callback;

      mutate();
      mutate();
      mutate();
      expect(markDirty).toHaveBeenCalledTimes(3);
      vi.advanceTimersByTime(599);
      expect(tick).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(tick).toHaveBeenCalledTimes(1);
    });

    it('polls tick on the interval', () => {
      const { watch, tick } = makeWatch();
      watch.start();
      vi.advanceTimersByTime(3600);
      expect(tick).toHaveBeenCalledTimes(3);
    });

    it('re-checks when the tab becomes visible, but not while it is hidden', () => {
      const { watch, tick } = makeWatch();
      watch.start();
      const onVisibility = handlerFor(dom.doc.addEventListener, 'visibilitychange');

      dom.doc.hidden = true;
      onVisibility();
      expect(tick).not.toHaveBeenCalled();
      dom.doc.hidden = false;
      onVisibility();
      expect(tick).toHaveBeenCalledTimes(1);
    });

    it('treats a finished iframe load as a content change, and ignores other loads', () => {
      // A long interval keeps the poll out of the count: only the debounce is
      // under test, and two 600 ms advances would otherwise cross a 1200 ms poll.
      const { watch, tick, markDirty } = makeWatch({ intervalMs: 100_000 });
      watch.start();
      const onLoad = handlerFor(dom.win.addEventListener, 'load');

      onLoad({ target: {} });
      vi.advanceTimersByTime(600);
      expect(markDirty).not.toHaveBeenCalled();
      expect(tick).not.toHaveBeenCalled();

      onLoad({ target: new FakeIframe() });
      expect(markDirty).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(600);
      expect(tick).toHaveBeenCalledTimes(1);
    });
  });

  describe('failure and edge cases', () => {
    it('arms nothing, and can retry, when the first scan throws', () => {
      const scan = vi.fn().mockImplementationOnce(() => {
        throw new Error('scan failed');
      });
      const { watch } = makeWatch({ scan });

      expect(() => watch.start()).toThrow('scan failed');
      expect(watch.active).toBe(false);
      expect(FakeObserver.instances).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);

      watch.start();
      expect(watch.active).toBe(true);
      expect(vi.getTimerCount()).toBe(3);
    });

    it('rolls back whatever it had armed if arming itself fails', () => {
      dom.doc.addEventListener.mockImplementationOnce(() => {
        throw new Error('listener failed');
      });
      const { watch } = makeWatch();

      expect(() => watch.start()).toThrow('listener failed');
      expect(watch.active).toBe(false);
      expect(FakeObserver.instances[0].disconnect).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('still arms the timers and listeners when there is no <body> yet', () => {
      dom = stubDom({ body: null });
      const { watch } = makeWatch();
      watch.start();

      expect(FakeObserver.instances).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(3);
      watch.stop();
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
