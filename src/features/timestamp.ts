/**
 * ThreadMax — Smart Configurable Timestamp
 * Hybrid / Absolute / Native modes with idempotent rendering.
 */

import { TM_Config } from '../config';
import { formatAbsolute, formatHybrid, CSS_PREFIX } from '../utils';
import { THRESHOLDS } from '../constants';

let currentTimestampMode: string | null = null;

export function updateAllTimestamps(): void {
  const mode = TM_Config.getTimestampMode();
  
  // Track mode change to force re-render
  if (currentTimestampMode !== mode) {
    currentTimestampMode = mode;
    // Clear all data-tm-mode flags to force recompute
    document.querySelectorAll<HTMLTimeElement>('time[datetime]').forEach(el => {
      delete (el.dataset as any).tmMode;
    });
  }

  const timeNodes = document.querySelectorAll<HTMLTimeElement>('time[datetime]');
  
  timeNodes.forEach(timeEl => {
    const iso = timeEl.dateTime;
    if (!iso) return;

    // Store original once
    if (!timeEl.dataset.tmOrig) {
      timeEl.dataset.tmOrig = timeEl.textContent?.trim() || '';
    }

    // Check if mode already applied
    if (timeEl.dataset.tmMode === mode) return;

    const orig = timeEl.dataset.tmOrig;
    const date = new Date(iso);
    if (isNaN(date.getTime())) return;

    let newText: string;
    if (mode === 'native') {
      newText = orig;
    } else if (mode === 'absolute') {
      newText = formatAbsolute(date);
    } else { // hybrid
      const hhmm = String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
      newText = `${orig} (${hhmm})`;
    }

    // Only write if different (idempotent)
    if (timeEl.textContent !== newText) {
      timeEl.textContent = newText;
    }
    timeEl.dataset.tmMode = mode;
  });
}