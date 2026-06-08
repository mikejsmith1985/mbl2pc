/** PinnedPanel renders nothing when there are no starred messages. */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PinnedPanel } from './PinnedPanel';
import { useStore } from '../store';

describe('PinnedPanel', () => {
  it('renders nothing when no messages are starred', () => {
    useStore.setState({ messages: [{ id: '1', sender: 'PC', text: 'hi', starred: false, timestamp: '', image_url: '', file_url: '', file_name: '' }] });
    const { container } = render(<PinnedPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the panel when messages are starred', () => {
    useStore.setState({ messages: [{ id: '1', sender: 'PC', text: 'pinned', starred: true, timestamp: '', image_url: '', file_url: '', file_name: '' }] });
    const { getByRole } = render(<PinnedPanel />);
    expect(getByRole('region', { name: 'Pinned messages' })).toBeTruthy();
  });
});
