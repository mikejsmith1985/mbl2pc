/**
 * Tests for the Worker entry point: what Cloudflare invokes on a request, on the
 * cron schedule, and what it must export for the Durable Object binding to bind.
 */

import { describe, expect, it, vi } from "vitest";

import worker, { NotificationHub } from "./index";
import type { Env } from "./env";

/** An environment with just enough wired up to reach the scheduled handler. */
function createTestEnv(overrides: Partial<Env> = {}): Env {
  return {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_KEY: "service-key",
    SESSION_SECRET_KEY: "signing-key",
    ...overrides,
  } as Env;
}

describe("Durable Object export", () => {
  it("exports NotificationHub, which the binding resolves by class name", () => {
    // wrangler.toml names this class. Without the export the deploy succeeds and
    // every request to /events then fails at runtime.
    expect(NotificationHub).toBeTypeOf("function");
  });
});

describe("scheduled keepalive", () => {
  it("queries the database directly rather than over the network", async () => {
    // The app now runs inside this Worker, so the heartbeat no longer needs an
    // HTTP round trip to itself — and cannot be broken by a bad origin URL.
    const touchDatabase = vi.fn(async () => {});

    await worker.scheduled({} as ScheduledController, createTestEnv(), {} as ExecutionContext, {
      touchDatabase,
      createSupabaseClient: () => ({}) as never,
    } as never);

    expect(touchDatabase).toHaveBeenCalledOnce();
  });

  it("fails loudly when the database cannot be reached", async () => {
    // A thrown error marks the run failed in the Cloudflare dashboard, which is
    // the only warning before Supabase's 7-day pause window runs out.
    const touchDatabase = vi.fn(async () => {
      throw new Error("connection refused");
    });

    await expect(
      worker.scheduled({} as ScheduledController, createTestEnv(), {} as ExecutionContext, {
        touchDatabase,
        createSupabaseClient: () => ({}) as never,
      } as never),
    ).rejects.toThrow(/connection refused/);
  });

  it("fails loudly when Supabase is not configured at all", async () => {
    const env = createTestEnv({ SUPABASE_SERVICE_KEY: "" });

    await expect(
      worker.scheduled({} as ScheduledController, env, {} as ExecutionContext, {
        touchDatabase: vi.fn(async () => {}),
        createSupabaseClient: () => ({}) as never,
      } as never),
    ).rejects.toThrow(/not configured/i);
  });
});

describe("fetch handler", () => {
  it("serves the application", async () => {
    const response = await worker.fetch(
      new Request("https://mbl2pc.rootlevellabs.tech/health"),
      createTestEnv(),
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
