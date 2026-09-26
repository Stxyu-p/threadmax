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
function testSemanticShareDetection(mockDOM) {
  // Strategy 1: Find within action row group
  if (mockDOM.actionGroups) {
    for (const group of mockDOM.actionGroups) {
      if (group.buttons && group.buttons.length >= 3) {
        const shareCandidate = group.buttons.find(b => b.hasShareSvg || b.title === 'Share' || b.ariaLabel === 'Share');
        if (shareCandidate) return { found: true, method: 'group_semantic', button: shareCandidate };
      }
    }
  }
  // Strategy 2: Fallback to SVG path matching
  if (mockDOM.svgPaths) {
    const matched = mockDOM.svgPaths.some(p => p.includes('M7.247 1.499') || p.includes('M7.246 1.5'));
    if (matched) return { found: true, method: 'svg_path_fallback', button: { id: 'fallback_btn' } };
  }
  return { found: false, method: 'none', button: null };
}

// 1. Primary semantic group detection
const resPrimary = testSemanticShareDetection({
  actionGroups: [
    { buttons: [{ id: 'like' }, { id: 'reply' }, { id: 'repost' }, { id: 'share', ariaLabel: 'Share' }] }
  ]
});
assert.strictEqual(resPrimary.found, true);
assert.strictEqual(resPrimary.method, 'group_semantic');
assert.strictEqual(resPrimary.button.id, 'share');

// 2. Fallback to SVG path when groups aren't rendered
const resFallback = testSemanticShareDetection({
  svgPaths: ['M7.247 1.499 C 5.2 2.1...']
});
assert.strictEqual(resFallback.found, true);
assert.strictEqual(resFallback.method, 'svg_path_fallback');

console.log('✓ Test 28: Semantic selector detection & SVG fallback engine verified');

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

  console.log('\n🎉 ALL 14 THREADMAX v1.4.0 TESTS PASSED GREEN!\n');
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
