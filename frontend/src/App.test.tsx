/** Smoke test: App component renders its top-level landmark without crashing. */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { App } from './App';

// Stub fetch so the initial data-load calls don't hit a real network
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ messages: [], has_more: false, snippets: [], content: '', version: 'test' }),
}));

// Stub EventSource so the SSE hook doesn't throw in jsdom
vi.stubGlobal('EventSource', class {
  addEventListener() {}
  close() {}
});

describe('App', () => {
  it('renders without throwing', () => {
    expect(() => render(<App />)).not.toThrow();
  });

  it('renders a header banner', () => {
    const { container } = render(<App />);
    expect(container.querySelector('header')).toBeTruthy();
  });
});
