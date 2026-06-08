/** App header: user avatar, device name, search, theme picker, date filter, multi-select, logout. */

import { useState } from 'react';
import { useStore } from '../store';
import { SearchBar } from './SearchBar';
import { ThemePicker } from './ThemePicker';
import { DatePicker } from './DatePicker';
import { PaletteIcon, CalendarIcon, SearchIcon, CheckboxIcon, LogoutIcon } from './icons';

export function Header() {
  const userProfile       = useStore(state => state.userProfile);
  const deviceName        = useStore(state => state.deviceName);
  const setDeviceName     = useStore(state => state.setDeviceName);
  const isSelectMode      = useStore(state => state.isSelectMode);
  const toggleSelectMode  = useStore(state => state.toggleSelectMode);
  const activeDateFilter  = useStore(state => state.activeDateFilter);
  const appVersion        = useStore(state => state.appVersion);

  const [isSearchOpen,   setIsSearchOpen]   = useState(false);
  const [isThemeOpen,    setIsThemeOpen]    = useState(false);
  const [isDateOpen,     setIsDateOpen]     = useState(false);

  function handleDeviceNameKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === 'Escape') {
      (event.target as HTMLInputElement).blur();
    }
  }

  function handleDeviceNameBlur(event: React.FocusEvent<HTMLInputElement>) {
    const trimmed = event.target.value.trim();
    if (trimmed) setDeviceName(trimmed);
  }

  function toggleSearch() {
    setIsSearchOpen(prev => !prev);
    setIsThemeOpen(false);
    setIsDateOpen(false);
  }

  function toggleTheme() {
    setIsThemeOpen(prev => !prev);
    setIsSearchOpen(false);
    setIsDateOpen(false);
  }

  function toggleDate() {
    setIsDateOpen(prev => !prev);
    setIsSearchOpen(false);
    setIsThemeOpen(false);
  }

  return (
    <>
      <header role="banner">
        {/* Avatar or placeholder initial */}
        {userProfile?.picture
          ? <img src={userProfile.picture} className="avatar" alt={userProfile.name} referrerPolicy="no-referrer" />
          : <div className="avatar-placeholder" aria-hidden="true">
              {userProfile?.name?.charAt(0).toUpperCase() ?? '?'}
            </div>
        }

        <div className="info">
          <div className="app-name">mbl2pc</div>
          <div className="device-row">
            <span style={{ opacity: .7, fontSize: '.72rem' }}>from&nbsp;</span>
            <input
              className="device-name-input"
              value={deviceName}
              onChange={e => setDeviceName(e.target.value)}
              onKeyDown={handleDeviceNameKeyDown}
              onBlur={handleDeviceNameBlur}
              aria-label="Device name"
              maxLength={32}
            />
          </div>
        </div>

        {/* Action buttons */}
        <button
          className={`btn-icon ${isSearchOpen ? 'active' : ''}`}
          onClick={toggleSearch}
          aria-label="Search messages"
          aria-pressed={isSearchOpen}
          title="Search"
        >
          <SearchIcon size={19} />
        </button>

        <button
          className={`btn-icon ${activeDateFilter ? 'active' : ''}`}
          onClick={toggleDate}
          aria-label={activeDateFilter ? `Date filter: ${activeDateFilter}` : 'Filter by date'}
          aria-pressed={!!activeDateFilter}
          title="Filter by date"
        >
          <CalendarIcon size={19} />
        </button>

        <button
          className={`btn-icon ${isSelectMode ? 'active' : ''}`}
          onClick={toggleSelectMode}
          aria-label={isSelectMode ? 'Exit select mode' : 'Enter select mode'}
          aria-pressed={isSelectMode}
          title="Select messages"
        >
          <CheckboxIcon size={19} />
        </button>

        <button
          className={`btn-icon ${isThemeOpen ? 'active' : ''}`}
          onClick={toggleTheme}
          aria-label="Theme settings"
          aria-pressed={isThemeOpen}
          title="Theme"
        >
          <PaletteIcon size={19} />
        </button>

        <a
          href="/logout"
          className="btn-icon"
          aria-label="Log out"
          title="Log out"
          style={{ textDecoration: 'none' }}
        >
          <LogoutIcon size={19} />
        </a>
      </header>

      {/* Version bar */}
      {appVersion && (
        <div className="version-bar" aria-label={`App version: ${appVersion}`}>
          v{appVersion.slice(0, 7)}
        </div>
      )}

      {/* Popovers — rendered outside the header so they can float over content */}
      {isThemeOpen  && <ThemePicker onClose={() => setIsThemeOpen(false)} />}
      {isDateOpen   && <DatePicker  onClose={() => setIsDateOpen(false)}  />}

      {/* Search bar appears inline below the header */}
      {isSearchOpen && <SearchBar  onClose={() => setIsSearchOpen(false)} />}
    </>
  );
}
