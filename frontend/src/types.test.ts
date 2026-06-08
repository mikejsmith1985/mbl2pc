/** Verify that the type definitions compile and their literal values are correctly typed. */
import { describe, it, expect } from 'vitest';
import type { ThemePalette, ThemeMode } from './types';

describe('ThemePalette type', () => {
  it('accepts all valid palette values', () => {
    const validPalettes: ThemePalette[] = ['indigo', 'ocean', 'forest', 'rose', 'amber'];
    expect(validPalettes).toHaveLength(5);
  });
});

describe('ThemeMode type', () => {
  it('accepts light and dark', () => {
    const validModes: ThemeMode[] = ['light', 'dark'];
    expect(validModes).toHaveLength(2);
  });
});
