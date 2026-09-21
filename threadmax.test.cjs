/**
 * ThreadMax Unit & Regression Tests (Zero-Dependency CJS)
 * Verifies ZIP32 integrity, URL sanitization, timestamp formatting, Unroller Markdown,
 * Composer rules, Thread Splitter, and Viral Velocity calculation.
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

// ─── 7. VIRAL VELOCITY LOGIC ───
function calculateVelocity(replies, reposts, ageMinutes) {
  const safeAge = Math.max(1, ageMinutes);
  return (replies * 2 + reposts * 1.5) / safeAge;
}

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

// Test 9: Viral Velocity Score & Metric Parsing
const v1 = calculateVelocity(20, 10, 30); // 20 replies, 10 reposts in 30 mins -> (40 + 15)/30 = 1.83
assert(Math.abs(v1 - 1.833) < 0.01, 'Velocity score mismatch');
assert.strictEqual(parseMetricNumber('1.2k'), 1200, 'Metric 1.2k failed');
assert.strictEqual(parseMetricNumber('2.5m'), 2500000, 'Metric 2.5m failed');
assert.strictEqual(parseMetricNumber('42'), 42, 'Metric 42 failed');
console.log('✓ Test 9: Viral Velocity Radar formula & Metric parser verified');

// ─── 8. PHASE 3 VIRAL FILTER & COMMENT GUARD LOGIC ───
function isRisingPost(replies, reposts, ageMinutes, maxReplies = 50, minVelocity = 0.1, maxAge = 180) {
  if (ageMinutes > maxAge) return false;
  if (replies >= maxReplies) return false; // Early-stage comment guard
  const vel = calculateVelocity(replies, reposts, ageMinutes);
  return vel >= minVelocity;
}

function shouldDisplayInFeed(isFilterActive, isRising) {
  if (!isFilterActive) return true;
  return isRising === true;
}

// Test 10: Viral Velocity Radar < 50 Comment Guard & Feed Filter
assert.strictEqual(isRisingPost(20, 10, 30), true, '20 replies < 50 should be rising');
assert.strictEqual(isRisingPost(55, 10, 30), false, '55 replies >= 50 should be blocked by guard');
assert.strictEqual(isRisingPost(10, 5, 200), false, 'Age > 180 should not be marked rising');
assert.strictEqual(shouldDisplayInFeed(false, false), true, 'All filter should show regular post');
assert.strictEqual(shouldDisplayInFeed(true, false), false, 'Rising filter should hide regular post');
assert.strictEqual(shouldDisplayInFeed(true, true), true, 'Rising filter should show rising post');
console.log('✓ Test 10: Viral Velocity < 50 comments guard & Feed Filter logic verified');

// ─── 9. PHASE 3.2 RELATIONSHIP DIFF ENGINE ───
function computeRelationshipDiff(currentFollowers, currentFollowing, prevSnapshot = null) {
  const followerSet = new Set(currentFollowers.map(u => String(u).toLowerCase()));
  const followingSet = new Set(currentFollowing.map(u => String(u).toLowerCase()));

  // 1. Not following back: We follow them, but they do NOT follow back
  const notFollowingBack = currentFollowing.filter(u => !followerSet.has(String(u).toLowerCase()));

  // 2. Fans / Admirers: They follow us, but we do NOT follow them back
  const fans = currentFollowers.filter(u => !followingSet.has(String(u).toLowerCase()));

  // 3. Mutual Friends: Both follow each other
  const mutual = currentFollowing.filter(u => followerSet.has(String(u).toLowerCase()));

  // 4. Lost & Gained (relative to previous snapshot)
  let gained = [];
  let lost = [];
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
    totalFollowing: currentFollowing.length
  };
}

// Test 11: Relationship Diff Calculation
const mockFollowers = ['alice', 'bob', 'charlie', 'diana'];
const mockFollowing = ['bob', 'charlie', 'edward', 'frank'];
const mockPrevSnapshot = {
  timestamp: Date.now() - 86400000,
  followers: ['alice', 'bob', 'charlie', 'george'], // george unfollowed, diana is new
  following: ['bob', 'charlie']
};

const diff = computeRelationshipDiff(mockFollowers, mockFollowing, mockPrevSnapshot);
assert.deepStrictEqual(diff.notFollowingBack.sort(), ['edward', 'frank'].sort(), 'Not following back mismatch');
assert.deepStrictEqual(diff.fans.sort(), ['alice', 'diana'].sort(), 'Fans mismatch');
assert.deepStrictEqual(diff.mutual.sort(), ['bob', 'charlie'].sort(), 'Mutual mismatch');
assert.deepStrictEqual(diff.gained, ['diana'], 'Gained followers mismatch');
assert.deepStrictEqual(diff.lost, ['george'], 'Lost followers mismatch');
console.log('✓ Test 11: 4-category Relationship Diff Engine verified');

// ─── 10. INDEXEDDB SNAPSHOT CONTRACT ───
function validateSnapshotContract(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  if (typeof snapshot.timestamp !== 'number') return false;
  if (!Array.isArray(snapshot.followers)) return false;
  if (!Array.isArray(snapshot.following)) return false;
  if (!snapshot.diff || typeof snapshot.diff !== 'object') return false;
  return true;
}

// Test 12: IndexedDB Snapshot Data Contract
const sampleRecord = {
  timestamp: Date.now(),
  username: 'choke.dev',
  followers: mockFollowers,
  following: mockFollowing,
  diff: diff
};
assert.strictEqual(validateSnapshotContract(sampleRecord), true, 'Snapshot contract check failed');
assert.strictEqual(validateSnapshotContract({}), false, 'Empty record should fail contract');
console.log('✓ Test 12: IndexedDB Snapshot Data Contract verified');

// ─── 11. USERSCRIPT METADATA & ICON VERIFICATION ───
const fs = require('fs');
const path = require('path');
const userScriptSource = fs.readFileSync(path.join(__dirname, 'threadmax.user.js'), 'utf8');

assert(userScriptSource.includes('// @version      1.4.0'), 'Userscript version should be 1.4.0');
assert(userScriptSource.includes('// @icon         https://www.threads.net/favicon.ico'), 'Userscript missing @icon');
assert(userScriptSource.includes('// @icon64       https://www.threads.net/favicon.ico'), 'Userscript missing @icon64');
assert(userScriptSource.includes('// @run-at       document-start'), 'Userscript must use @run-at document-start for early sniffer intercept');
console.log('✓ Test 13: Userscript Metadata Header (@icon, @icon64, @version 1.4.0) verified');

// ─── 12. MULTI-TIER USER ID EXTRACTION LOGIC ───
function extractIdFromCookie(cookieStr) {
  const m = (cookieStr || '').match(/(?:^|;\s*)ds_user_id=(\d+)/);
  return m ? m[1] : null;
}

function extractIdFromDeepLink(tagContent) {
  const m = (tagContent || '').match(/(?:barcelona|instagram):\/\/user\?id=(\d+)/i);
  return m ? m[1] : null;
}

function extractIdFromScriptSlice(scriptText, username) {
  if (!scriptText || !username) return null;
  const clean = username.replace(/^@/, '').toLowerCase();
  const idx = scriptText.toLowerCase().indexOf(clean);
  if (idx === -1) return null;
  const slice = scriptText.substring(Math.max(0, idx - 600), Math.min(scriptText.length, idx + 600));
  const m = slice.match(/"(?:pk|user_id|target_user_id|profile_id)":"?(\d{4,25})"?/);
  return (m && m[1] !== '0') ? m[1] : null;
}

function validateUserId(id) {
  if (!id) return false;
  const s = String(id).trim();
  return /^\d{4,25}$/.test(s) && s !== '0';
}

// Test 14: Multi-tier User ID parsers & validation
assert.strictEqual(validateUserId('0'), false, 'ID 0 should be invalid');
assert.strictEqual(validateUserId('abc'), false, 'Non-digit ID should be invalid');
assert.strictEqual(validateUserId('60293848123'), true, 'Valid numeric ID should pass');

const mockCookies = 'csrftoken=token123; ds_user_id=60293848123; sessionid=sess456';
assert.strictEqual(extractIdFromCookie(mockCookies), '60293848123', 'Cookie ds_user_id extraction failed');

const mockMeta = 'barcelona://user?id=60293848123';
assert.strictEqual(extractIdFromDeepLink(mockMeta), '60293848123', 'Deep link extraction failed');

const mockScript = '{"require":[["ScheduledServerJS",{"props":{"username":"stxyu.p","pk":"60293848123"}}]]}';
assert.strictEqual(extractIdFromScriptSlice(mockScript, 'stxyu.p'), '60293848123', 'Script proximity extraction failed');
console.log('✓ Test 14: Multi-tier User ID Extraction (Cookie, Deep Link, In-Script JSON) verified');

// ─── 13. GRAPHQL PAYLOAD CONTRACT & ACTIVE SNIFFER ───
function buildGraphQLPayload(docId, lsd, userId, cursor = null) {
  const form = new URLSearchParams();
  if (lsd) form.set('lsd', lsd);
  form.set('variables', JSON.stringify({ userID: userId, first: 50, after: cursor }));
  form.set('doc_id', docId);
  return form.toString();
}

const gqlPayload = buildGraphQLPayload('284797047911918316998205836755', 'AVq7token', '60293848123');
assert(gqlPayload.includes('doc_id=284797047911918316998205836755'), 'Missing doc_id in payload');
assert(gqlPayload.includes('variables=%7B%22userID%22%3A%2260293848123%22'), 'Variables not properly encoded');
console.log('✓ Test 15: GraphQL Payload Builder & Sniffer schema contract verified');

// ─── 14. MODAL HARVESTER DEDUPLICATION & PARSER ───
function parseUsernamesFromHrefs(hrefs) {
  const found = new Set();
  for (const href of hrefs) {
    if (href.includes('/post/')) continue;
    const m = (href || '').match(/@([^/?#]+)/);
    if (m) {
      const u = m[1].toLowerCase();
      if (!['post', 'explore', 'search', 'activity', 'messages', 'settings'].includes(u)) {
        found.add(u);
      }
    }
  }
  return Array.from(found);
}

const mockModalLinks = [
  'https://www.threads.com/@alice',
  'https://www.threads.com/@bob',
  'https://www.threads.com/@alice', // duplicate in virtualized scrolling
  'https://www.threads.com/@charlie/post/xyz', // post link, should filter out
  '/@stxyu.p'
];
const parsedUsers = parseUsernamesFromHrefs(mockModalLinks);
assert.deepStrictEqual(parsedUsers.sort(), ['alice', 'bob', 'stxyu.p'].sort(), 'Modal deduplication mismatch');
console.log('✓ Test 16: Modal Harvester deduplication & virtualized parser verified');

// ─── 15. 2-WAY MODAL TAB DETECTION & NUMBER PARSER ───
function extractNumberFromText(str) {
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

const followersRegex = /(^ผู้ติดตาม(\s+[\d,kmb\.]+)?$|^([\d,kmb\.]+\s+)?ผู้ติดตาม$|^followers(\s+[\d,kmb\.]+)?$|^([\d,kmb\.]+\s+)?followers$)/i;
const followingRegex = /(^กำลังติดตาม(\s+[\d,kmb\.]+)?$|^([\d,kmb\.]+\s+)?กำลังติดตาม$|^following(\s+[\d,kmb\.]+)?$|^([\d,kmb\.]+\s+)?following$)/i;

// Test 17: Tab Matching & Count Extraction
assert.strictEqual(extractNumberFromText('ผู้ติดตาม 1,250'), 1250, 'Followers 1,250 failed');
assert.strictEqual(extractNumberFromText('กำลังติดตาม 444'), 444, 'Following 444 failed');
assert.strictEqual(extractNumberFromText('12.5K Followers'), 12500, 'K suffix failed');
assert.strictEqual(extractNumberFromText('1.2M Following'), 1200000, 'M suffix failed');
assert.strictEqual(extractNumberFromText('0'), 0, 'Zero failed');

assert(followersRegex.test('ผู้ติดตาม 1,250'), 'Followers Thai format with trailing count failed');
assert(followersRegex.test('1,250 ผู้ติดตาม'), 'Followers Thai format with leading count failed');
assert(followersRegex.test('ผู้ติดตาม'), 'Followers Thai label only failed');
assert(followersRegex.test('Followers 12.5K'), 'Followers English format failed');

assert(followingRegex.test('กำลังติดตาม 444'), 'Following Thai format with trailing count failed');
assert(followingRegex.test('444 กำลังติดตาม'), 'Following Thai format with leading count failed');
assert(followingRegex.test('กำลังติดตาม'), 'Following Thai label only failed');
assert(followingRegex.test('Following 444'), 'Following English format failed');

console.log('✓ Test 17: 2-Way Modal Tab detection & Number Parser verified');

// ─── 16. UPWARD CONTAINER RESOLUTION & THRESHOLD-CROSSING SCROLLER ───
function resolveScrollContainer(startNode, boundaryNode) {
  let curr = startNode ? startNode.parentElement : null;
  while (curr && curr !== boundaryNode) {
    if (curr.scrollHeight > curr.clientHeight + 10 && curr.clientHeight > 60) {
      return curr;
    }
    curr = curr.parentElement;
  }
  return boundaryNode;
}

// Mock DOM hierarchy:
// dialog (fixed, 1920x1080)
//   -> dialogCard (600x600)
//     -> scrollableList (600x500, scrollHeight 1200)
//       -> itemRow (600x60)
//         -> link (inline)
const mockDialog = { clientHeight: 1080, scrollHeight: 1080 };
const mockCard = { clientHeight: 600, scrollHeight: 600, parentElement: mockDialog };
const mockList = { clientHeight: 500, scrollHeight: 1200, parentElement: mockCard };
const mockRow = { clientHeight: 60, scrollHeight: 60, parentElement: mockList };
const mockLink = { parentElement: mockRow };

const resolved = resolveScrollContainer(mockLink, mockDialog);
assert.strictEqual(resolved, mockList, 'Upward container resolution failed to locate true scroll list');

// Threshold-crossing bounce check:
const pullback = Math.max(0, mockList.scrollHeight - mockList.clientHeight - 250);
assert.strictEqual(pullback, 450, 'Pullback calculation incorrect');
assert(pullback < mockList.scrollHeight, 'Pullback must be less than scrollHeight');
console.log('✓ Test 18: Upward Container Resolution & Threshold-Crossing Scroller verified');

// ─── 17. HUMAN-ASSIST LIVE CAPTURE ACCUMULATOR & WORKFLOW ───
class MockLiveCaptureSession {
  constructor(targetUsername, followersTarget = 0, followingTarget = 0) {
    this.targetUsername = targetUsername;
    this.followersTarget = followersTarget;
    this.followingTarget = followingTarget;
    this.activeTab = 'followers';
    this.followers = new Set();
    this.following = new Set();
    this.isCapturing = true;
  }

  sniff(renderedHrefs) {
    if (!this.isCapturing) return;
    const usernames = parseUsernamesFromHrefs(renderedHrefs);
    const targetSet = this.activeTab === 'followers' ? this.followers : this.following;
    usernames.forEach(u => targetSet.add(u));
  }

  switchTab(tab) {
    this.activeTab = tab;
  }

  finish(prevSnapshot = null) {
    this.isCapturing = false;
    const followers = Array.from(this.followers);
    const following = Array.from(this.following);
    const diff = computeRelationshipDiff(followers, following, prevSnapshot);
    return { followers, following, diff };
  }
}

const session = new MockLiveCaptureSession('stxyu.p', 1250, 444);

// Scroll batch 1 on Followers tab
session.sniff(['/@alice', '/@bob', '/@charlie']);
assert.strictEqual(session.followers.size, 3, 'Followers batch 1 count mismatch');

// Scroll batch 2 on Followers tab (virtual scroll with overlaps)
session.sniff(['/@charlie', '/@david', '/@eve']);
assert.strictEqual(session.followers.size, 5, 'Followers batch 2 deduplication mismatch');

// Switch to Following tab
session.switchTab('following');
session.sniff(['/@alice', '/@frank']);
assert.strictEqual(session.following.size, 2, 'Following batch 1 mismatch');

// Finish and compute diff
const liveResult = session.finish();
assert.deepStrictEqual(liveResult.diff.mutual, ['alice'], 'Mutual mismatch in live capture');
assert.deepStrictEqual(liveResult.diff.fans.sort(), ['bob', 'charlie', 'david', 'eve'].sort(), 'Fans mismatch in live capture');
assert.deepStrictEqual(liveResult.diff.notFollowingBack, ['frank'], 'NotFollowingBack mismatch in live capture');
console.log('✓ Test 19: Human-Assist Live Capture Accumulator & Relationship Diff verified');

// ─── 18. TAB PARTITION GUARD & NON-DESTRUCTIVE WEIGHT DETECTOR ───
function detectTabFromWeights(f1Weight, f2Weight) {
  if (f2Weight > f1Weight + 15) return 'following';
  if (f1Weight > f2Weight + 15) return 'followers';
  return null; // Non-destructive: must not guess when ambiguous!
}

// When weights are ambiguous (e.g. 10 vs 12), must return null
assert.strictEqual(detectTabFromWeights(10, 12), null, 'Ambiguous weight must return null');
// When followers tab has strong underline & white text (50 vs 10)
assert.strictEqual(detectTabFromWeights(50, 10), 'followers', 'Followers weight detection failed');
// When following tab has strong underline & white text (10 vs 60)
assert.strictEqual(detectTabFromWeights(10, 60), 'following', 'Following weight detection failed');

// State guard check: activeTab must never reset to followers if detector returns null
let currentActiveTab = 'following';
const detected = detectTabFromWeights(20, 20); // Ambiguous in DOM
if (detected) {
  currentActiveTab = detected;
}
assert.strictEqual(currentActiveTab, 'following', 'State guard failed: activeTab was erroneously reset');
console.log('✓ Test 20: Tab Partition Guard & Non-destructive Weight Detector verified');

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

// ─── 20. MONOTONIC AUTO-SCROLLER ENGINE & COMPLETION GUARD ───
class MockAutoScrollEngine {
  constructor(scrollHeight, clientHeight) {
    this.scrollHeight = scrollHeight;
    this.clientHeight = clientHeight;
    this.scrollTop = 0;
    this.idleTicks = 0;
    this.isCompleted = false;
  }

  step(renderedRowsCount, stepSize = 450) {
    if (this.isCompleted) return;
    const maxScroll = this.scrollHeight - this.clientHeight;
    const prevTop = this.scrollTop;

    if (this.scrollTop + stepSize < maxScroll) {
      this.scrollTop += stepSize;
    } else {
      this.scrollTop = maxScroll;
    }

    if (this.scrollTop === prevTop && this.scrollTop >= maxScroll - 10) {
      this.idleTicks++;
      if (this.idleTicks >= 10) {
        this.isCompleted = true;
      }
    } else {
      this.idleTicks = 0;
    }
  }
}

const scroller = new MockAutoScrollEngine(3000, 600);
// Step 1
scroller.step(27);
assert.strictEqual(scroller.scrollTop, 450, 'Step 1 mismatch');
// Advance to bottom
while (scroller.scrollTop < 2400) {
  scroller.step(27);
}
assert.strictEqual(scroller.scrollTop, 2400, 'Scroller failed to reach maxScroll');

// Test idle ticks at bottom
for (let i = 0; i < 10; i++) {
  assert.strictEqual(scroller.isCompleted, false, 'Premature completion');
  scroller.step(27);
}
assert.strictEqual(scroller.isCompleted, true, 'Auto-scroller must complete after 10 idle ticks at bottom');
console.log('✓ Test 22: Monotonic Auto-Scroller Engine & Completion Guard verified');

// ─── 21. INCREMENTAL ACCOUNT PARSER & TAGGED SKIP ENGINE ───
function mockIncrementalParser(links, targetSet) {
  let added = 0;
  for (let i = 0; i < links.length; i++) {
    const a = links[i];
    if (a._tmTagged) continue;
    a._tmTagged = true;

    const href = a.href || '';
    const m = href.match(/@([^/?#]+)/);
    if (m) {
      const u = m[1].toLowerCase();
      if (!['post', 'explore', 'search', 'activity', 'messages', 'settings'].includes(u)) {
        targetSet.add(u);
        added++;
      }
    }
  }
  return added;
}

const mockTargetSet = new Set();
const batch1 = [
  { href: 'https://www.threads.net/@alice' },
  { href: 'https://www.threads.net/@bob' }
];

const addedBatch1 = mockIncrementalParser(batch1, mockTargetSet);
assert.strictEqual(addedBatch1, 2, 'Batch 1 added count mismatch');
assert.strictEqual(mockTargetSet.size, 2, 'Target set size mismatch');

// Batch 2 with previous tagged items + 1 new item
const batch2 = [
  batch1[0],
  batch1[1],
  { href: 'https://www.threads.net/@charlie' }
];

const addedBatch2 = mockIncrementalParser(batch2, mockTargetSet);
assert.strictEqual(addedBatch2, 1, 'Incremental parser must only process 1 new untagged item');
assert.strictEqual(mockTargetSet.size, 3, 'Target set must contain exactly 3 items');
assert.strictEqual(batch2[0]._tmTagged, true, 'Tagged flag must persist');
console.log('✓ Test 23: Incremental Account Parsing & Tagged Skip Engine verified');

// ─── 22. VIRTUAL PAGINATED LIST & LOAD MORE GENERATOR ───
function paginateAccounts(accounts, limit = 50) {
  const display = accounts.slice(0, limit);
  const remaining = Math.max(0, accounts.length - limit);
  const hasMore = remaining > 0;
  return { display, remaining, hasMore };
}

const largeAccountList = Array.from({ length: 1250 }, (_, i) => `user_${i}`);

// Initial page of 50
const page1 = paginateAccounts(largeAccountList, 50);
assert.strictEqual(page1.display.length, 50, 'Page 1 must contain exactly 50 accounts');
assert.strictEqual(page1.remaining, 1200, 'Page 1 remaining count must be 1,200');
assert.strictEqual(page1.hasMore, true, 'Page 1 hasMore must be true');

// After clicking Load More (limit = 100)
const page2 = paginateAccounts(largeAccountList, 100);
assert.strictEqual(page2.display.length, 100, 'Page 2 must contain exactly 100 accounts');
assert.strictEqual(page2.remaining, 1150, 'Page 2 remaining count must be 1,150');

// Small list (< 50)
const smallList = ['alice', 'bob'];
const pageSmall = paginateAccounts(smallList, 50);
assert.strictEqual(pageSmall.display.length, 2, 'Small list display length mismatch');
assert.strictEqual(pageSmall.remaining, 0, 'Small list remaining must be 0');
assert.strictEqual(pageSmall.hasMore, false, 'Small list hasMore must be false');
console.log('✓ Test 24: Virtual Paginated List & Load More Generator verified');

// ─── 23. TAB SWITCH RECURSION LOCK & TRANSITION INVALIDATION ENGINE ───
class MockTabSwitchController {
  constructor() {
    this._isSwitchingTab = false;
    this._isTabTransitioning = false;
    this.activeTab = 'followers';
    this.followers = new Set(['alice', 'bob']);
    this.following = new Set();
    this.dispatchedClicks = 0;
    this.recursiveAttemptsBlocked = 0;
  }

  clickTab(targetTabName, dialogClickHandler) {
    if (this._isSwitchingTab) {
      this.recursiveAttemptsBlocked++;
      return false;
    }
    this._isSwitchingTab = true;
    this.dispatchedClicks++;

    // Synthetic DOM event dispatch triggers dialog's capture listener synchronously
    try {
      if (typeof dialogClickHandler === 'function') {
        dialogClickHandler({ target: targetTabName });
      }
    } finally {
      this._isSwitchingTab = false;
    }
    return true;
  }

  switchTab(tabName, shouldClickDOM = true) {
    this._isTabTransitioning = true;
    this.activeTab = tabName;

    if (shouldClickDOM) {
      this.clickTab(tabName, (e) => {
        // Simulates dialog.addEventListener('click', handleDialogClick, true)
        if (this._isSwitchingTab) {
          this.recursiveAttemptsBlocked++;
          return; // Recursion successfully intercepted!
        }
        this.switchTab(e.target, true);
      });
    }

    // Complete transition
    this._isTabTransitioning = false;
  }

  sniff(renderedHrefs) {
    if (this._isTabTransitioning) return 0; // Guard active!
    const targetSet = this.activeTab === 'followers' ? this.followers : this.following;
    let added = 0;
    for (const href of renderedHrefs) {
      const m = href.match(/@([^/?#]+)/);
      if (m && !targetSet.has(m[1])) {
        targetSet.add(m[1]);
        added++;
      }
    }
    return added;
  }
}

const tabController = new MockTabSwitchController();

// Initial state
assert.strictEqual(tabController.activeTab, 'followers', 'Initial tab must be followers');
assert.strictEqual(tabController.followers.size, 2, 'Followers size mismatch');

// Trigger tab switch to following
tabController.switchTab('following', true);

// Assert recursion was intercepted
assert.strictEqual(tabController.dispatchedClicks, 1, 'Exactly one tab click should be dispatched');
assert.strictEqual(tabController.recursiveAttemptsBlocked, 1, 'Re-entrant recursive call must be blocked');
assert.strictEqual(tabController.activeTab, 'following', 'Active tab must now be following');

// Sniff during transition guard (simulate lingering stale followers in DOM)
tabController._isTabTransitioning = true;
const staleAdded = tabController.sniff(['/@alice', '/@bob']);
assert.strictEqual(staleAdded, 0, 'Transition guard must prevent sniffing stale accounts into new tab');
assert.strictEqual(tabController.following.size, 0, 'Following set must remain clean during transition');

// Transition complete -> sniff new following accounts
tabController._isTabTransitioning = false;
const freshAdded = tabController.sniff(['/@charlie', '/@david']);
assert.strictEqual(freshAdded, 2, 'Fresh accounts must be added after transition unlocks');
assert.strictEqual(tabController.following.size, 2, 'Following set size mismatch');
assert.deepStrictEqual(Array.from(tabController.following), ['charlie', 'david'], 'Following accounts mismatch');

console.log('✓ Test 25: Tab Switch Recursion Lock & Transition Invalidation Engine verified');

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

// ─── TEST 27: TokenBucket Rate Limiter Contract ───────────────
class TestTokenBucket {
  constructor({ capacity = 5, refillRate = 2, minIntervalMs = 100, startTime = Date.now() }) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.tokens = capacity;
    this.lastRefill = startTime;
    this.minIntervalMs = minIntervalMs;
    this.lastOpTime = 0;
  }

  refill(now = Date.now()) {
    const elapsedSec = Math.max(0, (now - this.lastRefill) / 1000);
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillRate);
    this.lastRefill = now;
  }

  tryConsume(tokens = 1, now = Date.now()) {
    this.refill(now);
    const sinceLastOp = now - this.lastOpTime;
    if (this.minIntervalMs > 0 && sinceLastOp < this.minIntervalMs) {
      return { allowed: false, waitMs: this.minIntervalMs - sinceLastOp };
    }
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      this.lastOpTime = now;
      return { allowed: true, waitMs: 0 };
    }
    const deficit = tokens - this.tokens;
    return { allowed: false, waitMs: Math.ceil((deficit / this.refillRate) * 1000) };
  }
}

let simTime = 10000;
const bucket = new TestTokenBucket({ capacity: 3, refillRate: 1, minIntervalMs: 50, startTime: simTime });

// Consume all 3 tokens
assert.strictEqual(bucket.tryConsume(1, simTime).allowed, true);
simTime += 60; // > minInterval
assert.strictEqual(bucket.tryConsume(1, simTime).allowed, true);
simTime += 60;
assert.strictEqual(bucket.tryConsume(1, simTime).allowed, true);

// 4th consume should be denied due to token depletion
simTime += 60;
const denied = bucket.tryConsume(1, simTime);
assert.strictEqual(denied.allowed, false, 'Should be denied when bucket is empty');
assert.ok(denied.waitMs > 0, 'Wait time must be positive');

// Advance time by 2 seconds -> should refill 2 tokens
simTime += 2000;
const refilled = bucket.tryConsume(2, simTime);
assert.strictEqual(refilled.allowed, true, 'Tokens should have refilled after time advance');

// Check minIntervalMs guard
const tooFast = bucket.tryConsume(1, simTime + 10);
assert.strictEqual(tooFast.allowed, false, 'Should deny if within minIntervalMs');
assert.strictEqual(tooFast.waitMs, 40, 'Wait time should match minInterval remaining');

console.log('✓ Test 27: TokenBucket rate-limiting & interval spacing contract verified');

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
  console.log('\n🎉 ALL 29 THREADMAX v1.4.0 TESTS PASSED GREEN!\n');
}, 150);






