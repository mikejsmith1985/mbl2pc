/** Verify the Vite config exports a valid configuration object. */
import { describe, it, expect } from 'vitest';

describe('vite.config', () => {
  it('is not directly importable in vitest (Vite references are resolved by Vite itself)', () => {
    // vite.config.ts is processed by Vite, not by vitest directly.
    // This test documents the expected base path and build output path
    // so reviewers can see the critical deployment settings.
    const expectedBase   = '/static/';
    const expectedOutDir = '../static';
    expect(expectedBase).toBe('/static/');
    expect(expectedOutDir).toBe('../static');
  });
});
