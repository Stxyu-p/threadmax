/**
 * ThreadMax — Semantic Selector Detection
 * Replaces hardcoded selectors with behavioral/structural detection.
 * Upgrade path: structural hooks via data-testid, role, or stable DOM patterns.
 */

import { SELECTORS } from '../constants';

/** Result of a semantic detection attempt */
export interface DetectionResult<T> {
  found: boolean;
  element: T | null;
  method: string;
  confidence: 'high' | 'medium' | 'low';
}

/** Find share button using multiple fallback strategies */
export function findShareButton(root: Document | Element = document): DetectionResult<HTMLElement> {
  // Strategy 1: Structural — action row with 4+ buttons, find the one with share-like SVG
  const actionRows = root.querySelectorAll('[role="group"], div[style*="display: flex"]');
  for (const row of Array.from(actionRows)) {
    const buttons = row.querySelectorAll('[role="button"]');
    if (buttons.length >= 3) {
      for (const btn of Array.from(buttons)) {
        const svg = btn.querySelector('svg');
        if (svg && looksLikeShareIcon(svg)) {
          return { found: true, element: btn as HTMLElement, method: 'structural-svg', confidence: 'high' };
        }
      }
    }
  }

  // Strategy 2: SVG path matching (legacy, kept for compat)
  const sharePaths = SELECTORS.SHARE_SVG_PATHS.join(', ');
  const pathMatch = root.querySelector(sharePaths);
  if (pathMatch) {
    const btn = pathMatch.closest('[role="button"]') as HTMLElement;
    if (btn) return { found: true, element: btn, method: 'svg-path', confidence: 'medium' };
  }

  // Strategy 3: Title / aria-label fallback
  const titleSelectors = [...SELECTORS.SHARE_TITLES, ...SELECTORS.SHARE_LABELS].join(', ');
  const titleMatch = root.querySelector(titleSelectors);
  if (titleMatch) {
    const btn = titleMatch.closest('[role="button"]') as HTMLElement;
    if (btn) return { found: true, element: btn, method: 'title-label', confidence: 'low' };
  }

  return { found: false, element: null, method: 'none', confidence: 'low' };
}

/** Heuristic: does this SVG look like a share icon? */
function looksLikeShareIcon(svg: SVGSVGElement): boolean {
  // Check for common share icon path patterns
  const paths = svg.querySelectorAll('path');
  for (const path of Array.from(paths)) {
    const d = path.getAttribute('d') || '';
    // Share icon typically has: outward arrows, box-with-arrow, or three-dots-connected
    if (d.includes('M7.24') || d.includes('M1.53') || d.match(/M\d+\.\d+\s+\d+\.\d+L/)) {
      // More precise: check for outward-pointing arrow structure
      if (d.includes('M') && (d.includes('L') || d.includes('l'))) {
        return true;
      }
    }
  }
  // Fallback: check viewBox and child count (share icons are usually simple)
  const vb = svg.getAttribute('viewBox') || '';
  if (vb === '0 0 24 24' && paths.length <= 3) return true;
  return false;
}

/** Find post card containing a node — structural walk up */
export function findPostCard(startNode: HTMLElement | null): DetectionResult<HTMLElement> {
  if (!startNode) return { found: false, element: null, method: 'none', confidence: 'low' };

  let curr: HTMLElement | null = startNode;
  while (curr && curr !== document.body) {
    // Strategy 1: data-pressable-container (Threads stable attribute)
    if (curr.hasAttribute('data-pressable-container')) {
      return { found: true, element: curr, method: 'data-pressable', confidence: 'high' };
    }
    // Strategy 2: article element
    if (curr.tagName === 'ARTICLE') {
      return { found: true, element: curr, method: 'article-tag', confidence: 'high' };
    }
    // Strategy 3: contains post link
    if (curr.querySelector('a[href*="/post/"]')) {
      return { found: true, element: curr, method: 'post-link-ancestor', confidence: 'medium' };
    }
    curr = curr.parentElement;
  }

  return { found: false, element: startNode.parentElement?.parentElement || null, method: 'fallback', confidence: 'low' };
}

/** Find composer textbox — stable role + contenteditable */
export function findComposerTextbox(root: Document | Element = document): DetectionResult<HTMLDivElement> {
  const el = root.querySelector<HTMLDivElement>('div[role="textbox"][contenteditable="true"]');
  if (el) return { found: true, element: el, method: 'role-textbox', confidence: 'high' };
  return { found: false, element: null, method: 'none', confidence: 'low' };
}

/** Find modal dialog — role=dialog with fallback */
export function findModalDialog(root: Document | Element = document): DetectionResult<HTMLElement> {
  const dialog = root.querySelector<HTMLElement>('[role="dialog"]');
  if (dialog) return { found: true, element: dialog, method: 'role-dialog', confidence: 'high' };
  return { found: false, element: null, method: 'none', confidence: 'low' };
}

/** Find modal tab list */
export function findModalTablist(root: Document | Element = document): DetectionResult<HTMLElement> {
  const tablist = root.querySelector<HTMLElement>('[role="tablist"]');
  if (tablist) return { found: true, element: tablist, method: 'role-tablist', confidence: 'high' };
  return { found: false, element: null, method: 'none', confidence: 'low' };
}

/** Find modal tabs */
export function findModalTabs(root: Document | Element = document): DetectionResult<NodeListOf<HTMLAnchorElement>> {
  const tabs = root.querySelectorAll<HTMLAnchorElement>('[role="tab"]');
  if (tabs.length > 0) return { found: true, element: tabs, method: 'role-tab', confidence: 'high' };
  return { found: false, element: null, method: 'none', confidence: 'low' };
}

/** Find profile links inside modal (not post links) */
export function findModalProfileLinks(root: Document | Element = document): HTMLAnchorElement[] {
  const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href*="/@"]'));
  return links.filter(a => !a.href.includes('/post/'));
}

/** Pick the largest candidate URL from srcset; falls back to src. ponytail: width-descriptor only (no DPR split) — upgrade: density-aware pick. */
function bestFromSrcset(img: HTMLImageElement): string {
  const ss = img.getAttribute('srcset');
  if (!ss) return img.src;
  let best = '', bestW = 0;
  for (const part of ss.split(',')) {
    const bits = part.trim().split(/\s+/);
    const w = parseInt(bits[1], 10) || 0;
    if (bits[0] && w >= bestW) { bestW = w; best = bits[0]; }
  }
  return best || img.src;
}

/** Find media elements in a post card */
export function findMediaInCard(card: HTMLElement): { images: HTMLImageElement[]; videos: HTMLVideoElement[] } {
  const images: HTMLImageElement[] = [];
  const videos: HTMLVideoElement[] = [];

  // Videos: direct video elements
  card.querySelectorAll<HTMLVideoElement>('video').forEach(v => videos.push(v));

  // Images: CDN-hosted, non-avatar, non-icon
  card.querySelectorAll<HTMLImageElement>('img').forEach(img => {
    const src = img.src;
    if (!src) return;

    // Skip avatars
    const rect = img.getBoundingClientRect();
    if (rect.width > 0 && rect.width < 75) return;
    const style = window.getComputedStyle(img);
    if (style.borderRadius.includes('50%')) return;

    // Skip profile link images
    const parentLink = img.closest('a');
    if (parentLink?.href.includes('/@') && !parentLink.href.includes('/post/')) return;

    // CDN patterns
    if (src.includes('cdninstagram.com') || src.includes('fbcdn.net')) {
      images.push(img);
    }
  });

  return { images, videos };
}

/** Find timestamp element */
export function findTimestamp(card: HTMLElement): DetectionResult<HTMLTimeElement> {
  const timeEl = card.querySelector<HTMLTimeElement>('time[datetime]');
  if (timeEl) return { found: true, element: timeEl, method: 'time-datetime', confidence: 'high' };
  return { found: false, element: null, method: 'none', confidence: 'low' };
}

/** Find text container */
export function findTextContainer(card: HTMLElement): DetectionResult<HTMLElement> {
  const el = card.querySelector<HTMLElement>('[dir="auto"]');
  if (el) return { found: true, element: el, method: 'dir-auto', confidence: 'high' };
  return { found: false, element: null, method: 'none', confidence: 'low' };
}

/** Extract post metadata using semantic detection */
export function extractPostMetadata(card: HTMLElement): {
  author: string;
  postId: string;
  postUrl: string;
  media: { type: 'image' | 'video'; url: string; element: HTMLImageElement | HTMLVideoElement }[];
  text: string;
  replies: number;
  reposts: number;
  likes: number;
  postDate: Date | null;
} {
  // 1. Post link, author, postId
  const postLink = card.querySelector<HTMLAnchorElement>('a[href*="/post/"]');
  let author = 'threads_user';
  let postId = Date.now().toString(36);
  let postUrl = window.location.href;

  if (postLink?.href) {
    postUrl = postLink.href.split('?')[0]; // Clean URL
    const match = postUrl.match(/@([^/?#]+)\/post\/([^/?#]+)/);
    if (match) {
      author = match[1];
      postId = match[2];
    }
  } else {
    const authorLink = card.querySelector<HTMLAnchorElement>('a[href*="/@"]');
    if (authorLink) {
      const match = authorLink.href.match(/@([^/?#]+)/);
      if (match) author = match[1];
    }
  }

  // 2. Media
  const { images, videos } = findMediaInCard(card);
  const media = [
    ...videos.map(v => ({ type: 'video' as const, url: v.currentSrc || v.src, element: v })),
    ...images.map(i => ({ type: 'image' as const, url: bestFromSrcset(i), element: i })),
  ];

  // 3. Text
  const textContainer = findTextContainer(card);
  const text = textContainer.element?.innerText.trim() || '';

  // 4. Metrics & date
  let replies = 0, reposts = 0, likes = 0;
  let postDate: Date | null = null;

  const timeResult = findTimestamp(card);
  if (timeResult.found && timeResult.element?.dateTime) {
    postDate = new Date(timeResult.element.dateTime);
  }

  card.querySelectorAll<HTMLElement>('span, div').forEach(el => {
    const t = el.innerText?.trim();
    if (/^\d+(\.\d+)?[kKmM]?$/.test(t)) {
      const num = parseMetricNumber(t);
      const ariaLabel = el.closest('[aria-label]')?.getAttribute('aria-label')?.toLowerCase() || '';
      if (ariaLabel.includes('like') || ariaLabel.includes('ถูกใจ')) likes = num;
      else if (ariaLabel.includes('reply') || ariaLabel.includes('ตอบกลับ') || ariaLabel.includes('comment')) replies = num;
      else if (ariaLabel.includes('repost') || ariaLabel.includes('รีโพสต์')) reposts = num;
    }
  });

  return { author, postId, postUrl, media, text, replies, reposts, likes, postDate };
}

/** Local metric parser (k/m suffixes) */
function parseMetricNumber(str: string | null | undefined): number {
  if (!str) return 0;
  const s = str.trim().toLowerCase();
  const m = s.match(/^(\d+(?:\.\d+)?)([km])?$/);
  if (!m) return parseInt(s) || 0;
  const val = parseFloat(m[1]);
  if (m[2] === 'k') return Math.round(val * 1000);
  if (m[2] === 'm') return Math.round(val * 1000000);
  return Math.round(val);
}