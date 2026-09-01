/**
 * Tests for the Cloudflare Worker that fronts mbl2pc: it keeps the Supabase
 * database awake on a schedule, and serves the app on its own domain.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

import worker, { KEEPALIVE_PATH, type Env } from "./index";

const ORIGIN_BASE_URL = "https://mbl2pc-fastapi.onrender.com";
const env: Env = { ORIGIN_BASE_URL };

/** Builds the JSON body the keepalive endpoint returns, for a given db state. */
function keepaliveResponse(databaseState: string, status = 200): Response {
  return new Response(JSON.stringify({ status: "ok", database: databaseState }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Replaces global fetch with a spy, so no test ever reaches the network. */
function stubFetch(response: Response | (() => Response)) {
  const fetchSpy = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      typeof response === "function" ? response() : response,
  );
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

// ── Scheduled heartbeat ────────────────────────────────────────────────────────

describe("scheduled keepalive", () => {
  it("queries the keepalive endpoint on the configured origin", async () => {
    const fetchSpy = stubFetch(keepaliveResponse("reachable"));

    await worker.scheduled({} as ScheduledController, env, {} as ExecutionContext);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const requestedUrl = fetchSpy.mock.calls[0][0] as string;
    expect(requestedUrl).toBe(`${ORIGIN_BASE_URL}${KEEPALIVE_PATH}`);
  });

  it("fails loudly when the database is unreachable", async () => {
    // A 200 that reports an unreachable database is the dangerous case: the ping
    // looks successful while Supabase quietly slides toward its 7-day pause.
    stubFetch(keepaliveResponse("unreachable"));

    await expect(
      worker.scheduled({} as ScheduledController, env, {} as ExecutionContext),
    ).rejects.toThrow(/unreachable/i);
  });

  it("fails loudly when the origin returns an error status", async () => {
    stubFetch(keepaliveResponse("reachable", 502));

    await expect(
      worker.scheduled({} as ScheduledController, env, {} as ExecutionContext),
    ).rejects.toThrow(/502/);
  });
});

// ── Domain proxy ───────────────────────────────────────────────────────────────

describe("request proxy", () => {
  it("forwards the method, path and body to the origin", async () => {
    const fetchSpy = stubFetch(new Response("sent"));
    const incoming = new Request("https://mbl2pc.rootlevellabs.tech/send", {
      method: "POST",
      body: "text=hello",
    });

    await worker.fetch(incoming, env, {} as ExecutionContext);

    const forwarded = fetchSpy.mock.calls[0][0] as Request;
    expect(forwarded.url).toBe(`${ORIGIN_BASE_URL}/send`);
    expect(forwarded.method).toBe("POST");
    expect(await forwarded.text()).toBe("text=hello");
  });

  it("preserves the query string", async () => {
    const fetchSpy = stubFetch(new Response("[]"));
    const incoming = new Request("https://mbl2pc.rootlevellabs.tech/messages?limit=20");

    await worker.fetch(incoming, env, {} as ExecutionContext);

    const forwarded = fetchSpy.mock.calls[0][0] as Request;
    expect(forwarded.url).toBe(`${ORIGIN_BASE_URL}/messages?limit=20`);
  });

  it("does not follow redirects, so the OAuth handshake reaches the browser", async () => {
    // Google sign-in works by redirecting the visitor. If the Worker followed
    // the redirect itself the visitor would never leave, and login would hang.
    const fetchSpy = stubFetch(new Response("", { status: 302 }));
    const incoming = new Request("https://mbl2pc.rootlevellabs.tech/login");

    await worker.fetch(incoming, env, {} as ExecutionContext);

    const forwarded = fetchSpy.mock.calls[0][0] as Request;
    expect(forwarded.redirect).toBe("manual");
  });

  it("passes the session cookie back to the browser", async () => {
    stubFetch(
      new Response("", { status: 302, headers: { "set-cookie": "session=abc; Path=/" } }),
    );
    const incoming = new Request("https://mbl2pc.rootlevellabs.tech/auth?code=xyz");

    const response = await worker.fetch(incoming, env, {} as ExecutionContext);

    expect(response.headers.get("set-cookie")).toBe("session=abc; Path=/");
  });

  it("rejects a request when the origin is not configured", async () => {
    stubFetch(new Response("unused"));
    const incoming = new Request("https://mbl2pc.rootlevellabs.tech/");

    const response = await worker.fetch(incoming, { ORIGIN_BASE_URL: "" }, {} as ExecutionContext);

    expect(response.status).toBe(500);
  });
});
