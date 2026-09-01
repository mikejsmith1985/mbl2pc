/**
 * The mbl2pc application, running entirely on Cloudflare.
 *
 * This replaces the FastAPI app that ran on Render. That app was on a free tier
 * that sleeps after fifteen idle minutes, so the first request after a quiet
 * period waited thirty to fifty seconds for the service to wake. Workers have no
 * such state to restore: there is nothing to spin down, and nothing to spin up.
 *
 * The React frontend is unchanged. Every route in `handlers.ts` matches what
 * `frontend/src/api.ts` already calls, so the port is invisible from the browser.
 *
 * Three responsibilities live here:
 *   fetch      — serves the app and its static assets
 *   scheduled  — the six-hourly heartbeat that stops Supabase pausing
 *   the export — NotificationHub, which the Durable Object binding resolves
 */

import { createApp, type DataLayer } from "./handlers";
import { hasSupabaseConfig, describeMissingConfig, type Env } from "./env";
import * as supabaseData from "./supabase";

export { NotificationHub } from "./notification-hub";

/** Built once per isolate; Hono routing is stateless, so it is safe to reuse. */
const app = createApp();

/**
 * Queries the database on a schedule so Supabase does not pause the project.
 *
 * Supabase pauses a free project after seven days without database activity, and
 * only a manual dashboard click brings it back. This used to be an HTTP request
 * the app made to itself; now the app runs here, so it is a direct query — one
 * fewer moving part, and immune to a mistyped origin URL.
 *
 * Errors are thrown rather than logged. A thrown error marks the run failed in
 * the Cloudflare dashboard, which is the only warning that arrives before the
 * seven-day window runs out.
 */
async function runScheduledKeepalive(env: Env, data: DataLayer): Promise<void> {
  if (!hasSupabaseConfig(env)) {
    throw new Error(
      `Keepalive cannot run: Supabase is not configured (missing ${describeMissingConfig(env).join(", ")}).`,
    );
  }

  await data.touchDatabase(data.createSupabaseClient(env));
  console.log("[KEEPALIVE] database reachable");
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    return app.fetch(request, env, ctx);
  },

  scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
    // Injected only by tests; production always uses the real data layer.
    data: DataLayer = supabaseData,
  ): Promise<void> {
    return runScheduledKeepalive(env, data);
  },
};
