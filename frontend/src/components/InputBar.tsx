/** Message composition bar: text input, file attach, expiry, clipboard paste, and send. */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useStore } from '../store';
import { sendTextMessage, sendImageMessage, sendFileMessage } from '../api';
import { isImageFile, getFileIcon } from '../utils';
import { AttachIcon, SendIcon, ClockIcon } from './icons';
import { SnippetsPanel } from './SnippetsPanel';

const EXPIRY_OPTIONS = [
  { label: '24 hours',  value: 24  },
  { label: '48 hours',  value: 48  },
  { label: '7 days',    value: 168 },
  { label: '30 days',   value: 720 },
  { label: 'Never',     value: 0   },
];

interface AttachedFile {
  file: File;
  previewUrl: string | null;
}

export function InputBar() {
  const deviceName  = useStore(state => state.deviceName);
  const loadMessages = useStore(state => state.loadMessages);
  const searchQuery  = useStore(state => state.searchQuery);
  const activeDateFilter = useStore(state => state.activeDateFilter);
  const showToast   = useStore(state => state.showToast);

  const [inputText,        setInputText]        = useState('');
  const [attachedFiles,    setAttachedFiles]    = useState<AttachedFile[]>([]);
  const [isSending,        setIsSending]        = useState(false);
  const [expiryHours,      setExpiryHours]      = useState(24);
  const [isExpiryOpen,     setIsExpiryOpen]     = useState(false);
  const [isDragOver,       setIsDragOver]       = useState(false);

  const textareaRef   = useRef<HTMLTextAreaElement>(null);
  const fileInputRef  = useRef<HTMLInputElement>(null);
  const expiryRef     = useRef<HTMLDivElement>(null);

  // Auto-resize the textarea as the user types
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  }, [inputText]);

  // Close expiry dropdown when clicking outside
  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (expiryRef.current && !expiryRef.current.contains(event.target as Node)) {
        setIsExpiryOpen(false);
      }
    }
    if (isExpiryOpen) document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isExpiryOpen]);

  function reloadMessages() {
    loadMessages({ query: searchQuery, date: activeDateFilter });
  }

  const handleSend = useCallback(async () => {
    const trimmedText = inputText.trim();
    if (!trimmedText && attachedFiles.length === 0) return;
    if (isSending) return;

    setIsSending(true);
    try {
      if (attachedFiles.length > 0) {
        // Send files first, then the text caption if any
        for (const attached of attachedFiles) {
          if (isImageFile(attached.file.name)) {
            await sendImageMessage(attached.file, deviceName, trimmedText);
          } else {
            await sendFileMessage(attached.file, deviceName, trimmedText);
          }
        }
        // Clean up object URLs to avoid memory leaks
        attachedFiles.forEach(a => { if (a.previewUrl) URL.revokeObjectURL(a.previewUrl); });
        setAttachedFiles([]);
        // Only send text as a separate message if no files were attached
      } else if (trimmedText) {
        await sendTextMessage(trimmedText, deviceName, expiryHours);
      }

      setInputText('');
      reloadMessages();
    } catch {
      showToast('Failed to send', 'error');
    } finally {
      setIsSending(false);
    }
  }, [inputText, attachedFiles, isSending, deviceName, expiryHours]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Ctrl+Enter or Cmd+Enter sends the message
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      handleSend();
    }
  }

  function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);
    appendFiles(selectedFiles);
    // Reset the input so the same file can be selected again if removed
    event.target.value = '';
  }

  function appendFiles(newFiles: File[]) {
    const newAttached: AttachedFile[] = newFiles.map(file => ({
      file,
      previewUrl: isImageFile(file.name) ? URL.createObjectURL(file) : null,
    }));
    setAttachedFiles(prev => [...prev, ...newAttached]);
  }

  function removeAttachedFile(index: number) {
    setAttachedFiles(prev => {
      const toRemove = prev[index];
      if (toRemove.previewUrl) URL.revokeObjectURL(toRemove.previewUrl);
      return prev.filter((_, fileIndex) => fileIndex !== index);
    });
  }

  async function handlePasteFromClipboard() {
    try {
      const clipboardText = await navigator.clipboard.readText();
      if (clipboardText) {
        setInputText(prev => prev + clipboardText);
        textareaRef.current?.focus();
      }
    } catch {
      showToast('Clipboard access denied', 'error');
    }
  }

  function handleDragOver(event: React.DragEvent) {
    event.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave() {
    setIsDragOver(false);
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    setIsDragOver(false);
    const droppedFiles = Array.from(event.dataTransfer.files);
    if (droppedFiles.length > 0) appendFiles(droppedFiles);
  }

  function insertSnippet(content: string) {
    setInputText(prev => prev + (prev ? '\n' : '') + content);
    textareaRef.current?.focus();
  }

  const canSend = (inputText.trim().length > 0 || attachedFiles.length > 0) && !isSending;
  const selectedExpiryLabel = EXPIRY_OPTIONS.find(o => o.value === expiryHours)?.label ?? '24 hours';

  return (
    <>
      <SnippetsPanel onInsert={insertSnippet} />

      {/* File attachment preview chips */}
      {attachedFiles.length > 0 && (
        <div className="attach-preview">
          {attachedFiles.map((attached, attachIndex) => (
            <div key={`${attached.file.name}-${attachIndex}`} className="attach-chip">
              {attached.previewUrl
                ? <img src={attached.previewUrl} className="preview-thumb" alt={attached.file.name} />
                : <span className="chip-icon">{getFileIcon(attached.file.name)}</span>
              }
              <span className="chip-name">{attached.file.name}</span>
              <button className="chip-del" onClick={() => removeAttachedFile(attachIndex)} aria-label={`Remove ${attached.file.name}`}>✕</button>
            </div>
          ))}
          <button className="clear-all-attach" onClick={() => setAttachedFiles([])}>Clear all</button>
        </div>
      )}

      <div
        className={`input-bar ${isDragOver ? 'drag-over' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Hidden file input — triggered by the attach button */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileSelect}
          aria-label="Attach files"
        />

        <button
          className="btn-round btn-attach"
          onClick={() => fileInputRef.current?.click()}
          title="Attach file"
          aria-label="Attach file"
        >
          <AttachIcon size={17} />
        </button>

        <textarea
          ref={textareaRef}
          placeholder={attachedFiles.length > 0 ? 'Add a caption…' : 'Message… (Ctrl+Enter to send)'}
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          aria-label="Message input"
        />

        <button
          className="btn-round btn-paste"
          onClick={handlePasteFromClipboard}
          title="Paste from clipboard"
          aria-label="Paste from clipboard"
        >
          📋
        </button>

        <div ref={expiryRef} style={{ position: 'relative' }}>
          <button
            className={`btn-round btn-expiry ${isExpiryOpen ? 'active' : ''}`}
            onClick={() => setIsExpiryOpen(prev => !prev)}
            title={`Expiry: ${selectedExpiryLabel}`}
            aria-label={`Message expiry: ${selectedExpiryLabel}`}
            aria-expanded={isExpiryOpen}
          >
            <ClockIcon size={15} />
          </button>
          {isExpiryOpen && (
            <div className="expiry-picker">
              <label htmlFor="expiry-select">Message expires after:</label>
              <select
                id="expiry-select"
                className="expiry-select"
                value={expiryHours}
                onChange={e => { setExpiryHours(Number(e.target.value)); setIsExpiryOpen(false); }}
              >
                {EXPIRY_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <button
          className="btn-round btn-send"
          onClick={handleSend}
          disabled={!canSend}
          aria-label="Send message"
          title="Send (Ctrl+Enter)"
        >
          {isSending ? '…' : <SendIcon size={17} />}
        </button>
      </div>
    </>
  );
}
