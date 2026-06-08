/** SelectionBar shows selected count and action buttons. */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SelectionBar } from './SelectionBar';
import { useStore } from '../store';

describe('SelectionBar', () => {
  it('shows selected count', () => {
    useStore.setState({ selectedMessageIds: { 'a': true, 'b': true }, messages: [] });
    const { getByText } = render(<SelectionBar />);
    expect(getByText('2 selected')).toBeTruthy();
  });

  it('shows "0 selected" when nothing is selected', () => {
    useStore.setState({ selectedMessageIds: {}, messages: [] });
    const { getByText } = render(<SelectionBar />);
    expect(getByText('0 selected')).toBeTruthy();
  });
});
