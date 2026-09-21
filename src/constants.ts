/**
 * ThreadMax — Centralized Constants
 * All magic numbers, timeouts, selectors, CSS class prefixes in one place.
 */

// ─── CSS Class Prefix ─────────────────────────────────────────
export const CSS_PREFIX = 'tm-';

// ─── Timing & Delays ──────────────────────────────────────────
export const TIMING = {
  SCAN_DEBOUNCE_MS: 250,
  DROPDOWN_CLICK_GUARD_MS: 50,
  SCROLL_LISTENER_THROTTLE_MS: 350,
  AUTO_SCROLL_INTERVAL_MS: 450,
  AUTO_SCROLL_STEP_MIN: 300,
  AUTO_SCROLL_STEP_MAX: 600,
  AUTO_SCROLL_IDLE_TICKS_TARGET: 10,
  AUTO_SCROLL_IDLE_TICKS_AT_TARGET: 3,
  TAB_TRANSITION_GRACE_MS: 400,
  LIVE_SNIFF_INTERVAL_MS: 350,
  GRAPHQL_JITTER_MIN_MS: 2000,
  GRAPHQL_JITTER_MAX_MS: 3500,
  DOWNLOAD_INDIVIDUAL_DELAY_MS: 220,
  TOAST_DURATION_MS: 2200,
  PROGRESS_BAR_CLEAR_DELAY_MS: 1200,
} as const;

// ─── UI Dimensions ────────────────────────────────────────────
export const UI_DIMENSIONS = {
  DROPDOWN_WIDTH: 270,
  DROPDOWN_MIN_WIDTH: 260,
  PROGRESS_BAR_WIDTH: 80,
  CHECKBOX_PILL_SIZE: 26,
  VIDEO_CONTROLLER_TOP: 12,
  VIDEO_CONTROLLER_RIGHT: 12,
  STUDIO_LAUNCHER_BOTTOM: 20,
  STUDIO_LAUNCHER_LEFT: 20,
  STUDIO_DRAWER_MAX_WIDTH: 440,
  READER_MODAL_MAX_WIDTH: 680,
  READER_MODAL_WIDTH_PCT: 90,
  READER_MODAL_MAX_HEIGHT_VH: 85,
  VIEWPORT_MARGIN: 16,
} as const;

// ─── Z-Index Layers ───────────────────────────────────────────
export const Z_INDEX = {
  DROPDOWN: 2147483647,      // Max signed 32-bit int
  PROGRESS_BAR: 999,
  VIDEO_CONTROLS: 40,
  CHECKBOX_PILL: 50,
  SELECTION_BAR: 100,
  TOAST: 9999999,
  STUDIO_LAUNCHER: 99999,
  STUDIO_DRAWER: 1000000,
  READER_MODAL: 1000000,
  FEED_FILTER_BAR: 100,
} as const;

// ─── Feature Thresholds ───────────────────────────────────────
export const THRESHOLDS = {
  HOOK_SAFE_MAX: 180,
  HOOK_CUT_MAX: 500,
  SPLIT_MAX_LEN: 460,
  VIRAL_MAX_AGE_MINUTES: 180,
  VIRAL_MAX_REPLIES: 50,
  VIRAL_MIN_VELOCITY: 0.1,
  CAROUSEL_AVATAR_MAX_WIDTH: 75,
  AVATAR_BORDER_RADIUS_50: '50%',
  SCROLL_CONTAINER_MIN_HEIGHT: 60,
  SCROLL_CONTAINER_SCROLL_MARGIN: 10,
  TAB_WEIGHT_DELTA: 15,
  USER_ID_MIN_DIGITS: 4,
  USER_ID_MAX_DIGITS: 25,
  BATCH_PAGE_SIZE: 50,
  LIST_PAGE_SIZE: 50,
} as const;

// ─── Storage Keys ─────────────────────────────────────────────
export const STORAGE_KEYS = {
  DOWNLOAD_MODE: 'tm_download_mode',
  TIMESTAMP_MODE: 'tm_timestamp_mode',
  VIDEO_VOLUME: 'tm_video_volume',
  VIDEO_SPEED: 'tm_video_speed',
  VIRAL_RADAR: 'tm_viral_radar_enabled',
  FILTER_RISING: 'tm_filter_rising',
  DOC_ID_FOLLOWERS: 'tm_doc_followers',
  DOC_ID_FOLLOWING: 'tm_doc_following',
  USER_ID_PREFIX: 'tm_uid_',
  CONFIG: 'tm_config',
} as const;

// ─── Default Config ───────────────────────────────────────────
export const DEFAULT_CONFIG = {
  downloadMode: 'zip' as 'zip' | 'individual',
  timestampMode: 'hybrid' as 'hybrid' | 'absolute' | 'native',
  videoVolume: 0.8,
  videoSpeed: 1.0,
  viralRadarEnabled: true,
  filterRising: false,
} as const;

// ─── Video Speeds ─────────────────────────────────────────────
export const VIDEO_SPEEDS = [1.0, 1.25, 1.5, 2.0] as const;

// ─── Timestamp Modes ──────────────────────────────────────────
export const TIMESTAMP_MODES = ['hybrid', 'absolute', 'native'] as const;

// ─── Download Modes ───────────────────────────────────────────
export const DOWNLOAD_MODES = ['zip', 'individual'] as const;

// ─── IndexedDB ────────────────────────────────────────────────
export const INDEXED_DB = {
  NAME: 'ThreadMaxDB',
  VERSION: 1,
  STORE_SNAPSHOTS: 'snapshots',
} as const;

// ─── Excluded Username Paths ──────────────────────────────────
export const EXCLUDED_USERNAME_PATHS = new Set([
  'post',
  'explore',
  'search',
  'activity',
  'messages',
  'settings',
]);

// ─── User Agent for GraphQL ───────────────────────────────────
export const GRAPHQL_HEADERS = {
  'X-IG-App-ID': '238260118658252',
  'X-Requested-With': 'XMLHttpRequest',
  'Content-Type': 'application/x-www-form-urlencoded',
} as const;

// ─── API Origins ──────────────────────────────────────────────
export const API_ORIGINS = [
  'https://www.threads.com',
  'https://www.threads.net',
] as const;

// ─── Selector Strategy ─────────────────────────────────────────
// DEPRECATED: Hardcoded selectors moved to semantic detection in src/dom/semantic.ts
// This object remains for backward compat during transition — will be removed.
export const SELECTORS = {
  POST_CONTAINER: '[data-pressable-container="true"], article',
  POST_LINK: 'a[href*="/post/"]',
  AUTHOR_LINK: 'a[href*="/@"]',
  ACTION_BUTTON: 'div[role="button"]',
  SHARE_SVG_PATHS: [
    'path[d*="M7.247 1.499"]',
    'path[d*="M7.246 1.5"]',
    'path[d*="M1.53 6.014"]',
  ],
  SHARE_TITLES: ['svg[title*="Share" i]', 'svg[title*="แชร์"]', 'svg[title*="分享"]'],
  SHARE_LABELS: ['svg[aria-label*="Share" i]', 'svg[aria-label*="แชร์"]'],
  VIDEO: 'video',
  VIDEO_SOURCE: 'video source',
  IMAGE: 'img[src*="cdninstagram.com"], img[src*="fbcdn.net"]',
  TIME_ELEMENT: 'time[datetime]',
  TEXT_CONTAINER: 'div[dir="auto"], span[dir="auto"]',
  COMPOSER_TEXTBOX: 'div[role="textbox"][contenteditable="true"]',
  DIALOG: '[role="dialog"]',
  MODAL_TABLIST: '[role="tablist"]',
  MODAL_TAB: '[role="tab"]',
  MODAL_HEADER: 'header',
  PROFILE_LINK_IN_MODAL: 'a[href*="/@"]:not([href*="/post/"])',
} as const;

// ─── ponytail: Simplification Markers ─────────────────────────
// These mark deliberate simplifications with ceiling & upgrade path
export const PONYTAIL_NOTES = {
  ZIP_MEMORY: 'ponytail: ZIP mode loads all media into memory before compressing. Ceiling: ~150MB (10×15MB videos). Upgrade: streaming ZIP via TransformStream.',
  GRAPHQL_FALLBACK: 'ponytail: GraphQL doc_id capture trusts any query containing "follower"/"following". Ceiling: false positives pollute cache. Upgrade: probe request validation before persist.',
  TIMESTAMP_REACT_FIGHT: 'ponytail: Timestamp re-applies on every scan; fights React re-renders. Ceiling: flicker on hybrid mode. Upgrade: idempotent write with data-tm-mode guard.',
  MUTATION_FULL_SCAN: 'ponytail: MutationObserver triggers full feed re-scan on any node insert. Ceiling: O(n²) on virtualized feed. Upgrade: targeted diff by postId tracking.',
  SHARE_BUTTON_SELECTOR: 'ponytail: Share button detection uses hardcoded SVG paths. Ceiling: breaks when Threads rotates icons. Upgrade: structural selector via action row wrapper.',
  AUTO_SCROLL_CONTAINER: 'ponytail: Container resolution falls back to dialog if no profile links rendered. Ceiling: scrolls entire dialog. Upgrade: wait for first render batch before resolving.',
  TAB_SWITCH_RACE: 'ponytail: Dual _isTabTransitioning/_isSwitchingTab flags with 400ms timeout. Ceiling: manual click during transition causes double-switch. Upgrade: explicit state machine.',
  CAROUSEL_SELECTOR: 'ponytail: Media tile detection climbs parentElement until non-PICTURE/A/zero-width. Ceiling: misplaces checkboxes on varied carousel DOM. Upgrade: target data-visualcompletion="media" or ul[role="list"]>li.',
  VIDEO_REATTACH: 'ponytail: Video booster only checks dataset.tmBoosted; misses src swap on carousel. Ceiling: stale controller on swapped video. Upgrade: MutationObserver on video currentSrc.',
  ERROR_BOUNDARY: 'ponytail: No try/catch in scheduleScan callback; uncaught exception kills observer loop. Ceiling: script goes dormant. Upgrade: exponential backoff wrapper.',
} as const;