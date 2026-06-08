/** DatePicker renders a calendar navigation and day grid. */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { DatePicker } from './DatePicker';
import { useStore } from '../store';

describe('DatePicker', () => {
  it('renders the calendar dialog', () => {
    useStore.setState({ activeDateFilter: '', searchQuery: '' });
    const { getByRole } = render(<DatePicker onClose={() => {}} />);
    expect(getByRole('dialog', { name: 'Date filter' })).toBeTruthy();
  });

  it('renders navigation buttons', () => {
    useStore.setState({ activeDateFilter: '', searchQuery: '' });
    const { getByLabelText } = render(<DatePicker onClose={() => {}} />);
    expect(getByLabelText('Previous month')).toBeTruthy();
    expect(getByLabelText('Next month')).toBeTruthy();
  });
});
