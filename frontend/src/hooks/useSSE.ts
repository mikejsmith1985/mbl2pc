/**
 * SSE (Server-Sent Events) hook — maintains a persistent connection to /events
 * so the UI updates in real-time when messages or clipboard content change
 * on any of the user's devices.
 */

import { useEffect, useRef } from 'react';
import { useStore } from '../store';

const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS     = 30_000; // cap at 30 seconds
const DELAY_GROWTH_FACTOR        = 2;

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

    function connect() {
      if (!isMounted) return;

      sseSource = new EventSource('/events');

      sseSource.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data) as { type: string };
          // Read current filter state directly from the store to avoid stale closures
          const { searchQuery, activeDateFilter } = useStore.getState();

          if (data.type === 'new_message') {
            loadMessages({ query: searchQuery, date: activeDateFilter });
          } else if (data.type === 'clipboard_update') {
            loadClipboard();
          }
        } catch {
          // Ignore malformed SSE payloads — keepalive comments arrive as empty events
        }
      });

      sseSource.addEventListener('open', () => {
        // Successful connection — reset backoff so the next error starts fresh
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

    connect();

    return () => {
      isMounted = false;
      sseSource?.close();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, []); // Empty dependency array — this runs once on mount and cleans up on unmount
}
