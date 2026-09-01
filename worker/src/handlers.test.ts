/**
 * Tests for the HTTP routes, exercised through a real Hono app.
 *
 * The React frontend is not being changed by this port, so these tests double as
 * a contract check: every path, form field and response shape here is what
 * `frontend/src/api.ts` already sends and expects. A difference is a bug.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

import { createApp } from "./handlers";
import { writeSessionUser, type SessionUser } from "./session";
import type { Env } from "./env";

const SIGNING_KEY = "a-long-random-signing-key";
const USER: SessionUser = { sub: "google-sub-123", email: "someone@example.com", name: "Someone" };

/** Records what the Durable Object was asked to publish, without a real one. */
function createHubSpy() {
  const published: unknown[] = [];
  const namespace = {
    idFromName: (name: string) => ({ name }),
    get: () => ({
      fetch: async (request: Request) => {
        if (request.url.endsWith("/publish")) {
          published.push(await request.json());
          return Response.json({ delivered: 1 });
        }
        return new Response("stream", { headers: { "content-type": "text/event-stream" } });
      },
    }),
  };
  return { namespace, published };
}

/** A fake Supabase layer; each test overrides just the calls it cares about. */
function createDataSpy(overrides: Record<string, unknown> = {}) {
  return {
    touchDatabase: vi.fn(async () => {}),
    fetchMessages: vi.fn(async () => ({ messages: [], has_more: false })),
    insertMessage: vi.fn(async (_client: unknown, _row: Record<string, unknown>) => {}),
    toggleStar: vi.fn(async () => ({ starred: true })),
    removeMessage: vi.fn(async () => {}),
    fetchSnippets: vi.fn(async () => []),
    insertSnippet: vi.fn(async () => ({ id: "s1", name: "n", content: "c", created_at: "" })),
    removeSnippet: vi.fn(async () => {}),
    fetchClipboard: vi.fn(async () => ({ content: "", updated_at: null })),
    upsertClipboard: vi.fn(async () => {}),
    fetchRecentForWebhook: vi.fn(async () => []),
    uploadToStorage: vi.fn(
      async (
        _client: unknown,
        _bucket: string,
        _key: string,
        _contents: ArrayBuffer,
        _contentType: string,
      ) => "https://storage.example/file.png",
    ),
    createSupabaseClient: vi.fn(() => ({}) as never),
    ...overrides,
  };
}

function createTestEnv(hubNamespace: unknown): Env {
  return {
    GOOGLE_CLIENT_ID: "client-id",
    GOOGLE_CLIENT_SECRET: "client-secret",
    OAUTH_REDIRECT_URI: "https://mbl2pc.rootlevellabs.tech/auth",
    SESSION_SECRET_KEY: SIGNING_KEY,
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_KEY: "service-key",
    SUPABASE_STORAGE_BUCKET: "mbl2pc-files",
    WEBHOOK_SECRET: "webhook-secret",
    WEBHOOK_USER_ID: "webhook-user",
    FORGE_INBOUND_URL: "",
    NOTIFICATION_HUB: hubNamespace,
    ASSETS: { fetch: async () => new Response("<html>app</html>") },
  } as unknown as Env;
}

/** Builds the app plus its spies, and a helper that signs requests in. */
function createHarness(dataOverrides: Record<string, unknown> = {}) {
  const hub = createHubSpy();
  const data = createDataSpy(dataOverrides);
  const env = createTestEnv(hub.namespace);
  const app = createApp(data as never);

  /** A cookie header carrying a valid session, obtained the way a browser would. */
  async function signedInCookie(): Promise<string> {
    const { Hono } = await import("hono");
    const helper = new Hono();
    helper.get("/x", async (c) => {
      await writeSessionUser(c, USER, SIGNING_KEY);
      return c.text("ok");
    });
    const response = await helper.request("/x");
    return response.headers.get("set-cookie")!.split(";")[0];
  }

  async function authed(path: string, init: RequestInit = {}) {
    const cookie = await signedInCookie();
    return app.request(path, { ...init, headers: { ...init.headers, cookie } }, env);
  }

  function anonymous(path: string, init: RequestInit = {}) {
    return app.request(path, init, env);
  }

  return { app, env, data, hub, authed, anonymous };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

// ── Authentication gate ────────────────────────────────────────────────────────

describe("authentication", () => {
  const protectedRoutes: [string, RequestInit][] = [
    ["/me", {}],
    ["/messages", {}],
    ["/snippets", {}],
    ["/clipboard", {}],
    ["/events", {}],
    ["/send", { method: "POST" }],
    ["/messages/abc", { method: "DELETE" }],
    ["/messages/abc/star", { method: "PATCH" }],
  ];

  it.each(protectedRoutes)("refuses %s without a session", async (path, init) => {
    const { anonymous } = createHarness();

    const response = await anonymous(path, init);

    expect(response.status).toBe(401);
  });

  it("never reaches the database for an anonymous request", async () => {
    // Authentication has to gate the query, not filter its results.
    const { anonymous, data } = createHarness();

    await anonymous("/messages");

    expect(data.fetchMessages).not.toHaveBeenCalled();
  });

  it("returns the signed-in profile from /me", async () => {
    const { authed } = createHarness();

    const response = await authed("/me");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(USER);
  });
});

// ── Messages ───────────────────────────────────────────────────────────────────

describe("GET /messages", () => {
  it("passes the search, date and last filters through", async () => {
    const { authed, data } = createHarness();

    await authed("/messages?q=invoice&date=2026-08-30&last=25");

    expect(data.fetchMessages).toHaveBeenCalledWith(expect.anything(), USER.sub, {
      query: "invoice",
      date: "2026-08-30",
      last: 25,
    });
  });

  it("answers in the shape the frontend destructures", async () => {
    const { authed } = createHarness({
      fetchMessages: vi.fn(async () => ({
        messages: [{ id: "a", sender: "PC", text: "hi", image_url: "", file_url: "", file_name: "", timestamp: "t", starred: false }],
        has_more: true,
      })),
    });

    const body = await (await authed("/messages")).json();

    expect(body).toHaveProperty("messages");
    expect(body).toHaveProperty("has_more", true);
  });

  it("forbids caching, so a reload never shows a stale conversation", async () => {
    const { authed } = createHarness();

    const response = await authed("/messages");

    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});

describe("POST /send", () => {
  it("stores the message against the signed-in user", async () => {
    const { authed, data } = createHarness();
    const form = new FormData();
    form.set("msg", "hello");
    form.set("sender", "PC");

    await authed("/send", { method: "POST", body: form });

    expect(data.insertMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ user_id: USER.sub, sender: "PC", text: "hello" }),
    );
  });

  it("names the device when the sender field is left empty", async () => {
    const { authed, data } = createHarness();
    const form = new FormData();
    form.set("msg", "hello");

    await authed("/send", {
      method: "POST",
      body: form,
      headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)" },
    });

    expect(data.insertMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sender: "iPhone" }),
    );
  });

  it("sets an expiry only when one was asked for", async () => {
    const { authed, data } = createHarness();
    const form = new FormData();
    form.set("msg", "self destructing");
    form.set("expires_hours", "2");

    await authed("/send", { method: "POST", body: form });

    const written = data.insertMessage.mock.calls[0][1];
    expect(written.expires_at).toEqual(expect.any(String));
  });

  it("leaves expiry unset when expires_hours is zero", async () => {
    const { authed, data } = createHarness();
    const form = new FormData();
    form.set("msg", "permanent");
    form.set("expires_hours", "0");

    await authed("/send", { method: "POST", body: form });

    const written = data.insertMessage.mock.calls[0][1];
    expect(written.expires_at).toBeUndefined();
  });

  it("notifies the user's other tabs", async () => {
    const { authed, hub } = createHarness();
    const form = new FormData();
    form.set("msg", "hello");

    await authed("/send", { method: "POST", body: form });

    expect(hub.published).toEqual([{ type: "new_message" }]);
  });
});

describe("PATCH /messages/:id/star and DELETE /messages/:id", () => {
  it("returns the new starred state", async () => {
    const { authed } = createHarness();

    const body = await (await authed("/messages/abc/star", { method: "PATCH" })).json();

    expect(body).toEqual({ starred: true });
  });

  it("answers 404 when the message is not the user's", async () => {
    const { authed } = createHarness({
      toggleStar: vi.fn(async () => {
        throw new Error("Message not found.");
      }),
    });

    const response = await authed("/messages/not-mine/star", { method: "PATCH" });

    expect(response.status).toBe(404);
  });

  it("deletes a message", async () => {
    const { authed, data } = createHarness();

    const response = await authed("/messages/abc", { method: "DELETE" });

    expect(response.status).toBe(200);
    expect(data.removeMessage).toHaveBeenCalledWith(expect.anything(), USER.sub, "abc");
  });
});

// ── Uploads ────────────────────────────────────────────────────────────────────

describe("POST /send-image", () => {
  it("rejects a file type the app does not accept", async () => {
    const { authed } = createHarness();
    const form = new FormData();
    form.set("file", new File(["data"], "virus.exe", { type: "application/octet-stream" }));

    const response = await authed("/send-image", { method: "POST", body: form });

    expect(response.status).toBe(400);
  });

  it("rejects a file with no extension", async () => {
    const { authed } = createHarness();
    const form = new FormData();
    form.set("file", new File(["data"], "screenshot", { type: "image/png" }));

    const response = await authed("/send-image", { method: "POST", body: form });

    expect(response.status).toBe(400);
  });

  it("uploads an accepted image and records its URL", async () => {
    const { authed, data } = createHarness();
    const form = new FormData();
    form.set("file", new File(["data"], "photo.png", { type: "image/png" }));

    const response = await authed("/send-image", { method: "POST", body: form });

    expect(response.status).toBe(200);
    expect(data.uploadToStorage).toHaveBeenCalled();
    expect(data.insertMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ image_url: "https://storage.example/file.png" }),
    );
  });
});

describe("POST /send-file", () => {
  it("rejects a file over the size limit", async () => {
    const { authed } = createHarness();
    const oversized = new File([new Uint8Array(26 * 1024 * 1024)], "big.zip");
    const form = new FormData();
    form.set("file", oversized);

    const response = await authed("/send-file", { method: "POST", body: form });

    expect(response.status).toBe(400);
  });

  it("stores an HTML upload as a download rather than a renderable page", async () => {
    const { authed, data } = createHarness();
    const form = new FormData();
    form.set("file", new File(["<script>"], "page.html", { type: "text/html" }));

    await authed("/send-file", { method: "POST", body: form });

    const contentType = data.uploadToStorage.mock.calls[0][4];
    expect(contentType).toBe("application/octet-stream");
  });

  it("keeps the original filename for display", async () => {
    const { authed, data } = createHarness();
    const form = new FormData();
    form.set("file", new File(["x"], "Quarterly Report (final).pdf", { type: "application/pdf" }));

    await authed("/send-file", { method: "POST", body: form });

    expect(data.insertMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ file_name: "Quarterly Report (final).pdf" }),
    );
  });
});

// ── Snippets and clipboard ─────────────────────────────────────────────────────

describe("snippets", () => {
  it("lists snippets under a `snippets` key", async () => {
    const { authed } = createHarness();

    expect(await (await authed("/snippets")).json()).toEqual({ snippets: [] });
  });

  it("rejects a snippet with a blank name", async () => {
    const { authed } = createHarness();
    const form = new FormData();
    form.set("name", "   ");
    form.set("content", "something");

    const response = await authed("/snippets", { method: "POST", body: form });

    expect(response.status).toBe(400);
  });
});

describe("clipboard", () => {
  it("returns the stored clipboard", async () => {
    const { authed } = createHarness({
      fetchClipboard: vi.fn(async () => ({ content: "copied", updated_at: "t" })),
    });

    expect(await (await authed("/clipboard")).json()).toEqual({ content: "copied", updated_at: "t" });
  });

  it("notifies other tabs when the clipboard changes", async () => {
    const { authed, hub } = createHarness();
    const form = new FormData();
    form.set("content", "copied");

    await authed("/clipboard", { method: "POST", body: form });

    expect(hub.published).toEqual([{ type: "clipboard_update" }]);
  });
});

// ── Webhook ────────────────────────────────────────────────────────────────────

describe("POST /webhook", () => {
  it("refuses a wrong token", async () => {
    const { anonymous } = createHarness();

    const response = await anonymous("/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hi", token: "wrong-secret" }),
    });

    expect(response.status).toBe(401);
  });

  it("accepts the configured token and stores the message", async () => {
    const { anonymous, data } = createHarness();

    const response = await anonymous("/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "from forge", token: "webhook-secret" }),
    });

    expect(response.status).toBe(200);
    expect(data.insertMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ user_id: "webhook-user", sender: "Forge Terminal" }),
    );
  });

  it("rejects an empty message", async () => {
    const { anonymous } = createHarness();

    const response = await anonymous("/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "   ", token: "webhook-secret" }),
    });

    expect(response.status).toBe(400);
  });
});

describe("GET /messages/recent", () => {
  it("refuses a wrong token", async () => {
    const { anonymous } = createHarness();

    expect((await anonymous("/messages/recent?token=wrong")).status).toBe(401);
  });

  it("returns messages for the configured webhook user", async () => {
    const { anonymous, data } = createHarness();

    const response = await anonymous("/messages/recent?token=webhook-secret&since=2026-01-01T00:00:00");

    expect(response.status).toBe(200);
    expect(data.fetchRecentForWebhook).toHaveBeenCalledWith(
      expect.anything(),
      "webhook-user",
      "2026-01-01T00:00:00",
    );
  });
});

// ── Keepalive and health ───────────────────────────────────────────────────────

describe("operational endpoints", () => {
  it("keepalive needs no session, since a scheduler has no cookie", async () => {
    const { anonymous } = createHarness();

    const response = await anonymous("/internal/keepalive");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", database: "reachable" });
  });

  it("keepalive still answers 200 when the database is down", async () => {
    // It is a heartbeat, not a health check: a database fault must not read as
    // the web service being dead.
    const { anonymous } = createHarness({
      touchDatabase: vi.fn(async () => {
        throw new Error("connection refused");
      }),
    });

    const response = await anonymous("/internal/keepalive");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", database: "unreachable" });
  });

  it("health never touches the database", async () => {
    const { anonymous, data } = createHarness();

    const response = await anonymous("/health");

    expect(response.status).toBe(200);
    expect(data.touchDatabase).not.toHaveBeenCalled();
  });
});

// ── Static assets ──────────────────────────────────────────────────────────────

describe("static assets", () => {
  it("strips the /static prefix the React build emits", async () => {
    // The bundle asks for /static/assets/send-abc.js, but the asset store is
    // itself the static directory, so the file is at /assets/send-abc.js.
    const requested: string[] = [];
    const { app, env } = createHarness();
    env.ASSETS = {
      fetch: async (request: Request) => {
        requested.push(new URL(request.url).pathname);
        return new Response("bundle");
      },
    } as never;

    await app.request("/static/assets/send-abc.js", {}, env);

    expect(requested).toEqual(["/assets/send-abc.js"]);
  });

  it("passes a root-level asset through untouched", async () => {
    const requested: string[] = [];
    const { app, env } = createHarness();
    env.ASSETS = {
      fetch: async (request: Request) => {
        requested.push(new URL(request.url).pathname);
        return new Response("worker");
      },
    } as never;

    await app.request("/sw.js", {}, env);

    expect(requested).toEqual(["/sw.js"]);
  });
});

// ── Sign-out ───────────────────────────────────────────────────────────────────

describe("GET /logout", () => {
  it("expires the session cookie and sends the visitor to sign in again", async () => {
    const { authed } = createHarness();

    const response = await authed("/logout");

    expect(response.status).toBe(302);
    expect(response.headers.get("set-cookie")).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
  });
});
