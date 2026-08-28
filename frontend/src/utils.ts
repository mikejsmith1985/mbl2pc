/**
 * Shared utilities: markdown rendering, file type detection,
 * per-sender colour palette, and blob download helper.
 */

import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Configure marked once at module load — gfm and breaks match the existing app behaviour
marked.use({ gfm: true, breaks: true });

// ── Markdown ──────────────────────────────────────────────────────────────────

/**
 * Convert markdown text to sanitized HTML.
 * DOMPurify strips any script tags or dangerous attributes before rendering.
 */
export function renderMarkdown(text: string): string {
  // marked.parse is synchronous when async option is not set
  const rawHtml = marked.parse(text) as string;
  return DOMPurify.sanitize(rawHtml, { ADD_ATTR: ['target', 'rel'] });
}

// ── File types ────────────────────────────────────────────────────────────────

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

/** Return the lowercase file extension without the dot, e.g. "pdf". */
export function getFileExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

/** True if the file is an image that should be displayed inline in the bubble. */
export function isImageFile(fileName: string): boolean {
  return IMAGE_EXTENSIONS.has('.' + getFileExtension(fileName));
}

/** Return an emoji icon that represents the file type. */
export function getFileIcon(fileName: string): string {
  const ext = getFileExtension(fileName);
  if (ext === 'pdf') return '📄';
  if (['doc', 'docx'].includes(ext)) return '📝';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '🗜️';
  if (['mp4', 'mov', 'avi', 'mkv'].includes(ext)) return '🎬';
  if (['mp3', 'wav', 'aac', 'flac'].includes(ext)) return '🎵';
  return '📎';
}

// ── Sender palette ────────────────────────────────────────────────────────────

export interface SenderPalette {
  /** Background colour for the message bubble */
  bg: string;
  /** Border colour */
  b: string;
  /** Text colour — guaranteed to be readable on bg */
  t: string;
}

// Each sender is assigned a consistent colour based on a hash of their name,
// so the same person always gets the same colour regardless of session.
const LIGHT_PALETTES: SenderPalette[] = [
  { bg: '#fef3c7', b: '#d97706', t: '#451a03' },
  { bg: '#d1fae5', b: '#059669', t: '#064e3b' },
  { bg: '#fce7f3', b: '#db2777', t: '#500724' },
  { bg: '#e0e7ff', b: '#4f46e5', t: '#1e1b4b' },
  { bg: '#ffedd5', b: '#ea580c', t: '#431407' },
  { bg: '#dcfce7', b: '#16a34a', t: '#14532d' },
  { bg: '#f3e8ff', b: '#9333ea', t: '#3b0764' },
  { bg: '#ffe4e6', b: '#e11d48', t: '#4c0519' },
];

const DARK_PALETTES: SenderPalette[] = [
  { bg: '#451a03', b: '#f59e0b', t: '#fef3c7' },
  { bg: '#022c22', b: '#34d399', t: '#d1fae5' },
  { bg: '#500724', b: '#f472b6', t: '#fce7f3' },
  { bg: '#1e1b4b', b: '#818cf8', t: '#e0e7ff' },
  { bg: '#431407', b: '#fb923c', t: '#ffedd5' },
  { bg: '#052e16', b: '#4ade80', t: '#dcfce7' },
  { bg: '#2e1065', b: '#c084fc', t: '#f3e8ff' },
  { bg: '#4c0519', b: '#fb7185', t: '#ffe4e6' },
];

/** Return a consistent colour palette for a given sender name and current theme. */
export function computeSenderPalette(senderName: string, isDark: boolean): SenderPalette {
  // djb2-style hash: maps any string to one of 8 palette slots
  let hash = 0;
  for (let i = 0; i < senderName.length; i++) {
    hash = (hash * 31 + senderName.charCodeAt(i)) & 0xffff;
  }
  return (isDark ? DARK_PALETTES : LIGHT_PALETTES)[hash % 8];
}

// ── File download ─────────────────────────────────────────────────────────────

/**
 * Fetch a file as a blob and trigger a browser download.
 * This is required for cross-origin URLs where the `download` attribute is ignored.
 */
export async function downloadFileAsBlob(fileUrl: string, fileName: string): Promise<void> {
  const response = await fetch(fileUrl);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(objectUrl);
}

// ── Clipboard ─────────────────────────────────────────────────────────────────

/**
 * Copy text to the system clipboard.
 * Falls back to the execCommand approach for older browsers.
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for browsers that restrict clipboard API
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

// ── Date formatting ───────────────────────────────────────────────────────────

/** Format a YYYY-MM-DD or ISO timestamp as a human-readable day label. */
export function formatDayLabel(timestamp: string): string {
  if (!timestamp) return '';

  // Date-only strings (YYYY-MM-DD, no T) are parsed by the JS engine as UTC midnight.
  // That shifts the displayed day by the user's UTC offset. Parsing them as local noon
  // (12:00) avoids this without changing the visible date in any timezone (±12h).
  let date: Date;
  if (timestamp.length === 10 && !timestamp.includes('T')) {
    const [year, month, day] = timestamp.split('-').map(Number);
    date = new Date(year, month - 1, day, 12, 0, 0);
  } else {
    date = new Date(timestamp);
  }

  if (isNaN(date.getTime())) return '';

  // Use 'sv' locale for a stable YYYY-MM-DD comparison string
  const toLocalDateString = (d: Date) => d.toLocaleDateString('sv');
  const today     = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (toLocalDateString(date) === toLocalDateString(today))     return 'Today';
  if (toLocalDateString(date) === toLocalDateString(yesterday)) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

/** Extract the YYYY-MM-DD date portion from a timestamp string. */
export function extractDatePart(timestamp: string): string {
  return timestamp ? timestamp.slice(0, 10) : '';
}

// ── Clipboard & attachment handling ───────────────────────────────────────────

/**
 * The largest file the backend will accept (`MAX_FILE_SIZE` in main.py).
 * Checked in the browser too, so an oversized phone video fails with a clear
 * message instead of a silent 400 after a long upload.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// Clipboard items frequently arrive with an empty or extension-less name — a
// screenshot copied on Windows is just "image.png" at best and "" at worst.
// The upload endpoints key off the extension, so one has to be derived.
const MIME_TYPE_EXTENSIONS: Record<string, string> = {
  'image/png':       'png',
  'image/jpeg':      'jpg',
  'image/gif':       'gif',
  'image/webp':      'webp',
  'image/heic':      'heic',
  'image/heif':      'heif',
  'image/avif':      'avif',
  'image/bmp':       'bmp',
  'image/svg+xml':   'svg',
  'video/mp4':       'mp4',
  'video/quicktime': 'mov',
  'video/webm':      'webm',
  'video/x-msvideo': 'avi',
  'audio/mpeg':      'mp3',
  'audio/wav':       'wav',
  'audio/mp4':       'm4a',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'text/plain':      'txt',
  'text/csv':        'csv',
};

const FALLBACK_UPLOAD_EXTENSION = 'bin';

/**
 * Return a filename the upload endpoints will accept for a pasted or dropped item.
 * The clipboard's own name wins when it already carries an extension; otherwise a
 * timestamped name is synthesised from the item's MIME type.
 */
export function deriveFileNameForClipboardItem(originalName: string, mimeType: string): string {
  if (originalName && originalName.includes('.')) return originalName;
  const extension = MIME_TYPE_EXTENSIONS[mimeType.toLowerCase()] ?? FALLBACK_UPLOAD_EXTENSION;
  return `pasted-${Date.now()}.${extension}`;
}

/**
 * Pull every file out of a paste or drop event's data transfer, guaranteeing each
 * one has a usable filename. Returns an empty array for text-only pastes so the
 * caller knows to leave the event alone and let the browser insert the text.
 */
export function extractFilesFromDataTransfer(dataTransfer: DataTransfer | null | undefined): File[] {
  if (!dataTransfer) return [];

  // `items` is the reliable source for clipboard pastes; `files` covers drops and
  // the browsers that populate only the FileList.
  const itemFiles = Array.from(dataTransfer.items ?? [])
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile())
    .filter((file): file is File => file !== null);

  const rawFiles = itemFiles.length > 0 ? itemFiles : Array.from(dataTransfer.files ?? []);

  return rawFiles.map(file => {
    const derivedName = deriveFileNameForClipboardItem(file.name, file.type);
    if (derivedName === file.name) return file;
    // File.name is read-only, so a renamed copy is the only way to carry the extension
    return new File([file], derivedName, { type: file.type, lastModified: file.lastModified });
  });
}

/** Return the first file that would be rejected by the upload size limit, or null. */
export function findOversizedFile(files: File[]): File | null {
  return files.find(file => file.size > MAX_UPLOAD_BYTES) ?? null;
}

const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = 1024 * 1024;

/** Format a byte count for display in an error message, e.g. "26.0 MB". */
export function formatByteSize(byteCount: number): string {
  if (byteCount >= BYTES_PER_MEGABYTE) return `${(byteCount / BYTES_PER_MEGABYTE).toFixed(1)} MB`;
  if (byteCount >= BYTES_PER_KILOBYTE) return `${Math.round(byteCount / BYTES_PER_KILOBYTE)} KB`;
  return `${byteCount} bytes`;
}
