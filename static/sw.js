// Minimal service worker — required for PWA installability and share target
const CACHE = 'mbl2pc-v5';

self.addEventListener('install', e => {
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    // Delete old caches so users immediately get fresh resources after deploy
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => clients.claim())
    );
});

// Cache static assets on fetch; always network-first for HTML and API calls
self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);

    // Never cache HTML — always fetch fresh so deploys take effect immediately
    if (e.request.destination === 'document' || url.pathname.endsWith('.html') || url.pathname === '/send') {
        e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
        return;
    }

    // Never intercept API calls
    if (['/send', '/messages', '/send-image', '/send-file', '/snippets',
         '/auth', '/login', '/logout', '/me', '/version', '/health', '/push', '/clipboard'].some(p => url.pathname.startsWith(p))) {
        return;
    }

    // Cache-first for static assets (icons, manifest, sw.js itself)
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

// ── Push notification handler ──────────────────────────────────────────────
self.addEventListener('push', e => {
    let data = { title: 'mbl2pc', body: 'New message', url: '/send.html' };
    try { data = Object.assign(data, e.data.json()); } catch(_) {}
    e.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: '/static/icon-192.png',
            badge: '/static/icon-192.png',
            data: { url: data.url },
            vibrate: [200, 100, 200],
            tag: 'mbl2pc-message',
            renotify: true,
        })
    );
});

self.addEventListener('notificationclick', e => {
    e.notification.close();
    const url = (e.notification.data && e.notification.data.url) || '/send.html';
    e.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
            for (const c of list) {
                if (c.url.includes('/send.html') && 'focus' in c) return c.focus();
            }
            return clients.openWindow(url);
        })
    );
});
