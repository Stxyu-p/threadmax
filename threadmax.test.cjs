/**
 * ThreadMax Unit & Regression Tests (Zero-Dependency CJS)
 * Verifies ZIP32 integrity, URL sanitization, timestamp formatting, Unroller Markdown, and Composer rules.
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

// ─── EXECUTE TESTS ───
console.log('🧪 Running ThreadMax v1.1.0 Test Suite...\n');

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

console.log('\n🎉 ALL 7 THREADMAX TESTS PASSED GREEN!\n');
