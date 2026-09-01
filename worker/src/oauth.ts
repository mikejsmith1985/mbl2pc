/**
 * Google sign-in, replacing Authlib's role in the FastAPI app.
 *
 * The handshake has two legs that arrive as separate HTTP requests: the visitor
 * is sent to Google, and Google sends them back with a code. A Worker keeps
 * nothing in memory between the two, so the values that tie them together — the
 * CSRF state and the PKCE verifier — travel in short-lived cookies.
 */

import { Google, decodeIdToken, generateCodeVerifier, generateState } from "arctic";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import type { Env } from "./env";
import type { SessionUser } from "./session";

/** Carries the CSRF state between the two legs of the handshake. */
export const OAUTH_STATE_COOKIE = "mbl2pc_oauth_state";

/** Carries the PKCE code verifier between the two legs of the handshake. */
export const OAUTH_VERIFIER_COOKIE = "mbl2pc_oauth_verifier";

/**
 * How long the visitor has to complete sign-in at Google.
 *
 * Long enough to pick an account and pass a two-factor prompt, short enough
 * that an abandoned attempt does not leave a usable cookie lying around.
 */
const HANDSHAKE_LIFETIME_SECONDS = 10 * 60;

/** openid gives the ID token; email and profile fill the avatar and name in the UI. */
const REQUESTED_SCOPES = ["openid", "email", "profile"];

/** The claims this app reads out of Google's ID token. */
interface GoogleIdTokenClaims {
  sub?: unknown;
  email?: unknown;
  name?: unknown;
  picture?: unknown;
  /** Google sends many more claims (iss, aud, exp…) that this app ignores. */
  [otherClaim: string]: unknown;
}

function createGoogleClient(env: Env): Google {
  return new Google(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.OAUTH_REDIRECT_URI);
}

/** Writes one leg-to-leg handshake cookie. */
function setHandshakeCookie(c: Context, name: string, value: string): void {
  setCookie(c, name, value, {
    httpOnly: true,
    secure: true,
    // Lax, not Strict: Google returns the visitor as a cross-site navigation,
    // and Strict would withhold these cookies on exactly that request.
    sameSite: "Lax",
    path: "/",
    maxAge: HANDSHAKE_LIFETIME_SECONDS,
  });
}

/** Sends the visitor to Google, remembering what the callback will need to check. */
export function startGoogleSignIn(c: Context, env: Env): Response {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();

  setHandshakeCookie(c, OAUTH_STATE_COOKIE, state);
  setHandshakeCookie(c, OAUTH_VERIFIER_COOKIE, codeVerifier);

  const authorizationUrl = createGoogleClient(env).createAuthorizationURL(
    state,
    codeVerifier,
    REQUESTED_SCOPES,
  );

  return c.redirect(authorizationUrl.toString(), 302);
}

/** Why a callback could not be turned into a session. Surfaced only in logs. */
export class SignInFailedError extends Error {}

/**
 * Completes the handshake and returns the signed-in user's profile.
 *
 * The state comparison is the CSRF defence: without it, an attacker could hand
 * the victim a link that completes sign-in as the attacker's own account, and
 * everything the victim then sent would land in the attacker's message history.
 */
export async function completeGoogleSignIn(c: Context, env: Env): Promise<SessionUser> {
  const returnedCode = c.req.query("code");
  const returnedState = c.req.query("state");
  const expectedState = getCookie(c, OAUTH_STATE_COOKIE);
  const codeVerifier = getCookie(c, OAUTH_VERIFIER_COOKIE);

  clearHandshakeCookies(c);

  if (!returnedCode || !returnedState || !expectedState || !codeVerifier) {
    throw new SignInFailedError("Sign-in callback was missing its handshake values.");
  }
  if (returnedState !== expectedState) {
    throw new SignInFailedError("Sign-in state did not match; possible cross-site attempt.");
  }

  const tokens = await createGoogleClient(env).validateAuthorizationCode(
    returnedCode,
    codeVerifier,
  );

  return buildProfileFromIdToken(decodeIdToken(tokens.idToken()) as GoogleIdTokenClaims);
}

/** Removes the handshake cookies, which are useless once the callback has run. */
export function clearHandshakeCookies(c: Context): void {
  deleteCookie(c, OAUTH_STATE_COOKIE, { path: "/" });
  deleteCookie(c, OAUTH_VERIFIER_COOKIE, { path: "/" });
}

/** Reads an optional string claim, ignoring anything that is not a string. */
function optionalString(claim: unknown): string | undefined {
  return typeof claim === "string" ? claim : undefined;
}

/**
 * Narrows Google's ID token to the four fields the session stores.
 *
 * `sub` is mandatory because every row in the database is keyed on it; a token
 * without one cannot identify an account, so it is rejected rather than stored
 * as an empty string that would silently collide with other broken sessions.
 */
export function buildProfileFromIdToken(claims: GoogleIdTokenClaims): SessionUser {
  if (typeof claims.sub !== "string" || claims.sub.length === 0) {
    throw new SignInFailedError("Google ID token carried no usable `sub` claim.");
  }

  return {
    sub: claims.sub,
    email: optionalString(claims.email),
    name: optionalString(claims.name),
    picture: optionalString(claims.picture),
  };
}
