// Minimal service worker — required for PWA installability and share target
const CACHE = 'mbl2pc-v1';

self.addEventListener('install', e => {
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(clients.claim());
});

// Cache static assets on fetch; always network-first for API calls
self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);
    // Don't cache API or auth routes
    if (['/send', '/messages', '/send-image', '/send-file', '/snippets',
         '/auth', '/login', '/logout', '/me', '/version', '/health'].some(p => url.pathname.startsWith(p))) {
        return; // let it fall through to network
    }
    e.respondWith(
        caches.open(CACHE).then(cache =>
            cache.match(e.request).then(cached => {
                const fresh = fetch(e.request).then(resp => {
                    if (resp.ok) cache.put(e.request, resp.clone());
                    return resp;
                }).catch(() => cached);
                return cached || fresh;
            })
        )
    );
});
