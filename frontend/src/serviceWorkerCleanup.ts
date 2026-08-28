/**
 * Removes the service worker the pre-React app used to register.
 *
 * The React app serves everything from the network, so a worker adds nothing —
 * but any worker a device registered under an older deploy stays in control
 * forever, serving whatever it cached at the time. That is a standing cause of
 * a phone showing a stale app, so the registration and its caches are cleared.
 */

// Every cache the old worker created was named "mbl2pc-v<n>".
const LEGACY_CACHE_NAME_PREFIX = 'mbl2pc-';

export async function removeLegacyServiceWorker(): Promise<void> {
  try {
    const registrations = await navigator.serviceWorker?.getRegistrations?.() ?? [];
    await Promise.all(registrations.map(registration => registration.unregister()));
  } catch {
    // Private browsing and some enterprise policies block this — nothing to do
  }

  try {
    const cacheNames = (await caches?.keys?.()) ?? [];
    const legacyCacheNames = cacheNames.filter(name => name.startsWith(LEGACY_CACHE_NAME_PREFIX));
    await Promise.all(legacyCacheNames.map(name => caches.delete(name)));
  } catch {
    // The Cache Storage API is unavailable or blocked — the unregister above is enough
  }
}
