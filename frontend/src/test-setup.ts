/** Global test setup: extend vitest matchers with jest-dom assertions. */
import '@testing-library/jest-dom';

// jsdom doesn't implement scrollIntoView — stub it so ChatArea's scroll-to-bottom doesn't throw
Element.prototype.scrollIntoView = () => {};

// jsdom doesn't implement window.matchMedia — stub it so the Zustand store can initialise
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener:    () => {},
    removeListener: () => {},
    addEventListener:    () => {},
    removeEventListener: () => {},
    dispatchEvent:       () => false,
  }),
});
