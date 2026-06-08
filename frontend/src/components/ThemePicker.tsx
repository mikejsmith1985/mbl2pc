/** Popover for toggling dark/light mode, choosing a colour palette, and adjusting font size. */

import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import type { ThemePalette, ThemeMode } from '../types';

interface ThemePickerProps {
  onClose: () => void;
}

const PALETTES: { value: ThemePalette; lightBg: string; darkBg: string; label: string }[] = [
  { value: 'indigo', lightBg: '#4f46e5', darkBg: '#4f46e5', label: 'Indigo' },
  { value: 'ocean',  lightBg: '#0891b2', darkBg: '#0891b2', label: 'Ocean'  },
  { value: 'forest', lightBg: '#16a34a', darkBg: '#16a34a', label: 'Forest' },
  { value: 'rose',   lightBg: '#e11d48', darkBg: '#e11d48', label: 'Rose'   },
  { value: 'amber',  lightBg: '#d97706', darkBg: '#d97706', label: 'Amber'  },
];

const FONT_SIZES: { label: string; value: number }[] = [
  { label: 'A',  value: 13 },
  { label: 'A',  value: 15 },
  { label: 'A',  value: 17 },
  { label: 'A',  value: 20 },
];

const THEME_MODES: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: '☀️ Light' },
  { value: 'dark',  label: '🌙 Dark'  },
];

export function ThemePicker({ onClose }: ThemePickerProps) {
  const themeMode   = useStore(state => state.themeMode);
  const palette     = useStore(state => state.palette);
  const fontSize    = useStore(state => state.fontSize);
  const setThemeMode = useStore(state => state.setThemeMode);
  const setPalette   = useStore(state => state.setPalette);
  const setFontSize  = useStore(state => state.setFontSize);
  const popoverRef  = useRef<HTMLDivElement>(null);

  // Close when clicking outside the popover
  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [onClose]);

  return (
    <div className="theme-popover" ref={popoverRef} role="dialog" aria-label="Theme settings">
      <div>
        <div className="tp-label">Mode</div>
        <div className="tp-modes">
          {THEME_MODES.map(mode => (
            <button
              key={mode.value}
              className={`tp-mode ${themeMode === mode.value ? 'active' : ''}`}
              onClick={() => setThemeMode(mode.value)}
              aria-pressed={themeMode === mode.value}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="tp-label">Colour</div>
        <div className="tp-swatches">
          {PALETTES.map(pal => (
            <button
              key={pal.value}
              className={`tp-swatch ${palette === pal.value ? 'active' : ''}`}
              style={{ background: themeMode === 'dark' ? pal.darkBg : pal.lightBg }}
              onClick={() => setPalette(pal.value)}
              aria-label={pal.label}
              aria-pressed={palette === pal.value}
              title={pal.label}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="tp-label">Font size</div>
        <div className="tp-sizes">
          {FONT_SIZES.map(sizeOption => (
            <button
              key={sizeOption.value}
              className={`tp-size ${fontSize === sizeOption.value ? 'active' : ''}`}
              style={{ fontSize: `${sizeOption.value * 0.75}px` }}
              onClick={() => setFontSize(sizeOption.value)}
              aria-label={`Font size ${sizeOption.value}`}
              aria-pressed={fontSize === sizeOption.value}
            >
              {sizeOption.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
