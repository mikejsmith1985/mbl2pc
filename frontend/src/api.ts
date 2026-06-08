/**
 * All HTTP calls to the FastAPI backend.
 * Each function returns typed data or throws an Error on failure.
 * Auth failures (401) redirect to /login automatically.
 */

import type { Message, Snippet, UserProfile, ClipboardEntry } from './types';

const API_BASE = window.location.origin;

// ── Auth ──────────────────────────────────────────────────────────────────────

/** Fetch the Google-authenticated user's profile from the session. */
export async function fetchCurrentUser(): Promise<UserProfile> {
  const response = await fetch(`${API_BASE}/me`);
  if (response.status === 401) {
    window.location.href = '/login';
    throw new Error('Not authenticated');
  }
  if (!response.ok) throw new Error('Failed to fetch user profile');
  return response.json();
}

// ── Messages ──────────────────────────────────────────────────────────────────

export interface FetchMessagesParams {
  query?: string;
  date?: string;
  last?: number;
}

export interface FetchMessagesResult {
  messages: Message[];
  has_more: boolean;
}

/** Retrieve messages for the current user, with optional search/date/limit filters. */
export async function fetchMessages(params: FetchMessagesParams = {}): Promise<FetchMessagesResult> {
  const searchParams = new URLSearchParams();
  if (params.query) searchParams.set('q', params.query);
  if (params.date)  searchParams.set('date', params.date);
  if (params.last && params.last > 0) searchParams.set('last', String(params.last));
  searchParams.set('_t', String(Date.now())); // cache-buster — prevents stale browser cache

  const response = await fetch(`${API_BASE}/messages?${searchParams}`, { cache: 'no-store' });
  if (response.status === 401) {
    window.location.href = '/login';
    throw new Error('Not authenticated');
  }
  if (!response.ok) throw new Error(`Failed to fetch messages: ${response.status}`);
  return response.json();
}

/** Toggle the starred (pinned) state of a message. Returns the new starred value. */
export async function toggleMessageStar(messageId: string): Promise<{ starred: boolean }> {
  const response = await fetch(`${API_BASE}/messages/${messageId}/star`, { method: 'PATCH' });
  if (!response.ok) throw new Error('Failed to toggle star');
  return response.json();
}

/** Permanently delete a message. */
export async function deleteMessage(messageId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/messages/${messageId}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Failed to delete message');
}

/** Send a plain-text message. The 'msg' field matches the backend Form parameter name. */
export async function sendTextMessage(text: string, sender: string, expiryHours: number): Promise<void> {
  const formData = new FormData();
  formData.append('msg', text);
  formData.append('sender', sender);
  formData.append('expires_hours', String(expiryHours));
  const response = await fetch(`${API_BASE}/send`, { method: 'POST', body: formData });
  if (!response.ok) throw new Error('Failed to send message');
}

/** Upload and send an image file with an optional caption. */
export async function sendImageMessage(file: File, sender: string, caption: string): Promise<void> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('sender', sender);
  formData.append('text', caption);
  const response = await fetch(`${API_BASE}/send-image`, { method: 'POST', body: formData });
  if (!response.ok) throw new Error('Failed to send image');
}

/** Upload and send any file type with an optional caption. */
export async function sendFileMessage(file: File, sender: string, caption: string): Promise<void> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('sender', sender);
  formData.append('text', caption);
  const response = await fetch(`${API_BASE}/send-file`, { method: 'POST', body: formData });
  if (!response.ok) throw new Error('Failed to send file');
}

// ── Snippets ──────────────────────────────────────────────────────────────────

/** Return all saved text snippets for the current user. */
export async function fetchSnippets(): Promise<Snippet[]> {
  const response = await fetch(`${API_BASE}/snippets`);
  if (!response.ok) throw new Error('Failed to fetch snippets');
  const data = await response.json();
  return data.snippets ?? [];
}

/** Create a new saved snippet. */
export async function createSnippet(name: string, content: string): Promise<Snippet> {
  const formData = new FormData();
  formData.append('name', name);
  formData.append('content', content);
  const response = await fetch(`${API_BASE}/snippets`, { method: 'POST', body: formData });
  if (!response.ok) throw new Error('Failed to create snippet');
  const data = await response.json();
  return data.snippet;
}

/** Delete a saved snippet by its ID. */
export async function deleteSnippet(snippetId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/snippets/${snippetId}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Failed to delete snippet');
}

// ── Clipboard ─────────────────────────────────────────────────────────────────

/** Return the latest synced clipboard content for the current user. */
export async function fetchClipboard(): Promise<ClipboardEntry> {
  const response = await fetch(`${API_BASE}/clipboard`);
  if (!response.ok) throw new Error('Failed to fetch clipboard');
  return response.json();
}

/** Push new clipboard content to the server, triggering SSE to other devices. */
export async function pushClipboard(content: string): Promise<void> {
  const formData = new FormData();
  formData.append('content', content);
  const response = await fetch(`${API_BASE}/clipboard`, { method: 'POST', body: formData });
  if (!response.ok) throw new Error('Failed to push clipboard');
}

// ── Version ───────────────────────────────────────────────────────────────────

/** Return the git commit hash that the server is running. */
export async function fetchVersion(): Promise<string> {
  try {
    const response = await fetch(`${API_BASE}/version`);
    if (!response.ok) return 'unknown';
    const data = await response.json();
    return String(data.version ?? 'unknown');
  } catch {
    return 'unknown';
  }
}
