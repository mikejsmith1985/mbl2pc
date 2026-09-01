/**
 * Every database and storage call the app makes.
 *
 * All of these run under the Supabase service key, which bypasses row-level
 * security. That is deliberate and matches the FastAPI app it replaces: the key
 * never leaves the server, so the browser cannot query the database directly.
 * The consequence is that the `user_id` filter in each query below is the only
 * thing separating one account from another — it is a security control, not a
 * convenience, and must never be dropped from a query.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  isExpired,
  normalizeMessageRow,
  type Message,
  type MessageRow,
} from "./data";
import type { Env } from "./env";

/** Columns the UI needs. `expires_at` is fetched to filter on, never displayed. */
const MESSAGE_COLUMNS = "id,sender,text,image_url,file_url,file_name,timestamp,starred,expires_at";

/**
 * How many messages a plain, unfiltered load returns.
 *
 * Fetched newest-first and then reversed, so someone with thousands of messages
 * sees their most recent ones rather than their oldest.
 */
const DEFAULT_MESSAGE_LIMIT = 100;

/** The sender name Forge Terminal writes under, excluded when it polls for replies. */
const FORGE_SENDER_NAME = "Forge Terminal";

/** Most rows the webhook poll returns in one call. */
const WEBHOOK_POLL_LIMIT = 20;

/** Builds a Supabase client bound to the service key. */
export function createSupabaseClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

/**
 * Throws when Supabase reported an error, so a failure surfaces as a failure.
 *
 * Supabase resolves rather than rejects on a database error, putting it in the
 * `error` field. Ignoring that field turns a broken query into an empty list,
 * which reads to the user as "your data is gone".
 */
function unwrap<T>(result: { data: T | null; error: unknown }, operation: string): T {
  if (result.error) {
    const detail =
      typeof result.error === "object" && result.error !== null && "message" in result.error
        ? String((result.error as { message: unknown }).message)
        : String(result.error);
    throw new Error(`${operation} failed: ${detail}`);
  }
  return (result.data ?? []) as T;
}

// ── Keepalive ──────────────────────────────────────────────────────────────────

/**
 * The cheapest possible read, run only so Supabase registers database activity.
 *
 * Supabase pauses a free project after 7 days without a query, and only a manual
 * dashboard click restores it. One id from one row is enough to reset that clock.
 */
export async function touchDatabase(client: SupabaseClient): Promise<void> {
  const result = await client.from("messages").select("id").limit(1);
  unwrap(result, "Keepalive read");
}

// ── Messages ───────────────────────────────────────────────────────────────────

export interface FetchMessagesOptions {
  /** Case-insensitive substring search over message text. */
  query?: string;
  /** A single calendar day, as YYYY-MM-DD. */
  date?: string;
  /** Return only the N most recent messages. Used for incremental loads. */
  last?: number;
}

export interface FetchMessagesResult {
  messages: Message[];
  has_more: boolean;
}

/** Reads one user's messages, applying search, date and limit filters. */
export async function fetchMessages(
  client: SupabaseClient,
  userId: string,
  options: FetchMessagesOptions,
): Promise<FetchMessagesResult> {
  const wantsMostRecentOnly = (options.last ?? 0) > 0;

  let query = client
    .from("messages")
    .select(MESSAGE_COLUMNS)
    .eq("user_id", userId)
    .order("timestamp", { ascending: false });

  if (wantsMostRecentOnly) {
    query = query.limit(options.last as number);
  } else if (options.query) {
    query = query.ilike("text", `%${options.query}%`);
  } else if (options.date) {
    query = query
      .gte("timestamp", `${options.date}T00:00:00`)
      .lt("timestamp", `${options.date}T23:59:59`);
  } else {
    query = query.limit(DEFAULT_MESSAGE_LIMIT);
  }

  const rows = unwrap<MessageRow[]>(await query, "Message query");

  const nowIso = new Date().toISOString();
  const visible = rows.filter((row) => !isExpired(row, nowIso)).map(normalizeMessageRow);

  // Rows arrive newest-first; the UI renders oldest-first.
  visible.reverse();

  // A limited fetch that came back full means older messages remain unseen.
  const hasMore = wantsMostRecentOnly && rows.length >= (options.last as number);

  return { messages: visible, has_more: hasMore };
}

/** A row about to be written to the messages table. */
export interface NewMessageRow {
  id: string;
  user_id: string;
  sender: string;
  text: string;
  timestamp: string;
  image_url?: string;
  file_url?: string;
  file_name?: string;
  expires_at?: string;
}

/** Stores a new message. */
export async function insertMessage(
  client: SupabaseClient,
  row: NewMessageRow,
): Promise<void> {
  unwrap(await client.from("messages").insert(row), "Message insert");
}

/**
 * Flips a message between starred and unstarred.
 *
 * Reads the current value first because the column is a plain boolean with no
 * toggle operator. Both the read and the write are scoped by `user_id`, so a
 * message belonging to someone else is simply not found.
 */
export async function toggleStar(
  client: SupabaseClient,
  userId: string,
  messageId: string,
): Promise<{ starred: boolean }> {
  const existing = unwrap<{ starred: boolean | null }[]>(
    await client.from("messages").select("starred").eq("id", messageId).eq("user_id", userId),
    "Star lookup",
  );

  if (existing.length === 0) {
    throw new Error("Message not found.");
  }

  const nextStarred = !existing[0].starred;
  unwrap(
    await client
      .from("messages")
      .update({ starred: nextStarred })
      .eq("id", messageId)
      .eq("user_id", userId),
    "Star update",
  );

  return { starred: nextStarred };
}

/** Deletes one of the user's own messages. */
export async function removeMessage(
  client: SupabaseClient,
  userId: string,
  messageId: string,
): Promise<void> {
  unwrap(
    await client.from("messages").delete().eq("id", messageId).eq("user_id", userId),
    "Message delete",
  );
}

// ── Snippets ───────────────────────────────────────────────────────────────────

export interface Snippet {
  id: string;
  name: string;
  content: string;
  created_at: string;
}

/** Lists the user's saved snippets, oldest first. */
export async function fetchSnippets(
  client: SupabaseClient,
  userId: string,
): Promise<Snippet[]> {
  return unwrap<Snippet[]>(
    await client
      .from("snippets")
      .select("id,name,content,created_at")
      .eq("user_id", userId)
      .order("created_at"),
    "Snippet query",
  );
}

/** Saves a new snippet, trimming the surrounding whitespace. */
export async function insertSnippet(
  client: SupabaseClient,
  userId: string,
  name: string,
  content: string,
): Promise<Snippet | Record<string, never>> {
  const created = unwrap<Snippet[]>(
    await client
      .from("snippets")
      .insert({ user_id: userId, name: name.trim(), content: content.trim() }),
    "Snippet insert",
  );
  return created[0] ?? {};
}

/** Deletes one of the user's own snippets. */
export async function removeSnippet(
  client: SupabaseClient,
  userId: string,
  snippetId: string,
): Promise<void> {
  unwrap(
    await client.from("snippets").delete().eq("id", snippetId).eq("user_id", userId),
    "Snippet delete",
  );
}

// ── Clipboard ──────────────────────────────────────────────────────────────────

export interface ClipboardEntry {
  content: string;
  updated_at: string | null;
}

/** Reads the user's synced clipboard, empty when they have never synced one. */
export async function fetchClipboard(
  client: SupabaseClient,
  userId: string,
): Promise<ClipboardEntry> {
  const rows = unwrap<{ content?: string; updated_at?: string }[]>(
    await client.from("clipboard").select("content,updated_at").eq("user_id", userId),
    "Clipboard query",
  );

  if (rows.length === 0) return { content: "", updated_at: null };
  return { content: rows[0].content ?? "", updated_at: rows[0].updated_at ?? null };
}

/**
 * Replaces the user's synced clipboard.
 *
 * Upserted on `user_id` so each user keeps exactly one row, which is what makes
 * the clipboard a single shared value across their devices rather than a log.
 */
export async function upsertClipboard(
  client: SupabaseClient,
  userId: string,
  content: string,
): Promise<void> {
  unwrap(
    await client.from("clipboard").upsert(
      { user_id: userId, content, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    ),
    "Clipboard upsert",
  );
}

// ── Webhook polling ────────────────────────────────────────────────────────────

export interface WebhookMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: string;
}

/**
 * Messages the user has sent since a given moment, for Forge Terminal to poll.
 *
 * Forge's own messages are excluded: it would otherwise read back everything it
 * just wrote and answer itself in a loop.
 */
export async function fetchRecentForWebhook(
  client: SupabaseClient,
  userId: string,
  since: string,
): Promise<WebhookMessage[]> {
  return unwrap<WebhookMessage[]>(
    await client
      .from("messages")
      .select("id,sender,text,timestamp")
      .eq("user_id", userId)
      .neq("sender", FORGE_SENDER_NAME)
      .gt("timestamp", since)
      .order("timestamp", { ascending: true })
      .limit(WEBHOOK_POLL_LIMIT),
    "Webhook poll",
  );
}

// ── Storage ────────────────────────────────────────────────────────────────────

/** Uploads bytes to Supabase Storage and returns the public URL to store. */
export async function uploadToStorage(
  client: SupabaseClient,
  bucket: string,
  key: string,
  contents: ArrayBuffer,
  contentType: string,
): Promise<string> {
  const upload = await client.storage
    .from(bucket)
    .upload(key, contents, { contentType, upsert: false });

  if (upload.error) {
    throw new Error(`File upload error: ${upload.error.message}`);
  }

  return client.storage.from(bucket).getPublicUrl(key).data.publicUrl;
}
