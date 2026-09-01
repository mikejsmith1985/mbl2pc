/**
 * Tests for the signed session cookie that replaces Starlette's SessionMiddleware.
 */

import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import {
  SESSION_COOKIE_NAME,
  clearSessionUser,
  readSessionUser,
  writeSessionUser,
  type SessionUser,
} from "./session";

const SIGNING_KEY = "a-long-random-signing-key";

const signedInUser: SessionUser = {
  sub: "google-sub-123",
  email: "someone@example.com",
  name: "Someone",
  picture: "https://example.com/avatar.png",
};

/**
 * A tiny app exposing the three session operations, so the cookie is exercised
 * through real requests and responses rather than by calling crypto directly.
 */
function createSessionTestApp() {
  const app = new Hono();
  app.get("/sign-in", async (c) => {
    await writeSessionUser(c, signedInUser, SIGNING_KEY);
    return c.text("signed in");
  });
  app.get("/whoami", async (c) => {
    const user = await readSessionUser(c, SIGNING_KEY);
    return user ? c.json(user) : c.text("anonymous", 401);
  });
  app.get("/sign-out", (c) => {
    clearSessionUser(c);
    return c.text("signed out");
  });
  return app;
}

/** Pulls the cookie value out of a Set-Cookie header for replay on the next request. */
function extractCookie(response: Response): string {
  return response.headers.get("set-cookie")!.split(";")[0];
}

describe("session round trip", () => {
  it("returns the same user that was signed in", async () => {
    const app = createSessionTestApp();
    const signIn = await app.request("/sign-in");

    const whoami = await app.request("/whoami", {
      headers: { cookie: extractCookie(signIn) },
    });

    expect(whoami.status).toBe(200);
    expect(await whoami.json()).toEqual(signedInUser);
  });

  it("treats a request with no cookie as anonymous", async () => {
    const whoami = await createSessionTestApp().request("/whoami");

    expect(whoami.status).toBe(401);
  });
});

describe("tamper resistance", () => {
  it("rejects a cookie whose payload was edited", async () => {
    // Without a signature check, anyone could set `sub` to another user's ID and
    // read their messages — the service key means the server does no other check.
    const app = createSessionTestApp();
    const signIn = await app.request("/sign-in");
    const tampered = extractCookie(signIn).replace(/.$/, "X");

    const whoami = await app.request("/whoami", { headers: { cookie: tampered } });

    expect(whoami.status).toBe(401);
  });

  it("rejects a cookie signed with a different key", async () => {
    const app = new Hono();
    app.get("/whoami", async (c) => {
      const user = await readSessionUser(c, "the-real-key");
      return user ? c.json(user) : c.text("anonymous", 401);
    });
    const forger = createSessionTestApp();
    const forged = extractCookie(await forger.request("/sign-in"));

    const whoami = await app.request("/whoami", { headers: { cookie: forged } });

    expect(whoami.status).toBe(401);
  });
});

describe("cookie attributes", () => {
  it("is HttpOnly, Secure and SameSite=Lax", async () => {
    const signIn = await createSessionTestApp().request("/sign-in");

    const setCookie = signIn.headers.get("set-cookie")!;

    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
  });

  it("uses SameSite=Lax so the cookie survives Google's redirect back", async () => {
    // Strict would drop the cookie on the cross-site return from accounts.google.com,
    // which would make sign-in appear to succeed and then immediately log out.
    const signIn = await createSessionTestApp().request("/sign-in");

    expect(signIn.headers.get("set-cookie")).not.toContain("SameSite=Strict");
  });
});

describe("signing out", () => {
  it("expires the cookie", async () => {
    const signOut = await createSessionTestApp().request("/sign-out");

    const setCookie = signOut.headers.get("set-cookie")!;

    expect(setCookie).toContain(SESSION_COOKIE_NAME);
    expect(setCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
  });
});

describe("malformed sessions", () => {
  it("rejects a validly-signed cookie whose payload is not a user", async () => {
    // Mirrors the FastAPI guard: a session without `sub` is not a usable identity.
    const app = new Hono();
    app.get("/sign-in", async (c) => {
      await writeSessionUser(c, { email: "no-sub@example.com" } as SessionUser, SIGNING_KEY);
      return c.text("signed in");
    });
    app.get("/whoami", async (c) => {
      const user = await readSessionUser(c, SIGNING_KEY);
      return user ? c.json(user) : c.text("anonymous", 401);
    });

    const signIn = await app.request("/sign-in");
    const whoami = await app.request("/whoami", { headers: { cookie: extractCookie(signIn) } });

    expect(whoami.status).toBe(401);
  });
});
