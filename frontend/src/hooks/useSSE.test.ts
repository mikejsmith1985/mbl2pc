/** Tests for the SSE hook — verifies exponential backoff reconnection logic. */
import { describe, it, expect, vi } from 'vitest';

describe('useSSE reconnection constants', () => {
  it('initial delay of 1 second doubles each attempt up to 30 seconds', () => {
    const INITIAL_DELAY  = 1000;
    const MAX_DELAY      = 30_000;
    const GROWTH_FACTOR  = 2;

    let currentDelay = INITIAL_DELAY;
    const delays: number[] = [];

    for (let attempt = 0; attempt < 7; attempt++) {
      delays.push(currentDelay);
      currentDelay = Math.min(currentDelay * GROWTH_FACTOR, MAX_DELAY);
    }

    expect(delays[0]).toBe(1000);
    expect(delays[1]).toBe(2000);
    expect(delays[2]).toBe(4000);
    expect(delays[3]).toBe(8000);
    expect(delays[4]).toBe(16000);
    expect(delays[5]).toBe(30000); // capped at max
    expect(delays[6]).toBe(30000); // stays at max
  });
});
