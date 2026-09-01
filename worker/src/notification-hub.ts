/**
 * Per-user hub that fans server-sent events out to every tab that user has open.
 *
 * Why a Durable Object
 * --------------------
 * The FastAPI app held a dictionary of asyncio queues in process memory: one
 * list of subscribers per user, and /send pushed a notification onto each. That
 * works only while a single process serves every request.
 *
 * Workers have no shared memory — two requests from the same person can run in
 * different isolates, in different cities. A Durable Object is Cloudflare's
 * answer: exactly one instance exists per name, and every request addressed to
 * that name reaches it. Naming each instance after the user's Google `sub`
 * reproduces the old per-user queue list precisely.
 *
 * Nothing here is persisted. An open connection is meaningless once the isolate
 * holding it is gone, so there is no state worth surviving a restart.
 */

const encoder = new TextEncoder();

/**
 * How often a heartbeat frame is sent down an idle stream.
 *
 * The browser cannot tell a quiet connection from a dead one, so the client
 * (`useSSE.ts`) declares a stream stale after 80 seconds of silence and
 * reconnects. Beating every 25 seconds gives three chances to be heard inside
 * that window, which is what makes a single dropped frame harmless.
 */
export const HEARTBEAT_INTERVAL_MS = 25_000;

/** Frames are plain SSE `data:` lines — the payload is always JSON. */
function encodeFrame(payload: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

export class NotificationHub {
  /** One writer per open tab. A failed write means the tab has gone. */
  private readonly openStreams = new Set<WritableStreamDefaultWriter>();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/publish")) {
      const payload = await request.json();
      return this.publishToOpenStreams(payload);
    }

    return this.openEventStream();
  }

  /**
   * Writes a payload to every open stream, dropping any that have closed.
   *
   * Delivery is not awaited. A tab whose reader has stalled must not hold up
   * the request that triggered the notification — that request is a user
   * sending a message, and it should return as soon as the database write does.
   */
  private publishToOpenStreams(payload: unknown): Response {
    const frame = encodeFrame(payload);
    let deliveredCount = 0;

    for (const stream of this.openStreams) {
      deliveredCount += 1;
      stream.write(frame).catch(() => this.forgetStream(stream));
    }

    return Response.json({ delivered: deliveredCount });
  }

  /**
   * Opens a new server-sent event stream for one tab.
   *
   * The opening frame is written without awaiting: nothing reads the readable
   * end until this Response is returned, so awaiting the first write deadlocks
   * and the browser receives an open socket that never delivers a byte.
   */
  private openEventStream(): Response {
    const { readable, writable } = new TransformStream();
    const stream = writable.getWriter();
    this.openStreams.add(stream);

    stream.write(encodeFrame({ type: "connected" })).catch(() => this.forgetStream(stream));

    const heartbeatTimer = setInterval(() => {
      stream.write(encodeFrame({ type: "heartbeat" })).catch(() => {
        clearInterval(heartbeatTimer);
        this.forgetStream(stream);
      });
    }, HEARTBEAT_INTERVAL_MS);

    return new Response(readable, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      },
    });
  }

  private forgetStream(stream: WritableStreamDefaultWriter): void {
    this.openStreams.delete(stream);
  }
}
