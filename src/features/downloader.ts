/**
 * ThreadMax — Batch Downloader & Progress UI
 * Pure functions for download logic, DOM manipulation separate.
 */

import { MediaItem, PostMetadata } from '../dom/extract';
import { cleanPostUrl, createStoredZip, makeFilename } from '../utils';
import { TM_Config } from '../config';
import { TIMING, UI_DIMENSIONS, Z_INDEX, CSS_PREFIX } from '../constants';

// ─── Progress Bar DOM ─────────────────────────────────────────
const progressTimeouts = new WeakMap<HTMLElement, any>();

export function showProgress(anchorBtn: HTMLElement, current: number, total: number): void {
  let bar = anchorBtn.parentElement?.querySelector(`.${CSS_PREFIX}progress-bar`) as HTMLElement;
  if (!bar) {
    bar = document.createElement('div');
    bar.className = `${CSS_PREFIX}progress-bar`;
    bar.innerHTML = `
      <span class="${CSS_PREFIX}progress-text"></span>
      <div class="${CSS_PREFIX}progress-track"><div class="${CSS_PREFIX}progress-fill"></div></div>
    `;
    anchorBtn.parentElement?.appendChild(bar);
  }

  // Clear existing watchdog timer
  if (progressTimeouts.has(anchorBtn)) {
    clearTimeout(progressTimeouts.get(anchorBtn));
  }
  // Auto-cleanup watchdog: remove stalled bar after 30 seconds
  const watchdog = setTimeout(() => {
    clearProgress(anchorBtn, 0);
  }, 30000);
  progressTimeouts.set(anchorBtn, watchdog);

  const pct = Math.round((current / (total || 1)) * 100);
  bar.querySelector(`.${CSS_PREFIX}progress-text`)!.textContent = `${current}/${total} ↓ (${pct}%)`;
  (bar.querySelector(`.${CSS_PREFIX}progress-fill`) as HTMLElement).style.width = `${pct}%`;
}

export function clearProgress(anchorBtn: HTMLElement, delay = TIMING.PROGRESS_BAR_CLEAR_DELAY_MS): void {
  if (progressTimeouts.has(anchorBtn)) {
    clearTimeout(progressTimeouts.get(anchorBtn));
    progressTimeouts.delete(anchorBtn);
  }
  const bar = anchorBtn.parentElement?.querySelector(`.${CSS_PREFIX}progress-bar`) as HTMLElement;
  if (bar) {
    if (delay <= 0) {
      bar.remove();
    } else {
      setTimeout(() => bar.remove(), delay);
    }
  }
}

// ─── Download Helpers ─────────────────────────────────────────
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1500);
}

export function downloadDirect(url: string, filename: string): void {
  if (typeof GM_download === 'function') {
    GM_download({
      url,
      name: filename,
      saveAs: false,
      onerror: () => fallbackDownload(url, filename),
    });
  } else {
    fallbackDownload(url, filename);
  }
}

function fallbackDownload(url: string, filename: string): void {
  fetch(url)
    .then(res => res.blob())
    .then(blob => downloadBlob(blob, filename))
    .catch(() => {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
}

// ─── Single Download ──────────────────────────────────────────
export function downloadSingle(mediaItem: MediaItem, author: string, postId: string, index: number, anchorBtn: HTMLElement): void {
  const filename = makeFilename(author, postId, index, mediaItem.type);
  showProgress(anchorBtn, 1, 1);

  if (mediaItem.type === 'video') {
    downloadDirect(mediaItem.url, filename);
    setTimeout(() => clearProgress(anchorBtn), TIMING.PROGRESS_BAR_CLEAR_DELAY_MS);
  } else {
    fetch(mediaItem.url)
      .then(r => r.blob())
      .then(blob => {
        downloadBlob(blob, filename);
        clearProgress(anchorBtn);
      })
      .catch(() => {
        downloadDirect(mediaItem.url, filename);
        clearProgress(anchorBtn);
      });
  }
}

// ─── Batch Download ───────────────────────────────────────────
export interface DownloadBatchOptions {
  mediaList: MediaItem[];
  author: string;
  postId: string;
  anchorBtn: HTMLElement;
  mode?: 'zip' | 'individual';
  onComplete?: (completed: number, failed: number) => void;
}

export async function downloadBatch(opts: DownloadBatchOptions): Promise<void> {
  const { mediaList, author, postId, anchorBtn, mode = 'zip', onComplete } = opts;
  const total = mediaList.length;
  let completed = 0;
  let failed = 0;

  showProgress(anchorBtn, 0, total);

  if (mode === 'individual') {
    for (let i = 0; i < mediaList.length; i++) {
      const item = mediaList[i];
      const filename = makeFilename(author, postId, i + 1, item.type);
      downloadDirect(item.url, filename);
      completed++;
      showProgress(anchorBtn, completed, total);
      await new Promise(r => setTimeout(r, TIMING.DOWNLOAD_INDIVIDUAL_DELAY_MS));
    }
    setTimeout(() => clearProgress(anchorBtn), 1500);
    onComplete?.(completed, failed);
    return;
  }

  // ZIP Mode — ponytail: loads all into memory. Ceiling ~150MB. Upgrade: streaming ZIP.
  const zipFiles: { name: string; data: Uint8Array }[] = [];
  for (let i = 0; i < mediaList.length; i++) {
    const item = mediaList[i];
    const entryName = makeFilename(author, postId, i + 1, item.type);

    try {
      const resp = await fetch(item.url);
      const buf = await resp.arrayBuffer();
      zipFiles.push({ name: entryName, data: new Uint8Array(buf) });
      completed++;
    } catch (err) {
      console.warn('[ThreadMax] Failed to fetch media in ZIP build:', item.url, err);
      failed++;
    }
    showProgress(anchorBtn, completed + failed, total);
  }

  if (zipFiles.length > 0) {
    const zipBlob = createStoredZip(zipFiles);
    const zipName = `${author}_${postId}_carousel_${zipFiles.length}items.zip`;
    downloadBlob(zipBlob, zipName);
    onComplete?.(completed, failed);
  } else {
    onComplete?.(0, total);
  }
  clearProgress(anchorBtn);
}