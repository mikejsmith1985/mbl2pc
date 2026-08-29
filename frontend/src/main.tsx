/** React DOM entry point — mounts the app into the #root element in send.html. */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { removeLegacyServiceWorker } from './serviceWorkerCleanup';

// Clear any worker left over from the pre-React app; it could otherwise keep
// serving cached files and pin the device to an old build.
void removeLegacyServiceWorker();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root not found in send.html');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
