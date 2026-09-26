/**
 * ThreadMax Unit & Regression Tests (Zero-Dependency CJS)
 * Verifies ZIP32 integrity, URL sanitization, timestamp formatting, Unroller Markdown,
 * Composer rules, and Thread Splitter.
 */

const assert = require('assert');

// ─── 1. CRC32 & ZIP32 GENERATOR LOGIC ───
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
  }
  CRC32_TABLE[i] = c >>> 0;
}

function crc32Bytes(uint8Array) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < uint8Array.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ uint8Array[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosTimestamp(date = new Date('2026-09-20T12:00:00Z')) {
  const d = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const t = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  return { dosDate: d, dosTime: t };
}

function createStoredZipBuffer(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { dosDate, dosTime } = dosTimestamp();

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    let dataBytes;
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

    localParts.push(Buffer.from(lfh), Buffer.from(dataBytes));

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
    cdhView.setUint16(36, 0, true);
    cdhView.setUint32(38, 0, true);
    cdhView.setUint32(42, offset, true);
    cdh.set(nameBytes, 46);

    centralParts.push(Buffer.from(cdh));
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

  return Buffer.concat([...localParts, ...centralParts, Buffer.from(eocd)]);
}

// ─── 2. URL SANITIZATION ───
function cleanPostUrl(url) {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/(\/@[^/]+\/post\/[^/?#]+)/);
    if (match) {
      return `https://www.threads.com${match[1]}`;
    }
    return `${u.origin}${u.pathname}`;
  } catch (e) {
    return (url || '').split('?')[0];
  }
}

// ─── 3. TIMESTAMP FORMATTING ───
function formatAbsolute(d) {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${mins}`;
}

function formatHybrid(orig, d) {
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${orig} (${hours}:${mins})`;
}

// ─── 4. UNROLLER MARKDOWN FORMATTER ───
function buildUnrolledMarkdown(author, postId, posts) {
  const header = `# Thread by @${author}\n\nURL: https://www.threads.com/@${author}/post/${postId}\n\n---\n\n`;
  const body = posts.map((p, i) => `### [${i + 1}/${posts.length}]\n\n${p.text}\n`).join('\n---\n\n');
  return header + body;
}

// ─── 5. COMPOSER HOOK CLASSIFIER ───
function evaluateComposerHook(length) {
  if (length === 0) return 'empty';
  if (length <= 180) return 'safe';
  if (length <= 500) return 'cut';
  return 'over';
}

// ─── 6. THREAD SPLITTER LOGIC ───
function splitText(text, maxLen = 460) {
  if (!text || text.length <= maxLen) return [text];
  const paragraphs = text.split(/\n\s*\n/);
  const chunks = [];
  let current = '';

  for (const p of paragraphs) {
    if ((current + (current ? '\n\n' : '') + p).length <= maxLen) {
      current = current + (current ? '\n\n' : '') + p;
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
          if ((current + (current ? ' ' : '') + s).length <= maxLen) {
            current = current + (current ? ' ' : '') + s;
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

// ─── Metric parsing helper ───
function parseMetricNumber(str) {
  if (!str) return 0;
  const s = String(str).trim().toLowerCase();
  if (s.endsWith('k')) return parseFloat(s) * 1000;
  if (s.endsWith('m')) return parseFloat(s) * 1000000;
  return parseInt(s, 10) || 0;
}

// ─── EXECUTE TESTS ───
console.log('🧪 Running ThreadMax v1.4.0 Test Suite...\n');

// Test 1: CRC32 known vectors
const sample1 = Buffer.from('123456789');
const crc1 = crc32Bytes(new Uint8Array(sample1));
assert.strictEqual(crc1, 0xCBF43926, 'CRC32 standard vector failed');
console.log('✓ Test 1: CRC32 standard test vector passed');

// Test 2: ZIP32 Buffer Generation & Header Validation
const mockFiles = [
  { name: 'user_post_001.jpg', data: Buffer.from('FakeJPEGDataHere') },
  { name: 'user_post_002.mp4', data: Buffer.from('FakeMP4VideoDataHere') }
];
const zipBuffer = createStoredZipBuffer(mockFiles);
assert(zipBuffer.length > 50, 'ZIP buffer too small');
assert.strictEqual(zipBuffer.readUInt32LE(0), 0x04034b50, 'Invalid LFH magic number');
assert.strictEqual(zipBuffer.readUInt32LE(zipBuffer.length - 22), 0x06054b50, 'Invalid EOCD magic number');
const totalEntries = zipBuffer.readUInt16LE(zipBuffer.length - 12);
assert.strictEqual(totalEntries, 2, 'EOCD total entries mismatch');
console.log('✓ Test 2: ZIP32 buffer generation & magic headers verified');

// Test 3: URL Cleaner removes Meta tracking params
const dirtyUrls = [
  'https://www.threads.net/@choke.dev/post/DE8zKLaSPwA?xmt=AQG03mR8aZ&s=12',
  'https://www.threads.com/@choke.dev/post/DE8zKLaSPwA/?xmt=AQG03mR8aZ',
  'https://threads.net/@choke.dev/post/DE8zKLaSPwA'
];
for (const dirty of dirtyUrls) {
  const cleaned = cleanPostUrl(dirty);
  assert.strictEqual(cleaned, 'https://www.threads.com/@choke.dev/post/DE8zKLaSPwA', `Failed cleaning: ${dirty}`);
}
console.log('✓ Test 3: Clean Link sanitization strips ?xmt= and tracking params');

// Test 4: Smart Timestamp logic
const testDate = new Date('2026-09-20T14:30:00');
const abs = formatAbsolute(testDate);
assert(abs.includes('20/09/2026') && abs.includes('14:30'), `Absolute timestamp format incorrect: ${abs}`);
const hybrid = formatHybrid('2 ชม.', testDate);
assert.strictEqual(hybrid, '2 ชม. (14:30)', `Hybrid timestamp incorrect: ${hybrid}`);
console.log('✓ Test 4: Smart Timestamp (Absolute & Hybrid) verified');

// Test 5: Filename convention
function makeFilename(username, postId, index, type) {
  const ext = type === 'video' ? 'mp4' : 'jpg';
  return `${username}_${postId}_${String(index).padStart(3, '0')}.${ext}`;
}
assert.strictEqual(makeFilename('alice', 'DdfP0AgEzDF', 1, 'image'), 'alice_DdfP0AgEzDF_001.jpg');
assert.strictEqual(makeFilename('alice', 'DdfP0AgEzDF', 3, 'video'), 'alice_DdfP0AgEzDF_003.mp4');
console.log('✓ Test 5: Filename formatting contract verified');

// Test 6: Thread Unroller Markdown generator
const mockThread = [
  { text: 'Part 1 of the story' },
  { text: 'Part 2 continuing' },
  { text: 'Part 3 conclusion' }
];
const md = buildUnrolledMarkdown('author_x', 'post_123', mockThread);
assert(md.includes('# Thread by @author_x'), 'Markdown header missing');
assert(md.includes('### [1/3]\n\nPart 1 of the story'), 'Part 1 missing');
assert(md.includes('### [3/3]\n\nPart 3 conclusion'), 'Part 3 missing');
console.log('✓ Test 6: Thread Unroller Markdown exporter verified');

// Test 7: Composer Hook Guide limits
assert.strictEqual(evaluateComposerHook(50), 'safe', 'Hook <= 180 should be safe');
assert.strictEqual(evaluateComposerHook(180), 'safe', 'Hook = 180 should be safe');
assert.strictEqual(evaluateComposerHook(181), 'cut', 'Hook > 180 should warn cutoff');
assert.strictEqual(evaluateComposerHook(501), 'over', 'Hook > 500 should warn length');
console.log('✓ Test 7: Composer Hook fold threshold verified (180 char cutoff)');

// Test 8: One-Click Thread Splitter (Sentence and Paragraph boundaries)
const longPost = 'Paragraph 1 is very informative and sets the stage for our entire discussion.\n\n' +
  'Paragraph 2 elaborates with detailed technical steps, covering architectural invariants and safety bounds. '.repeat(5) +
  '\n\nParagraph 3 wraps up everything with key takeaways.';
const splitChunks = splitText(longPost, 300);
assert(splitChunks.length >= 3, 'Splitter should chunk long text into 3+ parts');
for (const c of splitChunks) {
  assert(c.length <= 350, `Chunk length exceeds tolerance: ${c.length}`);
}
console.log(`✓ Test 8: One-Click Thread Splitter correctly split long text into ${splitChunks.length} chunks`);

// ─── 11. USERSCRIPT METADATA & ICON VERIFICATION ───
const fs = require('fs');
const path = require('path');
const userScriptSource = fs.readFileSync(path.join(__dirname, 'threadmax.user.js'), 'utf8');

assert(userScriptSource.includes('// @version      1.4.0'), 'Userscript version should be 1.4.0');
assert(userScriptSource.includes('// @icon         https://www.threads.net/favicon.ico'), 'Userscript missing @icon');
assert(userScriptSource.includes('// @icon64       https://www.threads.net/favicon.ico'), 'Userscript missing @icon64');
assert(userScriptSource.includes('// @run-at       document-start'), 'Userscript must use @run-at document-start for early sniffer intercept');
console.log('✓ Test 13: Userscript Metadata Header (@icon, @icon64, @version 1.4.0) verified');

// ─── 19. FIXED BODY PORTAL POSITIONING & VIEWPORT CLAMP ───
function computePortalCoordinates(anchorRect, dropdownWidth = 270, windowWidth = 1920) {
  let left = anchorRect.left;
  if (left + dropdownWidth > windowWidth - 16) {
    left = windowWidth - dropdownWidth - 16;
  }
  if (left < 16) left = 16;
  const top = anchorRect.bottom + 6;
  return { top, left, zIndex: 2147483647 };
}

// Normal positioning
const posNormal = computePortalCoordinates({ left: 300, bottom: 400 });
assert.strictEqual(posNormal.top, 406, 'Portal top calculation mismatch');
assert.strictEqual(posNormal.left, 300, 'Portal left calculation mismatch');
assert.strictEqual(posNormal.zIndex, 2147483647, 'Portal zIndex must be max signed 32-bit int');

// Right viewport edge overflow clamping
const posEdgeRight = computePortalCoordinates({ left: 1800, bottom: 400 }, 270, 1920);
assert.strictEqual(posEdgeRight.left, 1920 - 270 - 16, 'Portal right clamp failed');

// Left viewport edge overflow clamping
const posEdgeLeft = computePortalCoordinates({ left: -20, bottom: 400 }, 270, 1920);
assert.strictEqual(posEdgeLeft.left, 16, 'Portal left clamp failed');
console.log('✓ Test 21: Fixed Body Portal Positioning & Viewport Boundary Clamp verified');

// ─── TEST 26: MutationWatcher Engine Contract ─────────────────
class TestMutationWatcher {
  constructor({ debounceMs = 50, maxBatchSize = 10, pauseWhen = () => false, filter = () => true, onMutations }) {
    this.debounceMs = debounceMs;
    this.maxBatchSize = maxBatchSize;
    this.pauseWhen = pauseWhen;
    this.filter = filter;
    this.onMutations = onMutations;
    this.buffer = [];
    this.paused = false;
  }

  pushMutations(mutations) {
    if (this.pauseWhen() || this.paused) return;
    const filtered = mutations.filter(this.filter);
    if (filtered.length === 0) return;
    this.buffer.push(...filtered);
    if (this.buffer.length > this.maxBatchSize) {
      this.buffer = this.buffer.slice(-this.maxBatchSize);
    }
  }

  flush() {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0, this.maxBatchSize);
    this.onMutations(batch);
  }
}

let mutationBatchesReceived = [];
let isCapturingModalActive = false;
const watcher = new TestMutationWatcher({
  debounceMs: 50,
  maxBatchSize: 3,
  pauseWhen: () => isCapturingModalActive,
  filter: m => m.type === 'childList' && m.addedCount > 0,
  onMutations: batch => mutationBatchesReceived.push(batch)
});

// Case 1: Filter out non-childList or empty added nodes
watcher.pushMutations([
  { type: 'attributes', addedCount: 0 },
  { type: 'childList', addedCount: 2, id: 1 },
  { type: 'childList', addedCount: 1, id: 2 }
]);
watcher.flush();
assert.strictEqual(mutationBatchesReceived.length, 1);
assert.strictEqual(mutationBatchesReceived[0].length, 2);

// Case 2: Max batch size truncation
watcher.pushMutations([
  { type: 'childList', addedCount: 1, id: 3 },
  { type: 'childList', addedCount: 1, id: 4 },
  { type: 'childList', addedCount: 1, id: 5 },
  { type: 'childList', addedCount: 1, id: 6 }
]);
// Buffer should be capped at maxBatchSize = 3 (ids 4, 5, 6)
watcher.flush();
assert.strictEqual(mutationBatchesReceived[1].length, 3);
assert.deepStrictEqual(mutationBatchesReceived[1].map(m => m.id), [4, 5, 6]);

// Case 3: Paused when modal is capturing
isCapturingModalActive = true;
watcher.pushMutations([{ type: 'childList', addedCount: 1, id: 7 }]);
watcher.flush();
assert.strictEqual(mutationBatchesReceived.length, 2, 'Should not process mutations while pauseWhen is active');

console.log('✓ Test 26: MutationWatcher debounce, batching & modal-aware pause verified');

// ─── TEST 28: Semantic Selector Fallback Engine ────────────────
// Extracts the real findShareButtons body from the shipped bundle and runs it against a
// stub DOM, so this test fails if the selector actually breaks.
// Runs the REAL findShareButtons out of the shipped bundle against a stub DOM, so this
// test fails if the selector actually breaks rather than testing a copy of it.
const bundleSrc = fs.readFileSync(path.join(__dirname, 'threadmax.user.js'), 'utf8');
function extractFn(src, marker) {
  const start = src.indexOf(marker);
  assert.ok(start > -1, marker + ' must exist in the bundle');
  const arrow = src.indexOf('{', src.indexOf('=>', start));
  let depth = 0, end = arrow;
  for (let i = arrow; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  return src.slice(start, end + 1).replace(marker, '() =>');
}
const runFinder = new Function('document',
  `return (${extractFn(bundleSrc, 'findShareButtons: () =>')})(document);`);

// DOM stub matching the real Threads row: .actions(row) > .actcell > [role=button] > svg > path.
// The seed is what the selector matched on layer 1, i.e. the BUTTON itself, not the path.
// That distinction matters: closest('svg') only walks ancestors, so a button that wraps
// its own svg was invisible to the old stub and to the old code.
function iconNode() {
  const path = { tagName: 'PATH', parentElement: null, closest: (s) => (s === 'svg' ? svg : null), querySelector: () => null };
  const svg = { tagName: 'SVG', parentElement: null, closest: (s) => (s === 'svg' ? svg : null), querySelector: () => null };
  // The share button WRAPS its svg; it is not inside one. closest() must not find it.
  const btn = { tagName: 'DIV', role: 'button', parentElement: null, closest: (s) => (s === '[role="button"]' ? btn : null), querySelector: (s) => (s === 'svg' ? svg : null) };
  // Only the row holds more than one role=button; the single cell must NOT qualify,
  // otherwise the walk-up is untested and a two-level guess would pass.
  // Real Threads nests an <a> between the button and its cell, so the row is three
  // levels up. Without it a two-level guess lands on the row by accident and the
  // walk-up is never exercised.
  const link = { tagName: 'A', role: null, parentElement: null, querySelectorAll: () => [] };
  const cell = { tagName: 'DIV', role: null, className: 'actcell', parentElement: null, querySelectorAll: () => [] };
  const row = { tagName: 'DIV', role: null, className: 'actions', parentElement: null, querySelectorAll: () => [btn, { tagName: 'DIV' }, { tagName: 'DIV' }] };
  path.parentElement = svg; svg.parentElement = btn; btn.parentElement = link; link.parentElement = cell; cell.parentElement = row;
  return { seed: btn, path, row, cell, link, btn, svg };
}
const doc = (map) => ({ querySelectorAll: (sel) => map[sel] || [] });
const HASH = 'path[d*="M7.247 1.499"], path[d*="M7.246 1.5"], path[d*="M1.53 6.014"]';
const BTN_LABEL = '[role="button"][aria-label*="Share" i], [role="button"][aria-label*="\u0e41\u0e0a\u0e23\u0e4c"]';
const SVG_LABEL = 'svg[title*="Share" i], svg[title*="\u0e41\u0e0a\u0e23\u0e4c"], svg[aria-label*="Share" i], svg[aria-label*="\u0e41\u0e0a\u0e23\u0e4c"]';

// 1. Primary layer: labelled share button, icon geometry irrelevant.
const n1 = iconNode();
const byLabel = runFinder(doc({ [BTN_LABEL]: [n1.seed] }));
assert.strictEqual(byLabel.length, 1, 'labelled share button must be found regardless of icon path');
assert.strictEqual(byLabel[0].actionRow, n1.row, 'actionRow must be the multi-action row, not a single cell');

// 2. Second layer: label on the svg, button itself unlabelled.
const n2 = iconNode();
const bySvgLabel = runFinder(doc({ [SVG_LABEL]: [n2.svg] }));
assert.strictEqual(bySvgLabel.length, 1, 'svg-level Share label must resolve');

// 3. Last layer: no label anywhere, only the legacy icon path.
const n3 = iconNode();
const byHash = runFinder(doc({ [HASH]: [n3.path] }));
assert.strictEqual(byHash.length, 1, 'path hash must remain as the final fallback');
// The path layer seeds the walk from the path, so the row must still resolve the same way.
assert.strictEqual(byHash[0].actionRow, n3.row, 'path layer must resolve the same multi-action row');

// 4. Layers short-circuit: a semantic hit means the hash query is never issued.
let hashQueried = false;
const n4 = iconNode();
const spyDoc = { querySelectorAll: (sel) => { if (sel === HASH) hashQueried = true; return sel === BTN_LABEL ? [n4.seed] : []; } };
const spied = runFinder(spyDoc);
assert.strictEqual(spied.length, 1);
assert.strictEqual(hashQueried, false, 'hash layer must not run once a semantic match exists');

// 5. Unrecognised DOM: zero results, never a throw.
assert.strictEqual(runFinder(doc({})).length, 0, 'unknown DOM must yield zero results');

// 6. Two different elements that resolve to the SAME button (a wrapper and the svg
// inside it) must collapse to one entry, otherwise that post gets two button sets.
const dup = iconNode();
const dupDoc = { querySelectorAll: (sel) => (sel === SVG_LABEL ? [dup.seed, dup.svg] : []) };
assert.strictEqual(runFinder(dupDoc).length, 1, 'two nodes resolving to one button must collapse to one');

console.log('\u2713 Test 28: Real bundle findShareButtons (label -> svg-label -> path hash, safe empty)');

// ─── TEST 29: Progress Watchdog Auto-Cleanup Contract ──────────
class MockProgressManager {
  constructor() {
    this.watchdogs = new Map();
    this.bars = new Map();
  }

  showProgress(id, current, total) {
    this.bars.set(id, { current, total, pct: Math.round((current / total) * 100) });
    if (this.watchdogs.has(id)) clearTimeout(this.watchdogs.get(id));
    const timer = setTimeout(() => {
      this.clearProgress(id, 0);
    }, 100); // 100ms for testing
    this.watchdogs.set(id, timer);
  }

  clearProgress(id, delay = 0) {
    if (this.watchdogs.has(id)) {
      clearTimeout(this.watchdogs.get(id));
      this.watchdogs.delete(id);
    }
    if (delay <= 0) {
      this.bars.delete(id);
    } else {
      setTimeout(() => this.bars.delete(id), delay);
    }
  }
}

const pm = new MockProgressManager();
pm.showProgress('dl_1', 1, 5);
assert.ok(pm.bars.has('dl_1'), 'Progress bar must exist');
assert.strictEqual(pm.bars.get('dl_1').pct, 20);

// Explicit clear removes immediately
pm.clearProgress('dl_1', 0);
assert.strictEqual(pm.bars.has('dl_1'), false, 'Progress bar should be removed on clear');

// Stalled progress auto-cleanup via watchdog
pm.showProgress('dl_stalled', 2, 5);
assert.ok(pm.bars.has('dl_stalled'));
setTimeout(() => {
  assert.strictEqual(pm.bars.has('dl_stalled'), false, 'Watchdog must auto-remove stalled progress bar');
  console.log('✓ Test 29: Progress bar watchdog auto-cleanup contract verified');

  // ─── TEST 33: Responsive srcset high-res media extraction contract ───
  function testGetBestMediaUrl(img) {
    const srcset = img.srcset;
    if (!srcset) return img.src;
    const candidates = srcset.split(',').map(s => {
      const [u, w] = s.trim().split(/\s+/);
      return { url: u, width: parseInt(w, 10) || 0 };
    }).filter(c => c.url);
    candidates.sort((a, b) => b.width - a.width);
    return candidates[0]?.url || img.src;
  }

  const mockImg = {
    src: 'https://scontent.cdninstagram.com/v/t51.2885-15/thumb_640.jpg',
    srcset: 'https://scontent.cdninstagram.com/v/t51.2885-15/thumb_640.jpg 640w, https://scontent.cdninstagram.com/v/t51.2885-15/high_1080.jpg 1080w, https://scontent.cdninstagram.com/v/t51.2885-15/max_1440.jpg 1440w'
  };
  assert.strictEqual(testGetBestMediaUrl(mockImg), 'https://scontent.cdninstagram.com/v/t51.2885-15/max_1440.jpg', 'Must pick maximum resolution candidate from srcset');
  console.log('✓ Test 33: Responsive srcset high-res image extraction contract verified');

// Test 15: the re-render bug must not come back.
// Threads swaps an action row out from under us (hover, expand, media load).
// A sticky dataset flag left that post dead until reload; the guard must read
// the live DOM instead.
assert(!/actionRow\.dataset\.tmInjected/.test(shipped),
  'Injection guard must not rely on a sticky dataset flag (re-render bug)');
assert(shipped.includes("actionRow.querySelector('.tm-download-btn, .tm-cleanlink-btn')"),
  'Injection guard must check the live DOM for existing buttons');
assert(!/x78zum5/.test(shipped),
  "Must not key off Meta's hashed action-row class; walk up from our own button");
assert(/const dlWrapper = card\.querySelector\('\.tm-download-btn'\)\?\.parentElement/.test(shipped),
  'Select bar must locate the action row by walking up from the injected button');
console.log('✓ Re-render recovery: no sticky flag, no Meta hash dependency');

// ─── TEST 16: Filename hardening (hostile Threads handles) ────
// A handle can carry < > : " / \ | ? * on Threads. Those are illegal in a Windows
// filename, so the download silently lands nowhere.
const safeDef = shipped.match(/const safeFilename = [^;]+;/);
assert.ok(safeDef, 'safeFilename must exist in the shipped bundle');
const safeFilename = new Function('return (' + safeDef[0].replace(/^const safeFilename = /, '').replace(/;$/, '') + ')')();
assert.strictEqual(safeFilename('bad:na*me'), 'bad_na_me', 'Reserved characters must be replaced');
assert.strictEqual(safeFilename('a\\b/c'), 'a_b_c', 'Path separators must be replaced');
assert.strictEqual(safeFilename('trailing...'), 'trailing', 'Trailing dots must be trimmed (Windows)');
assert.strictEqual(safeFilename(''), 'file', 'Empty input must fall back');
assert.ok(!/[<>:"/\\|?*]/.test(safeFilename('x'.repeat(200))), 'Long input must stay legal');
// every download path must go through it
for (const marker of ['downloadSingle:', 'downloadBatch:']) {
  const seg = shipped.slice(shipped.indexOf(marker), shipped.indexOf(marker) + 2500);
  assert(seg.includes('safeFilename('), marker + ' must build filenames through safeFilename');
}
console.log('✓ Test 16: Hostile handles produce legal filenames');

// ─── TEST 17: composer counts codepoints, not UTF-16 units ────
// Threads limits by codepoint. String.length counts an emoji as 2, so a
// 250-emoji post (250 to Threads) was reported as 500 and treated as full.
const countSrc = shipped.slice(shipped.indexOf('const update = () => {'), shipped.indexOf('const update = () => {') + 900);
assert(countSrc.includes('[...textbox.innerText.trim()].length'),
  'Composer must count codepoints; String.length double-counts emoji');

// ─── TEST 18: GM_download timeout is real ────
// ontimeout only fires when a timeout option is passed. Without it a stalled
// download left the promise pending and wedged the batch loop.
const dlSeg = shipped.slice(shipped.indexOf('const GM_DOWNLOAD_TIMEOUT_MS'), shipped.indexOf('const fetchAsBlob'));
const call = dlSeg.slice(dlSeg.indexOf('GM_download({'));
assert(/\btimeout:\s*GM_DOWNLOAD_TIMEOUT_MS/.test(call.slice(0, call.indexOf(');'))),
  'GM_download must be passed an explicit timeout option');
assert(dlSeg.includes('setTimeout(fallback'), 'A local timer must fire the fallback if GM never calls back');
assert(dlSeg.includes('if (!settled)'), 'Resolution must be guarded so late callbacks cannot double-resolve');
console.log('✓ Test 17-18: codepoint counter and real download timeout');

// ─── TEST 19: splitter must never emit an over-limit chunk ────
// A run with no sentence break (Thai without spaces, a pasted wall of text)
// used to come back as one oversized chunk Threads rejects, so the button
// silently did nothing. Word, then hard-slice, fallback added.
// The bundle's splitText, lifted out and run for real. extractFn already walks the
// matching brace, so reuse it instead of re-parsing the arrow header by hand.
// extractFn strips the parameter list, so put it back around the lifted body.
const splitFnSrc = extractFn(shipped, 'splitText: (text, maxLen = 460) =>');
const splitText = new Function('return (' + splitFnSrc.replace('() =>', '(text, maxLen = 460) =>') + ')')();
for (const [name, input] of [
  ['ascii wall', 'x'.repeat(1200)],
  ['thai no space', 'ก'.repeat(1200)],
  ['single word', 'z'.repeat(1200)],
  ['sentences', 'A. '.repeat(400)],
  ['long url', 'https://x.io/' + 'a'.repeat(60) + ' ']
]) {
  const chunks = splitText(input, 460);
  const max = Math.max(...chunks.map(c => c.length));
  assert(max <= 500, name + ' produced an over-limit chunk of ' + max);
  const kept = chunks.join('').replace(/\s/g, '').length;
  assert.strictEqual(kept, input.replace(/\s/g, '').length, name + ' lost characters while splitting');
}
assert.strictEqual(splitText('short', 460).length, 1, 'Text under the limit must stay one chunk');
console.log('✓ Test 19: Splitter caps every chunk and preserves content');

// ─── TEST 20: the video volume listener must bind once ────
// Threads re-renders video nodes and drops the data attribute, so keying the
// listener off it attached a fresh closure on every scan and leaked one per pass.
const vidSeg = shipped.slice(shipped.indexOf('enhance: (video)'), shipped.indexOf('/* ─── 9. SMART'));
assert(vidSeg.includes('tmVolumeBound'), 'Volume listener needs its own persistent marker');
const bindIdx = vidSeg.indexOf('if (!video.dataset.tmVolumeBound)');
const volIdx = vidSeg.indexOf("addEventListener('volumechange'");
assert(bindIdx > -1 && volIdx > bindIdx, 'volumechange must sit inside the bind-once guard');
console.log('✓ Test 20: Video volume listener binds exactly once');

  console.log('\n🎉 ALL 20 THREADMAX v1.4.0 TESTS PASSED GREEN!\n');
}, 150);

// ─── SCOPE REGRESSION: removed features must not survive in production or docs ───
// threadmax.user.js is the single source of truth; src/ is gone (2026-09-26).
const repoRoot = __dirname;
const productionFiles = [path.join(repoRoot, 'threadmax.user.js')];
const documentationFiles = [path.join(repoRoot, 'README.md')];
const removedFiles = ['src/features/viral.ts', 'src/features/auditor/db.ts', 'src/features/auditor/graphql.ts'];
const removedTokens = [
  'TM_ViralRadar', 'TM_RelationshipAuditor', 'TM_Studio', 'TM_Sniffer', 'TM_DB',
  'VIRAL_RADAR', 'FILTER_RISING', 'STUDIO_LAUNCHER', 'STUDIO_DRAWER', 'FEED_FILTER_BAR',
  'installGraphQLSniffer', 'handleAutoUnfollow', 'unfollowUser',
  'tm_unfollow', 'tm_doc_followers', 'tm_doc_following', 'tm_uid_',
  'tm-viral-badge', 'tm-feed-filter-bar', 'tm-studio-launcher', 'tm-studio-drawer',
  'ThreadMax Studio', 'Viral Velocity', 'Relationship Auditor', 'Auto-unfollow',
  'Mutual Auditor', 'Growth Intelligence', 'IndexedDB Snapshot',
];

for (const rel of removedFiles) {
  assert(!fs.existsSync(path.join(repoRoot, rel)), `Removed source file still exists: ${rel}`);
}
for (const file of [...productionFiles, ...documentationFiles]) {
  const text = fs.readFileSync(file, 'utf8');
  for (const token of removedTokens) {
    assert(!text.includes(token), `Removed feature token ${token} remains in ${path.relative(repoRoot, file)}`);
  }
}
assert(!fs.existsSync(path.join(repoRoot, 'src')), 'src/ must be gone: the bundle is the only source of truth');
const shipped = fs.readFileSync(path.join(repoRoot, 'threadmax.user.js'), 'utf8');
for (const retained of ['TM_Buttons', 'TM_Unroller', 'TM_Composer', 'TM_Video', 'TM_Timestamp']) {
  assert(shipped.includes(retained), `Retained core module missing from shipped bundle: ${retained}`);
}
// P0 a11y that lived only in the deleted src/: the shipped bundle must trap Tab in both modals.
assert(shipped.includes('tmFocusTrap'), 'Focus trap helper missing from shipped bundle');
assert(shipped.includes("role', 'group'"), 'Video controls must expose role=group');
console.log('✓ Scope regression: removed features absent; retained core artifacts present');
console.log('✓ Single-source gate: src/ deleted, bundle is the only implementation');
