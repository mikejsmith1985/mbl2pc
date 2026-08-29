/** InputBar behaviour: rendering, Enter-to-send, and clipboard paste of files. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { InputBar } from './InputBar';
import { useStore } from '../store';
import * as api from '../api';

/** Reset the store to a known baseline so each test starts from the same state. */
function resetStore() {
  useStore.setState({ snippets: [], deviceName: 'PC', searchQuery: '', activeDateFilter: '' });
}

/** Build a paste event carrying the given files, since jsdom has no real DataTransfer. */
function buildPasteEvent(files: File[]) {
  return {
    clipboardData: {
      files: files as unknown as FileList,
      items: files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file })),
    },
  };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  resetStore();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('InputBar rendering', () => {
  it('renders the message textarea', () => {
    const { getByLabelText } = render(<InputBar />);
    expect(getByLabelText('Message input')).toBeTruthy();
  });

  it('renders the send button as disabled when input is empty', () => {
    const { getByLabelText } = render(<InputBar />);
    expect(getByLabelText('Send message')).toBeDisabled();
  });
});

describe('InputBar Enter-to-send', () => {
  it('sends the message when Enter is pressed without a modifier', async () => {
    const sendSpy = vi.spyOn(api, 'sendTextMessage').mockResolvedValue(undefined);
    const { getByLabelText } = render(<InputBar />);
    const textarea = getByLabelText('Message input');

    fireEvent.change(textarea, { target: { value: 'hello pc' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => expect(sendSpy).toHaveBeenCalledOnce());
    expect(sendSpy.mock.calls[0][0]).toBe('hello pc');
  });

  it('inserts a newline instead of sending when Shift+Enter is pressed', () => {
    const sendSpy = vi.spyOn(api, 'sendTextMessage').mockResolvedValue(undefined);
    const { getByLabelText } = render(<InputBar />);
    const textarea = getByLabelText('Message input');

    fireEvent.change(textarea, { target: { value: 'line one' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('still sends on Ctrl+Enter so the old shortcut keeps working', async () => {
    const sendSpy = vi.spyOn(api, 'sendTextMessage').mockResolvedValue(undefined);
    const { getByLabelText } = render(<InputBar />);
    const textarea = getByLabelText('Message input');

    fireEvent.change(textarea, { target: { value: 'hello again' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

    await waitFor(() => expect(sendSpy).toHaveBeenCalledOnce());
  });

  it('does not send while an IME composition is active', () => {
    const sendSpy = vi.spyOn(api, 'sendTextMessage').mockResolvedValue(undefined);
    const { getByLabelText } = render(<InputBar />);
    const textarea = getByLabelText('Message input');

    fireEvent.change(textarea, { target: { value: 'にほんご' } });
    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true });

    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe('InputBar Enter-to-send on touch devices', () => {
  /** Make the component believe it is running on a phone. */
  function stubTouchPrimaryDevice() {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('coarse'), media: query }));
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('inserts a newline on Enter so the phone return key still works as a return key', () => {
    stubTouchPrimaryDevice();
    const sendSpy = vi.spyOn(api, 'sendTextMessage').mockResolvedValue(undefined);
    const { getByLabelText } = render(<InputBar />);
    const textarea = getByLabelText('Message input');

    fireEvent.change(textarea, { target: { value: 'sent from my phone' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('still sends on Ctrl+Enter from a hardware keyboard paired to a tablet', async () => {
    stubTouchPrimaryDevice();
    const sendSpy = vi.spyOn(api, 'sendTextMessage').mockResolvedValue(undefined);
    const { getByLabelText } = render(<InputBar />);
    const textarea = getByLabelText('Message input');

    fireEvent.change(textarea, { target: { value: 'from the ipad' } });
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });

    await waitFor(() => expect(sendSpy).toHaveBeenCalledOnce());
  });

  it('omits the Enter hint from the placeholder on a phone', () => {
    stubTouchPrimaryDevice();
    const { getByLabelText } = render(<InputBar />);

    expect(getByLabelText('Message input')).toHaveAttribute('placeholder', 'Message…');
  });

  it('keeps the Enter hint in the placeholder on a desktop', () => {
    const { getByLabelText } = render(<InputBar />);

    expect(getByLabelText('Message input')).toHaveAttribute('placeholder', 'Message… (Enter to send)');
  });
});

describe('InputBar clipboard paste', () => {
  it('attaches a pasted image as a preview chip', async () => {
    const { getByLabelText, findByText } = render(<InputBar />);
    const pastedImage = new File(['binary'], 'screenshot.png', { type: 'image/png' });

    fireEvent.paste(getByLabelText('Message input'), buildPasteEvent([pastedImage]));

    expect(await findByText('screenshot.png')).toBeTruthy();
  });

  it('attaches a pasted video as a preview chip', async () => {
    const { getByLabelText, findByText } = render(<InputBar />);
    const pastedVideo = new File(['binary'], 'clip.mp4', { type: 'video/mp4' });

    fireEvent.paste(getByLabelText('Message input'), buildPasteEvent([pastedVideo]));

    expect(await findByText('clip.mp4')).toBeTruthy();
  });

  it('attaches files pasted while the textarea is not focused', async () => {
    const { findByText } = render(<InputBar />);
    const pastedFile = new File(['binary'], 'notes.pdf', { type: 'application/pdf' });

    fireEvent.paste(window, buildPasteEvent([pastedFile]));

    expect(await findByText('notes.pdf')).toBeTruthy();
  });

  it('leaves plain text pastes to the browser so the text still lands in the box', () => {
    const { getByLabelText } = render(<InputBar />);
    const textPasteEvent = buildPasteEvent([]);

    const wasNotPrevented = fireEvent.paste(getByLabelText('Message input'), textPasteEvent);

    expect(wasNotPrevented).toBe(true);
  });

  it('routes a pasted image to the image endpoint and a pasted video to the file endpoint', async () => {
    const sendImageSpy = vi.spyOn(api, 'sendImageMessage').mockResolvedValue(undefined);
    const sendFileSpy  = vi.spyOn(api, 'sendFileMessage').mockResolvedValue(undefined);
    const { getByLabelText } = render(<InputBar />);

    fireEvent.paste(getByLabelText('Message input'), buildPasteEvent([
      new File(['binary'], 'photo.png', { type: 'image/png' }),
      new File(['binary'], 'clip.mp4',  { type: 'video/mp4' }),
    ]));
    fireEvent.click(getByLabelText('Send message'));

    await waitFor(() => expect(sendImageSpy).toHaveBeenCalledOnce());
    expect(sendFileSpy).toHaveBeenCalledOnce();
  });
});

describe('InputBar upload limits', () => {
  it('refuses an oversized file with a specific message instead of a generic failure', async () => {
    const sendFileSpy = vi.spyOn(api, 'sendFileMessage').mockResolvedValue(undefined);
    const showToastSpy = vi.fn();
    useStore.setState({ showToast: showToastSpy });

    const { getByLabelText } = render(<InputBar />);
    const oversizedVideo = new File(['x'], 'holiday.mov', { type: 'video/quicktime' });
    Object.defineProperty(oversizedVideo, 'size', { value: 40 * 1024 * 1024 });

    fireEvent.paste(getByLabelText('Message input'), buildPasteEvent([oversizedVideo]));
    fireEvent.click(getByLabelText('Send message'));

    await waitFor(() => expect(showToastSpy).toHaveBeenCalled());
    expect(showToastSpy.mock.calls[0][0]).toContain('holiday.mov');
    expect(sendFileSpy).not.toHaveBeenCalled();
  });
});

/** Replace navigator.clipboard for one test; jsdom ships no usable implementation. */
function stubClipboard(clipboardStub: Partial<Clipboard>) {
  Object.defineProperty(navigator, 'clipboard', { value: clipboardStub, configurable: true });
}

/** Build a ClipboardItem-alike whose getType resolves or rejects per format. */
function buildClipboardItem(formats: Record<string, Blob | Error>) {
  return {
    types: Object.keys(formats),
    getType: async (mimeType: string) => {
      const format = formats[mimeType];
      if (format instanceof Error) throw format;
      return format;
    },
  } as unknown as ClipboardItem;
}

describe('InputBar clipboard button', () => {
  it('attaches an image the clipboard button reads', async () => {
    stubClipboard({
      read: async () => [buildClipboardItem({ 'image/png': new Blob(['binary'], { type: 'image/png' }) })],
      readText: async () => '',
    });
    const { getByLabelText, findByText } = render(<InputBar />);

    fireEvent.click(getByLabelText('Paste from clipboard'));

    expect(await findByText(/pasted-\d+\.png/)).toBeTruthy();
  });

  it('keeps reading a clipboard item after one of its formats refuses to be read', async () => {
    stubClipboard({
      read: async () => [buildClipboardItem({
        'text/html':                new Blob(['<img>'], { type: 'text/html' }),
        'com.apple.private-format': new Error('unsupported type'),
        'image/png':                new Blob(['binary'], { type: 'image/png' }),
      })],
      readText: async () => '',
    });
    const { getByLabelText, findByText } = render(<InputBar />);

    fireEvent.click(getByLabelText('Paste from clipboard'));

    expect(await findByText(/pasted-\d+\.png/)).toBeTruthy();
  });

  it('tells the user when the clipboard holds nothing the composer can take', async () => {
    const showToastSpy = vi.fn();
    useStore.setState({ showToast: showToastSpy });
    stubClipboard({ read: async () => [], readText: async () => '' });
    const { getByLabelText } = render(<InputBar />);

    fireEvent.click(getByLabelText('Paste from clipboard'));

    await waitFor(() => expect(showToastSpy).toHaveBeenCalled());
    expect(showToastSpy.mock.calls[0][0]).toMatch(/nothing/i);
  });

  it('confirms with a toast when a keyboard paste attaches a file', async () => {
    const showToastSpy = vi.fn();
    useStore.setState({ showToast: showToastSpy });
    const { getByLabelText } = render(<InputBar />);

    fireEvent.paste(getByLabelText('Message input'), buildPasteEvent([
      new File(['binary'], 'screenshot.png', { type: 'image/png' }),
    ]));

    await waitFor(() => expect(showToastSpy).toHaveBeenCalled());
    expect(showToastSpy.mock.calls[0][0]).toContain('screenshot.png');
  });
});
