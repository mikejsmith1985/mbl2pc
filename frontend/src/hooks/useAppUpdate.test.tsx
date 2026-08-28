/**
 * Tests for the update-on-resume hook — the mechanism that removes the need to
 * force-quit an iOS home-screen app before a new deploy is picked up.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { useAppUpdate } from './useAppUpdate';
import * as api from '../api';

function AppUpdateHarness() {
  useAppUpdate();
  return null;
}

/** Fire the browser event iOS uses to tell a suspended page it is visible again. */
function simulateAppResume(visibilityState: DocumentVisibilityState = 'visible') {
  Object.defineProperty(document, 'visibilityState', { value: visibilityState, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

let reloadSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  reloadSpy = vi.fn();
  vi.spyOn(window, 'location', 'get').mockReturnValue({
    ...window.location,
    reload: reloadSpy,
  } as unknown as Location);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useAppUpdate', () => {
  it('reloads the page when the server is running a newer build', async () => {
    const versionSpy = vi.spyOn(api, 'fetchVersion')
      .mockResolvedValueOnce('aaaaaaa')  // build loaded in this tab
      .mockResolvedValueOnce('bbbbbbb'); // build the server now serves

    render(<AppUpdateHarness />);
    await vi.waitFor(() => expect(versionSpy).toHaveBeenCalledOnce());

    simulateAppResume();

    await vi.waitFor(() => expect(reloadSpy).toHaveBeenCalledOnce());
  });

  it('does not reload when the server build is unchanged', async () => {
    const versionSpy = vi.spyOn(api, 'fetchVersion').mockResolvedValue('aaaaaaa');

    render(<AppUpdateHarness />);
    await vi.waitFor(() => expect(versionSpy).toHaveBeenCalledOnce());

    simulateAppResume();

    await vi.waitFor(() => expect(versionSpy).toHaveBeenCalledTimes(2));
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('never reloads on an unknown version, so a blip cannot cause a reload loop', async () => {
    vi.spyOn(api, 'fetchVersion')
      .mockResolvedValueOnce('aaaaaaa')
      .mockResolvedValueOnce('unknown');

    render(<AppUpdateHarness />);
    simulateAppResume();

    await new Promise(resolve => setTimeout(resolve, 10));
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('does not check for updates while the app is being hidden', async () => {
    const versionSpy = vi.spyOn(api, 'fetchVersion').mockResolvedValue('aaaaaaa');

    render(<AppUpdateHarness />);
    await vi.waitFor(() => expect(versionSpy).toHaveBeenCalledOnce());

    simulateAppResume('hidden');

    expect(versionSpy).toHaveBeenCalledOnce();
  });

  it('stops checking after unmount', async () => {
    const versionSpy = vi.spyOn(api, 'fetchVersion').mockResolvedValue('aaaaaaa');

    const { unmount } = render(<AppUpdateHarness />);
    await vi.waitFor(() => expect(versionSpy).toHaveBeenCalledOnce());
    unmount();

    simulateAppResume();

    expect(versionSpy).toHaveBeenCalledOnce();
  });
});
