/**
 * Tests for the Google sign-in handshake.
 *
 * The FastAPI app delegated this to Authlib. Arctic plays the same role here,
 * so these tests cover the parts this app owns: where the visitor is sent, what
 * is remembered between the two legs of the handshake, and what is refused.
 */

import { Hono } from "hono";
import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  buildProfileFromIdToken,
  startGoogleSignIn,
} from "./oauth";
import type { Env } from "./env";

const env = {
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  OAUTH_REDIRECT_URI: "https://mbl2pc.rootlevellabs.tech/auth",
} as Env;

function createSignInApp() {
  const app = new Hono();
  app.get("/login", (c) => startGoogleSignIn(c, env));
  return app;
}

/** Collects every Set-Cookie header, since Hono may send several. */
function allSetCookies(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  return headers.getSetCookie?.().join("; ") ?? headers.get("set-cookie") ?? "";
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("starting sign-in", () => {
  it("redirects the visitor to Google", async () => {
    const response = await createSignInApp().request("/login");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("accounts.google.com");
  });

  it("asks Google for the profile fields the UI displays", async () => {
    const response = await createSignInApp().request("/login");

    const location = new URL(response.headers.get("location")!);
    const scopes = location.searchParams.get("scope") ?? "";

    expect(scopes).toContain("openid");
    expect(scopes).toContain("email");
    expect(scopes).toContain("profile");
  });

  it("sends the redirect URI the deployment is configured with", async () => {
    const response = await createSignInApp().request("/login");

    const location = new URL(response.headers.get("location")!);

    expect(location.searchParams.get("redirect_uri")).toBe(env.OAUTH_REDIRECT_URI);
  });

  it("remembers the state and PKCE verifier for the callback to check", async () => {
    // Both legs run in different requests, and a Worker keeps nothing in memory
    // between them, so the handshake state has to travel in cookies.
    const response = await createSignInApp().request("/login");

    const cookies = allSetCookies(response);

    expect(cookies).toContain(OAUTH_STATE_COOKIE);
    expect(cookies).toContain(OAUTH_VERIFIER_COOKIE);
  });

  it("keeps the handshake cookies HttpOnly", async () => {
    const response = await createSignInApp().request("/login");

    expect(allSetCookies(response)).toContain("HttpOnly");
  });

  it("uses a different state on every attempt", async () => {
    const app = createSignInApp();

    const first = new URL((await app.request("/login")).headers.get("location")!);
    const second = new URL((await app.request("/login")).headers.get("location")!);

    expect(first.searchParams.get("state")).not.toBe(second.searchParams.get("state"));
  });
});

describe("buildProfileFromIdToken", () => {
  it("keeps exactly the fields the session stores", () => {
    const profile = buildProfileFromIdToken({
      sub: "google-sub-123",
      email: "someone@example.com",
      name: "Someone",
      picture: "https://example.com/avatar.png",
      iss: "https://accounts.google.com",
      aud: "client-id",
    });

    expect(profile).toEqual({
      sub: "google-sub-123",
      email: "someone@example.com",
      name: "Someone",
      picture: "https://example.com/avatar.png",
    });
  });

  it("tolerates a token carrying no optional profile fields", () => {
    const profile = buildProfileFromIdToken({ sub: "google-sub-123" });

    expect(profile.sub).toBe("google-sub-123");
    expect(profile.email).toBeUndefined();
  });

  it("refuses a token with no subject", () => {
    // `sub` is the identity every row in the database is keyed on. A token
    // without one cannot be turned into a session at all.
    expect(() => buildProfileFromIdToken({ email: "someone@example.com" })).toThrow(/sub/i);
  });

  it("refuses a token whose subject is not a string", () => {
    expect(() => buildProfileFromIdToken({ sub: 12345 })).toThrow(/sub/i);
  });
});
