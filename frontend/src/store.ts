/**
 * Central application state powered by Zustand.
 * All components read state from here; all mutations go through store actions.
 */

import { create } from 'zustand';
import type { Message, Snippet, UserProfile, ThemePalette, ThemeMode, ToastNotification, ClipboardEntry } from './types';
import * as api from './api';

// ── Theme persistence helpers ─────────────────────────────────────────────────

function loadInitialTheme(): { themeMode: ThemeMode; palette: ThemePalette; fontSize: number } {
  const savedMode = localStorage.getItem('mbl2pc_theme') as ThemeMode | null;
  const themeMode: ThemeMode = savedMode ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  // Migrate users who had the old single-palette key before per-mode palettes were introduced
  const legacyPalette = localStorage.getItem('mbl2pc_palette');
  if (legacyPalette) {
    if (!localStorage.getItem('mbl2pc_palette_light')) localStorage.setItem('mbl2pc_palette_light', legacyPalette);
    if (!localStorage.getItem('mbl2pc_palette_dark'))  localStorage.setItem('mbl2pc_palette_dark',  legacyPalette);
  }

  const modeStorageKey = themeMode === 'dark' ? 'mbl2pc_palette_dark' : 'mbl2pc_palette_light';
  const palette = (localStorage.getItem(modeStorageKey) ?? 'indigo') as ThemePalette;
  const fontSize = Number(localStorage.getItem('mbl2pc_fontsize') ?? 15);
  return { themeMode, palette, fontSize };
}

function applyThemeToDom(themeMode: ThemeMode, palette: ThemePalette, fontSize: number): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', themeMode);
  root.setAttribute('data-palette', palette);
  root.style.fontSize = `${fontSize}px`;
}

function persistTheme(themeMode: ThemeMode, palette: ThemePalette, fontSize: number): void {
  const modeStorageKey = themeMode === 'dark' ? 'mbl2pc_palette_dark' : 'mbl2pc_palette_light';
  localStorage.setItem('mbl2pc_theme', themeMode);
  localStorage.setItem(modeStorageKey, palette);
  localStorage.setItem('mbl2pc_fontsize', String(fontSize));
}

// ── Device name detection ─────────────────────────────────────────────────────

function detectDefaultDeviceName(): string {
  const saved = localStorage.getItem('mbl2pc_sender');
  if (saved) return saved;
  const ua = navigator.userAgent;
  if (/iPad/.test(ua))             return 'iPad';
  if (/iPhone/.test(ua))           return 'iPhone';
  if (/Android/.test(ua))          return 'Android';
  if (/CrOS/.test(ua))             return 'Chromebook';
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/.test(ua))          return 'PC';
  if (/Linux/.test(ua))            return 'Linux';
  return 'Device';
}

// ── Store interface ───────────────────────────────────────────────────────────

interface AppState {
  // Theme
  themeMode: ThemeMode;
  palette: ThemePalette;
  fontSize: number;
  setThemeMode: (mode: ThemeMode) => void;
  setPalette: (palette: ThemePalette) => void;
  setFontSize: (size: number) => void;

  // User profile and app version
  userProfile: UserProfile | null;
  appVersion: string;
  loadUserProfile: () => Promise<void>;
  loadAppVersion: () => Promise<void>;

  // Messages
  messages: Message[];
  isLoadingMessages: boolean;
  hasMore: boolean;
  searchQuery: string;
  activeDateFilter: string;
  loadMessages: (params?: { query?: string; date?: string; last?: number }) => Promise<void>;
  toggleStar: (messageId: string) => Promise<void>;
  removeMessage: (messageId: string) => Promise<void>;
  setSearchQuery: (query: string) => void;
  setActiveDateFilter: (date: string) => void;

  // Device identifier shown on sent messages
  deviceName: string;
  setDeviceName: (name: string) => void;

  // Snippets
  snippets: Snippet[];
  loadSnippets: () => Promise<void>;
  addSnippet: (name: string, content: string) => Promise<void>;
  removeSnippet: (snippetId: string) => Promise<void>;

  // Clipboard sync
  clipboardEntry: ClipboardEntry;
  loadClipboard: () => Promise<void>;
  syncClipboard: (content: string) => Promise<void>;

  // Toast notifications
  toasts: ToastNotification[];
  showToast: (message: string, type?: 'success' | 'error') => void;
  dismissToast: (id: string) => void;

  // Multi-select mode for batch operations
  isSelectMode: boolean;
  selectedMessageIds: Record<string, boolean>;
  toggleSelectMode: () => void;
  toggleMessageSelection: (id: string) => void;
  clearSelection: () => void;
}

// ── Store creation ────────────────────────────────────────────────────────────

let toastIdCounter = 0;

const initialTheme = loadInitialTheme();

export const useStore = create<AppState>((set, get) => {
  // Apply theme to DOM immediately — before any React renders — to avoid flash
  applyThemeToDom(initialTheme.themeMode, initialTheme.palette, initialTheme.fontSize);

  return {
    // ── Theme ────────────────────────────────────────────────────────────────
    themeMode: initialTheme.themeMode,
    palette:   initialTheme.palette,
    fontSize:  initialTheme.fontSize,

    setThemeMode: (mode) => {
      // Switching modes restores that mode's saved palette independently
      const modeStorageKey = mode === 'dark' ? 'mbl2pc_palette_dark' : 'mbl2pc_palette_light';
      const palette = (localStorage.getItem(modeStorageKey) ?? 'indigo') as ThemePalette;
      const { fontSize } = get();
      set({ themeMode: mode, palette });
      applyThemeToDom(mode, palette, fontSize);
      persistTheme(mode, palette, fontSize);
    },

    setPalette: (palette) => {
      const { themeMode, fontSize } = get();
      set({ palette });
      applyThemeToDom(themeMode, palette, fontSize);
      persistTheme(themeMode, palette, fontSize);
    },

    setFontSize: (fontSize) => {
      const { themeMode, palette } = get();
      set({ fontSize });
      applyThemeToDom(themeMode, palette, fontSize);
      persistTheme(themeMode, palette, fontSize);
    },

    // ── User profile ─────────────────────────────────────────────────────────
    userProfile: null,
    appVersion:  '',

    loadUserProfile: async () => {
      try {
        const profile = await api.fetchCurrentUser();
        set({ userProfile: profile });
      } catch {
        // Auth redirect is handled inside fetchCurrentUser on 401
      }
    },

    loadAppVersion: async () => {
      const version = await api.fetchVersion();
      set({ appVersion: version });
    },

    // ── Messages ─────────────────────────────────────────────────────────────
    messages:           [],
    isLoadingMessages:  true,
    hasMore:            false,
    searchQuery:        '',
    activeDateFilter:   '',

    loadMessages: async (params = {}) => {
      set({ isLoadingMessages: true });
      try {
        const result = await api.fetchMessages(params);
        set({ messages: result.messages, hasMore: result.has_more, isLoadingMessages: false });
      } catch {
        set({ isLoadingMessages: false });
      }
    },

    toggleStar: async (messageId) => {
      try {
        const result = await api.toggleMessageStar(messageId);
        set(state => ({
          messages: state.messages.map(m =>
            m.id === messageId ? { ...m, starred: result.starred } : m
          ),
        }));
        get().showToast(result.starred ? 'Pinned ⭐' : 'Unpinned');
      } catch {
        get().showToast('Failed to pin', 'error');
      }
    },

    removeMessage: async (messageId) => {
      try {
        await api.deleteMessage(messageId);
        set(state => ({ messages: state.messages.filter(m => m.id !== messageId) }));
        get().showToast('Deleted');
      } catch {
        get().showToast('Delete failed', 'error');
      }
    },

    setSearchQuery:      (query) => set({ searchQuery: query }),
    setActiveDateFilter: (date)  => set({ activeDateFilter: date }),

    // ── Device name ──────────────────────────────────────────────────────────
    deviceName: detectDefaultDeviceName(),

    setDeviceName: (name) => {
      localStorage.setItem('mbl2pc_sender', name);
      set({ deviceName: name });
    },

    // ── Snippets ─────────────────────────────────────────────────────────────
    snippets: [],

    loadSnippets: async () => {
      try {
        const snippets = await api.fetchSnippets();
        set({ snippets });
      } catch {
        // Snippets are a convenience feature — silent fail is acceptable
      }
    },

    addSnippet: async (name, content) => {
      const snippet = await api.createSnippet(name, content);
      set(state => ({ snippets: [...state.snippets, snippet] }));
      get().showToast('Snippet saved ⚡');
    },

    removeSnippet: async (snippetId) => {
      try {
        await api.deleteSnippet(snippetId);
        set(state => ({ snippets: state.snippets.filter(s => s.id !== snippetId) }));
        get().showToast('Snippet deleted');
      } catch {
        get().showToast('Error', 'error');
      }
    },

    // ── Clipboard ─────────────────────────────────────────────────────────────
    clipboardEntry: { content: '', updated_at: null },

    loadClipboard: async () => {
      try {
        const entry = await api.fetchClipboard();
        set({ clipboardEntry: entry });
      } catch {
        // Silent fail
      }
    },

    syncClipboard: async (content) => {
      try {
        await api.pushClipboard(content);
        set({ clipboardEntry: { content, updated_at: new Date().toISOString() } });
        get().showToast('Clipboard synced');
      } catch {
        get().showToast('Failed to sync clipboard', 'error');
      }
    },

    // ── Toasts ───────────────────────────────────────────────────────────────
    toasts: [],

    showToast: (message, type = 'success') => {
      const id = String(++toastIdCounter);
      set(state => ({ toasts: [...state.toasts, { id, message, type }] }));
      // Auto-dismiss matches the CSS animation duration of 2.6 seconds
      setTimeout(() => get().dismissToast(id), 2600);
    },

    dismissToast: (id) => {
      set(state => ({ toasts: state.toasts.filter(t => t.id !== id) }));
    },

    // ── Selection mode ────────────────────────────────────────────────────────
    isSelectMode:       false,
    selectedMessageIds: {},

    toggleSelectMode: () => {
      set(state => ({ isSelectMode: !state.isSelectMode, selectedMessageIds: {} }));
    },

    toggleMessageSelection: (id) => {
      set(state => {
        const updated = { ...state.selectedMessageIds };
        if (updated[id]) {
          delete updated[id];
        } else {
          updated[id] = true;
        }
        return { selectedMessageIds: updated };
      });
    },

    clearSelection: () => set({ isSelectMode: false, selectedMessageIds: {} }),
  };
});
