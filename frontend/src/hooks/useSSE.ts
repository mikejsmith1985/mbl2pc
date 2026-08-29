/**
 * SSE (Server-Sent Events) hook — maintains a persistent connection to /events
 * so the UI updates in real-time when messages or clipboard content change
 * on any of the user's devices.
 *
 * It also handles resume: when an OS suspends the app (an iOS home-screen PWA
 * being backgrounded is the common case) the connection is torn down without
 * an `error` event ever firing. Nothing would then reconnect, and the app would
 * look frozen until it was force-quit and relaunched. The resume listeners below
 * resync on wake and rebuild the connection whenever it is no longer alive.
 */

import { useEffect, useRef } from 'react';
import { useStore } from '../store';

const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS     = 30_000; // cap at 30 seconds
const DELAY_GROWTH_FACTOR        = 2;

// The server emits a heartbeat every 25 seconds. Three missed beats means the
// stream is dead even if the browser still reports the socket as open.
const CONNECTION_STALE_AFTER_MS = 80_000;

// While the app is in the foreground, poll for a silently-dead connection.
const HEALTH_CHECK_INTERVAL_MS = 30_000;

export function useSSE(): void {
  const loadMessages  = useStore(state => state.loadMessages);
  const loadClipboard = useStore(state => state.loadClipboard);

  // Keep the reconnect timer ref outside the connect closure so it can be
  // cancelled if the component unmounts before the next reconnect fires.
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let sseSource: EventSource | null = null;
    let reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
    let isMounted = true;
    // Timestamp of the last byte received from the server, used to spot a
    // connection that the browser still calls open but that no longer delivers.
    let lastServerContactAt = Date.now();

    /** Re-read every piece of server state the SSE stream would have pushed. */
    function resyncFromServer() {
      const { searchQuery, activeDateFilter } = useStore.getState();
      loadMessages({ query: searchQuery, date: activeDateFilter });
      loadClipboard();
    }

    function connect() {
      if (!isMounted) return;

      lastServerContactAt = Date.now();
      sseSource = new EventSource('/events');

      sseSource.addEventListener('message', (event) => {
        lastServerContactAt = Date.now();
        try {
          const data = JSON.parse(event.data) as { type: string };
          // Read current filter state directly from the store to avoid stale closures
          const { searchQuery, activeDateFilter } = useStore.getState();

          if (data.type === 'new_message') {
            loadMessages({ query: searchQuery, date: activeDateFilter });
          } else if (data.type === 'clipboard_update') {
            loadClipboard();
          }
          // 'heartbeat' needs no action — receiving it is the point
        } catch {
          // Ignore malformed SSE payloads — keepalive comments arrive as empty events
        }
      });

      sseSource.addEventListener('open', () => {
        // Successful connection — reset backoff so the next error starts fresh
        lastServerContactAt = Date.now();
        reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
      });

      sseSource.addEventListener('error', () => {
        sseSource?.close();
        if (!isMounted) return;
        // Exponential backoff up to MAX_RECONNECT_DELAY_MS
        reconnectTimerRef.current = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * DELAY_GROWTH_FACTOR, MAX_RECONNECT_DELAY_MS);
          connect();
        }, reconnectDelay);
      });
    }

    /** True when the stream is closed, absent, or has stopped delivering heartbeats. */
    function isConnectionDead(): boolean {
      if (!sseSource) return true;
      if (sseSource.readyState === EventSource.CLOSED) return true;
      return Date.now() - lastServerContactAt > CONNECTION_STALE_AFTER_MS;
    }

    /** Drop whatever connection exists and immediately build a fresh one. */
    function reconnectNow() {
      if (!isMounted) return;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      sseSource?.close();
      reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
      connect();
    }

    /**
     * Called when the app returns to the foreground or regains the network.
     * Always resyncs — a suspended app misses events even when the socket
     * survives — and rebuilds the connection only when it is actually dead.
     */
    function handleResume() {
      if (!isMounted) return;
      if (isConnectionDead()) reconnectNow();
      resyncFromServer();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') handleResume();
    }

    connect();

    // `visibilitychange` covers iOS/Android backgrounding; `pageshow` covers a
    // restore from the back-forward cache; `online` covers a dropped network.
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handleResume);
    window.addEventListener('online', handleResume);

    // Catches a connection that dies while the app is still on screen — timers
    // are frozen while the app is suspended, so this never fires in the background.
    const healthCheckTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && isConnectionDead()) reconnectNow();
    }, HEALTH_CHECK_INTERVAL_MS);

    return () => {
      isMounted = false;
      sseSource?.close();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      clearInterval(healthCheckTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handleResume);
      window.removeEventListener('online', handleResume);
    };
  }, []); // Empty dependency array — this runs once on mount and cleans up on unmount
}
