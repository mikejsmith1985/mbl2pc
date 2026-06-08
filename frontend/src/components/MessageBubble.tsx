/** A single chat message bubble with sender palette, markdown, file/image support, and action buttons. */

import { useStore } from '../store';
import { renderMarkdown, computeSenderPalette, isImageFile, getFileIcon, downloadFileAsBlob, copyTextToClipboard } from '../utils';
import { StarIcon, TrashIcon, CopyIcon } from './icons';

interface MessageBubbleProps {
  messageId: string;
}

export function MessageBubble({ messageId }: MessageBubbleProps) {
  const message              = useStore(state => state.messages.find(m => m.id === messageId));
  const deviceName           = useStore(state => state.deviceName);
  const themeMode            = useStore(state => state.themeMode);
  const isSelectMode         = useStore(state => state.isSelectMode);
  const selectedMessageIds   = useStore(state => state.selectedMessageIds);
  const toggleStar           = useStore(state => state.toggleStar);
  const removeMessage        = useStore(state => state.removeMessage);
  const toggleMessageSelection = useStore(state => state.toggleMessageSelection);
  const showToast            = useStore(state => state.showToast);

  if (!message) return null;

  const isSentByThisDevice = message.sender === deviceName;
  const isSelected         = !!selectedMessageIds[message.id];
  const isDarkMode         = themeMode === 'dark';

  const senderPalette = !isSentByThisDevice
    ? computeSenderPalette(message.sender, isDarkMode)
    : null;

  // Format timestamp: show time only for today, otherwise include date
  const messageDate = new Date(message.timestamp);
  const timeString  = messageDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const renderedHtml = message.text ? renderMarkdown(message.text) : null;

  const hasImage       = !!message.image_url;
  const hasFile        = !hasImage && !!message.file_url;
  const fileIsImage    = hasFile && isImageFile(message.file_name);

  async function handleCopy() {
    if (!message) return;
    const textToCopy = message.text || message.file_name || '';
    await copyTextToClipboard(textToCopy);
    showToast('Copied!');
  }

  async function handleDownload() {
    if (!message) return;
    const url      = message.file_url || message.image_url;
    const fileName = message.file_name || url.split('/').pop() || 'download';
    try {
      await downloadFileAsBlob(url, fileName);
    } catch {
      showToast('Download failed', 'error');
    }
  }

  function handleBubbleClick() {
    if (isSelectMode) toggleMessageSelection(message!.id);
  }

  const bubbleStyle = senderPalette ? {
    background:  senderPalette.bg,
    borderColor: senderPalette.b,
    color:       senderPalette.t,
  } : undefined;

  const bubbleClass = [
    'bubble',
    isSentByThisDevice ? 'sent' : 'received',
    message.starred ? 'is-starred' : '',
    isSelected ? 'selected' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={bubbleClass}
      style={bubbleStyle}
      onClick={handleBubbleClick}
      role={isSelectMode ? 'checkbox' : undefined}
      aria-checked={isSelectMode ? isSelected : undefined}
    >
      {/* Star badge — only shown on pinned messages */}
      {message.starred && <span className="starred-badge" aria-label="Pinned">⭐</span>}

      {/* Selection checkbox indicator */}
      <div className="sel-indicator" aria-hidden="true">
        {isSelected ? '✓' : ''}
      </div>

      {/* Sender name — only on messages from other devices */}
      {!isSentByThisDevice && (
        <div className="sender" style={{ color: senderPalette?.b }}>{message.sender}</div>
      )}

      {/* Image content */}
      {hasImage && (
        <img
          src={message.image_url}
          alt="Shared image"
          loading="lazy"
          onClick={e => { e.stopPropagation(); window.open(message.image_url, '_blank'); }}
          style={{ cursor: 'pointer' }}
        />
      )}

      {/* File attachment card */}
      {hasFile && !fileIsImage && (
        <div className="file-card" onClick={e => { e.stopPropagation(); handleDownload(); }} role="button" tabIndex={0}>
          <span className="file-icon">{getFileIcon(message.file_name)}</span>
          <div>
            <div className="fname">{message.file_name}</div>
            <div className="fhint">Click to download</div>
          </div>
        </div>
      )}

      {/* Inline image file */}
      {fileIsImage && (
        <img
          src={message.file_url}
          alt={message.file_name}
          loading="lazy"
          onClick={e => { e.stopPropagation(); window.open(message.file_url, '_blank'); }}
          style={{ cursor: 'pointer' }}
        />
      )}

      {/* Message text rendered as markdown */}
      {renderedHtml && (
        <div
          className="text md-body"
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      )}

      {/* Timestamp */}
      <div className="timestamp">{timeString}</div>

      {/* Hover action buttons — not shown in select mode */}
      {!isSelectMode && (
        <div className="bubble-actions">
          {message.text && (
            <button className="ba" onClick={e => { e.stopPropagation(); handleCopy(); }} title="Copy">
              <CopyIcon size={13} />
            </button>
          )}
          <button
            className="ba"
            onClick={e => { e.stopPropagation(); toggleStar(message.id); }}
            title={message.starred ? 'Unpin' : 'Pin'}
          >
            <StarIcon size={13} filled={message.starred} />
          </button>
          {(hasFile || hasImage) && (
            <button className="ba" onClick={e => { e.stopPropagation(); handleDownload(); }} title="Download">
              ↓
            </button>
          )}
          <button
            className="ba"
            onClick={e => { e.stopPropagation(); removeMessage(message.id); }}
            title="Delete"
          >
            <TrashIcon size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
