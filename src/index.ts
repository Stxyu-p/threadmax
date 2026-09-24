/**
 * ThreadMax — Entry Point
 * Orchestrates Phase 1 and Phase 2 features.
 * Pure Vanilla TypeScript, Zero External Dependencies.
 */

import { updateAllTimestamps } from './features/timestamp';
import { enhanceVideo } from './features/video';
import { enhanceComposer } from './features/composer';
import { MutationWatcher } from './dom/observer';
import { CSS_PREFIX, TIMING } from './constants';

/**
 * Scan feed and inject Phase 1 and 2 triggers
 */
export function scheduleScan(): void {
  // 1. Phase 1: in-feed buttons are injected by the bundle's buttons module (src parity pending)

  // 2. Phase 1: Video Player Booster
  document.querySelectorAll<HTMLVideoElement>('video').forEach(video => {
    enhanceVideo(video);
  });

  // 3. Phase 1: Smart Timestamp formatting
  updateAllTimestamps();

  // 4. Phase 2: Composer Hook Guide & Splitter
  document.querySelectorAll<HTMLElement>('[role="textbox"]').forEach(box => {
    enhanceComposer(box);
  });

}

/**
 * Initialize ThreadMax
 */
export function init(): void {
  // Phase 1 / Mutation Observer: debounced, batched, safe
  let scanTimer: any = null;
  const debouncedScan = () => {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(scheduleScan, TIMING.SCAN_DEBOUNCE_MS);
  };

  const watcher = new MutationWatcher({
    debounceMs: TIMING.SCAN_DEBOUNCE_MS,
    maxBatchSize: 50,
    filter: m => m.type === 'childList' && m.addedNodes.length > 0,
    onMutations: () => debouncedScan(),
  });

  if (document.body) {
    watcher.observe(document.body, { childList: true, subtree: true });
  }

  // Initial immediate scan
  debouncedScan();
}

// Auto-start on load
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}
