/** Unit tests for pure utility functions — markdown, file detection, palettes, dates. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  renderMarkdown,
  isImageFile,
  getFileIcon,
  getFileExtension,
  computeSenderPalette,
  formatDayLabel,
  extractDatePart,
  deriveFileNameForClipboardItem,
  extractFilesFromDataTransfer,
  findOversizedFile,
  formatByteSize,
  MAX_UPLOAD_BYTES,
  isTouchPrimaryDevice,
} from './utils';

describe('renderMarkdown', () => {
  it('converts bold markdown to <strong>', () => {
    const result = renderMarkdown('**bold text**');
    expect(result).toContain('<strong>bold text</strong>');
  });

  it('strips dangerous script tags', () => {
    const result = renderMarkdown('<script>alert("xss")</script>');
    expect(result).not.toContain('<script>');
  });

  it('renders inline code', () => {
    const result = renderMarkdown('`code`');
    expect(result).toContain('<code>code</code>');
  });

  it('renders paragraphs for plain text', () => {
    const result = renderMarkdown('hello world');
    expect(result).toContain('hello world');
  });
});

describe('isImageFile', () => {
  it('returns true for jpg, jpeg, png, gif, webp', () => {
    expect(isImageFile('photo.jpg')).toBe(true);
    expect(isImageFile('photo.jpeg')).toBe(true);
    expect(isImageFile('image.PNG')).toBe(true);
    expect(isImageFile('anim.gif')).toBe(true);
    expect(isImageFile('pic.webp')).toBe(true);
  });

  it('returns false for non-image extensions', () => {
    expect(isImageFile('document.pdf')).toBe(false);
    expect(isImageFile('archive.zip')).toBe(false);
    expect(isImageFile('video.mp4')).toBe(false);
  });
});

describe('getFileExtension', () => {
  it('returns lowercase extension without the dot', () => {
    expect(getFileExtension('file.PDF')).toBe('pdf');
    expect(getFileExtension('archive.tar.gz')).toBe('gz');
    expect(getFileExtension('no-ext')).toBe('no-ext');
  });
});

describe('getFileIcon', () => {
  it('returns distinct emojis for known types', () => {
    expect(getFileIcon('file.pdf')).toBe('📄');
    expect(getFileIcon('file.docx')).toBe('📝');
    expect(getFileIcon('file.xlsx')).toBe('📊');
    expect(getFileIcon('archive.zip')).toBe('🗜️');
    expect(getFileIcon('video.mp4')).toBe('🎬');
    expect(getFileIcon('music.mp3')).toBe('🎵');
    expect(getFileIcon('file.unknown')).toBe('📎');
  });
});

describe('computeSenderPalette', () => {
  it('returns a palette with bg, b, t keys', () => {
    const palette = computeSenderPalette('Alice', false);
    expect(palette).toHaveProperty('bg');
    expect(palette).toHaveProperty('b');
    expect(palette).toHaveProperty('t');
  });

  it('returns the same palette for the same name', () => {
    const paletteA = computeSenderPalette('Bob', false);
    const paletteB = computeSenderPalette('Bob', false);
    expect(paletteA).toEqual(paletteB);
  });

  it('returns different palettes for light vs dark mode', () => {
    const lightPalette = computeSenderPalette('Carol', false);
    const darkPalette  = computeSenderPalette('Carol', true);
    expect(lightPalette.bg).not.toBe(darkPalette.bg);
  });
});

describe('extractDatePart', () => {
  it('returns the YYYY-MM-DD portion of a timestamp', () => {
    expect(extractDatePart('2025-03-15T14:30:00Z')).toBe('2025-03-15');
  });

  it('returns empty string for empty input', () => {
    expect(extractDatePart('')).toBe('');
  });
});

describe('formatDayLabel', () => {
  it('returns Today for today\'s date', () => {
    const today = new Date();
    const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(formatDayLabel(todayString)).toBe('Today');
  });

  it('returns Yesterday for yesterday\'s date', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayString = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    expect(formatDayLabel(yesterdayString)).toBe('Yesterday');
  });

  it('returns empty string for invalid input', () => {
    expect(formatDayLabel('')).toBe('');
    expect(formatDayLabel('not-a-date')).toBe('');
  });
});

// ── Clipboard / attachment helpers ────────────────────────────────────────────

describe('deriveFileNameForClipboardItem', () => {
  it('keeps a usable original name when the clipboard supplies one', () => {
    expect(deriveFileNameForClipboardItem('screenshot.png', 'image/png')).toBe('screenshot.png');
  });

  it('synthesises a name with the right extension when the clipboard supplies none', () => {
    const derivedName = deriveFileNameForClipboardItem('', 'image/png');
    expect(derivedName.startsWith('pasted-')).toBe(true);
    expect(derivedName.endsWith('.png')).toBe(true);
  });

  it('synthesises a name when the clipboard supplies one without an extension', () => {
    expect(deriveFileNameForClipboardItem('image', 'video/quicktime').endsWith('.mov')).toBe(true);
  });

  it('falls back to the .bin extension for unrecognised MIME types', () => {
    expect(deriveFileNameForClipboardItem('', 'application/x-unknown-thing').endsWith('.bin')).toBe(true);
  });
});

describe('extractFilesFromDataTransfer', () => {
  /** Build a minimal DataTransfer-like object; jsdom does not implement the real one. */
  function buildDataTransfer(files: File[]): DataTransfer {
    return {
      files: files as unknown as FileList,
      items: files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file })),
    } as unknown as DataTransfer;
  }

  it('returns an empty array when the clipboard holds no files', () => {
    expect(extractFilesFromDataTransfer(buildDataTransfer([]))).toEqual([]);
  });

  it('returns an empty array when the event carries no clipboard data at all', () => {
    expect(extractFilesFromDataTransfer(null)).toEqual([]);
  });

  it('extracts a pasted image and gives it a usable filename', () => {
    const namelessImage = new File(['binary'], '', { type: 'image/png' });
    const extracted = extractFilesFromDataTransfer(buildDataTransfer([namelessImage]));
    expect(extracted).toHaveLength(1);
    expect(extracted[0].name.endsWith('.png')).toBe(true);
  });

  it('extracts a pasted video alongside a pasted document', () => {
    const video    = new File(['binary'], 'clip.mp4',  { type: 'video/mp4' });
    const document = new File(['binary'], 'notes.pdf', { type: 'application/pdf' });
    const extracted = extractFilesFromDataTransfer(buildDataTransfer([video, document]));
    expect(extracted.map(file => file.name)).toEqual(['clip.mp4', 'notes.pdf']);
  });
});

describe('findOversizedFile', () => {
  it('returns null when every file is within the upload limit', () => {
    const smallFile = new File(['tiny'], 'small.txt', { type: 'text/plain' });
    expect(findOversizedFile([smallFile])).toBeNull();
  });

  it('returns the first file that exceeds the upload limit', () => {
    const oversized = new File(['x'], 'huge.mp4', { type: 'video/mp4' });
    Object.defineProperty(oversized, 'size', { value: MAX_UPLOAD_BYTES + 1 });
    expect(findOversizedFile([oversized])?.name).toBe('huge.mp4');
  });
});

describe('formatByteSize', () => {
  it('formats megabyte-scale sizes with one decimal place', () => {
    expect(formatByteSize(26 * 1024 * 1024)).toBe('26.0 MB');
  });

  it('formats kilobyte-scale sizes without a decimal place', () => {
    expect(formatByteSize(2048)).toBe('2 KB');
  });
});

describe('isTouchPrimaryDevice', () => {
  /** Replace matchMedia so the pointer capability can be simulated. */
  function stubPointerCapability(isCoarsePointer: boolean) {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('coarse') ? isCoarsePointer : !isCoarsePointer,
      media: query,
    }));
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports a phone or tablet, where the primary pointer is a finger', () => {
    stubPointerCapability(true);
    expect(isTouchPrimaryDevice()).toBe(true);
  });

  it('reports a desktop with a mouse', () => {
    stubPointerCapability(false);
    expect(isTouchPrimaryDevice()).toBe(false);
  });

  it('treats a touchscreen laptop as a desktop, since its primary pointer is fine', () => {
    stubPointerCapability(false);
    expect(isTouchPrimaryDevice()).toBe(false);
  });

  it('falls back to touch-point count on a browser without matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);
    vi.stubGlobal('navigator', { maxTouchPoints: 5 });
    expect(isTouchPrimaryDevice()).toBe(true);
  });

  it('reports desktop when neither signal is available', () => {
    vi.stubGlobal('matchMedia', undefined);
    vi.stubGlobal('navigator', {});
    expect(isTouchPrimaryDevice()).toBe(false);
  });
});
