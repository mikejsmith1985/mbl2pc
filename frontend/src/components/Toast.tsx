/** Fixed-position toast notification container. Auto-dismissal is handled in the store. */

import { useStore } from '../store';

export function Toast() {
  const toasts = useStore(state => state.toasts);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" role="status" aria-live="polite">
      {toasts.map(toast => (
        <div key={toast.id} className={`toast ${toast.type}`}>
          {toast.message}
        </div>
      ))}
    </div>
  );
}
