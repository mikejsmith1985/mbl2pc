/** Unit tests for pure utility functions — markdown, file detection, palettes, dates. */
import { describe, it, expect, vi } from 'vitest';
import {
  renderMarkdown,
  isImageFile,
  getFileIcon,
  getFileExtension,
  computeSenderPalette,
  formatDayLabel,
  extractDatePart,
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
