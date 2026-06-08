/** Collapsible panel for syncing clipboard content between devices. */

import { useState } from 'react';
import { useStore } from '../store';
import { copyTextToClipboard } from '../utils';

export function ClipboardPanel() {
  const clipboardEntry = useStore(state => state.clipboardEntry);
  const syncClipboard  = useStore(state => state.syncClipboard);
  const showToast      = useStore(state => state.showToast);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const hasContent = !!clipboardEntry.content;

  async function handleCopyToClipboard() {
    if (!clipboardEntry.content) return;
    await copyTextToClipboard(clipboardEntry.content);
    showToast('Copied to clipboard!');
  }

  async function handleSyncFromClipboard() {
    try {
      const clipboardText = await navigator.clipboard.readText();
      if (clipboardText) {
        await syncClipboard(clipboardText);
      } else {
        showToast('Clipboard is empty', 'error');
      }
    } catch {
      showToast('Clipboard access denied', 'error');
    }
  }

  return (
    <div className={`clipboard-panel ${isCollapsed ? 'collapsed' : ''}`} role="region" aria-label="Clipboard sync">
      <div
        className="clip-header"
        onClick={() => setIsCollapsed(prev => !prev)}
        role="button"
        tabIndex={0}
        aria-expanded={!isCollapsed}
        onKeyDown={e => e.key === 'Enter' && setIsCollapsed(prev => !prev)}
      >
        <span className="clip-title">
          📋 Clipboard
          {hasContent && <span style={{ fontWeight: 400, fontSize: '.75rem', marginLeft: '.3rem', opacity: .7 }}>
            {clipboardEntry.content.length > 40
              ? clipboardEntry.content.slice(0, 40) + '…'
              : clipboardEntry.content}
          </span>}
        </span>
        <span className="clip-arrow">▼</span>
      </div>

      {!isCollapsed && (
        <div className="clip-body">
          {hasContent ? (
            <>
              <div className="clip-content">{clipboardEntry.content}</div>
              {clipboardEntry.updated_at && (
                <div className="clip-timestamp">
                  Synced {new Date(clipboardEntry.updated_at).toLocaleTimeString()}
                </div>
              )}
            </>
          ) : (
            <div className="clip-content" style={{ color: 'var(--meta)', fontStyle: 'italic' }}>
              No clipboard content yet
            </div>
          )}

          <div className="clip-btns">
            {hasContent && (
              <button className="clip-btn clip-btn-copy" onClick={handleCopyToClipboard}>
                Copy to clipboard
              </button>
            )}
            <button className="clip-btn clip-btn-copy" onClick={handleSyncFromClipboard}>
              Sync from this device
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
