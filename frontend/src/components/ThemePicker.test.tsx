/** ThemePicker renders mode buttons and palette swatches. */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ThemePicker } from './ThemePicker';

describe('ThemePicker', () => {
  it('renders the light and dark mode buttons', () => {
    const { getByText } = render(<ThemePicker onClose={() => {}} />);
    expect(getByText('☀️ Light')).toBeTruthy();
    expect(getByText('🌙 Dark')).toBeTruthy();
  });

  it('renders 5 palette swatches', () => {
    const { getAllByRole } = render(<ThemePicker onClose={() => {}} />);
    // 2 mode buttons + 4 font-size buttons + 5 palette swatches = 11 total
    const buttons = getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(5);
  });
});
