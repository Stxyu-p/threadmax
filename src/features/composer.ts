/**
 * ThreadMax — Composer Hook Guide & Auto-Splitter
 * Visual indicator for 180-char mobile cutoff + thread splitting.
 */

import { evaluateComposerHook, HookStatus, splitText, escapeHtml, CSS_PREFIX, Z_INDEX } from '../utils';
import { THRESHOLDS, TIMING } from '../constants';
import { SELECTORS } from '../dom/extract';

interface ComposerBar {
  element: HTMLElement;
  countEl: HTMLElement;
  hookEl: HTMLElement;
  splitBtn: HTMLButtonElement;
}

const composerBars = new WeakMap<HTMLElement, ComposerBar>();

export function enhanceComposer(textbox: HTMLElement): void {
  if (composerBars.has(textbox)) return;
  textbox.dataset.tmComposer = 'true';

  const parent = textbox.closest('form') || textbox.parentElement;
  if (!parent || parent.querySelector(`.${CSS_PREFIX}composer-bar`)) return;

  const bar = document.createElement('div');
  bar.className = `${CSS_PREFIX}composer-bar`;
  bar.innerHTML = `
    <div class="${CSS_PREFIX}composer-left">
      <span class="${CSS_PREFIX}hook-status"></span>
      <button type="button" class="${CSS_PREFIX}split-btn" style="display:none;">✂️ แบ่งเธรดอัตโนมัติ</button>
    </div>
    <span class="${CSS_PREFIX}char-count">0 / 500</span>
  `;
  parent.appendChild(bar);

  const countEl = bar.querySelector(`.${CSS_PREFIX}char-count`) as HTMLElement;
  const hookEl = bar.querySelector(`.${CSS_PREFIX}hook-status`) as HTMLElement;
  const splitBtn = bar.querySelector(`.${CSS_PREFIX}split-btn`) as HTMLButtonElement;

  splitBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    openSplitter(textbox.innerText.trim());
  };

  const update = () => {
    const len = textbox.innerText.trim().length;
    countEl.textContent = `${len} / 500`;

    if (len === 0) {
      hookEl.textContent = '';
      hookEl.className = `${CSS_PREFIX}hook-status`;
      splitBtn.style.display = 'none';
    } else if (len <= THRESHOLDS.HOOK_SAFE_MAX) {
      hookEl.textContent = '✨ Hook ปลอดภัย (ไม่ถูกซ่อนบนจอมือถือ)';
      hookEl.className = `${CSS_PREFIX}hook-status ${CSS_PREFIX}hook-safe`;
      splitBtn.style.display = 'none';
    } else if (len <= THRESHOLDS.HOOK_CUT_MAX) {
      hookEl.textContent = '📍 เกิน 180 อักษร (จะถูกซ่อนหลัง "...ดูเพิ่มเติม")';
      hookEl.className = `${CSS_PREFIX}hook-status ${CSS_PREFIX}hook-cut`;
      splitBtn.style.display = 'none';
    } else {
      hookEl.textContent = '⚠️ ข้อความยาวเกิน 500 อักษร';
      hookEl.className = `${CSS_PREFIX}hook-status ${CSS_PREFIX}hook-over`;
      splitBtn.style.display = 'inline-flex';
    }
  };

  textbox.addEventListener('input', update);
  textbox.addEventListener('keyup', update);
  update();

  composerBars.set(textbox, { element: bar, countEl, hookEl, splitBtn });
}

export function initAllComposers(): void {
  document.querySelectorAll<HTMLElement>(SELECTORS.COMPOSER_TEXTBOX).forEach(enhanceComposer);
}

// ─── Splitter Modal ───────────────────────────────────────────
let splitterModal: HTMLElement | null = null;

export function openSplitter(rawText: string): void {
  const chunks = splitText(rawText);
  const total = chunks.length;

  closeSplitter();

  splitterModal = document.createElement('div');
  splitterModal.id = `${CSS_PREFIX}splitter-modal`;
  splitterModal.innerHTML = `
    <div class="${CSS_PREFIX}reader-overlay"></div>
    <div class="${CSS_PREFIX}reader-card">
      <div class="${CSS_PREFIX}reader-header">
        <div>
          <div class="${CSS_PREFIX}reader-title">✂️ Thread Splitter</div>
          <div class="${CSS_PREFIX}reader-author">แบ่งออกเป็น ${total} ท่อนย่อยพร้อมเลขกำกับ (1/N)</div>
        </div>
        <div class="${CSS_PREFIX}reader-header-actions">
          <button type="button" class="${CSS_PREFIX}btn-primary" id="${CSS_PREFIX}copy-all-split">📋 คัดลอกทั้งหมด</button>
          <button type="button" class="${CSS_PREFIX}btn-sub" id="${CSS_PREFIX}close-split">✕ ปิด</button>
        </div>
      </div>
      <div class="${CSS_PREFIX}reader-body">
        ${chunks.map((c, i) => `
          <div class="${CSS_PREFIX}split-item">
            <div class="${CSS_PREFIX}split-item-header">
              <span class="${CSS_PREFIX}segment-badge">${i + 1}/${total} (${c.length} อักษร)</span>
              <button type="button" class="${CSS_PREFIX}btn-sub ${CSS_PREFIX}copy-chunk" data-index="${i}">📋 คัดลอกท่อนนี้</button>
            </div>
            <div class="${CSS_PREFIX}split-text">${escapeHtml(c)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  document.body.appendChild(splitterModal);

  splitterModal.querySelectorAll(`.${CSS_PREFIX}copy-chunk`).forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt((btn as HTMLElement).dataset.index || '0', 10);
      const formatted = `${idx + 1}/${total}\n\n${chunks[idx]}`;
      navigator.clipboard.writeText(formatted).then(() => {
        showToast(`✓ คัดลอกท่อนที่ ${idx + 1}/${total} แล้ว`);
      });
    };
  });

  splitterModal.querySelector(`#${CSS_PREFIX}copy-all-split`)!.onclick = () => {
    const full = chunks.map((c, i) => `[${i + 1}/${total}]\n${c}`).join('\n\n---\n\n');
    navigator.clipboard.writeText(full).then(() => {
      showToast('✓ คัดลอกเธรดที่แบ่งแล้วทั้งหมด');
    });
  };

  splitterModal.querySelector(`#${CSS_PREFIX}close-split`)!.onclick = closeSplitter;
  splitterModal.querySelector(`.${CSS_PREFIX}reader-overlay`)!.onclick = closeSplitter;
}

export function closeSplitter(): void {
  splitterModal?.remove();
  splitterModal = null;
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