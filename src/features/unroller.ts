/**
 * ThreadMax — Thread Unroller & Clean Reader
 * Collects OP's threaded posts into unified modal with Markdown export.
 */

import { findShareButtons, findPostCard, getPostMetadata, PostMetadata } from '../dom/extract';
import { buildUnrolledMarkdown, ThreadPost, escapeHtml, CSS_PREFIX, Z_INDEX } from '../utils';
import { TIMING, UI_DIMENSIONS } from '../constants';

let readerModal: HTMLElement | null = null;

export function openUnroller(author: string, postId: string): void {
  const allCards = findShareButtons().map(s => findPostCard(s.actionRow));
  const opPosts: PostMetadata[] = [];

  allCards.forEach(c => {
    const meta = getPostMetadata(c);
    if (meta.author.toLowerCase() === author.toLowerCase() && meta.text.length > 0) {
      if (!opPosts.some(p => p.text === meta.text)) {
        opPosts.push(meta);
      }
    }
  });

  if (opPosts.length === 0) {
    showToast('⚠️ ไม่พบบทสนทนาต่อเนื่องของเจ้าของโพสต์');
    return;
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
          <div class="${CSS_PREFIX}reader-author">@${author} • ${opPosts.length} โพสต์ต่อเนื่อง</div>
        </div>
        <div class="${CSS_PREFIX}reader-header-actions">
          <button type="button" class="${CSS_PREFIX}btn-primary" id="${CSS_PREFIX}copy-md">📥 คัดลอก Markdown</button>
          <button type="button" class="${CSS_PREFIX}btn-sub" id="${CSS_PREFIX}close-reader">✕ ปิด</button>
        </div>
      </div>
      <div class="${CSS_PREFIX}reader-body">
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

  document.body.appendChild(readerModal);

  readerModal.querySelector(`#${CSS_PREFIX}copy-md`)!.onclick = () => {
    navigator.clipboard.writeText(mdText).then(() => {
      showToast('✓ คัดลอก Markdown ทั้งเธรดแล้ว');
    });
  };

  readerModal.querySelector(`#${CSS_PREFIX}close-reader`)!.onclick = closeReader;
  readerModal.querySelector(`.${CSS_PREFIX}reader-overlay`)!.onclick = closeReader;

  const onEsc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeReader();
      document.removeEventListener('keydown', onEsc);
    }
  };
  document.addEventListener('keydown', onEsc);
}

export function closeReader(): void {
  readerModal?.remove();
  readerModal = null;
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