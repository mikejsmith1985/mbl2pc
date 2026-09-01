/**
 * Tests for every database and storage call the Worker makes.
 *
 * The Supabase service key bypasses row-level security, so nothing in the
 * database constrains one user's query to their own rows — only the `user_id`
 * filter added here does. Several tests below exist purely to assert that
 * filter is present, because losing it would silently expose every account.
 */

import { describe, expect, it } from "vitest";

import {
  fetchClipboard,
  fetchMessages,
  fetchRecentForWebhook,
  fetchSnippets,
  insertMessage,
  insertSnippet,
  removeMessage,
  removeSnippet,
  toggleStar,
  touchDatabase,
  upsertClipboard,
} from "./supabase";

const USER_ID = "google-sub-123";

interface RecordedCall {
  method: string;
  args: unknown[];
}

/**
 * Stands in for a Supabase client, recording the chained calls a query makes and
 * resolving to a canned result. Every builder method returns the same recorder,
 * which is what lets `.select().eq().order()` chain the way the real client does.
 */
function createClientRecorder(result: { data?: unknown; error?: unknown } = { data: [] }) {
  const calls: RecordedCall[] = [];
  const recorder: Record<string, unknown> = {};

  const builderMethods = [
    "from", "select", "insert", "update", "upsert", "delete",
    "eq", "neq", "gt", "gte", "lt", "ilike", "order", "limit",
  ];
  for (const method of builderMethods) {
    recorder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return recorder;
    };
  }
  recorder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);

  /** Arguments of every recorded call to one builder method. */
  function argsOf(method: string): unknown[][] {
    return calls.filter((call) => call.method === method).map((call) => call.args);
  }

  return { client: recorder as never, calls, argsOf };
}

/** True when the recorded chain scoped the query to one user's rows. */
function isScopedToUser(argsOf: (method: string) => unknown[][]): boolean {
  return argsOf("eq").some(([column, value]) => column === "user_id" && value === USER_ID);
}

// ── Keepalive ──────────────────────────────────────────────────────────────────

describe("touchDatabase", () => {
  it("issues a real query, since that is the entire point", async () => {
    const { client, argsOf } = createClientRecorder();

    await touchDatabase(client);

    expect(argsOf("from")[0]).toEqual(["messages"]);
    expect(argsOf("limit")[0]).toEqual([1]);
  });
});

// ── Messages ───────────────────────────────────────────────────────────────────

describe("fetchMessages", () => {
  it("scopes the query to the signed-in user", async () => {
    const { client, argsOf } = createClientRecorder({ data: [] });

    await fetchMessages(client, USER_ID, {});

    expect(isScopedToUser(argsOf)).toBe(true);
  });

  it("returns the newest 100 in chronological order by default", async () => {
    // Fetched newest-first so a user with thousands of messages gets the recent
    // ones, then reversed so the UI can render oldest to newest.
    const { client, argsOf } = createClientRecorder({
      data: [
        { id: "newest", timestamp: "2026-09-01T12:00:02" },
        { id: "oldest", timestamp: "2026-09-01T12:00:00" },
      ],
    });

    const result = await fetchMessages(client, USER_ID, {});

    expect(argsOf("limit")[0]).toEqual([100]);
    expect(result.messages.map((message) => message.id)).toEqual(["oldest", "newest"]);
  });

  it("searches text with a case-insensitive contains match", async () => {
    const { client, argsOf } = createClientRecorder({ data: [] });

    await fetchMessages(client, USER_ID, { query: "invoice" });

    expect(argsOf("ilike")[0]).toEqual(["text", "%invoice%"]);
  });

  it("filters a date to that whole calendar day", async () => {
    const { client, argsOf } = createClientRecorder({ data: [] });

    await fetchMessages(client, USER_ID, { date: "2026-08-30" });

    expect(argsOf("gte")[0]).toEqual(["timestamp", "2026-08-30T00:00:00"]);
    expect(argsOf("lt")[0]).toEqual(["timestamp", "2026-08-30T23:59:59"]);
  });

  it("does not also apply the default limit when searching", async () => {
    // A search that silently only looked at the last 100 messages would be worse
    // than useless — it would look like the older message had been deleted.
    const { client, argsOf } = createClientRecorder({ data: [] });

    await fetchMessages(client, USER_ID, { query: "invoice" });

    expect(argsOf("limit")).toHaveLength(0);
  });

  it("hides a message whose expiry has passed", async () => {
    const { client } = createClientRecorder({
      data: [
        { id: "live", expires_at: null },
        { id: "expired", expires_at: "2000-01-01T00:00:00" },
      ],
    });

    const result = await fetchMessages(client, USER_ID, {});

    expect(result.messages.map((message) => message.id)).toEqual(["live"]);
  });

  it("reports more available when a limited fetch comes back full", async () => {
    const { client } = createClientRecorder({ data: [{ id: "a" }, { id: "b" }] });

    const result = await fetchMessages(client, USER_ID, { last: 2 });

    expect(result.has_more).toBe(true);
  });

  it("reports no more available when a limited fetch comes back short", async () => {
    const { client } = createClientRecorder({ data: [{ id: "a" }] });

    const result = await fetchMessages(client, USER_ID, { last: 5 });

    expect(result.has_more).toBe(false);
  });

  it("raises the database error rather than returning an empty list", async () => {
    // Silently returning [] would look identical to "you have no messages".
    const { client } = createClientRecorder({ error: { message: "connection refused" } });

    await expect(fetchMessages(client, USER_ID, {})).rejects.toThrow(/connection refused/);
  });
});

describe("insertMessage", () => {
  it("writes the row it is given", async () => {
    const { client, argsOf } = createClientRecorder({ data: [{}] });
    const row = { id: "abc", user_id: USER_ID, sender: "PC", text: "hi", timestamp: "2026-09-01T12:00:00" };

    await insertMessage(client, row);

    expect(argsOf("from")[0]).toEqual(["messages"]);
    expect(argsOf("insert")[0]).toEqual([row]);
  });
});

describe("toggleStar", () => {
  it("flips an unstarred message to starred", async () => {
    const { client } = createClientRecorder({ data: [{ starred: false }] });

    expect(await toggleStar(client, USER_ID, "msg-1")).toEqual({ starred: true });
  });

  it("flips a starred message back", async () => {
    const { client } = createClientRecorder({ data: [{ starred: true }] });

    expect(await toggleStar(client, USER_ID, "msg-1")).toEqual({ starred: false });
  });

  it("refuses to star a message belonging to somebody else", async () => {
    // The lookup is scoped by user_id, so another user's message simply is not
    // found — which must surface as "not found", never as a successful update.
    const { client } = createClientRecorder({ data: [] });

    await expect(toggleStar(client, USER_ID, "not-mine")).rejects.toThrow(/not found/i);
  });

  it("scopes both the lookup and the update to the signed-in user", async () => {
    const { client, argsOf } = createClientRecorder({ data: [{ starred: false }] });

    await toggleStar(client, USER_ID, "msg-1");

    const userScopedFilters = argsOf("eq").filter(([column]) => column === "user_id");
    expect(userScopedFilters).toHaveLength(2);
  });
});

describe("removeMessage", () => {
  it("scopes the delete to the signed-in user", async () => {
    const { client, argsOf } = createClientRecorder();

    await removeMessage(client, USER_ID, "msg-1");

    expect(isScopedToUser(argsOf)).toBe(true);
    expect(argsOf("eq").some(([column, value]) => column === "id" && value === "msg-1")).toBe(true);
  });
});

// ── Snippets ───────────────────────────────────────────────────────────────────

describe("snippets", () => {
  it("lists only the signed-in user's snippets", async () => {
    const { client, argsOf } = createClientRecorder({ data: [] });

    await fetchSnippets(client, USER_ID);

    expect(isScopedToUser(argsOf)).toBe(true);
  });

  it("stores a snippet against its owner, trimmed", async () => {
    const { client, argsOf } = createClientRecorder({ data: [{ id: "s1" }] });

    await insertSnippet(client, USER_ID, "  greeting  ", "  hello  ");

    expect(argsOf("insert")[0][0]).toEqual({
      user_id: USER_ID,
      name: "greeting",
      content: "hello",
    });
  });

  it("scopes a snippet delete to the signed-in user", async () => {
    const { client, argsOf } = createClientRecorder();

    await removeSnippet(client, USER_ID, "s1");

    expect(isScopedToUser(argsOf)).toBe(true);
  });
});

// ── Clipboard ──────────────────────────────────────────────────────────────────

describe("clipboard", () => {
  it("returns empty content when nothing has been synced yet", async () => {
    const { client } = createClientRecorder({ data: [] });

    expect(await fetchClipboard(client, USER_ID)).toEqual({ content: "", updated_at: null });
  });

  it("returns the stored content", async () => {
    const { client } = createClientRecorder({
      data: [{ content: "copied text", updated_at: "2026-09-01T12:00:00" }],
    });

    expect(await fetchClipboard(client, USER_ID)).toEqual({
      content: "copied text",
      updated_at: "2026-09-01T12:00:00",
    });
  });

  it("upserts on user_id so each user keeps exactly one clipboard row", async () => {
    const { client, argsOf } = createClientRecorder({ data: [] });

    await upsertClipboard(client, USER_ID, "copied text");

    expect(argsOf("upsert")[0][1]).toEqual({ onConflict: "user_id" });
  });
});

// ── Webhook polling ────────────────────────────────────────────────────────────

describe("fetchRecentForWebhook", () => {
  it("excludes messages Forge Terminal itself sent, to avoid an echo loop", async () => {
    const { client, argsOf } = createClientRecorder({ data: [] });

    await fetchRecentForWebhook(client, USER_ID, "2026-09-01T00:00:00");

    expect(argsOf("neq")[0]).toEqual(["sender", "Forge Terminal"]);
    expect(argsOf("gt")[0]).toEqual(["timestamp", "2026-09-01T00:00:00"]);
  });
});
