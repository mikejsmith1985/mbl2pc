/** SnippetsPanel renders the snippets region and list. */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { SnippetsPanel } from './SnippetsPanel';
import { useStore } from '../store';

describe('SnippetsPanel', () => {
  it('renders the snippets region', () => {
    useStore.setState({ snippets: [] });
    const { getByRole } = render(<SnippetsPanel onInsert={() => {}} />);
    expect(getByRole('region', { name: 'Text snippets' })).toBeTruthy();
  });

  it('lists existing snippets', () => {
    useStore.setState({ snippets: [{ id: '1', name: 'Greeting', content: 'Hello!', created_at: '' }] });
    const { getByText } = render(<SnippetsPanel onInsert={() => {}} />);
    expect(getByText('Greeting')).toBeTruthy();
  });

  it('calls onInsert when the insert button is clicked', () => {
    const handleInsert = vi.fn();
    useStore.setState({ snippets: [{ id: '1', name: 'Test', content: 'test content', created_at: '' }] });
    const { getByLabelText } = render(<SnippetsPanel onInsert={handleInsert} />);
    getByLabelText('Insert snippet: Test').click();
    expect(handleInsert).toHaveBeenCalledWith('test content');
  });
});
