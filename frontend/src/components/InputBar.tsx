/** Message composition bar: text input, file attach, expiry, clipboard paste, and send. */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useStore } from '../store';
import { sendTextMessage, sendImageMessage, sendFileMessage } from '../api';
import {
  isImageFile,
  getFileIcon,
  extractFilesFromDataTransfer,
  deriveFileNameForClipboardItem,
  findOversizedFile,
  formatByteSize,
  MAX_UPLOAD_BYTES,
  isTouchPrimaryDevice,
} from '../utils';
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

/**
 * Turn the blobs held by `navigator.clipboard.read()` into named files.
 * Each clipboard item can advertise several MIME types; the first one that
 * yields a blob is the representation to upload.
 */
async function collectFilesFromClipboardItems(clipboardItems: ClipboardItem[]): Promise<File[]> {
  const collectedFiles: File[] = [];
  for (const clipboardItem of clipboardItems) {
    for (const mimeType of clipboardItem.types) {
      if (mimeType === 'text/plain' || mimeType === 'text/html') continue;
      const blob = await clipboardItem.getType(mimeType);
      collectedFiles.push(new File([blob], deriveFileNameForClipboardItem('', mimeType), { type: mimeType }));
      break;
    }
  }
  return collectedFiles;
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

    // Reject oversized uploads up front — a 40 MB phone video would otherwise
    // upload for a minute and then fail with an unexplained "Failed to send".
    const oversizedFile = findOversizedFile(attachedFiles.map(attached => attached.file));
    if (oversizedFile) {
      showToast(
        `${oversizedFile.name} is ${formatByteSize(oversizedFile.size)} — the limit is ${formatByteSize(MAX_UPLOAD_BYTES)}`,
        'error',
      );
      return;
    }

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
    } catch (sendError) {
      // Surface the backend's own reason (unsupported type, size limit, storage
      // error) instead of a generic message the user cannot act on.
      showToast(sendError instanceof Error && sendError.message ? sendError.message : 'Failed to send', 'error');
    } finally {
      setIsSending(false);
    }
  }, [inputText, attachedFiles, isSending, deviceName, expiryHours, showToast]);

  /**
   * On a desktop, Enter sends and Shift+Enter inserts a newline.
   * On a phone or tablet, Enter stays a plain newline: a soft keyboard offers no
   * Shift+Enter, so sending on Enter would make a second line impossible to type.
   * Ctrl/Cmd+Enter sends everywhere, which is the shortcut this app already had.
   */
  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter') return;

    // While an input method editor is composing (Japanese, Chinese, accent entry)
    // Enter commits the candidate word, so sending here would truncate the input.
    if (event.nativeEvent.isComposing) return;

    const isExplicitSendShortcut = event.ctrlKey || event.metaKey;
    if (!isExplicitSendShortcut) {
      if (event.shiftKey) return;          // deliberate newline
      if (isTouchPrimaryDevice()) return;  // phone or tablet return key
    }

    event.preventDefault();
    handleSend();
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

  /**
   * Attach any images, videos, or documents carried by a paste event.
   * Returns true when files were taken, so the caller can suppress the browser's
   * own text insertion; plain-text pastes return false and are left untouched.
   */
  const attachFilesFromPaste = useCallback((clipboardData: DataTransfer | null): boolean => {
    const pastedFiles = extractFilesFromDataTransfer(clipboardData);
    if (pastedFiles.length === 0) return false;
    appendFiles(pastedFiles);
    return true;
  }, []);

  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (attachFilesFromPaste(event.clipboardData)) event.preventDefault();
  }

  // A paste aimed at the page rather than the textarea still belongs to the
  // composer — without this, Ctrl+V after copying a screenshot does nothing at all.
  useEffect(() => {
    function handleWindowPaste(event: ClipboardEvent) {
      if (event.defaultPrevented) return;
      if (attachFilesFromPaste(event.clipboardData)) event.preventDefault();
    }
    window.addEventListener('paste', handleWindowPaste);
    return () => window.removeEventListener('paste', handleWindowPaste);
  }, [attachFilesFromPaste]);

  /**
   * Pull whatever the system clipboard holds into the composer: image and file
   * blobs become attachments, text is appended to the message box.
   */
  async function handlePasteFromClipboard() {
    // navigator.clipboard.read() exposes binary blobs; readText() cannot see them.
    if (navigator.clipboard?.read) {
      try {
        const clipboardItems = await navigator.clipboard.read();
        const blobFiles = await collectFilesFromClipboardItems(clipboardItems);
        if (blobFiles.length > 0) {
          appendFiles(blobFiles);
          return;
        }
      } catch {
        // Firefox and older Safari lack clipboard.read() — fall through to text
      }
    }

    try {
      const clipboardText = await navigator.clipboard.readText();
      if (clipboardText) {
        setInputText(prev => prev + clipboardText);
        textareaRef.current?.focus();
      }
    } catch {
      showToast('Clipboard access denied — press Ctrl+V instead', 'error');
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
    const droppedFiles = extractFilesFromDataTransfer(event.dataTransfer);
    if (droppedFiles.length > 0) appendFiles(droppedFiles);
  }

  function insertSnippet(content: string) {
    setInputText(prev => prev + (prev ? '\n' : '') + content);
    textareaRef.current?.focus();
  }

  const canSend = (inputText.trim().length > 0 || attachedFiles.length > 0) && !isSending;

  // The Enter hint only belongs on devices where Enter actually sends
  const isTouchDevice = isTouchPrimaryDevice();
  const composerPlaceholder = attachedFiles.length > 0
    ? 'Add a caption…'
    : (isTouchDevice ? 'Message…' : 'Message… (Enter to send)');
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
          placeholder={composerPlaceholder}
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
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
          title={isTouchDevice ? 'Send' : 'Send (Enter)'}
        >
          {isSending ? '…' : <SendIcon size={17} />}
        </button>
      </div>
    </>
  );
}
