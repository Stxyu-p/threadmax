/**
 * ThreadMax — Thread Unroller & Clean Reader
 * Collects OP's threaded posts into unified modal with Markdown export.
 */

import { findShareButtons, findPostCard, getPostMetadata, PostMetadata } from '../dom/extract';
import { buildUnrolledMarkdown, ThreadPost, escapeHtml } from '../utils';
import { TIMING, UI_DIMENSIONS, CSS_PREFIX } from '../constants';

let readerModal: HTMLElement | null = null;
let readerOpener: HTMLElement | null = null;

const onReaderKeydown = (e: KeyboardEvent): void => {
  if (!readerModal) return;
  if (e.key === 'Escape') { e.preventDefault(); closeReader(); return; }
  if (e.key !== 'Tab') return;
  const f = readerModal.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  const active = document.activeElement as HTMLElement | null;
  const inside = active && readerModal.contains(active);
  if (e.shiftKey && (!inside || active === first)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (!inside || active === last)) { e.preventDefault(); first.focus(); }
};

export function openUnroller(author: string, postId: string): void {
  const metas = findShareButtons().map(s => getPostMetadata(findPostCard(s.actionRow)));

  // HONEST CAPTURE: only the contiguous same-author run containing the clicked post.
  // Unrelated same-author posts elsewhere in the feed are excluded (causal approximation
  // from DOM order); captured/total below makes any miss visible instead of silent.
  const idxs: number[] = [];
  metas.forEach((m, i) => {
    if (m.author.toLowerCase() === author.toLowerCase() && m.text.length > 0) idxs.push(i);
  });
  let a = idxs.indexOf(metas.findIndex(m => m.postId === postId));
  if (a === -1) a = 0;
  let lo = a, hi = a;
  while (lo > 0 && idxs[lo - 1] === idxs[lo] - 1) lo--;
  while (hi < idxs.length - 1 && idxs[hi + 1] === idxs[hi] + 1) hi++;

  const opPosts: PostMetadata[] = [];
  for (const i of idxs.slice(lo, hi + 1)) {
    const m = metas[i];
    if (!opPosts.some(p => p.text === m.text)) opPosts.push(m);
  }

  if (opPosts.length === 0) {
    showToast('⚠️ ไม่พบบทสนทนาต่อเนื่องของเจ้าของโพสต์');
    return;
  }

  // (x/y) inline series marker → known total for captured/missing honesty
  let seriesTotal = 0;
  for (const p of opPosts) {
    const mm = p.text.match(/\((\d+)\s*\/\s*(\d+)\)/);
    if (mm) seriesTotal = Math.max(seriesTotal, parseInt(mm[2], 10) || 0);
  }

  closeReader();

  const threadPosts: ThreadPost[] = opPosts.map(p => ({
    text: p.text,
    media: p.media.map(m => ({ type: m.type, url: m.url })),
  }));

  const mdText = buildUnrolledMarkdown(author, postId, threadPosts);

  readerModal = document.createElement('div');
  readerModal.id = `${CSS_PREFIX}reader-modal`;
  readerModal.innerHTML = `
    <div class="${CSS_PREFIX}reader-overlay"></div>
    <div class="${CSS_PREFIX}reader-card">
      <div class="${CSS_PREFIX}reader-header">
        <div>
          <div class="${CSS_PREFIX}reader-title">📖 Thread Unroller</div>
          <div class="${CSS_PREFIX}reader-author">@${author} • จับได้ ${opPosts.length}${seriesTotal ? `/${seriesTotal}` : ""} โพสต์</div>
        </div>
        <div class="${CSS_PREFIX}reader-header-actions">
          <button type="button" class="${CSS_PREFIX}btn-primary" id="${CSS_PREFIX}copy-md">📥 คัดลอก Markdown</button>
          <button type="button" class="${CSS_PREFIX}btn-sub" id="${CSS_PREFIX}close-reader">✕ ปิด</button>
        </div>
      </div>
      <div class="${CSS_PREFIX}reader-body">
        ${seriesTotal > 0 && opPosts.length < seriesTotal ? `<div class="${CSS_PREFIX}segment-media-hint">⚠️ เก็บได้ ${opPosts.length}/${seriesTotal} — โพสต์ที่เหลือไม่อยู่ในหน้าปัจจุบัน ลองเลื่อนมาที่เธรดนี้แล้วเปิดใหม่</div>` : ''}
        ${opPosts.map((p, idx) => `
          <div class="${CSS_PREFIX}reader-segment">
            <div class="${CSS_PREFIX}segment-badge">${idx + 1}/${opPosts.length}</div>
            <div class="${CSS_PREFIX}segment-text">${escapeHtml(p.text).replace(/\n/g, '<br>')}</div>
            ${p.media.length > 0 ? `<div class="${CSS_PREFIX}segment-media-hint">📷 แนบมีเดีย ${p.media.length} รายการ</div>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `;

  readerModal.setAttribute('role', 'dialog');
  readerModal.setAttribute('aria-modal', 'true');
  readerModal.setAttribute('aria-label', 'Thread Unroller');
  readerOpener = document.activeElement as HTMLElement | null;
  document.body.appendChild(readerModal);
  document.addEventListener('keydown', onReaderKeydown);
  (readerModal.querySelector<HTMLElement>(`#${CSS_PREFIX}close-reader`) as HTMLButtonElement | null)?.focus();

  readerModal.querySelector<HTMLElement>(`#${CSS_PREFIX}copy-md`)!.onclick = () => {
    navigator.clipboard.writeText(mdText).then(() => {
      showToast('✓ คัดลอก Markdown ทั้งเธรดแล้ว');
    });
  };

  readerModal.querySelector<HTMLElement>(`#${CSS_PREFIX}close-reader`)!.onclick = closeReader;
  readerModal.querySelector<HTMLElement>(`.${CSS_PREFIX}reader-overlay`)!.onclick = closeReader;

}

export function closeReader(): void {
  document.removeEventListener('keydown', onReaderKeydown);
  readerModal?.remove();
  readerModal = null;
  readerOpener?.focus();
  readerOpener = null;
}

// ─── Toast helper ─────────────────────────────────────────────
function showToast(msg: string, duration = TIMING.TOAST_DURATION_MS): void {
  let toast = document.getElementById(`${CSS_PREFIX}toast`);
  if (!toast) {
    toast = document.createElement('div');
    toast.id = `${CSS_PREFIX}toast`;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add(`${CSS_PREFIX}toast-visible`);
  clearTimeout((toast as any)._timer);
  (toast as any)._timer = setTimeout(() => {
    toast.classList.remove(`${CSS_PREFIX}toast-visible`);
  }, duration);
}