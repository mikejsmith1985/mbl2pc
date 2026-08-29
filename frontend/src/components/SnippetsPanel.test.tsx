/** SnippetsPanel renders the snippets region and list, collapsed until the user opens it. */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SnippetsPanel } from './SnippetsPanel';
import { useStore } from '../store';

/** Open the panel the way a user does — by clicking its header row. */
function expandPanel(getByRole: (role: string, options: { name: RegExp }) => HTMLElement) {
  fireEvent.click(getByRole('button', { name: /Snippets/ }));
}

describe('SnippetsPanel', () => {
  it('renders the snippets region', () => {
    useStore.setState({ snippets: [] });
    const { getByRole } = render(<SnippetsPanel onInsert={() => {}} />);
    expect(getByRole('region', { name: 'Text snippets' })).toBeTruthy();
  });

  it('starts collapsed so the snippet list does not crowd out the messages', () => {
    useStore.setState({ snippets: [{ id: '1', name: 'Greeting', content: 'Hello!', created_at: '' }] });
    const { queryByText, getByRole } = render(<SnippetsPanel onInsert={() => {}} />);
    expect(queryByText('Greeting')).toBeNull();
    expect(getByRole('button', { name: /Snippets/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('still shows the snippet count while collapsed', () => {
    useStore.setState({ snippets: [{ id: '1', name: 'Greeting', content: 'Hello!', created_at: '' }] });
    const { getByText } = render(<SnippetsPanel onInsert={() => {}} />);
    expect(getByText(/⚡ Snippets \(1\)/)).toBeTruthy();
  });

  it('lists existing snippets once the header is clicked', () => {
    useStore.setState({ snippets: [{ id: '1', name: 'Greeting', content: 'Hello!', created_at: '' }] });
    const { getByText, getByRole } = render(<SnippetsPanel onInsert={() => {}} />);
    expandPanel(getByRole);
    expect(getByText('Greeting')).toBeTruthy();
  });

  it('calls onInsert when the insert button is clicked', () => {
    const handleInsert = vi.fn();
    useStore.setState({ snippets: [{ id: '1', name: 'Test', content: 'test content', created_at: '' }] });
    const { getByLabelText, getByRole } = render(<SnippetsPanel onInsert={handleInsert} />);
    expandPanel(getByRole);
    fireEvent.click(getByLabelText('Insert snippet: Test'));
    expect(handleInsert).toHaveBeenCalledWith('test content');
  });

  it('opens the panel when the add button is used while collapsed', () => {
    useStore.setState({ snippets: [] });
    const { getByLabelText } = render(<SnippetsPanel onInsert={() => {}} />);
    fireEvent.click(getByLabelText('Add snippet'));
    expect(getByLabelText('Snippet name')).toBeTruthy();
  });
});
