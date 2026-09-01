/**
 * The Worker's configuration surface, and the guards that make a misconfigured
 * deploy diagnosable instead of mysterious.
 *
 * The FastAPI app it replaces failed the same way on purpose: it listed every
 * missing OAuth variable at startup rather than throwing on the first request,
 * because a half-configured deploy is otherwise very hard to tell apart from a
 * broken one.
 */

export interface Env {
  // ── Google sign-in ──────────────────────────────────────────────────────────
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /** Absolute URL Google returns the visitor to, e.g. https://…/auth */
  OAUTH_REDIRECT_URI: string;
  /** Signing key for the session cookie. Any long random string. */
  SESSION_SECRET_KEY: string;

  // ── Supabase ────────────────────────────────────────────────────────────────
  SUPABASE_URL: string;
  /** service_role key. Stays server-side, which is why the app needs no RLS. */
  SUPABASE_SERVICE_KEY: string;
  SUPABASE_STORAGE_BUCKET: string;

  // ── Optional Forge Terminal integration ─────────────────────────────────────
  /** Shared secret for the server-to-server webhook. Empty disables it. */
  WEBHOOK_SECRET: string;
  /** Google `sub` of the user webhook messages are delivered to. */
  WEBHOOK_USER_ID: string;
  /** When set, messages the user sends are forwarded here. Empty disables it. */
  FORGE_INBOUND_URL: string;

  // ── Bindings ────────────────────────────────────────────────────────────────
  /** Per-user hub that fans server-sent events out to open browser tabs. */
  NOTIFICATION_HUB: DurableObjectNamespace;
  /** The built React app, served as static assets. */
  ASSETS: Fetcher;
}

/**
 * Variables without which the app cannot serve a signed-in user at all. The
 * webhook and Forge variables are deliberately absent: those features simply
 * switch themselves off when unset, exactly as they did in the FastAPI version.
 */
const REQUIRED_VARIABLE_NAMES = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "OAUTH_REDIRECT_URI",
  "SESSION_SECRET_KEY",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_KEY",
] as const satisfies readonly (keyof Env)[];

/** Lists every required variable that is missing or blank, for logging. */
export function describeMissingConfig(env: Env): string[] {
  return REQUIRED_VARIABLE_NAMES.filter((name) => !env[name]);
}

/** True when database and storage calls can actually be made. */
export function hasSupabaseConfig(env: Env): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);
}
