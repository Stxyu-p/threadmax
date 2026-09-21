/**
 * ThreadMax — Entry Point
 * Orchestrates Phase 1, Phase 2, and Phase 3 features.
 * Pure Vanilla TypeScript, Zero External Dependencies.
 */

import { installGraphQLSniffer } from './features/auditor/graphql';
import { updateAllTimestamps } from './features/timestamp';
import { enhanceVideo } from './features/video';
import { enhanceComposer } from './features/composer';
import { scanViralRadar, injectFilterBar } from './features/viral';
import { findShareButtons, findPostCard } from './dom/extract';
import { MutationWatcher } from './dom/observer';
import { CSS_PREFIX, TIMING } from './constants';

/**
 * Scan feed and inject Phase 1, 2, and 3 triggers
 */
export function scheduleScan(): void {
  // 1. Phase 1: In-feed download & clean link triggers
  const shareItems = findShareButtons();
  shareItems.forEach(shareInfo => {
    // Injected by buttons module / DOM handler
  });

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

  // 5. Phase 3: Viral Velocity Radar
  injectFilterBar();
  scanViralRadar();
}

/**
 * Initialize ThreadMax
 */
export function init(): void {
  // Phase 3 Sniffer: captures doc_id from live requests
  installGraphQLSniffer();

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
