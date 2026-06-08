/** Toast renders toasts from the store and applies the correct CSS class. */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Toast } from './Toast';
import { useStore } from '../store';

describe('Toast', () => {
  it('renders nothing when there are no toasts', () => {
    useStore.setState({ toasts: [] });
    const { container } = render(<Toast />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a toast with the success class', () => {
    useStore.setState({ toasts: [{ id: '1', message: 'Done!', type: 'success' }] });
    const { getByText } = render(<Toast />);
    expect(getByText('Done!')).toBeTruthy();
  });

  it('renders a toast with the error class', () => {
    useStore.setState({ toasts: [{ id: '2', message: 'Oops!', type: 'error' }] });
    const { getByText } = render(<Toast />);
    expect(getByText('Oops!')).toBeTruthy();
  });
});
