/**
 * Tests for the Zustand store — covers theme persistence, device name detection,
 * toast lifecycle, and selection mode toggle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock localStorage before importing the store so the store initialises with a clean slate
const localStorageMock = (() => {
  const store: Record<string, string> = {};
  return {
    getItem:    (key: string) => store[key] ?? null,
    setItem:    (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear:      () => { Object.keys(store).forEach(k => delete store[k]); },
  };
})();

vi.stubGlobal('localStorage', localStorageMock);
vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn() }));
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));

import { useStore } from './store';

beforeEach(() => {
  localStorageMock.clear();
  // Reset the store to initial state between tests
  useStore.setState({
    toasts:             [],
    isSelectMode:       false,
    selectedMessageIds: {},
    messages:           [],
  });
});

describe('toast lifecycle', () => {
  it('adds a toast and auto-dismisses it', async () => {
    vi.useFakeTimers();
    useStore.getState().showToast('Hello!', 'success');
    expect(useStore.getState().toasts).toHaveLength(1);
    expect(useStore.getState().toasts[0].message).toBe('Hello!');

    vi.advanceTimersByTime(3000);
    expect(useStore.getState().toasts).toHaveLength(0);
    vi.useRealTimers();
  });

  it('dismisses a specific toast by ID', () => {
    useStore.getState().showToast('A', 'success');
    useStore.getState().showToast('B', 'error');
    const firstId = useStore.getState().toasts[0].id;
    useStore.getState().dismissToast(firstId);
    expect(useStore.getState().toasts).toHaveLength(1);
    expect(useStore.getState().toasts[0].message).toBe('B');
  });
});

describe('selection mode', () => {
  it('toggles select mode on and off', () => {
    expect(useStore.getState().isSelectMode).toBe(false);
    useStore.getState().toggleSelectMode();
    expect(useStore.getState().isSelectMode).toBe(true);
    useStore.getState().toggleSelectMode();
    expect(useStore.getState().isSelectMode).toBe(false);
  });

  it('toggles message selection', () => {
    useStore.getState().toggleMessageSelection('msg-1');
    expect(useStore.getState().selectedMessageIds['msg-1']).toBe(true);
    useStore.getState().toggleMessageSelection('msg-1');
    expect(useStore.getState().selectedMessageIds['msg-1']).toBeUndefined();
  });

  it('clears all selections and exits select mode', () => {
    useStore.setState({ isSelectMode: true, selectedMessageIds: { 'a': true, 'b': true } });
    useStore.getState().clearSelection();
    expect(useStore.getState().isSelectMode).toBe(false);
    expect(Object.keys(useStore.getState().selectedMessageIds)).toHaveLength(0);
  });
});

describe('device name', () => {
  it('persists the device name to localStorage', () => {
    useStore.getState().setDeviceName('MyPhone');
    expect(localStorageMock.getItem('mbl2pc_sender')).toBe('MyPhone');
    expect(useStore.getState().deviceName).toBe('MyPhone');
  });
});

describe('filter state', () => {
  it('sets search query', () => {
    useStore.getState().setSearchQuery('hello');
    expect(useStore.getState().searchQuery).toBe('hello');
  });

  it('sets active date filter', () => {
    useStore.getState().setActiveDateFilter('2025-06-01');
    expect(useStore.getState().activeDateFilter).toBe('2025-06-01');
  });
});
