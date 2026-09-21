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

console.log('\n🎉 ALL 18 THREADMAX v1.4.0 TESTS PASSED GREEN!\n');


