/** Root component: app shell layout, initial data loading, and SSE connection. */

import { useEffect } from 'react';
import { useStore } from './store';
import { useSSE } from './hooks/useSSE';
import { Header } from './components/Header';
import { PinnedPanel } from './components/PinnedPanel';
import { ChatArea } from './components/ChatArea';
import { InputBar } from './components/InputBar';
import { SelectionBar } from './components/SelectionBar';
import { ClipboardPanel } from './components/ClipboardPanel';
import { Toast } from './components/Toast';
import './styles.css';

export function App() {
  const loadUserProfile  = useStore(state => state.loadUserProfile);
  const loadMessages     = useStore(state => state.loadMessages);
  const loadSnippets     = useStore(state => state.loadSnippets);
  const loadClipboard    = useStore(state => state.loadClipboard);
  const loadAppVersion   = useStore(state => state.loadAppVersion);
  const isSelectMode     = useStore(state => state.isSelectMode);

  // Start the SSE connection — it lives for the entire app lifetime
  useSSE();

  // Load all initial data in parallel on first render
  useEffect(() => {
    loadUserProfile();
    loadMessages();
    loadSnippets();
    loadClipboard();
    loadAppVersion();
  }, []);

  return (
    <>
      <Header />
      <PinnedPanel />
      <ClipboardPanel />
      <ChatArea />
      {isSelectMode ? <SelectionBar /> : <InputBar />}
      <Toast />
    </>
  );
}
