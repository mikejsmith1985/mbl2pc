/** ChatArea renders a message log with date separators and load-more button. */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ChatArea } from './ChatArea';
import { useStore } from '../store';

describe('ChatArea', () => {
  it('renders the messages log region', () => {
    useStore.setState({ messages: [], isLoadingMessages: false, hasMore: false, searchQuery: '', activeDateFilter: '' });
    const { getByRole } = render(<ChatArea />);
    expect(getByRole('log', { name: 'Messages' })).toBeTruthy();
  });

  it('renders the spinner while loading', () => {
    useStore.setState({ messages: [], isLoadingMessages: true, hasMore: false, searchQuery: '', activeDateFilter: '' });
    const { getByText } = render(<ChatArea />);
    expect(getByText('Loading messages…')).toBeTruthy();
  });

  it('renders a load-more button when hasMore is true', () => {
    useStore.setState({
      messages: [{
        id: '1', sender: 'PC', text: 'hi', starred: false,
        timestamp: '2025-06-01T10:00:00Z', image_url: '', file_url: '', file_name: '',
      }],
      isLoadingMessages: false,
      hasMore: true,
      searchQuery: '',
      activeDateFilter: '',
      deviceName: 'PC',
      isSelectMode: false,
      selectedMessageIds: {},
    });
    const { getByText } = render(<ChatArea />);
    expect(getByText('↑ Load all messages')).toBeTruthy();
  });
});
