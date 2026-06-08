/** SearchBar renders an input and calls load on change. */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SearchBar } from './SearchBar';
import { useStore } from '../store';

describe('SearchBar', () => {
  it('renders a search input', () => {
    const { getByRole } = render(<SearchBar onClose={() => {}} />);
    expect(getByRole('searchbox')).toBeTruthy();
  });

  it('calls onClose when clear button is clicked', () => {
    const handleClose = vi.fn();
    const { getByLabelText } = render(<SearchBar onClose={handleClose} />);
    fireEvent.click(getByLabelText('Clear search'));
    expect(handleClose).toHaveBeenCalled();
  });
});
