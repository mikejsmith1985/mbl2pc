/** Verify the test setup globals are available after test-setup.ts runs. */
import { describe, it, expect } from 'vitest';

describe('test-setup globals', () => {
  it('window.matchMedia is stubbed', () => {
    expect(typeof window.matchMedia).toBe('function');
    const result = window.matchMedia('(prefers-color-scheme: dark)');
    expect(result).toHaveProperty('matches');
  });

  it('Element.prototype.scrollIntoView is stubbed', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    expect(() => div.scrollIntoView()).not.toThrow();
    document.body.removeChild(div);
  });
});
