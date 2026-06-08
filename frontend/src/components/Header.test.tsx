/** Header renders the app banner with action buttons. */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Header } from './Header';
import { useStore } from '../store';

describe('Header', () => {
  it('renders the header banner', () => {
    useStore.setState({ userProfile: null, deviceName: 'PC', isSelectMode: false, activeDateFilter: '', appVersion: '' });
    const { getByRole } = render(<Header />);
    expect(getByRole('banner')).toBeTruthy();
  });

  it('renders the app name', () => {
    useStore.setState({ userProfile: null, deviceName: 'PC', isSelectMode: false, activeDateFilter: '', appVersion: '' });
    const { getByText } = render(<Header />);
    expect(getByText('mbl2pc')).toBeTruthy();
  });

  it('renders search, calendar, select, theme, and logout buttons', () => {
    useStore.setState({ userProfile: null, deviceName: 'PC', isSelectMode: false, activeDateFilter: '', appVersion: '' });
    const { getByLabelText } = render(<Header />);
    expect(getByLabelText('Search messages')).toBeTruthy();
    expect(getByLabelText('Filter by date')).toBeTruthy();
    expect(getByLabelText('Enter select mode')).toBeTruthy();
    expect(getByLabelText('Theme settings')).toBeTruthy();
    expect(getByLabelText('Log out')).toBeTruthy();
  });
});
