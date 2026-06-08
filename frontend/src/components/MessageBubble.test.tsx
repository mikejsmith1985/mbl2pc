/** MessageBubble renders message text and sender name correctly. */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MessageBubble } from './MessageBubble';
import { useStore } from '../store';

const SAMPLE_MESSAGE = {
  id: 'msg-1',
  sender: 'iPhone',
  text: 'Hello from phone',
  image_url: '',
  file_url: '',
  file_name: '',
  timestamp: '2025-06-01T10:00:00Z',
  starred: false,
};

describe('MessageBubble', () => {
  it('renders the message text', () => {
    useStore.setState({ messages: [SAMPLE_MESSAGE], deviceName: 'PC', isSelectMode: false, selectedMessageIds: {} });
    const { getByText } = render(<MessageBubble messageId="msg-1" />);
    expect(getByText('Hello from phone')).toBeTruthy();
  });

  it('renders the sender name for received messages', () => {
    useStore.setState({ messages: [SAMPLE_MESSAGE], deviceName: 'PC', isSelectMode: false, selectedMessageIds: {} });
    const { getByText } = render(<MessageBubble messageId="msg-1" />);
    expect(getByText('iPhone')).toBeTruthy();
  });

  it('does not render sender name for sent messages', () => {
    useStore.setState({
      messages: [{ ...SAMPLE_MESSAGE, sender: 'PC' }],
      deviceName: 'PC',
      isSelectMode: false,
      selectedMessageIds: {},
    });
    const { queryByText } = render(<MessageBubble messageId="msg-1" />);
    expect(queryByText('PC')).toBeNull();
  });

  it('renders nothing for an unknown message ID', () => {
    useStore.setState({ messages: [], deviceName: 'PC', isSelectMode: false, selectedMessageIds: {} });
    const { container } = render(<MessageBubble messageId="not-found" />);
    expect(container.firstChild).toBeNull();
  });
});
