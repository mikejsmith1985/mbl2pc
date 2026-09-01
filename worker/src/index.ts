/**
 * Cloudflare Worker fronting mbl2pc: it keeps the Supabase database awake on a
 * schedule, and serves the app from mbl2pc.rootlevellabs.tech.
 *
 * Why this exists
 * ---------------
 * mbl2pc used to ping itself every 10 minutes so its web host would never idle.
 * That worked, but it kept the service running around the clock and consumed the
 * entire monthly free-instance-hour allowance for a tool that is only used in
 * short bursts. The service is now allowed to sleep.
 *
 * Something still has to keep the database alive: Supabase pauses a free project
 * after 7 days with no database activity, and only a manual dashboard click
 * brings it back. That heartbeat cannot live inside a service that is allowed to
 * sleep, so it lives here instead — a scheduler that keeps running regardless.
 */

// ── Constants ──────────────────────────────────────────────────────────────────

/**
 * The origin endpoint that deliberately queries the database. It is separate
 * from the host's own /health probe on purpose: /health must never depend on the
 * database, or a database blip would make the host restart a healthy service.
 */
export const KEEPALIVE_PATH = "/internal/keepalive";

/** The only `database` value from the heartbeat that means everything is well. */
const DATABASE_STATE_REACHABLE = "reachable";

/**
 * Redirects must reach the visitor's browser rather than being resolved here.
 * Google sign-in is a chain of redirects; a Worker that followed them itself
 * would swallow the handshake and login would hang.
 */
const DO_NOT_FOLLOW_REDIRECTS = "manual";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Env {
  /** Base URL of the FastAPI app, e.g. https://mbl2pc.onrender.com */
  ORIGIN_BASE_URL: string;
}

/** Shape of the JSON the keepalive endpoint answers with. */
interface KeepaliveReport {
  status: string;
  database: string;
}

// ── Scheduled heartbeat ────────────────────────────────────────────────────────

/**
 * Calls the origin's keepalive endpoint so Supabase registers database activity.
 *
 * Throws on any unhealthy result rather than logging quietly. A thrown error
 * marks the run as failed in the Cloudflare dashboard, which is the only way a
 * broken heartbeat becomes visible before the 7-day pause window runs out.
 */
async function runScheduledKeepalive(env: Env): Promise<void> {
  const keepaliveUrl = `${env.ORIGIN_BASE_URL}${KEEPALIVE_PATH}`;
  const response = await fetch(keepaliveUrl);

  if (!response.ok) {
    throw new Error(`Keepalive ping to ${keepaliveUrl} returned ${response.status}`);
  }

  // The endpoint answers 200 even when the database is down — it is a heartbeat,
  // not a health check. So the body, not the status code, is what must be read.
  const report = (await response.json()) as KeepaliveReport;

  if (report.database !== DATABASE_STATE_REACHABLE) {
    throw new Error(
      `Keepalive ping succeeded but the database is "${report.database}" — ` +
        "Supabase is not registering activity and will pause.",
    );
  }

  console.log(`[KEEPALIVE] database ${report.database}`);
}

// ── Domain proxy ───────────────────────────────────────────────────────────────

/**
 * Passes a visitor's request straight through to the FastAPI origin.
 *
 * This is deliberately a thin passthrough. As the app is ported off its current
 * host, individual routes get answered here natively instead, and the proxy
 * shrinks — so the domain can move today without waiting for the whole port.
 */
async function proxyRequestToOrigin(request: Request, env: Env): Promise<Response> {
  if (!env.ORIGIN_BASE_URL) {
    return new Response("ORIGIN_BASE_URL is not configured for this Worker.", {
      status: 500,
    });
  }

  const incomingUrl = new URL(request.url);
  const targetUrl = `${env.ORIGIN_BASE_URL}${incomingUrl.pathname}${incomingUrl.search}`;

  const forwardedRequest = new Request(targetUrl, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: DO_NOT_FOLLOW_REDIRECTS,
    // Required when forwarding a streamed body; harmless when there is none.
    ...(request.body ? { duplex: "half" } : {}),
  } as RequestInit);

  const originResponse = await fetch(forwardedRequest);

  // Rebuilt rather than returned as-is so the headers are mutable downstream.
  // Passing the body through untouched is what keeps the /events SSE stream live.
  return new Response(originResponse.body, originResponse);
}

// ── Worker entry points ────────────────────────────────────────────────────────

export default {
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    await runScheduledKeepalive(env);
  },

  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    return proxyRequestToOrigin(request, env);
  },
};
