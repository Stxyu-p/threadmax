/**
 * ThreadMax — Shared Pure Utilities
 * Zero-dependency, tree-shakeable, used by both main script and tests.
 */

// ─── CRC32 Table (pre-computed) ──────────────────────────────
export const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC32_TABLE[i] = c >>> 0;
}

export function crc32Bytes(uint8Array: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < uint8Array.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ uint8Array[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ─── DOS Timestamp ───────────────────────────────────────────
export function dosTimestamp(date = new Date()): { dosDate: number; dosTime: number } {
  const d = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const t = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  return { dosDate: d, dosTime: t };
}

// ─── ZIP32 Engine (Pure) ─────────────────────────────────────
export interface ZipFileEntry {
  name: string;
  data: Uint8Array | string | ArrayBuffer;
}

export function createStoredZip(files: ZipFileEntry[]): Blob {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  const { dosDate, dosTime } = dosTimestamp();

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    let dataBytes: Uint8Array;
    if (file.data instanceof Uint8Array) dataBytes = file.data;
    else if (typeof file.data === 'string') dataBytes = encoder.encode(file.data);
    else if (file.data instanceof ArrayBuffer) dataBytes = new Uint8Array(file.data);
    else dataBytes = new Uint8Array(file.data || 0);

    const crc = crc32Bytes(dataBytes);
    const size = dataBytes.length;

    const lfh = new Uint8Array(30 + nameBytes.length);
    const lfhView = new DataView(lfh.buffer);
    lfhView.setUint32(0, 0x04034b50, true);
    lfhView.setUint16(4, 20, true);
    lfhView.setUint16(6, 0x0800, true);
    lfhView.setUint16(8, 0, true);
    lfhView.setUint16(10, dosTime, true);
    lfhView.setUint16(12, dosDate, true);
    lfhView.setUint32(14, crc, true);
    lfhView.setUint32(18, size, true);
    lfhView.setUint32(22, size, true);
    lfhView.setUint16(26, nameBytes.length, true);
    lfhView.setUint16(28, 0, true);
    lfh.set(nameBytes, 30);

    localParts.push(lfh, dataBytes);

    const cdh = new Uint8Array(46 + nameBytes.length);
    const cdhView = new DataView(cdh.buffer);
    cdhView.setUint32(0, 0x02014b50, true);
    cdhView.setUint16(4, 20, true);
    cdhView.setUint16(6, 20, true);
    cdhView.setUint16(8, 0x0800, true);
    cdhView.setUint16(10, 0, true);
    cdhView.setUint16(12, dosTime, true);
    cdhView.setUint16(14, dosDate, true);
    cdhView.setUint32(16, crc, true);
    cdhView.setUint32(20, size, true);
    cdhView.setUint32(24, size, true);
    cdhView.setUint16(28, nameBytes.length, true);
    cdhView.setUint16(30, 0, true);
    cdhView.setUint16(32, 0, true);
    cdhView.setUint16(34, 0, true);
    cdhView.setUint32(36, 0, true);
    cdhView.setUint32(38, offset, true);
    cdh.set(nameBytes, 46);

    centralParts.push(cdh);
    offset += lfh.length + size;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const p of centralParts) cdSize += p.length;

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, files.length, true);
  eocdView.setUint16(10, files.length, true);
  eocdView.setUint32(12, cdSize, true);
  eocdView.setUint32(16, cdOffset, true);
  eocdView.setUint16(20, 0, true);

  return new Blob([...localParts, ...centralParts, eocd], { type: 'application/zip' });
}

// ─── URL Sanitization ────────────────────────────────────────
export function cleanPostUrl(url: string): string {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/(\/@[^/]+\/post\/[^/?#]+)/);
    if (match) {
      return `https://www.threads.com${match[1]}`;
    }
    return `${u.origin}${u.pathname}`;
  } catch {
    return (url || '').split('?')[0];
  }
}

// ─── Metric Parsing ──────────────────────────────────────────
export function parseMetricNumber(str: string | null | undefined): number {
  if (!str) return 0;
  const s = str.trim().toLowerCase();
  if (s.endsWith('k')) return parseFloat(s) * 1000;
  if (s.endsWith('m')) return parseFloat(s) * 1000000;
  return parseInt(s, 10) || 0;
}

// ─── Timestamp Formatting ────────────────────────────────────
export function formatAbsolute(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${mins}`;
}

export function formatHybrid(orig: string, d: Date): string {
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${orig} (${hours}:${mins})`;
}

// ─── Filename Convention ─────────────────────────────────────
export function makeFilename(username: string, postId: string, index: number, type: 'image' | 'video'): string {
  const ext = type === 'video' ? 'mp4' : 'jpg';
  return `${username}_${postId}_${String(index).padStart(3, '0')}.${ext}`;
}

// ─── Thread Unroller Markdown ────────────────────────────────
export interface ThreadPost {
  text: string;
  media?: { type: 'image' | 'video'; url: string }[];
}

export function buildUnrolledMarkdown(author: string, postId: string, posts: ThreadPost[]): string {
  const header = `# Thread by @${author}\n\nURL: https://www.threads.com/@${author}/post/${postId}\n\n---\n\n`;
  const body = posts.map((p, i) => `### [${i + 1}/${posts.length}]\n\n${p.text}\n`).join('\n---\n\n');
  return header + body;
}

// ─── Composer Hook Classifier ────────────────────────────────
export type HookStatus = 'empty' | 'safe' | 'cut' | 'over';

export function evaluateComposerHook(length: number): HookStatus {
  if (length === 0) return 'empty';
  if (length <= 180) return 'safe';
  if (length <= 500) return 'cut';
  return 'over';
}

// ─── Thread Splitter ─────────────────────────────────────────
export function splitText(text: string, maxLen = 460): string[] {
  if (!text || text.length <= maxLen) return [text];
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let current = '';

  for (const p of paragraphs) {
    const candidate = current + (current ? '\n\n' : '') + p;
    if (candidate.length <= maxLen) {
      current = candidate;
    } else {
      if (current) {
        chunks.push(current);
        current = '';
      }
      if (p.length <= maxLen) {
        current = p;
      } else {
        const sentences = p.split(/(?<=[.!?\n])\s+/);
        for (const s of sentences) {
          const sCandidate = current + (current ? ' ' : '') + s;
          if (sCandidate.length <= maxLen) {
            current = sCandidate;
          } else {
            if (current) chunks.push(current);
            current = s;
          }
        }
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// ─── Viral Velocity ──────────────────────────────────────────
export function calculateVelocity(replies: number, reposts: number, ageMinutes: number): number {
  const safeAge = Math.max(1, ageMinutes);
  return (replies * 2 + reposts * 1.5) / safeAge;
}

export function isRisingPost(
  replies: number,
  reposts: number,
  ageMinutes: number,
  maxReplies = 50,
  minVelocity = 0.1,
  maxAge = 180
): boolean {
  if (ageMinutes > maxAge) return false;
  if (replies >= maxReplies) return false;
  return calculateVelocity(replies, reposts, ageMinutes) >= minVelocity;
}

export function shouldDisplayInFeed(isFilterActive: boolean, isRising: boolean): boolean {
  if (!isFilterActive) return true;
  return isRising;
}

// ─── Relationship Diff Engine ────────────────────────────────
export interface RelationshipDiff {
  notFollowingBack: string[];
  fans: string[];
  mutual: string[];
  gained: string[];
  lost: string[];
  totalFollowers: number;
  totalFollowing: number;
}

export interface Snapshot {
  timestamp: number;
  followers: string[];
  following: string[];
  diff?: RelationshipDiff;
}

export function computeRelationshipDiff(
  currentFollowers: string[],
  currentFollowing: string[],
  prevSnapshot: Snapshot | null = null
): RelationshipDiff {
  const followerSet = new Set(currentFollowers.map(u => String(u).toLowerCase()));
  const followingSet = new Set(currentFollowing.map(u => String(u).toLowerCase()));

  const notFollowingBack = currentFollowing.filter(u => !followerSet.has(String(u).toLowerCase()));
  const fans = currentFollowers.filter(u => !followingSet.has(String(u).toLowerCase()));
  const mutual = currentFollowing.filter(u => followerSet.has(String(u).toLowerCase()));

  let gained: string[] = [];
  let lost: string[] = [];
  if (prevSnapshot && Array.isArray(prevSnapshot.followers)) {
    const prevFollowerSet = new Set(prevSnapshot.followers.map(u => String(u).toLowerCase()));
    gained = currentFollowers.filter(u => !prevFollowerSet.has(String(u).toLowerCase()));
    lost = prevSnapshot.followers.filter(u => !followerSet.has(String(u).toLowerCase()));
  }

  return {
    notFollowingBack,
    fans,
    mutual,
    gained,
    lost,
    totalFollowers: currentFollowers.length,
    totalFollowing: currentFollowing.length,
  };
}

// ─── Snapshot Contract Validation ────────────────────────────
export function validateSnapshotContract(snapshot: unknown): snapshot is Snapshot {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const s = snapshot as Record<string, unknown>;
  if (typeof s.timestamp !== 'number') return false;
  if (!Array.isArray(s.followers)) return false;
  if (!Array.isArray(s.following)) return false;
  if (!s.diff || typeof s.diff !== 'object') return false;
  return true;
}

// ─── Username Extraction from HREFs ──────────────────────────
const EXCLUDED_PATHS = new Set(['post', 'explore', 'search', 'activity', 'messages', 'settings']);

export function parseUsernamesFromHrefs(hrefs: string[]): string[] {
  const found = new Set<string>();
  for (const href of hrefs) {
    if (href.includes('/post/')) continue;
    const m = href.match(/@([^/?#]+)/);
    if (m) {
      const u = m[1].toLowerCase();
      if (!EXCLUDED_PATHS.has(u)) found.add(u);
    }
  }
  return Array.from(found);
}

// ─── GraphQL Payload Builder ─────────────────────────────────
export function buildGraphQLPayload(docId: string, lsd: string, userId: string, cursor: string | null = null): string {
  const form = new URLSearchParams();
  if (lsd) form.set('lsd', lsd);
  form.set('variables', JSON.stringify({ userID: userId, first: 50, after: cursor }));
  form.set('doc_id', docId);
  return form.toString();
}

// ─── Number Extraction from Text ─────────────────────────────
export function extractNumberFromText(str: string | null | undefined): number {
  if (!str) return 0;
  const s = String(str).trim();
  const m = s.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([kmb])?/i);
  if (!m) return 0;
  let num = parseFloat(m[1]);
  const suffix = (m[2] || '').toLowerCase();
  if (suffix === 'k') num *= 1000;
  else if (suffix === 'm') num *= 1000000;
  else if (suffix === 'b') num *= 1000000000;
  return Math.round(num);
}

// ─── Tab Detection Regex ─────────────────────────────────────
export const followersRegex = /(^ผู้ติดตาม(\s+[\d,kmb\.]+)?$|^([\d,kmb\.]+\s+)?ผู้ติดตาม$|^followers(\s+[\d,kmb\.]+)?$|^([\d,kmb\.]+\s+)?followers$)/i;
export const followingRegex = /(^กำลังติดตาม(\s+[\d,kmb\.]+)?$|^([\d,kmb\.]+\s+)?กำลังติดตาม$|^following(\s+[\d,kmb\.]+)?$|^([\d,kmb\.]+\s+)?following$)/i;

// ─── Tab Weight Detection ────────────────────────────────────
export function detectTabFromWeights(f1Weight: number, f2Weight: number): 'followers' | 'following' | null {
  if (f2Weight > f1Weight + 15) return 'following';
  if (f1Weight > f2Weight + 15) return 'followers';
  return null;
}

// ─── Portal Positioning ──────────────────────────────────────
export interface PortalCoords {
  top: number;
  left: number;
  zIndex: number;
}

export function computePortalCoordinates(
  anchorRect: { left: number; bottom: number },
  dropdownWidth = 270,
  windowWidth = 1920
): PortalCoords {
  let left = anchorRect.left;
  if (left + dropdownWidth > windowWidth - 16) {
    left = windowWidth - dropdownWidth - 16;
  }
  if (left < 16) left = 16;
  const top = anchorRect.bottom + 6;
  return { top, left, zIndex: 2147483647 };
}

// ─── Scroll Container Resolution ─────────────────────────────
export interface ScrollableElement {
  clientHeight: number;
  scrollHeight: number;
  parentElement: ScrollableElement | null;
}

export function resolveScrollContainer(
  startNode: ScrollableElement | null,
  boundaryNode: ScrollableElement
): ScrollableElement {
  let curr = startNode?.parentElement ?? null;
  while (curr && curr !== boundaryNode) {
    if (curr.scrollHeight > curr.clientHeight + 10 && curr.clientHeight > 60) {
      return curr;
    }
    curr = curr.parentElement;
  }
  return boundaryNode;
}

// ─── Pagination Helper ───────────────────────────────────────
export interface PageResult<T> {
  display: T[];
  remaining: number;
  hasMore: boolean;
}

export function paginateAccounts<T>(accounts: T[], limit = 50): PageResult<T> {
  const display = accounts.slice(0, limit);
  const remaining = Math.max(0, accounts.length - limit);
  return { display, remaining, hasMore: remaining > 0 };
}

// ─── HTML Escape ─────────────────────────────────────────────
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&',
    '<': '<',
    '>': '>',
    '"': '"',
    "'": '&#039;',
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

// ─── User ID Validation ──────────────────────────────────────
export function validateUserId(id: string | null | undefined): boolean {
  if (!id) return false;
  const s = String(id).trim();
  return /^\d{4,25}$/.test(s) && s !== '0';
}

export function extractIdFromCookie(cookieStr: string): string | null {
  const m = (cookieStr || '').match(/(?:^|;\s*)ds_user_id=(\d+)/);
  return m ? m[1] : null;
}

export function extractIdFromDeepLink(tagContent: string): string | null {
  const m = (tagContent || '').match(/(?:barcelona|instagram):\/\/user\?id=(\d+)/i);
  return m ? m[1] : null;
}

export function extractIdFromScriptSlice(scriptText: string, username: string): string | null {
  if (!scriptText || !username) return null;
  const clean = username.replace(/^@/, '').toLowerCase();
  const idx = scriptText.toLowerCase().indexOf(clean);
  if (idx === -1) return null;
  const slice = scriptText.substring(Math.max(0, idx - 600), Math.min(scriptText.length, idx + 600));
  const m = slice.match(/"(?:pk|user_id|target_user_id|profile_id)":"?(\d{4,25})"?/);
  return (m && m[1] !== '0') ? m[1] : null;
}