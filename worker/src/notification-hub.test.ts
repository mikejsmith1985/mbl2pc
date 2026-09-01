/**
 * Tests for the per-user hub that fans server-sent events out to open tabs.
 *
 * The FastAPI app kept a dictionary of asyncio queues in process memory. That
 * cannot survive the move to Workers, where each request may run in a different
 * isolate with no shared memory — hence a Durable Object, which is the one place
 * Cloudflare guarantees a single instance all of a user's tabs can reach.
 */

import { describe, expect, it, vi, afterEach } from "vitest";

import { NotificationHub, HEARTBEAT_INTERVAL_MS } from "./notification-hub";

/** Reads however many SSE frames are already buffered, without blocking. */
async function readBufferedFrames(response: Response, frameCount: number): Promise<string[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const frames: string[] = [];
  for (let i = 0; i < frameCount; i += 1) {
    const { value, done } = await reader.read();
    if (done) break;
    frames.push(decoder.decode(value));
  }
  reader.releaseLock();
  return frames;
}

function createHub(): NotificationHub {
  return new NotificationHub();
}

const subscribeRequest = () => new Request("https://hub.internal/subscribe");
const publishRequest = (payload: unknown) =>
  new Request("https://hub.internal/publish", {
    method: "POST",
    body: JSON.stringify(payload),
  });

afterEach(() => {
  vi.useRealTimers();
});

describe("subscribing", () => {
  it("answers with an event-stream rather than a buffered body", async () => {
    const response = await createHub().fetch(subscribeRequest());

    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache");
  });

  it("sends an opening frame immediately so the browser sees a live stream", async () => {
    // The client treats silence as a dead connection, so the very first byte
    // has to arrive without waiting for the first heartbeat tick.
    const response = await createHub().fetch(subscribeRequest());

    const [firstFrame] = await readBufferedFrames(response, 1);

    expect(firstFrame).toContain('"type"');
  });
});

describe("publishing", () => {
  it("delivers a payload to a subscribed stream", async () => {
    const hub = createHub();
    const stream = await hub.fetch(subscribeRequest());

    const publishResponse = await hub.fetch(publishRequest({ type: "new_message" }));

    expect(await publishResponse.json()).toEqual({ delivered: 1 });
    const frames = await readBufferedFrames(stream, 2);
    expect(frames.join("")).toContain('"type":"new_message"');
  });

  it("reaches every tab the same user has open", async () => {
    const hub = createHub();
    await hub.fetch(subscribeRequest());
    await hub.fetch(subscribeRequest());

    const publishResponse = await hub.fetch(publishRequest({ type: "clipboard_update" }));

    expect(await publishResponse.json()).toEqual({ delivered: 2 });
  });

  it("reports zero when nobody is listening", async () => {
    const publishResponse = await createHub().fetch(publishRequest({ type: "new_message" }));

    expect(await publishResponse.json()).toEqual({ delivered: 0 });
  });
});

describe("heartbeat", () => {
  it("beats often enough for the client's staleness check", () => {
    // useSSE.ts declares a stream dead after 80s without contact, describing it
    // as three missed beats. Any slower and a healthy stream looks dead.
    const CLIENT_STALE_AFTER_MS = 80_000;

    expect(HEARTBEAT_INTERVAL_MS * 3).toBeLessThanOrEqual(CLIENT_STALE_AFTER_MS);
  });

  it("emits a heartbeat frame once the interval elapses", async () => {
    vi.useFakeTimers();
    const response = await createHub().fetch(subscribeRequest());
    await readBufferedFrames(response, 1);

    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS + 100);

    const [heartbeatFrame] = await readBufferedFrames(response, 1);
    expect(heartbeatFrame).toContain('"type":"heartbeat"');
  });
});

describe("disconnection", () => {
  it("forgets a stream whose reader has gone away", async () => {
    const hub = createHub();
    const stream = await hub.fetch(subscribeRequest());
    await stream.body!.cancel();

    // The first publish discovers the broken pipe; the second sees a clean hub.
    await hub.fetch(publishRequest({ type: "new_message" }));
    const secondPublish = await hub.fetch(publishRequest({ type: "new_message" }));

    expect(await secondPublish.json()).toEqual({ delivered: 0 });
  });
});
