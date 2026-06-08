/** Collapsible panel for managing and inserting saved text snippets. */

import { useState } from 'react';
import { useStore } from '../store';
import { copyTextToClipboard } from '../utils';

interface SnippetsPanelProps {
  /** Called when a snippet is clicked so the parent can insert it into the input bar. */
  onInsert: (content: string) => void;
}

export function SnippetsPanel({ onInsert }: SnippetsPanelProps) {
  const snippets      = useStore(state => state.snippets);
  const addSnippet    = useStore(state => state.addSnippet);
  const removeSnippet = useStore(state => state.removeSnippet);
  const showToast     = useStore(state => state.showToast);

  const [isCollapsed,    setIsCollapsed]    = useState(false);
  const [isAddingNew,    setIsAddingNew]    = useState(false);
  const [newSnippetName, setNewSnippetName] = useState('');
  const [newSnippetBody, setNewSnippetBody] = useState('');

  async function handleSaveNew() {
    if (!newSnippetName.trim() || !newSnippetBody.trim()) return;
    try {
      await addSnippet(newSnippetName.trim(), newSnippetBody.trim());
      setNewSnippetName('');
      setNewSnippetBody('');
      setIsAddingNew(false);
    } catch {
      showToast('Failed to save snippet', 'error');
    }
  }

  async function handleCopy(content: string) {
    await copyTextToClipboard(content);
    showToast('Copied!');
  }

  return (
    <div className={`snippets-panel ${isCollapsed ? 'collapsed' : ''}`} role="region" aria-label="Text snippets">
      <div
        className="snip-header"
        onClick={() => { setIsCollapsed(prev => !prev); setIsAddingNew(false); }}
        role="button"
        tabIndex={0}
        aria-expanded={!isCollapsed}
        onKeyDown={e => e.key === 'Enter' && setIsCollapsed(prev => !prev)}
      >
        <span>⚡ Snippets {snippets.length > 0 && `(${snippets.length})`}</span>
        <button
          className="snip-add-btn"
          onClick={e => { e.stopPropagation(); setIsCollapsed(false); setIsAddingNew(prev => !prev); }}
          aria-label="Add snippet"
          title="Add snippet"
        >
          +
        </button>
      </div>

      {!isCollapsed && (
        <>
          {isAddingNew && (
            <div className="add-snippet-form">
              <input
                placeholder="Name (e.g. 'API call')"
                value={newSnippetName}
                onChange={e => setNewSnippetName(e.target.value)}
                aria-label="Snippet name"
              />
              <textarea
                placeholder="Snippet content…"
                value={newSnippetBody}
                onChange={e => setNewSnippetBody(e.target.value)}
                aria-label="Snippet content"
              />
              <div className="snip-form-row">
                <button className="save-snippet-btn" onClick={handleSaveNew}>Save</button>
                <button className="cancel-snippet-btn" onClick={() => setIsAddingNew(false)}>Cancel</button>
              </div>
            </div>
          )}

          {snippets.length > 0 ? (
            <div className="snippets-list">
              {snippets.map(snippet => (
                <div key={snippet.id} className="snip-item">
                  <span className="snip-name" title={snippet.name}>{snippet.name}</span>
                  <span className="snip-content">{snippet.content}</span>
                  <button
                    className="snip-copy"
                    onClick={() => onInsert(snippet.content)}
                    title="Insert into message"
                    aria-label={`Insert snippet: ${snippet.name}`}
                  >
                    ↑
                  </button>
                  <button
                    className="snip-copy"
                    onClick={() => handleCopy(snippet.content)}
                    title="Copy to clipboard"
                    aria-label={`Copy snippet: ${snippet.name}`}
                  >
                    📋
                  </button>
                  <button
                    className="snip-del"
                    onClick={() => removeSnippet(snippet.id)}
                    title="Delete snippet"
                    aria-label={`Delete snippet: ${snippet.name}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ) : (
            !isAddingNew && (
              <div style={{ padding: '.3rem .75rem .5rem', fontSize: '.78rem', color: 'var(--meta)', fontStyle: 'italic' }}>
                No snippets yet — tap + to add one
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
