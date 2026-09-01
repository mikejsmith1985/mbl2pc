/**
 * Every HTTP route the app serves.
 *
 * The React frontend is unchanged by this port, so the paths, form field names
 * and response shapes below are fixed by `frontend/src/api.ts` and must match it
 * exactly. Where a choice looked arbitrary, it was copied from the FastAPI app
 * on purpose.
 *
 * The data layer arrives as a parameter rather than being imported directly, so
 * the routes can be tested without a Supabase client or a network.
 */

import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";

import {
  buildStorageKey,
  currentTimestamp,
  detectDevice,
  forceDownloadContentType,
  timestampAfterHours,
} from "./data";
import { hasSupabaseConfig, type Env } from "./env";
import { completeGoogleSignIn, startGoogleSignIn } from "./oauth";
import { clearSessionUser, readSessionUser, writeSessionUser, type SessionUser } from "./session";
import * as supabaseData from "./supabase";

/** The data layer, injected so tests can supply a fake. */
export type DataLayer = typeof supabaseData;

/** Largest file the app will accept, matching the previous 25 MB ceiling. */
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

/** Image types the picker accepts. Anything else is refused before uploading. */
const ALLOWED_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

/** The sender recorded for messages arriving over the server-to-server webhook. */
const FORGE_SENDER_NAME = "Forge Terminal";

/** Where a signed-in visitor lands, and where the SPA is served from. */
const APP_SHELL_PATH = "/send.html";

/** URL prefix the built frontend requests its bundles under. */
const STATIC_URL_PREFIX = "/static/";

/** Variables carried through the request, set by the authentication middleware. */
interface RequestVariables {
  user: SessionUser;
}

type AppContext = { Bindings: Env; Variables: RequestVariables };

/** Reads a form field as a string, tolerating an absent field. */
function formString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  return typeof value === "string" ? value : "";
}

/** The extension of a filename, lowercased and including the dot. */
function extensionOf(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  return lastDot <= 0 ? "" : fileName.slice(lastDot).toLowerCase();
}

/**
 * Tells every tab a user has open that something changed.
 *
 * Failure is swallowed deliberately. The notification is a convenience — the
 * client re-fetches on its own schedule regardless — so a hub problem must not
 * turn a successfully-saved message into an error the sender sees.
 */
async function notifyUserTabs(env: Env, userId: string, payload: unknown): Promise<void> {
  try {
    const hub = env.NOTIFICATION_HUB.get(env.NOTIFICATION_HUB.idFromName(userId));
    await hub.fetch(
      new Request("https://hub.internal/publish", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );
  } catch (notifyError) {
    console.error("[NOTIFY] could not reach the hub:", notifyError);
  }
}

/** Middleware placing the signed-in user on the request, or refusing it. */
const requireSignedIn: MiddlewareHandler<AppContext> = async (c, next) => {
  const user = await readSessionUser(c, c.env.SESSION_SECRET_KEY);
  if (!user) {
    return c.json({ detail: "Not authenticated: session missing or expired." }, 401);
  }
  c.set("user", user);
  await next();
};

/** Builds the application. */
export function createApp(data: DataLayer = supabaseData) {
  const app = new Hono<AppContext>();

  app.use("*", cors());

  // ── Operational endpoints (no session required) ─────────────────────────────

  /**
   * Liveness only. It must never touch the database: this is what an uptime
   * check watches, and a database blip must not read as the app being down.
   */
  app.get("/health", (c) => c.json({ status: "ok" }));

  /**
   * Deliberately queries the database so Supabase registers activity and does
   * not pause the free project. Always answers 200 — it is a heartbeat, not a
   * health check — and reports the database state in the body instead, which is
   * what the scheduled handler inspects.
   */
  app.get("/internal/keepalive", async (c) => {
    if (!hasSupabaseConfig(c.env)) {
      return c.json({ status: "ok", database: "not-configured" });
    }
    try {
      await data.touchDatabase(data.createSupabaseClient(c.env));
      return c.json({ status: "ok", database: "reachable" });
    } catch (keepaliveError) {
      console.error("[KEEPALIVE] database touch failed:", keepaliveError);
      return c.json({ status: "ok", database: "unreachable" });
    }
  });

  app.get("/version", (c) => c.json({ version: "cloudflare-worker" }));

  // ── Sign in and out ─────────────────────────────────────────────────────────

  app.get("/login", (c) => startGoogleSignIn(c, c.env));

  app.get("/auth", async (c) => {
    try {
      const user = await completeGoogleSignIn(c, c.env);
      await writeSessionUser(c, user, c.env.SESSION_SECRET_KEY);
      return c.redirect(APP_SHELL_PATH, 302);
    } catch (signInError) {
      // Send them back to try again rather than showing an error page: almost
      // every failure here is an expired or abandoned handshake.
      console.error("[AUTH] sign-in failed:", signInError);
      return c.redirect("/login", 302);
    }
  });

  app.get("/logout", (c) => {
    clearSessionUser(c);
    return c.redirect("/login", 302);
  });

  // ── Server-to-server webhook (token auth, no session) ───────────────────────

  app.post("/webhook", async (c) => {
    const { WEBHOOK_SECRET, WEBHOOK_USER_ID } = c.env;
    if (!WEBHOOK_SECRET || !WEBHOOK_USER_ID) {
      return c.json({ detail: "Webhook is not configured on this server." }, 503);
    }

    const payload = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (payload.token !== WEBHOOK_SECRET) {
      return c.json({ detail: "Unauthorized: invalid token." }, 401);
    }

    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    if (!text) return c.json({ detail: "text is required." }, 400);

    const sender = typeof payload.sender === "string" ? payload.sender : FORGE_SENDER_NAME;

    await data.insertMessage(data.createSupabaseClient(c.env), {
      id: crypto.randomUUID(),
      user_id: WEBHOOK_USER_ID,
      sender,
      text,
      timestamp: currentTimestamp(),
    });

    await notifyUserTabs(c.env, WEBHOOK_USER_ID, { type: "new_message" });
    return c.json({ status: "delivered" });
  });

  /** Polling fallback for Forge Terminal, protected by the same shared secret. */
  app.get("/messages/recent", async (c) => {
    const { WEBHOOK_SECRET, WEBHOOK_USER_ID } = c.env;
    if (!WEBHOOK_SECRET || c.req.query("token") !== WEBHOOK_SECRET) {
      return c.json({ detail: "Unauthorized." }, 401);
    }
    if (!WEBHOOK_USER_ID) {
      return c.json({ detail: "WEBHOOK_USER_ID is not configured." }, 503);
    }

    const since = c.req.query("since") || "1970-01-01T00:00:00";
    const messages = await data.fetchRecentForWebhook(
      data.createSupabaseClient(c.env),
      WEBHOOK_USER_ID,
      since,
    );
    return c.json({ messages });
  });

  // ── Everything below requires a signed-in user ──────────────────────────────

  /**
   * Rejects anonymous requests before any handler runs.
   *
   * This gate is what protects the data. Queries run under the Supabase service
   * key, which bypasses row-level security, so an unauthenticated request that
   * reached a handler would be served in full.
   */
  app.use("/me", requireSignedIn);
  app.use("/events", requireSignedIn);
  app.use("/messages", requireSignedIn);
  app.use("/messages/:messageId", requireSignedIn);
  app.use("/messages/:messageId/star", requireSignedIn);
  app.use("/send", requireSignedIn);
  app.use("/send-image", requireSignedIn);
  app.use("/send-file", requireSignedIn);
  app.use("/snippets", requireSignedIn);
  app.use("/snippets/:snippetId", requireSignedIn);
  app.use("/clipboard", requireSignedIn);

  app.get("/me", (c) => c.json(c.get("user")));

  /**
   * The notification stream. Handing the request to the user's own Durable
   * Object is what replaces the FastAPI app's in-process subscriber list: it is
   * the one place every tab belonging to this user can reach.
   */
  app.get("/events", (c) => {
    const userId = c.get("user").sub;
    const hub = c.env.NOTIFICATION_HUB.get(c.env.NOTIFICATION_HUB.idFromName(userId));
    return hub.fetch(new Request("https://hub.internal/subscribe"));
  });

  // ── Messages ────────────────────────────────────────────────────────────────

  app.get("/messages", async (c) => {
    const result = await data.fetchMessages(data.createSupabaseClient(c.env), c.get("user").sub, {
      query: c.req.query("q") || undefined,
      date: c.req.query("date") || undefined,
      last: Number(c.req.query("last")) || undefined,
    });
    // The conversation must never come from a cache, or a reload can appear to
    // lose a message that was sent seconds earlier.
    return c.json(result, 200, { "Cache-Control": "no-store" });
  });

  app.post("/send", async (c) => {
    const user = c.get("user");
    const body = await c.req.parseBody();
    const text = formString(body, "msg");
    const sender = formString(body, "sender") || detectDevice(c.req.header("user-agent") ?? "");
    const expiresHours = Number(formString(body, "expires_hours")) || 0;

    const row: supabaseData.NewMessageRow = {
      id: crypto.randomUUID(),
      user_id: user.sub,
      sender,
      text,
      timestamp: currentTimestamp(),
    };
    if (expiresHours > 0) row.expires_at = timestampAfterHours(expiresHours);

    await data.insertMessage(data.createSupabaseClient(c.env), row);
    forwardToForgeTerminal(c, text, sender);
    await notifyUserTabs(c.env, user.sub, { type: "new_message" });

    return c.json({ status: "Message received" });
  });

  app.patch("/messages/:messageId/star", async (c) => {
    try {
      const result = await data.toggleStar(
        data.createSupabaseClient(c.env),
        c.get("user").sub,
        c.req.param("messageId"),
      );
      return c.json(result);
    } catch (starError) {
      const detail = starError instanceof Error ? starError.message : String(starError);
      // A message that is not the user's own is simply not found by the scoped
      // lookup, which is exactly the answer the caller should get.
      if (/not found/i.test(detail)) return c.json({ detail }, 404);
      throw starError;
    }
  });

  app.delete("/messages/:messageId", async (c) => {
    await data.removeMessage(
      data.createSupabaseClient(c.env),
      c.get("user").sub,
      c.req.param("messageId"),
    );
    return c.json({ status: "deleted" });
  });

  // ── Uploads ─────────────────────────────────────────────────────────────────

  app.post("/send-image", async (c) => {
    const user = c.get("user");
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File) || !file.name) {
      return c.json({ detail: "No file uploaded." }, 400);
    }

    const extension = extensionOf(file.name);
    if (!extension) {
      return c.json({ detail: "File must have an extension (e.g. .jpg, .png)" }, 400);
    }
    if (!ALLOWED_IMAGE_EXTENSIONS.has(extension)) {
      return c.json({ detail: "Unsupported file type." }, 400);
    }

    const imageUrl = await data.uploadToStorage(
      data.createSupabaseClient(c.env),
      c.env.SUPABASE_STORAGE_BUCKET,
      buildStorageKey("img", file.name),
      await file.arrayBuffer(),
      file.type || "image/jpeg",
    );

    await data.insertMessage(data.createSupabaseClient(c.env), {
      id: crypto.randomUUID(),
      user_id: user.sub,
      sender: formString(body, "sender") || detectDevice(c.req.header("user-agent") ?? ""),
      text: formString(body, "text"),
      image_url: imageUrl,
      timestamp: currentTimestamp(),
    });

    await notifyUserTabs(c.env, user.sub, { type: "new_message" });
    return c.json({ status: "Image received", image_url: imageUrl });
  });

  app.post("/send-file", async (c) => {
    const user = c.get("user");
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File) || !file.name) {
      return c.json({ detail: "No file uploaded." }, 400);
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return c.json({ detail: "File exceeds 25 MB limit." }, 400);
    }

    const fileUrl = await data.uploadToStorage(
      data.createSupabaseClient(c.env),
      c.env.SUPABASE_STORAGE_BUCKET,
      buildStorageKey("file", file.name),
      await file.arrayBuffer(),
      forceDownloadContentType(file.name, file.type || "application/octet-stream"),
    );

    await data.insertMessage(data.createSupabaseClient(c.env), {
      id: crypto.randomUUID(),
      user_id: user.sub,
      sender: formString(body, "sender") || detectDevice(c.req.header("user-agent") ?? ""),
      text: formString(body, "text"),
      file_url: fileUrl,
      file_name: file.name,
      timestamp: currentTimestamp(),
    });

    await notifyUserTabs(c.env, user.sub, { type: "new_message" });
    return c.json({ status: "File received", file_url: fileUrl, file_name: file.name });
  });

  // ── Snippets ────────────────────────────────────────────────────────────────

  app.get("/snippets", async (c) => {
    const snippets = await data.fetchSnippets(data.createSupabaseClient(c.env), c.get("user").sub);
    return c.json({ snippets });
  });

  app.post("/snippets", async (c) => {
    const body = await c.req.parseBody();
    const name = formString(body, "name");
    const content = formString(body, "content");
    if (!name.trim() || !content.trim()) {
      return c.json({ detail: "Name and content are required." }, 400);
    }

    const snippet = await data.insertSnippet(
      data.createSupabaseClient(c.env),
      c.get("user").sub,
      name,
      content,
    );
    return c.json({ snippet });
  });

  app.delete("/snippets/:snippetId", async (c) => {
    await data.removeSnippet(
      data.createSupabaseClient(c.env),
      c.get("user").sub,
      c.req.param("snippetId"),
    );
    return c.json({ status: "deleted" });
  });

  // ── Clipboard ───────────────────────────────────────────────────────────────

  app.get("/clipboard", async (c) => {
    const entry = await data.fetchClipboard(data.createSupabaseClient(c.env), c.get("user").sub);
    return c.json(entry, 200, { "Cache-Control": "no-store" });
  });

  app.post("/clipboard", async (c) => {
    const user = c.get("user");
    const body = await c.req.parseBody();

    await data.upsertClipboard(
      data.createSupabaseClient(c.env),
      user.sub,
      formString(body, "content"),
    );
    await notifyUserTabs(c.env, user.sub, { type: "clipboard_update" });

    return c.json({ status: "ok" });
  });

  // ── Static assets ───────────────────────────────────────────────────────────

  /**
   * The built React app. The shell names hashed bundle files, so a cached copy
   * pins a device to an old build — iOS home-screen apps are the worst offender,
   * holding it across launches until a force-quit.
   */
  app.get(APP_SHELL_PATH, async (c) => {
    const user = await readSessionUser(c, c.env.SESSION_SECRET_KEY);
    if (!user) return c.redirect("/login", 302);

    const shell = await c.env.ASSETS.fetch(new Request(new URL(APP_SHELL_PATH, c.req.url)));
    return new Response(shell.body, {
      status: shell.status,
      headers: {
        "content-type": shell.headers.get("content-type") ?? "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
    });
  });

  app.get("/", (c) => c.redirect(APP_SHELL_PATH, 302));

  /**
   * Everything unmatched is a bundle, icon or manifest from the built frontend.
   *
   * The React build emits its asset URLs under /static/, matching where FastAPI
   * mounted them. The asset store *is* that directory, so the prefix is stripped
   * here rather than changing the frontend build — which keeps the Render
   * deployment byte-identical and therefore a working rollback.
   */
  app.all("*", (c) => {
    const url = new URL(c.req.url);
    if (url.pathname.startsWith(STATIC_URL_PREFIX)) {
      url.pathname = url.pathname.slice(STATIC_URL_PREFIX.length - 1);
      return c.env.ASSETS.fetch(new Request(url, c.req.raw));
    }
    return c.env.ASSETS.fetch(c.req.raw);
  });

  return app;
}

/**
 * Sends a copy of the message to Forge Terminal, when that integration is on.
 *
 * Fired without awaiting, via waitUntil: Forge often runs on a home network the
 * Worker cannot reach, and the sender should not wait on a request that is
 * expected to time out.
 */
function forwardToForgeTerminal(
  c: { env: Env; executionCtx: unknown },
  text: string,
  sender: string,
): void {
  const { env } = c;
  if (!env.FORGE_INBOUND_URL || !env.WEBHOOK_SECRET || !text.trim()) return;

  const delivery = fetch(`${env.FORGE_INBOUND_URL}/api/notify/inbound`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, sender, token: env.WEBHOOK_SECRET }),
  }).catch((forwardError) => {
    console.warn("[FORGE] could not forward message:", forwardError);
  });

  // Reading executionCtx throws where one does not exist. Sending the message
  // must not depend on this optional integration, so a missing context degrades
  // to a plain background promise rather than failing the request.
  try {
    (c.executionCtx as ExecutionContext).waitUntil(delivery);
  } catch {
    // No execution context available; the fetch above is already in flight.
  }
}
