/**
 * The signed session cookie that identifies a signed-in user.
 *
 * The FastAPI app used Starlette's SessionMiddleware, which signs a cookie with
 * itsdangerous and stores the Google profile inside it. This is the same idea on
 * Hono's signed cookies, which sign with HMAC-SHA256 via the Web Crypto API that
 * Workers provide natively.
 *
 * The signature is load-bearing, not decoration. Every database query is scoped
 * by the `sub` in this cookie and runs under the Supabase service key, which
 * bypasses row-level security — so an unsigned cookie would let anyone read any
 * account simply by editing their own `sub`.
 */

import type { Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";

/** Name of the cookie holding the signed session. */
export const SESSION_COOKIE_NAME = "mbl2pc_session";

/** How long a sign-in lasts before the user has to authenticate again. */
const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

/** The Google profile fields the UI displays, matching the FastAPI session shape. */
export interface SessionUser {
  /** Google's stable user identifier. Every row in the database is keyed on it. */
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}

/** True when a decoded payload is a usable identity rather than merely valid JSON. */
function isUsableIdentity(payload: unknown): payload is SessionUser {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as SessionUser).sub === "string" &&
    (payload as SessionUser).sub.length > 0
  );
}

/** Signs the user into this browser by writing the session cookie. */
export async function writeSessionUser(
  c: Context,
  user: SessionUser,
  signingKey: string,
): Promise<void> {
  await setSignedCookie(c, SESSION_COOKIE_NAME, JSON.stringify(user), signingKey, {
    httpOnly: true,
    secure: true,
    // Lax rather than Strict: the visitor arrives back from accounts.google.com
    // as a cross-site navigation, and Strict would withhold the cookie on that
    // very first request — sign-in would appear to work and instantly log out.
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_LIFETIME_SECONDS,
  });
}

/**
 * Returns the signed-in user, or null when the request is anonymous.
 *
 * Null covers every failure alike — absent, expired, tampered, or structurally
 * wrong — because the caller's response is identical in all four cases and
 * distinguishing them would only tell an attacker which guess was closer.
 */
export async function readSessionUser(
  c: Context,
  signingKey: string,
): Promise<SessionUser | null> {
  const cookieValue = await getSignedCookie(c, signingKey, SESSION_COOKIE_NAME);
  if (!cookieValue) return null;

  try {
    const payload: unknown = JSON.parse(cookieValue);
    return isUsableIdentity(payload) ? payload : null;
  } catch {
    return null;
  }
}

/** Signs the user out of this browser. */
export function clearSessionUser(c: Context): void {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
}
