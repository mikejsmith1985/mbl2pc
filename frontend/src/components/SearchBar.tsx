/** Search input shown when the user taps the search button in the header. */

import { useRef, useEffect } from 'react';
import { useStore } from '../store';

interface SearchBarProps {
  onClose: () => void;
}

export function SearchBar({ onClose }: SearchBarProps) {
  const searchQuery     = useStore(state => state.searchQuery);
  const setSearchQuery  = useStore(state => state.setSearchQuery);
  const loadMessages    = useStore(state => state.loadMessages);
  const activeDateFilter = useStore(state => state.activeDateFilter);
  const inputRef        = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const newQuery = event.target.value;
    setSearchQuery(newQuery);
    loadMessages({ query: newQuery, date: activeDateFilter });
  }

  function handleClear() {
    setSearchQuery('');
    loadMessages({ query: '', date: activeDateFilter });
    onClose();
  }

  return (
    <div className="search-bar">
      <input
        ref={inputRef}
        className="search-input"
        type="search"
        placeholder="Search messages…"
        value={searchQuery}
        onChange={handleChange}
        aria-label="Search messages"
      />
      <button className="clear-search" onClick={handleClear} aria-label="Clear search">
        ✕
      </button>
    </div>
  );
}
