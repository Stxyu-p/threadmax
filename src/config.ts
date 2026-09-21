/**
 * ThreadMax — Configuration & Storage Abstraction
 * GM_* API with localStorage fallback, typed accessors.
 */

import { STORAGE_KEYS, DEFAULT_CONFIG, DOWNLOAD_MODES, TIMESTAMP_MODES, VIDEO_SPEEDS } from '../constants';

export type DownloadMode = typeof DOWNLOAD_MODES[number];
export type TimestampMode = typeof TIMESTAMP_MODES[number];
export type VideoSpeed = typeof VIDEO_SPEEDS[number];

export interface TMConfig {
  downloadMode: DownloadMode;
  timestampMode: TimestampMode;
  videoVolume: number;
  videoSpeed: VideoSpeed;
  viralRadarEnabled: boolean;
  filterRising: boolean;
}

const isGM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';

function gmGet<T>(key: string, fallback: T): T {
  try {
    if (isGM) return GM_getValue(key, fallback) as T;
    const val = localStorage.getItem(key);
    return val !== null ? JSON.parse(val) : fallback;
  } catch {
    return fallback;
  }
}

function gmSet(key: string, value: unknown): void {
  try {
    if (isGM) { GM_setValue(key, value); return; }
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('[ThreadMax] Failed to save config:', key, e);
  }
}

// ─── Typed Accessors ──────────────────────────────────────────
export const TM_Config = {
  getDownloadMode: (): DownloadMode => gmGet(STORAGE_KEYS.DOWNLOAD_MODE, DEFAULT_CONFIG.downloadMode),
  setDownloadMode: (v: DownloadMode) => gmSet(STORAGE_KEYS.DOWNLOAD_MODE, v),

  getTimestampMode: (): TimestampMode => gmGet(STORAGE_KEYS.TIMESTAMP_MODE, DEFAULT_CONFIG.timestampMode),
  setTimestampMode: (v: TimestampMode) => gmSet(STORAGE_KEYS.TIMESTAMP_MODE, v),

  getVideoVolume: (): number => gmGet(STORAGE_KEYS.VIDEO_VOLUME, DEFAULT_CONFIG.videoVolume),
  setVideoVolume: (v: number) => gmSet(STORAGE_KEYS.VIDEO_VOLUME, Math.max(0, Math.min(1, v))),

  getVideoSpeed: (): VideoSpeed => gmGet(STORAGE_KEYS.VIDEO_SPEED, DEFAULT_CONFIG.videoSpeed),
  setVideoSpeed: (v: VideoSpeed) => gmSet(STORAGE_KEYS.VIDEO_SPEED, v),

  getViralRadarEnabled: (): boolean => gmGet(STORAGE_KEYS.VIRAL_RADAR, DEFAULT_CONFIG.viralRadarEnabled),
  setViralRadarEnabled: (v: boolean) => gmSet(STORAGE_KEYS.VIRAL_RADAR, v),

  getFilterRising: (): boolean => gmGet(STORAGE_KEYS.FILTER_RISING, DEFAULT_CONFIG.filterRising),
  setFilterRising: (v: boolean) => gmSet(STORAGE_KEYS.FILTER_RISING, v),

  // Doc IDs for GraphQL
  getDocIdFollowers: (): string | null => gmGet(STORAGE_KEYS.DOC_ID_FOLLOWERS, null),
  setDocIdFollowers: (v: string) => gmSet(STORAGE_KEYS.DOC_ID_FOLLOWERS, v),
  getDocIdFollowing: (): string | null => gmGet(STORAGE_KEYS.DOC_ID_FOLLOWING, null),
  setDocIdFollowing: (v: string) => gmSet(STORAGE_KEYS.DOC_ID_FOLLOWING, v),

  // User ID cache
  getUserId: (username: string): string | null => gmGet(`${STORAGE_KEYS.USER_ID_PREFIX}${username.toLowerCase()}`, null),
  setUserId: (username: string, id: string) => gmSet(`${STORAGE_KEYS.USER_ID_PREFIX}${username.toLowerCase()}`, id),

  // Generic
  get: <T>(key: string, fallback: T): T => gmGet(key, fallback),
  set: (key: string, value: unknown) => gmSet(key, value),
};

// ─── Menu Command Registration ────────────────────────────────
export function registerMenuCommands(actions: Map<string, () => void>): void {
  if (typeof GM_registerMenuCommand !== 'function') return;
  
  actions.forEach((fn, label) => {
    try {
      GM_registerMenuCommand(label, fn);
    } catch (e) {
      console.warn('[ThreadMax] Failed to register menu command:', label, e);
    }
  });
}