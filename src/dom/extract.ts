/**
 * ThreadMax — DOM Extraction & Post Metadata
 * Centralized selectors and extraction logic.
 * Uses semantic detection (src/dom/semantic.ts) instead of hardcoded selectors.
 */

import {
  findShareButton,
  findPostCard as detectPostCard,
  findMediaInCard,
  findTimestamp,
  findTextContainer,
  extractPostMetadata,
} from './semantic';
import { cleanPostUrl, makeFilename } from '../utils';

export interface MediaItem {
  type: 'image' | 'video';
  url: string;
  element: HTMLImageElement | HTMLVideoElement;
}

export interface PostMetadata {
  card: HTMLElement;
  author: string;
  postId: string;
  postUrl: string;
  media: MediaItem[];
  text: string;
  replies: number;
  reposts: number;
  likes: number;
  postDate: Date | null;
}

export interface ShareButtonInfo {
  shareSvg: SVGSVGElement;
  shareBtn: HTMLElement;
  shareWrapper: HTMLElement;
  actionRow: HTMLElement;
}

/** Find all share buttons in feed using semantic detection */
export function findShareButtons(): ShareButtonInfo[] {
  const results: ShareButtonInfo[] = [];

  // Strategy 1: Find all action rows (groups of buttons) and detect share in each
  const actionRows = document.querySelectorAll('[role="group"]');
  for (const row of Array.from(actionRows)) {
    const buttons = row.querySelectorAll('[role="button"]');
    if (buttons.length >= 3) {
      for (const btn of Array.from(buttons)) {
        if (results.some(r => r.shareBtn === btn)) continue;
        const svg = btn.querySelector('svg');
        if (svg) {
          const wrapper = btn.parentElement;
          const actionRow = wrapper?.parentElement;
          if (wrapper && actionRow) {
            results.push({ shareSvg: svg as SVGSVGElement, shareBtn: btn as HTMLElement, shareWrapper: wrapper as HTMLElement, actionRow: actionRow as HTMLElement });
          }
        }
      }
    }
  }

  // Strategy 2: Fallback - find share buttons by SVG path (legacy)
  if (results.length === 0) {
    const primary = findShareButton(document);
    if (primary.found && primary.element) {
      const btn = primary.element;
      const svg = btn.querySelector('svg') as SVGSVGElement;
      const wrapper = btn.parentElement;
      const actionRow = wrapper?.parentElement;
      if (svg && wrapper && actionRow) {
        results.push({ shareSvg: svg, shareBtn: btn, shareWrapper: wrapper as HTMLElement, actionRow: actionRow as HTMLElement });
      }
    }
  }

  return results;
}

/** Find post card containing a node — uses semantic detection */
export function findPostCard(startNode: HTMLElement | null): HTMLElement {
  if (!startNode) return document.body;

  const result = detectPostCard(startNode);
  if (result.found && result.element) {
    return result.element;
  }

  return startNode.parentElement?.parentElement || startNode;
}

/** Get post metadata using semantic extraction */
export function getPostMetadata(card: HTMLElement): PostMetadata {
  const extracted = extractPostMetadata(card);

  return {
    card,
    author: extracted.author,
    postId: extracted.postId,
    postUrl: extracted.postUrl,
    media: extracted.media,
    text: extracted.text,
    replies: extracted.replies,
    reposts: extracted.reposts,
    likes: extracted.likes,
    postDate: extracted.postDate,
  };
}