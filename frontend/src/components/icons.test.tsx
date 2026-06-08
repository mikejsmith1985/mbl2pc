/** Icon components render SVG elements without throwing. */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SendIcon, StarIcon, TrashIcon, CopyIcon, SearchIcon, CalendarIcon } from './icons';

describe('Icon components', () => {
  it('SendIcon renders an svg', () => {
    const { container } = render(<SendIcon />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('StarIcon renders filled when prop is true', () => {
    const { container } = render(<StarIcon filled={true} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('fill')).toBe('currentColor');
  });

  it('StarIcon renders unfilled by default', () => {
    const { container } = render(<StarIcon />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('fill')).toBe('none');
  });

  it('TrashIcon, CopyIcon, SearchIcon, CalendarIcon render without error', () => {
    expect(() => render(<TrashIcon />)).not.toThrow();
    expect(() => render(<CopyIcon />)).not.toThrow();
    expect(() => render(<SearchIcon />)).not.toThrow();
    expect(() => render(<CalendarIcon />)).not.toThrow();
  });
});
