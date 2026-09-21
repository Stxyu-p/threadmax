/**
 * ThreadMax — Viral Velocity Radar
 * Detects rising posts early with mathematical engagement scoring.
 */

import { findShareButtons, findPostCard, getPostMetadata, PostMetadata } from '../dom/extract';
import { calculateVelocity, isRisingPost, shouldDisplayInFeed, TM_Config } from '../utils';
import { THRESHOLDS, TIMING, CSS_PREFIX, Z_INDEX } from '../constants';

let filterBarInjected = false;

export function scanViralRadar(): void {
  const enabled = TM_Config.getViralRadarEnabled();
  if (!enabled) return;

  const shareItems = findShareButtons();
  shareItems.forEach(shareInfo => {
    const card = findPostCard(shareInfo.actionRow);
    if (!card || card.querySelector(`.${CSS_PREFIX}viral-badge`)) return;

    const meta = getPostMetadata(card);
    if (!meta.postDate) return;

    const ageMinutes = Math.max(1, (Date.now() - meta.postDate.getTime()) / 60000);
    
    if (isRisingPost(meta.replies, meta.reposts, ageMinutes)) {
      const authorHeader = card.querySelector('a[href*="/@"]')?.parentElement || card.querySelector('time')?.parentElement;
      if (authorHeader && !authorHeader.querySelector(`.${CSS_PREFIX}viral-badge`)) {
        const badge = document.createElement('span');
        badge.className = `${CSS_PREFIX}viral-badge`;
        const ratePerHour = Math.round(calculateVelocity(meta.replies, meta.reposts, ageMinutes) * 60);
        badge.title = `ThreadMax Viral Radar: อัตราเร่ง ~${ratePerHour} เอนเกจเมนต์/ชม.`;
        badge.textContent = `⚡ Rising (${ratePerHour}/hr)`;
        authorHeader.appendChild(badge);
      }
    }
  });

  applyFilter();
  injectFilterBar();
}

export function applyFilter(): void {
  const filterActive = TM_Config.getFilterRising();
  const shareItems = findShareButtons();
  
  shareItems.forEach(shareInfo => {
    const card = findPostCard(shareInfo.actionRow);
    if (!card) return;
    const isRising = card.querySelector(`.${CSS_PREFIX}viral-badge`) !== null;
    card.style.display = shouldDisplayInFeed(filterActive, isRising) ? '' : 'none';
  });
}

export function injectFilterBar(): void {
  if (filterBarInjected) {
    updateFilterBarUI();
    return;
  }

  const container = document.querySelector('main') || document.querySelector('[role="main"]');
  if (!container) return;

  const bar = document.createElement('div');
  bar.id = `${CSS_PREFIX}feed-filter-bar`;
  bar.className = `${CSS_PREFIX}feed-filter-bar`;
  bar.innerHTML = `
    <div class="${CSS_PREFIX}filter-pills">
      <button type="button" class="${CSS_PREFIX}filter-pill active" data-filter="all">ทั้งหมด</button>
      <button type="button" class="${CSS_PREFIX}filter-pill" data-filter="rising">🔥 Rising Radar</button>
    </div>
  `;

  bar.querySelectorAll(`.${CSS_PREFIX}filter-pill`).forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const filter = (btn as HTMLElement).dataset.filter;
      const isRising = filter === 'rising';
      TM_Config.setFilterRising(isRising);
      updateFilterBarUI();
      applyFilter();
      showToast(isRising ? '🔥 แสดงเฉพาะโพสต์เรดาร์พุ่งแรง' : 'แสดงโพสต์ทั้งหมด');
    };
  });

  container.insertBefore(bar, container.firstChild);
  filterBarInjected = true;
  updateFilterBarUI();
}

export function updateFilterBarUI(): void {
  const bar = document.getElementById(`${CSS_PREFIX}feed-filter-bar`);
  if (!bar) return;
  const isRising = TM_Config.getFilterRising();
  bar.querySelectorAll(`.${CSS_PREFIX}filter-pill`).forEach(btn => {
    const filter = (btn as HTMLElement).dataset.filter;
    if (filter === 'rising') {
      btn.classList.toggle('active', isRising);
    } else {
      btn.classList.toggle('active', !isRising);
    }
  });
}

// ─── Toast helper ─────────────────────────────────────────────
function showToast(msg: string, duration = TIMING.TOAST_DURATION_MS): void {
  let toast = document.getElementById(`${CSS_PREFIX}toast`);
  if (!toast) {
    toast = document.createElement('div');
    toast.id = `${CSS_PREFIX}toast`;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add(`${CSS_PREFIX}toast-visible`);
  clearTimeout((toast as any)._timer);
  (toast as any)._timer = setTimeout(() => {
    toast.classList.remove(`${CSS_PREFIX}toast-visible`);
  }, duration);
}