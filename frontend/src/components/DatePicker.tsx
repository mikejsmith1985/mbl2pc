/** Calendar popover for filtering messages by a specific date. */

import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';

interface DatePickerProps {
  onClose: () => void;
}

export function DatePicker({ onClose }: DatePickerProps) {
  const activeDateFilter   = useStore(state => state.activeDateFilter);
  const setActiveDateFilter = useStore(state => state.setActiveDateFilter);
  const loadMessages       = useStore(state => state.loadMessages);
  const searchQuery        = useStore(state => state.searchQuery);

  const today = new Date();
  const [viewYear,  setViewYear]  = useState(activeDateFilter ? parseInt(activeDateFilter.slice(0, 4)) : today.getFullYear());
  const [viewMonth, setViewMonth] = useState(activeDateFilter ? parseInt(activeDateFilter.slice(5, 7)) - 1 : today.getMonth());
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [onClose]);

  function handleSelectDate(dateString: string) {
    const newFilter = activeDateFilter === dateString ? '' : dateString;
    setActiveDateFilter(newFilter);
    loadMessages({ query: searchQuery, date: newFilter });
    if (newFilter) onClose();
  }

  function handleClear() {
    setActiveDateFilter('');
    loadMessages({ query: searchQuery, date: '' });
    onClose();
  }

  function navigateMonth(direction: -1 | 1) {
    let newMonth = viewMonth + direction;
    let newYear  = viewYear;
    if (newMonth < 0)  { newMonth = 11; newYear--; }
    if (newMonth > 11) { newMonth = 0;  newYear++; }
    setViewMonth(newMonth);
    setViewYear(newYear);
  }

  const MONTH_NAMES    = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DAY_LABELS     = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  const firstDayOfMonth = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth     = new Date(viewYear, viewMonth + 1, 0).getDate();

  const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  return (
    <div className="date-popover" ref={popoverRef} role="dialog" aria-label="Date filter">
      <div className="cal-pop-header">
        <button onClick={() => navigateMonth(-1)} aria-label="Previous month">‹</button>
        <span className="cal-pop-month-label">{MONTH_NAMES[viewMonth]} {viewYear}</span>
        <button onClick={() => navigateMonth(1)} aria-label="Next month">›</button>
      </div>

      <div className="cal-pop-grid">
        {DAY_LABELS.map(dayLabel => (
          <div key={dayLabel} className="cpd">{dayLabel}</div>
        ))}

        {/* Empty cells before the first day */}
        {Array.from({ length: firstDayOfMonth }, (_, cellIndex) => (
          <div key={`empty-${cellIndex}`} className="cpday empty" />
        ))}

        {/* Day number cells */}
        {Array.from({ length: daysInMonth }, (_, dayIndex) => {
          const dayNumber  = dayIndex + 1;
          const dateString = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;
          const isToday    = dateString === todayString;
          const isSelected = dateString === activeDateFilter;
          return (
            <button
              key={dateString}
              className={`cpday ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}`}
              onClick={() => handleSelectDate(dateString)}
              aria-label={dateString}
              aria-pressed={isSelected}
            >
              {dayNumber}
            </button>
          );
        })}
      </div>

      {activeDateFilter && (
        <button className="date-picker-clear" onClick={handleClear}>
          Clear date filter
        </button>
      )}
    </div>
  );
}
