/** Tests for removal of the legacy service worker that could pin devices to old builds. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { removeLegacyServiceWorker } from './serviceWorkerCleanup';

const unregisterSpy = vi.fn().mockResolvedValue(true);
const deleteCacheSpy = vi.fn().mockResolvedValue(true);

beforeEach(() => {
  unregisterSpy.mockClear();
  deleteCacheSpy.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('removeLegacyServiceWorker', () => {
  it('unregisters every service worker still controlling the origin', async () => {
    vi.stubGlobal('navigator', {
      serviceWorker: { getRegistrations: async () => [{ unregister: unregisterSpy }, { unregister: unregisterSpy }] },
    });
    vi.stubGlobal('caches', { keys: async () => [], delete: deleteCacheSpy });

    await removeLegacyServiceWorker();

    expect(unregisterSpy).toHaveBeenCalledTimes(2);
  });

  it('purges the caches the old worker left behind', async () => {
    vi.stubGlobal('navigator', {
      serviceWorker: { getRegistrations: async () => [] },
    });
    vi.stubGlobal('caches', { keys: async () => ['mbl2pc-v7', 'mbl2pc-v6'], delete: deleteCacheSpy });

    await removeLegacyServiceWorker();

    expect(deleteCacheSpy).toHaveBeenCalledTimes(2);
  });

  it('does nothing on a browser without service worker support', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('caches', undefined);

    await expect(removeLegacyServiceWorker()).resolves.toBeUndefined();
  });

  it('never throws when the browser rejects the request', async () => {
    vi.stubGlobal('navigator', {
      serviceWorker: { getRegistrations: async () => { throw new Error('blocked'); } },
    });
    vi.stubGlobal('caches', undefined);

    await expect(removeLegacyServiceWorker()).resolves.toBeUndefined();
  });
});
