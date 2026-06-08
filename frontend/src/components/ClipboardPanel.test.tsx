/** ClipboardPanel renders the clipboard region with sync button. */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ClipboardPanel } from './ClipboardPanel';
import { useStore } from '../store';

describe('ClipboardPanel', () => {
  it('renders the clipboard region', () => {
    useStore.setState({ clipboardEntry: { content: '', updated_at: null } });
    const { getByRole } = render(<ClipboardPanel />);
    expect(getByRole('region', { name: 'Clipboard sync' })).toBeTruthy();
  });

  it('shows the clipboard content when it exists', () => {
    useStore.setState({ clipboardEntry: { content: 'hello world', updated_at: null } });
    const { getAllByText } = render(<ClipboardPanel />);
    // Content appears twice: once in the collapsed header preview and once in the body
    expect(getAllByText('hello world').length).toBeGreaterThanOrEqual(1);
  });
});
