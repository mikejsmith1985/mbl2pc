/** Tests for the API layer — uses global fetch mock to verify request shapes. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally before importing any api functions
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import {
  fetchSnippets,
  deleteMessage,
  toggleMessageStar,
  sendTextMessage,
} from './api';

beforeEach(() => {
  mockFetch.mockReset();
});

describe('fetchSnippets', () => {
  it('returns the snippets array from the response', async () => {
    const fakeSnippets = [{ id: '1', name: 'Hello', content: 'World', created_at: '' }];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ snippets: fakeSnippets }),
    });

    const result = await fetchSnippets();
    expect(result).toEqual(fakeSnippets);
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/snippets'));
  });

  it('returns an empty array when response has no snippets key', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    const result = await fetchSnippets();
    expect(result).toEqual([]);
  });
});

describe('deleteMessage', () => {
  it('sends a DELETE request to the correct URL', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    await deleteMessage('msg-123');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/messages/msg-123'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('throws when the server returns an error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(deleteMessage('msg-999')).rejects.toThrow('Failed to delete message');
  });
});

describe('toggleMessageStar', () => {
  it('sends a PATCH request and returns the starred status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ starred: true }) });
    const result = await toggleMessageStar('msg-42');
    expect(result.starred).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/messages/msg-42/star'),
      expect.objectContaining({ method: 'PATCH' })
    );
  });
});

describe('sendTextMessage', () => {
  it('posts form data with the msg field (not text)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });
    await sendTextMessage('Hello!', 'PC', 24);

    const [, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe('POST');
    const formData = options.body as FormData;
    expect(formData.get('msg')).toBe('Hello!');
    expect(formData.get('sender')).toBe('PC');
  });
});
