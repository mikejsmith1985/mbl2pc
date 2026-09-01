/**
 * Pure transforms shared by the message, upload and query paths.
 *
 * These are separated from the database code so the awkward parts — filename
 * sanitising, content-type neutralising, expiry — can be tested exhaustively
 * without a Supabase client anywhere near them.
 */

// ── Device labelling ───────────────────────────────────────────────────────────

/**
 * Names the device a message was sent from, used when the UI does not supply a
 * sender. Order matters: iPadOS reports itself as a Macintosh and Android
 * reports itself as Linux, so the more specific match has to win.
 */
export function detectDevice(userAgent: string): string {
  if (userAgent.includes("iPad")) return "iPad";
  if (userAgent.includes("iPhone")) return "iPhone";
  if (userAgent.includes("Android")) return "Android";
  if (userAgent.includes("CrOS")) return "Chromebook";
  if (userAgent.includes("Macintosh") || userAgent.includes("Mac OS X")) return "Mac";
  if (userAgent.includes("Windows")) return "PC";
  if (userAgent.includes("Linux")) return "Linux";
  return "unknown";
}

// ── Storage keys ───────────────────────────────────────────────────────────────

/**
 * Supabase Storage accepts only a conservative character set in an object key.
 * A photo named "Screenshot 2026-08-28 at 14.02.11 (1).png", or anything with
 * an accent or emoji, is rejected outright — which is why some uploads failed
 * while others worked.
 */
const UNSAFE_STORAGE_KEY_CHARS = /[^A-Za-z0-9._-]/g;
const MAX_STORAGE_KEY_BASE_LENGTH = 80;

/** Splits a filename into its base and its extension, extension including the dot. */
function splitExtension(fileName: string): { base: string; extension: string } {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0) return { base: fileName, extension: "" };
  return { base: fileName.slice(0, lastDot), extension: fileName.slice(lastDot) };
}

/**
 * Builds a storage key that Supabase will accept while still hinting at the
 * original filename. The name the user sees is stored separately in the
 * database, so mangling the key costs nothing and prevents an upload failing
 * on its filename alone.
 */
export function buildStorageKey(prefix: string, originalName: string): string {
  const { base, extension } = splitExtension(originalName);
  const safeBase = base
    .replace(UNSAFE_STORAGE_KEY_CHARS, "_")
    .slice(0, MAX_STORAGE_KEY_BASE_LENGTH)
    .replace(/^_+|_+$/g, "");
  const safeExtension = extension.replace(UNSAFE_STORAGE_KEY_CHARS, "");
  // A random suffix alongside the timestamp: two files chosen in the same
  // millisecond would otherwise collide and the second upload would be rejected.
  const uniqueSuffix = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  return `${prefix}_${uniqueSuffix}_${safeBase || "file"}${safeExtension}`;
}

// ── Content types ──────────────────────────────────────────────────────────────

/**
 * Types a browser would render rather than download. A shared file is a payload,
 * not a page: serving HTML or SVG inline from the storage domain would let an
 * uploaded file execute script in that origin.
 */
const RENDERABLE_CONTENT_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "text/xml",
  "application/xml",
  "text/javascript",
  "application/javascript",
]);

const RENDERABLE_EXTENSIONS = new Set([".html", ".htm", ".svg", ".xml", ".xhtml", ".js"]);

/**
 * Returns the content type to store the file under, forcing a download for
 * anything the browser would otherwise render. The extension is checked as well
 * as the declared type, because the declared type comes from the uploading
 * browser and cannot be trusted on its own.
 */
export function forceDownloadContentType(fileName: string, declaredType: string): string {
  const { extension } = splitExtension(fileName.toLowerCase());
  if (RENDERABLE_CONTENT_TYPES.has(declaredType) || RENDERABLE_EXTENSIONS.has(extension)) {
    return "application/octet-stream";
  }
  return declaredType;
}

// ── Message rows ───────────────────────────────────────────────────────────────

/** A row as Supabase returns it, before the nulls are smoothed out. */
export interface MessageRow {
  id?: string;
  sender?: string | null;
  text?: string | null;
  image_url?: string | null;
  file_url?: string | null;
  file_name?: string | null;
  timestamp?: string | null;
  starred?: boolean | null;
  expires_at?: string | null;
}

/** A message as the UI consumes it: every field present, nothing null. */
export interface Message {
  id: string;
  sender: string;
  text: string;
  image_url: string;
  file_url: string;
  file_name: string;
  timestamp: string;
  starred: boolean;
}

/**
 * True when a self-destructing message's moment has passed. Expiry is filtered
 * in code rather than in the query because timestamps are stored as text, and a
 * text comparison in the database would not survive a change of format.
 */
export function isExpired(row: Pick<MessageRow, "expires_at">, nowIso: string): boolean {
  return Boolean(row.expires_at && row.expires_at <= nowIso);
}

/** Fills in every null so the UI never has to guard a missing field. */
export function normalizeMessageRow(row: MessageRow): Message {
  return {
    id: row.id ?? "",
    sender: row.sender ?? "",
    text: row.text ?? "",
    image_url: row.image_url ?? "",
    file_url: row.file_url ?? "",
    file_name: row.file_name ?? "",
    timestamp: row.timestamp ?? "",
    starred: Boolean(row.starred),
  };
}

// ── Timestamps ─────────────────────────────────────────────────────────────────

/** Length of "YYYY-MM-DDTHH:MM:SS" — an ISO timestamp with the fraction cut off. */
const SECONDS_PRECISION_LENGTH = 19;

/**
 * The moment now, in exactly the format already stored in the database.
 *
 * This matters more than it looks. Timestamps are stored as text, ordered as
 * text, and date-filtered with text comparisons. The FastAPI app wrote
 * second-precision ISO strings with no timezone suffix, so writing a different
 * shape now — milliseconds, or a trailing Z — would sort new messages
 * inconsistently against every existing row and drop them from date filters.
 */
export function currentTimestamp(atMs: number = Date.now()): string {
  return new Date(atMs).toISOString().slice(0, SECONDS_PRECISION_LENGTH);
}

/** The same format, offset forward by a number of hours, for expiring messages. */
export function timestampAfterHours(hours: number, atMs: number = Date.now()): string {
  return currentTimestamp(atMs + hours * 60 * 60 * 1000);
}
