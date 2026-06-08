/** InputBar renders the textarea and send button. */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { InputBar } from './InputBar';
import { useStore } from '../store';

vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

describe('InputBar', () => {
  it('renders the message textarea', () => {
    useStore.setState({ snippets: [], deviceName: 'PC', searchQuery: '', activeDateFilter: '' });
    const { getByLabelText } = render(<InputBar />);
    expect(getByLabelText('Message input')).toBeTruthy();
  });

  it('renders the send button as disabled when input is empty', () => {
    useStore.setState({ snippets: [], deviceName: 'PC', searchQuery: '', activeDateFilter: '' });
    const { getByLabelText } = render(<InputBar />);
    expect(getByLabelText('Send message')).toBeDisabled();
  });
});
