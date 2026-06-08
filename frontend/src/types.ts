/** Core domain types shared across all components of the mbl2pc frontend. */

export interface Message {
  id: string;
  sender: string;
  text: string;
  image_url: string;
  file_url: string;
  file_name: string;
  timestamp: string;
  starred: boolean;
}

export interface Snippet {
  id: string;
  name: string;
  content: string;
  created_at: string;
}

export interface UserProfile {
  sub: string;
  name: string;
  email: string;
  picture: string;
}

export type ThemePalette = 'indigo' | 'ocean' | 'forest' | 'rose' | 'amber';
export type ThemeMode = 'light' | 'dark';

export interface ToastNotification {
  id: string;
  message: string;
  type: 'success' | 'error';
}

export interface ClipboardEntry {
  content: string;
  updated_at: string | null;
}
