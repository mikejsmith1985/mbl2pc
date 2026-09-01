/** Tests for the environment-variable guards the Worker starts up behind. */

import { describe, expect, it } from "vitest";

import { describeMissingConfig, hasSupabaseConfig, type Env } from "./env";

/** A fully-populated environment, which individual tests then break on purpose. */
function completeEnv(): Env {
  return {
    GOOGLE_CLIENT_ID: "client-id",
    GOOGLE_CLIENT_SECRET: "client-secret",
    OAUTH_REDIRECT_URI: "https://mbl2pc.rootlevellabs.tech/auth",
    SESSION_SECRET_KEY: "a-long-random-string",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_KEY: "service-key",
    SUPABASE_STORAGE_BUCKET: "mbl2pc-files",
    WEBHOOK_SECRET: "",
    WEBHOOK_USER_ID: "",
    FORGE_INBOUND_URL: "",
  } as Env;
}

describe("describeMissingConfig", () => {
  it("reports nothing when every required variable is present", () => {
    expect(describeMissingConfig(completeEnv())).toEqual([]);
  });

  it("names each missing variable so a misconfigured deploy is diagnosable", () => {
    const env = completeEnv();
    env.GOOGLE_CLIENT_SECRET = "";
    env.SUPABASE_URL = "";

    const missing = describeMissingConfig(env);

    expect(missing).toContain("GOOGLE_CLIENT_SECRET");
    expect(missing).toContain("SUPABASE_URL");
    expect(missing).toHaveLength(2);
  });

  it("treats the optional webhook and Forge variables as optional", () => {
    const env = completeEnv();
    env.WEBHOOK_SECRET = "";
    env.WEBHOOK_USER_ID = "";
    env.FORGE_INBOUND_URL = "";

    expect(describeMissingConfig(env)).toEqual([]);
  });
});

describe("hasSupabaseConfig", () => {
  it("is true only when both the URL and the service key are set", () => {
    expect(hasSupabaseConfig(completeEnv())).toBe(true);
  });

  it("is false when the service key is absent", () => {
    const env = completeEnv();
    env.SUPABASE_SERVICE_KEY = "";

    expect(hasSupabaseConfig(env)).toBe(false);
  });
});
