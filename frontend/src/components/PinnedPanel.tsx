/** Collapsible panel showing starred (pinned) messages at the top of the chat. */

import { useState } from 'react';
import { useStore } from '../store';
import { copyTextToClipboard } from '../utils';

export function PinnedPanel() {
  const messages = useStore(state => state.messages);
  const showToast = useStore(state => state.showToast);
  const [isExpanded, setIsExpanded] = useState(true);

  const pinnedMessages = messages.filter(m => m.starred);

  if (pinnedMessages.length === 0) return null;

  async function handleCopy(text: string) {
    await copyTextToClipboard(text);
    showToast('Copied!');
  }

  return (
    <div className="pinned-panel" role="region" aria-label="Pinned messages">
      <div
        className="pinned-header"
        onClick={() => setIsExpanded(prev => !prev)}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onKeyDown={e => e.key === 'Enter' && setIsExpanded(prev => !prev)}
      >
        <span>⭐ {pinnedMessages.length} pinned</span>
        <span style={{ fontSize: '.75rem' }}>{isExpanded ? '▲' : '▼'}</span>
      </div>

      {isExpanded && (
        <div className="pinned-list">
          {pinnedMessages.map(message => (
            <div key={message.id} className="pinned-item">
              <span className="p-sender">{message.sender}</span>
              <span className="p-text">{message.text || (message.image_url ? '🖼️' : '📎')}</span>
              <button
                className="p-copy"
                onClick={() => handleCopy(message.text)}
                title="Copy text"
                aria-label="Copy pinned message"
              >
                📋
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
