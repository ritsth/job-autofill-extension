import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScannerWatchController } from './scannerWatch';

class TestMutationObserver {
  static instances: TestMutationObserver[] = [];
  readonly disconnect = vi.fn();
  readonly observe = vi.fn();

  constructor(readonly callback: MutationCallback) {
    TestMutationObserver.instances.push(this);
  }
}

class TestIFrame {}

describe('scanner watcher lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    TestMutationObserver.instances = [];
    vi.stubGlobal('MutationObserver', TestMutationObserver);
    vi.stubGlobal('HTMLIFrameElement', TestIFrame);
    vi.stubGlobal('document', {
      body: {},
      hidden: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      clearInterval,
      clearTimeout,
      setInterval,
      setTimeout,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('owns one observer, interval, startup scans, and listener set', () => {
    const scan = vi.fn();
    const tick = vi.fn();
    const controller = createScannerWatchController({ scan, tick });

    controller.start();
    controller.start();

    expect(controller.active).toBe(true);
    expect(scan).toHaveBeenCalledOnce();
    expect(TestMutationObserver.instances).toHaveLength(1);
    expect(TestMutationObserver.instances[0].observe).toHaveBeenCalledWith(
      document.body,
      { childList: true, subtree: true },
    );
    expect(document.addEventListener).toHaveBeenCalledOnce();
    expect(window.addEventListener).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(1800);
    expect(scan).toHaveBeenCalledTimes(3);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('cancels every queued and long-lived resource on stop', () => {
    const scan = vi.fn();
    const tick = vi.fn();
    const controller = createScannerWatchController({ scan, tick });

    controller.start();
    TestMutationObserver.instances[0].callback([], TestMutationObserver.instances[0] as never);
    controller.stop();

    expect(controller.active).toBe(false);
    expect(TestMutationObserver.instances[0].disconnect).toHaveBeenCalledOnce();
    expect(document.removeEventListener).toHaveBeenCalledOnce();
    expect(window.removeEventListener).toHaveBeenCalledOnce();

    vi.runOnlyPendingTimers();
    expect(scan).toHaveBeenCalledOnce();
    expect(tick).not.toHaveBeenCalled();
  });

  it('re-arms cleanly after being disabled', () => {
    const scan = vi.fn();
    const tick = vi.fn();
    const controller = createScannerWatchController({ scan, tick });

    controller.start();
    controller.stop();
    controller.start();

    expect(controller.active).toBe(true);
    expect(scan).toHaveBeenCalledTimes(2);
    expect(TestMutationObserver.instances).toHaveLength(2);
    expect(TestMutationObserver.instances[1].observe).toHaveBeenCalledOnce();
    expect(document.addEventListener).toHaveBeenCalledTimes(2);
    expect(window.addEventListener).toHaveBeenCalledTimes(2);
  });

  it('does not deliver a pending debounce from before a restart', () => {
    const tick = vi.fn();
    const controller = createScannerWatchController({
      scan: vi.fn(),
      tick,
      debounceMs: 100,
      intervalMs: 10_000,
      startupDelaysMs: [],
    });

    controller.start();
    const observer = TestMutationObserver.instances[0];
    observer.callback([], observer as never);
    controller.stop();
    controller.start();
    vi.advanceTimersByTime(100);

    expect(tick).not.toHaveBeenCalled();
  });

  it('remains restartable when the initial scan throws', () => {
    const scan = vi.fn().mockImplementationOnce(() => {
      throw new Error('scan failed');
    });
    const controller = createScannerWatchController({ scan, tick: vi.fn() });

    expect(() => controller.start()).toThrow('scan failed');
    expect(controller.active).toBe(false);

    controller.start();
    expect(controller.active).toBe(true);
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it('debounces DOM and iframe changes but ignores other load events', () => {
    const tick = vi.fn();
    const controller = createScannerWatchController({
      scan: vi.fn(),
      tick,
      intervalMs: 10_000,
    });
    controller.start();

    const observer = TestMutationObserver.instances[0];
    observer.callback([], observer as never);
    observer.callback([], observer as never);
    vi.advanceTimersByTime(599);
    expect(tick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(tick).toHaveBeenCalledOnce();

    const loadHandler = vi.mocked(window.addEventListener).mock.calls.find(
      ([name]) => name === 'load',
    )?.[1] as EventListener;
    loadHandler({ target: {} } as Event);
    vi.advanceTimersByTime(600);
    expect(tick).toHaveBeenCalledOnce();
    loadHandler({ target: new TestIFrame() } as unknown as Event);
    vi.advanceTimersByTime(600);
    expect(tick).toHaveBeenCalledTimes(2);
  });
});

describe('sponsorship scanner settings', () => {
  let sponsorship: typeof import('./sponsorship');

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.stubGlobal('location', { href: 'https://example.test/', hostname: 'example.test' });
    vi.stubGlobal('document', {
      body: null,
      hidden: false,
      querySelector: vi.fn(() => null),
      querySelectorAll: vi.fn(() => []),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      clearInterval,
      clearTimeout,
      setInterval,
      setTimeout,
    });
    sponsorship = await import('./sponsorship');
  });

  afterEach(() => {
    sponsorship.setScannerEnabled(false);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps a disabled scanner idle when content initialization starts the watch', () => {
    sponsorship.setScannerEnabled(false);
    sponsorship.startSponsorshipWatch();

    expect(vi.getTimerCount()).toBe(0);
    expect(document.addEventListener).not.toHaveBeenCalled();
    expect(window.addEventListener).not.toHaveBeenCalled();
  });

  it('releases polling and startup timers when the setting is switched off', () => {
    sponsorship.startSponsorshipWatch();
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    sponsorship.setScannerEnabled(false);

    expect(vi.getTimerCount()).toBe(0);
    expect(document.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(window.removeEventListener).toHaveBeenCalledWith('load', expect.any(Function), true);
  });

  it('re-enables one watcher after being stopped, without accumulating timers', () => {
    sponsorship.startSponsorshipWatch();
    const runningTimers = vi.getTimerCount();
    sponsorship.setScannerEnabled(false);
    expect(vi.getTimerCount()).toBe(0);

    sponsorship.setScannerEnabled(true);
    sponsorship.startSponsorshipWatch();
    sponsorship.setScannerEnabled(true);

    expect(vi.getTimerCount()).toBe(runningTimers);
    sponsorship.setScannerEnabled(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
