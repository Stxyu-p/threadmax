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
    cdhView.setUint32(42, offset, true);
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

  return new Blob([...localParts, ...centralParts, eocd] as BlobPart[], { type: 'application/zip' });
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

// ─── HTML Escape ─────────────────────────────────────────────
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

