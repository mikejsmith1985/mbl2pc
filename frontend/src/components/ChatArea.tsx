/** Scrollable message list with date separators, load-more pagination, and auto-scroll to bottom. */

import { useRef, useEffect, useCallback } from 'react';
import { useStore } from '../store';
import { MessageBubble } from './MessageBubble';
import { extractDatePart, formatDayLabel } from '../utils';

const DEFAULT_PAGE_SIZE = 50;
const EXPANDED_PAGE_SIZE = 999;

export function ChatArea() {
  const messages         = useStore(state => state.messages);
  const isLoadingMessages = useStore(state => state.isLoadingMessages);
  const hasMore          = useStore(state => state.hasMore);
  const searchQuery      = useStore(state => state.searchQuery);
  const activeDateFilter = useStore(state => state.activeDateFilter);
  const loadMessages     = useStore(state => state.loadMessages);
  const setActiveDateFilter = useStore(state => state.setActiveDateFilter);

  const chatBottomRef = useRef<HTMLDivElement>(null);
  const containerRef  = useRef<HTMLDivElement>(null);

  // Scroll to the bottom whenever new messages arrive — but only if already near the bottom
  const scrollToBottom = useCallback(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200;
    if (isNearBottom) scrollToBottom();
  }, [messages.length, scrollToBottom]);

  // Initial scroll to bottom when first loaded
  useEffect(() => {
    if (!isLoadingMessages && messages.length > 0) {
      chatBottomRef.current?.scrollIntoView({ behavior: 'instant' });
    }
  }, [isLoadingMessages]);

  function handleLoadMore() {
    loadMessages({ query: searchQuery, date: activeDateFilter, last: EXPANDED_PAGE_SIZE });
  }

  function handleDateSeparatorClick(dateString: string) {
    const newFilter = activeDateFilter === dateString ? '' : dateString;
    setActiveDateFilter(newFilter);
    loadMessages({ query: searchQuery, date: newFilter });
  }

  if (isLoadingMessages) {
    return (
      <div className="chat-area" ref={containerRef}>
        <div className="spinner">
          <div className="spin" aria-hidden="true" />
          <span>Loading messages…</span>
        </div>
      </div>
    );
  }

  // Group messages by day so we can render date separators between them
  const messagesByDay = groupMessagesByDay(messages);

  return (
    <>
      {hasMore && (
        <button className="load-more-btn" onClick={handleLoadMore}>
          ↑ Load all messages
        </button>
      )}

      <div className="chat-area" ref={containerRef} role="log" aria-live="polite" aria-label="Messages">
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--meta)', fontSize: '.9rem', marginTop: '2rem' }}>
            No messages yet. Say hello! 👋
          </div>
        ) : (
          messagesByDay.map(({ dateString, messageIds }) => (
            <div key={dateString}>
              <div
                className={`date-sep ${activeDateFilter === dateString ? 'active-date' : ''}`}
                onClick={() => handleDateSeparatorClick(dateString)}
              >
                <span role="button" tabIndex={0} aria-label={`Filter by ${formatDayLabel(dateString)}`}>
                  {formatDayLabel(dateString)}
                </span>
              </div>
              {messageIds.map(id => (
                <MessageBubble key={id} messageId={id} />
              ))}
            </div>
          ))
        )}
        <div ref={chatBottomRef} />
      </div>
    </>
  );
}

// ── Helper: group message IDs by their calendar date ─────────────────────────

interface DayGroup {
  dateString: string;
  messageIds: string[];
}

function groupMessagesByDay(messages: { id: string; timestamp: string }[]): DayGroup[] {
  const groups: DayGroup[]         = [];
  const seenDates: Record<string, number> = {};

  for (const message of messages) {
    const dateString = extractDatePart(message.timestamp);
    if (seenDates[dateString] === undefined) {
      seenDates[dateString] = groups.length;
      groups.push({ dateString, messageIds: [] });
    }
    groups[seenDates[dateString]].messageIds.push(message.id);
  }

  return groups;
}
