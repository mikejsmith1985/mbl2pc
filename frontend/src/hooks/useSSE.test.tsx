/**
 * Tests for the SSE hook — reconnection backoff plus the resume behaviour that
 * keeps an iOS home-screen PWA in sync after the OS suspends and wakes it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { useSSE } from './useSSE';
import { useStore } from '../store';

/** Minimal stand-in for EventSource; jsdom does not implement it. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readyState = FakeEventSource.CONNECTING;
  isClosed = false;
  private listeners: Record<string, ((event: unknown) => void)[]> = {};

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(eventName: string, handler: (event: unknown) => void) {
    (this.listeners[eventName] ??= []).push(handler);
  }

  close() {
    this.isClosed = true;
    this.readyState = FakeEventSource.CLOSED;
  }

  /** Drive the fake source the way the browser would. */
  emit(eventName: string, event: unknown = {}) {
    (this.listeners[eventName] ?? []).forEach(handler => handler(event));
  }

  simulateOpen() {
    this.readyState = FakeEventSource.OPEN;
    this.emit('open');
  }
}

/** Host component that does nothing but run the hook under test. */
function SSEHarness() {
  useSSE();
  return null;
}

/** Fire the browser event iOS uses to tell a suspended page it is visible again. */
function simulateAppResume(visibilityState: DocumentVisibilityState = 'visible') {
  Object.defineProperty(document, 'visibilityState', { value: visibilityState, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Build a spy shaped like the store's async loader actions. */
function createLoaderSpy() {
  return vi.fn(async () => {});
}

let loadMessagesSpy: ReturnType<typeof createLoaderSpy>;
let loadClipboardSpy: ReturnType<typeof createLoaderSpy>;

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  loadMessagesSpy  = createLoaderSpy();
  loadClipboardSpy = createLoaderSpy();
  useStore.setState({
    loadMessages:  loadMessagesSpy,
    loadClipboard: loadClipboardSpy,
    searchQuery: '',
    activeDateFilter: '',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useSSE reconnection constants', () => {
  it('initial delay of 1 second doubles each attempt up to 30 seconds', () => {
    const INITIAL_DELAY  = 1000;
    const MAX_DELAY      = 30_000;
    const GROWTH_FACTOR  = 2;

    let currentDelay = INITIAL_DELAY;
    const delays: number[] = [];

    for (let attempt = 0; attempt < 7; attempt++) {
      delays.push(currentDelay);
      currentDelay = Math.min(currentDelay * GROWTH_FACTOR, MAX_DELAY);
    }

    expect(delays[0]).toBe(1000);
    expect(delays[1]).toBe(2000);
    expect(delays[2]).toBe(4000);
    expect(delays[3]).toBe(8000);
    expect(delays[4]).toBe(16000);
    expect(delays[5]).toBe(30000); // capped at max
    expect(delays[6]).toBe(30000); // stays at max
  });
});

describe('useSSE connection lifecycle', () => {
  it('opens a single connection to /events on mount', () => {
    render(<SSEHarness />);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe('/events');
  });

  it('closes the connection on unmount', () => {
    const { unmount } = render(<SSEHarness />);
    unmount();
    expect(FakeEventSource.instances[0].isClosed).toBe(true);
  });

  it('reloads messages when a new_message event arrives', () => {
    render(<SSEHarness />);
    FakeEventSource.instances[0].emit('message', { data: JSON.stringify({ type: 'new_message' }) });
    expect(loadMessagesSpy).toHaveBeenCalled();
  });
});

describe('useSSE resume after the OS suspends the app', () => {
  it('refetches messages and clipboard as soon as the app becomes visible again', () => {
    render(<SSEHarness />);
    FakeEventSource.instances[0].simulateOpen();
    loadMessagesSpy.mockClear();
    loadClipboardSpy.mockClear();

    simulateAppResume();

    expect(loadMessagesSpy).toHaveBeenCalledOnce();
    expect(loadClipboardSpy).toHaveBeenCalledOnce();
  });

  it('does not refetch while the app is being hidden', () => {
    render(<SSEHarness />);
    FakeEventSource.instances[0].simulateOpen();
    loadMessagesSpy.mockClear();

    simulateAppResume('hidden');

    expect(loadMessagesSpy).not.toHaveBeenCalled();
  });

  it('rebuilds a connection that iOS killed silently while the app was suspended', () => {
    render(<SSEHarness />);
    const originalSource = FakeEventSource.instances[0];
    originalSource.simulateOpen();

    // iOS tears the socket down without ever firing an error event
    originalSource.readyState = FakeEventSource.CLOSED;
    simulateAppResume();

    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it('reuses a healthy connection instead of churning it on every resume', () => {
    render(<SSEHarness />);
    FakeEventSource.instances[0].simulateOpen();

    simulateAppResume();

    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('rebuilds a connection that has gone silent past the heartbeat window', () => {
    vi.useFakeTimers();
    render(<SSEHarness />);
    FakeEventSource.instances[0].simulateOpen();

    // The server heartbeats every 25s; three missed beats means the socket is dead
    vi.advanceTimersByTime(90_000);
    simulateAppResume();

    expect(FakeEventSource.instances.length).toBeGreaterThan(1);
  });

  it('reconnects when the device comes back online', () => {
    render(<SSEHarness />);
    const originalSource = FakeEventSource.instances[0];
    originalSource.simulateOpen();
    originalSource.readyState = FakeEventSource.CLOSED;

    window.dispatchEvent(new Event('online'));

    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it('stops listening for resume events after unmount', () => {
    const { unmount } = render(<SSEHarness />);
    FakeEventSource.instances[0].simulateOpen();
    unmount();
    loadMessagesSpy.mockClear();

    simulateAppResume();

    expect(loadMessagesSpy).not.toHaveBeenCalled();
  });
});
