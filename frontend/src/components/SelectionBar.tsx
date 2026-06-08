/** Action bar that replaces the input bar when multi-select mode is active. */

import { useStore } from '../store';
import { downloadFileAsBlob } from '../utils';

export function SelectionBar() {
  const selectedMessageIds = useStore(state => state.selectedMessageIds);
  const messages           = useStore(state => state.messages);
  const clearSelection     = useStore(state => state.clearSelection);
  const removeMessage      = useStore(state => state.removeMessage);
  const showToast          = useStore(state => state.showToast);

  const selectedCount  = Object.keys(selectedMessageIds).length;
  const selectedMessages = messages.filter(m => selectedMessageIds[m.id]);

  // The "Save images" button is only active when at least one selected message has an image
  const imageMessages = selectedMessages.filter(m => m.image_url);

  async function handleSaveImages() {
    if (imageMessages.length === 0) return;
    try {
      for (const message of imageMessages) {
        const fileName = message.image_url.split('/').pop() ?? 'image.jpg';
        await downloadFileAsBlob(message.image_url, fileName);
      }
      showToast(`Saved ${imageMessages.length} image${imageMessages.length === 1 ? '' : 's'}`);
    } catch {
      showToast('Failed to save images', 'error');
    }
    clearSelection();
  }

  async function handleDeleteSelected() {
    if (selectedMessages.length === 0) return;
    for (const message of selectedMessages) {
      await removeMessage(message.id);
    }
    clearSelection();
  }

  return (
    <div className="selection-bar" role="toolbar" aria-label="Selection actions">
      <span className="sel-count-label">
        {selectedCount} selected
      </span>
      <button
        className="sel-action-btn"
        onClick={handleSaveImages}
        disabled={imageMessages.length === 0}
        aria-label={`Save ${imageMessages.length} image${imageMessages.length !== 1 ? 's' : ''}`}
      >
        Save images
      </button>
      <button
        className="sel-action-btn"
        onClick={handleDeleteSelected}
        disabled={selectedCount === 0}
        aria-label="Delete selected"
      >
        Delete
      </button>
      <button className="sel-action-btn accent" onClick={clearSelection} aria-label="Cancel selection">
        Cancel
      </button>
    </div>
  );
}
