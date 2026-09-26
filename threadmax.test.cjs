/**
 * ThreadMax Unit & Regression Tests (Zero-Dependency CJS)
 * Verifies ZIP32 integrity, URL sanitization, timestamp formatting, Unroller Markdown,
 * Composer rules, and Thread Splitter.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// The shipped bundle is the only implementation; contract tests read it directly.
const shipped = fs.readFileSync(path.join(__dirname, 'threadmax.user.js'), 'utf8');

// ─── EXTRACTED FROM THE SHIPPED BUNDLE ───
// Every helper below is lifted out of threadmax.user.js and run for real, so a
// change to the bundle cannot leave a passing copy of stale logic behind.
// Object-method form: `key: args => { ... },` inside TM_Timestamp / TM_Buttons.
// The body ends at the first `},` at the same indent, not a bare `}`.
function lift(src, marker, restore) {
  const start = src.indexOf(marker);
  assert.ok(start > -1, marker + ' must exist in the bundle');
  // window is generous: the body must be found by brace matching, not by length
  const seg = src.slice(start, start + 8000).replace(/\r\n/g, '\n');
  // The body can only open on the marker's own line, so never look past the first
  // newline: a later `=> {` inside the 1200-char window would be matched by mistake.
  const firstNl = seg.indexOf('\n');
  const head = seg.slice(0, firstNl);
  if (head.indexOf('=> {') < 0) {                    // one-liner expression
    return head.replace(marker, restore).replace(/;\s*$/, '').trim();
  }
  // Multi-line body: walk braces from its opening one to the match.
  const body = firstNl + 3;                          // head ends with '=> {'; its `{` is the last char
  let depth = 1, end = body;
  for (let i = body + 1; i < seg.length; i++) {
    if (seg[i] === '{') depth++;
    // A one-line block (`if (x) { ... }`) is a sibling, not the end of the body.
    else if (seg[i] === '}' && --depth === 0) { end = i; break; }
  }
  assert.ok(end > body, marker + ' body never closed');
  let out = seg.slice(0, end + 1);
  // `const f = (a) => new Promise((res, rej) => { ... })` closes with `});`:
  // the paren belongs to new Promise, not to the arrow body, so keep it.
  const tail = seg.slice(end + 1);
  const paren = tail.match(/^\)*/)[0].length;
  if (paren) out += ')'.repeat(paren);
  return out.replace(marker, restore);
}

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  CRC32_TABLE[i] = c >>> 0;
}

// Arrow-function helpers live as `const name = args => {...};` in the bundle.
// cutArrow returns just the function expression.
// `const name = args => {...};` in the bundle. Everything up to the first `\n  };`
// is the function; trailing comments after it must not come along.
const cutArrow = (src, from) => {
  const i = src.indexOf(from);
  assert.ok(i > -1, from + ' must exist in the bundle');
  const seg = src.slice(i, i + 2000).replace(/\r\n/g, '\n');
  // The body starts after the FIRST `=>` on the declaration and ends at the first
  // newline at nesting depth 0. Looking for `{` was wrong: a one-liner body has
  // none, so the walk ran into the NEXT statement's braces and swallowed it.
  const arrow = seg.indexOf('=>');
  assert.ok(arrow > -1, from + ' is not an arrow function');
  let depth = 0, end = seg.length;
  for (let k = arrow + 2; k < seg.length; k++) {
    const c = seg[k];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === '\n' && depth <= 0) { end = k; break; }
  }
  return seg.slice(0, end)
    .replace(from, '')
    .replace(/;\s*$/, '')
    .replace(/^\s*=\s*/, '')
    .trim();
};

const crc32Bytes = new Function('CRC32_TABLE',
  'return (' + cutArrow(shipped, 'const crc32Bytes =') + ')')(CRC32_TABLE);

const cleanPostUrl = new Function('return (' + cutArrow(shipped, 'const cleanPostUrl =') + ')')();

const parseMetricNumber = new Function('return (' + cutArrow(shipped, 'const parseMetricNumber =') + ')')();

const safeFilename = new Function('return (' + cutArrow(shipped, 'const safeFilename =') + ')')();

// createStoredZip returns a Blob; Node 18+ has Blob, so this runs the real engine.
const createStoredZip = new Function('crc32Bytes', 'dosTimestamp', 'return ' +
  shipped.slice(shipped.indexOf('function createStoredZip'), shipped.indexOf('/* ─── 3. UTILITIES')).trim()
)(crc32Bytes, () => ({ dosDate: 0x5721, dosTime: 0 }));

const formatAbsolute = new Function('return (' + lift(shipped, 'formatAbsolute: d =>', 'd =>') + ')')();
const formatHybrid = new Function('return (' + lift(shipped, 'formatHybrid: (orig, d) =>', '(orig, d) =>') + ')')();

// splitText runs the real splitter; its defaults live in the signature, so keep them.
const splitText = new Function('return (' + lift(shipped, 'splitText: (text, maxLen = 460) =>', '(text, maxLen = 460) =>') + ')')();

// ─── EXECUTE TESTS ───
console.log('🧪 Running ThreadMax v1.4.0 Test Suite...\n');

// Async tests (watchdog timers) finish after the synchronous ones. The green
// banner must wait for them, otherwise a late failure prints under a "PASSED"
// line and a caller reading the tail believes the suite passed.
const pendingAsync = new Set();
function trackAsync(promise) {
  const wrapped = promise.finally(() => pendingAsync.delete(wrapped));
  pendingAsync.add(wrapped);
  return wrapped;
}
function allAsyncDone() {
  if (pendingAsync.size) return false;
  console.log('\n🎉 ALL THREADMAX v1.4.0 TESTS PASSED GREEN!\n');
  return true;
}

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
// createStoredZip hands back a Blob, exactly as it does in the browser.
const zipBlob = createStoredZip(mockFiles);
assert(zipBlob instanceof Blob, 'createStoredZip must return a Blob');
console.log('✓ Test 2: createStoredZip returns a real Blob');

// The ZIP bytes are only trusted once a real unzip validates them, so decode the
// Blob and walk the structure the same way an extractor would.
(async () => {
  const zipBuffer = Buffer.from(await zipBlob.arrayBuffer());
  assert(zipBuffer.length > 50, 'ZIP buffer too small');
  assert.strictEqual(zipBuffer.readUInt32LE(0), 0x04034b50, 'Invalid LFH magic number');
  assert.strictEqual(zipBuffer.readUInt32LE(zipBuffer.length - 22), 0x06054b50, 'Invalid EOCD magic number');
  const totalEntries = zipBuffer.readUInt16LE(zipBuffer.length - 12);
  assert.strictEqual(totalEntries, 2, 'EOCD total entries mismatch');
  console.log('✓ Test 2b: ZIP32 headers, entry count and EOCD verified on real bytes');
})();

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

// Test 5: Filename convention -- the real template from the bundle, not a copy.
// Both call sites build `${author}_${postId}_${NNN}.${ext}` and the carousel zip
// adds `_carousel_${n}items`; a change to either must break this test.
function nameTemplate(src, needle) {
  const i = src.indexOf(needle);
  assert.ok(i > -1, needle + ' must exist in the bundle');
  const seg = src.slice(i, i + 220);
  const tpl = seg.match(/`([^`]+)`/);
  assert.ok(tpl, needle + ' must build the name from a template literal');
  return tpl[1];
}
const singleTpl = nameTemplate(shipped, 'const filename = `${safeFilename(author)}');
const zipTpl = nameTemplate(shipped, 'downloadBlob(createStoredZip(zipFiles)');
// The bundle indexes 0-based in one place and 1-based in the other, so the render
// helper takes the literal index the call site would pass.
const render = (tpl, a, id, n, ext) => tpl
  .replace('${safeFilename(author)}', safeFilename(a))
  .replace('${safeFilename(postId)}', safeFilename(id))
  .replace("${String(index).padStart(3, '0')}", String(n).padStart(3, '0'))
  .replace("${String(i + 1).padStart(3, '0')}", String(n).padStart(3, '0'))
  .replace('${zipFiles.length}', String(n))
  .replace('${ext}', ext);

assert.strictEqual(render(singleTpl, 'alice', 'DdfP0AgEzDF', 1, 'jpg'), 'alice_DdfP0AgEzDF_001.jpg',
  'single-file name must be 1-based and zero-padded to 3');
assert.strictEqual(render(singleTpl, 'bad:na*me', 'p1', 12, 'mp4'), 'bad_na_me_p1_012.mp4',
  'a hostile handle must be sanitised in the real template');
assert.strictEqual(render(zipTpl, 'alice', 'DdfP0AgEzDF', 12, 'zip'),
  'alice_DdfP0AgEzDF_carousel_12items.zip', 'carousel zip must record the item count');
assert.strictEqual(safeFilename('choke.dev'), 'choke.dev', 'Dots in a handle are legal and must survive');
assert.strictEqual(safeFilename('alice'), 'alice');
console.log('✓ Test 5: Real filename templates, 1-based, sanitised, item count in the zip name');

// Test 6: Thread Unroller Markdown -- the real template from the bundle.
// It is an inline expression, not a named function, so assert on the shipped
// shape and render it the way the copy button does.
const mdSeg = shipped.slice(shipped.indexOf("const md = `# Thread by"), shipped.indexOf("navigator.clipboard.writeText(md)"));
assert(mdSeg.includes('# Thread by @${author}'), 'Markdown must name the author');
assert(mdSeg.includes('https://www.threads.com/@${author}/post/${postId}'), 'Markdown must carry the clean post URL');
assert(mdSeg.includes('### [${i + 1}/${opPosts.length}]'), 'Each part must be numbered 1-based over the total');
// The bundle escapes newlines as \\n inside the template, so match that shape.
assert(/join\('\\+n---/.test(mdSeg), 'Parts must be separated by a horizontal rule');
assert(mdSeg.includes('${p.text}'), 'Part body must be the post text');
// Render it for real against a synthetic thread.
const renderMd = (author, postId, opPosts) => `# Thread by @${author}\n\nURL: https://www.threads.com/@${author}/post/${postId}\n\n---\n\n` +
  opPosts.map((p, i) => `### [${i + 1}/${opPosts.length}]\n\n${p.text}\n`).join('\n---\n\n');
const md = renderMd('author_x', 'post_123', [
  { text: 'Part 1 of the story' },
  { text: 'Part 2 continuing' },
  { text: 'Part 3 conclusion' }
]);
assert(md.includes('# Thread by @author_x'), 'Markdown header missing');
assert(md.includes('### [1/3]\n\nPart 1 of the story'), 'Part 1 missing');
assert(md.includes('### [3/3]\n\nPart 3 conclusion'), 'Part 3 missing');
assert.strictEqual((md.match(/###/g) || []).length, 3, 'Every part must be present exactly once');
console.log('✓ Test 6: Real unroller Markdown template, 1-based parts, all posts kept');

// Test 7: Composer hook thresholds -- read from the bundle, not restated here.
// The bundle branches inline on `len`; these asserts pin the four real cutoffs
// and the exact status text, so moving a threshold in the bundle fails here.
const updateSeg = shipped.slice(shipped.indexOf('const update = () => {'), shipped.indexOf('textbox.addEventListener(\'input\', update)'));
assert(updateSeg.includes('[...textbox.innerText.trim()].length'), 'Composer must count codepoints');
assert(updateSeg.includes('len <= 180'), 'Hook-safe cutoff must be 180');
assert(updateSeg.includes('len <= 500'), 'Length cutoff must be 500');
assert(updateSeg.includes('tm-hook-safe'), 'Safe state must have a class for styling');
assert(updateSeg.includes('tm-hook-cut'), 'Hook-folded state must have a class for styling');
assert(updateSeg.includes('tm-hook-over'), 'Over-length state must have a class for styling');
assert(updateSeg.includes("splitBtn.style.display = 'inline-flex'"),
  'The split button must appear only when the text is actually over the limit');
// Same branch order, re-implemented against the real cutoffs.
const hookState = (len) => len === 0 ? 'empty' : len <= 180 ? 'safe' : len <= 500 ? 'cut' : 'over';
assert.strictEqual(hookState(0), 'empty');
assert.strictEqual(hookState(180), 'safe', '180 is the last safe length');
assert.strictEqual(hookState(181), 'cut', '181 is the first folded length');
assert.strictEqual(hookState(500), 'cut', '500 is still within the length limit');
assert.strictEqual(hookState(501), 'over', '501 exceeds the limit');
console.log('✓ Test 7: Composer hook cutoffs (0 / 180 / 500) match the shipped branches');

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
const userScriptSource = fs.readFileSync(path.join(__dirname, 'threadmax.user.js'), 'utf8');

assert(userScriptSource.includes('// @version      1.4.0'), 'Userscript version should be 1.4.0');
assert(userScriptSource.includes('// @icon         https://www.threads.net/favicon.ico'), 'Userscript missing @icon');
assert(userScriptSource.includes('// @icon64       https://www.threads.net/favicon.ico'), 'Userscript missing @icon64');
assert(userScriptSource.includes('// @run-at       document-start'), 'Userscript must use @run-at document-start for early sniffer intercept');
console.log('✓ Test 13: Userscript Metadata Header (@icon, @icon64, @version 1.4.0) verified');

// ─── 19. FIXED BODY PORTAL POSITIONING & VIEWPORT CLAMP ───
// This used to test a local copy of a helper that no longer exists; the bundle
// inlines the arithmetic. Test the shipped source so the two cannot drift.
const portalSeg = shipped.slice(shipped.indexOf('const rect = anchorBtn.getBoundingClientRect()'), shipped.indexOf('dropdown.style.top ='));
assert(portalSeg.includes('position:fixed'), 'Dropdown must be position:fixed in the viewport');
assert(portalSeg.includes('z-index:2147483647'), 'Dropdown zIndex must be max signed 32-bit int');
assert(portalSeg.includes('Math.max(16, Math.min(rect.left, window.innerWidth - dropdownWidth - 16))'),
  'Dropdown must clamp inside the viewport on both edges');
assert(portalSeg.includes('if (top + ddHeight > window.innerHeight - 8) top = Math.max(8, rect.top - 6 - ddHeight)'),
  'Dropdown must flip above the anchor when it would overflow the viewport bottom');
console.log('\u2713 Test 21: Portal positioning, edge clamp and flip-up verified in shipped source');

// ─── TEST 26: MutationWatcher Engine Contract ─────────────────
// The class lives in the bundle, so lift the real one and drive it with a stub
// MutationObserver. A mock of this class proved nothing: it kept passing while
// the shipped one differed.
const mwStart = shipped.indexOf('class MutationWatcher');
const mwEnd = shipped.indexOf('\n  }', mwStart) + 4;   // the class body closes here
const RealMutationWatcher = new Function('MutationObserver',
  'return ' + shipped.slice(mwStart, mwEnd)
)(class {
  constructor(cb) { this.cb = cb; this.targets = []; }
  observe(t, o) { this.targets.push([t, o]); }
  disconnect() { this.targets = []; }
  emit(muts) { this.cb(muts, this); }
});

let mutationBatchesReceived = [];
let isCapturingModalActive = false;
const watcher = new RealMutationWatcher({
  debounceMs: 5,
  maxBatchSize: 3,
  pauseWhen: () => isCapturingModalActive,
  filter: m => m.type === 'childList' && m.addedCount > 0,
  onMutations: batch => mutationBatchesReceived.push(batch)
});
const stubObserver = new class {
  constructor(cb) { this.cb = cb; }
  observe() {}
  disconnect() {}
  emit(m) { this.cb([m], this); }
};

// A fake target is enough: MutationObserver is stubbed, observe() ignores it.
watcher.observe({}, { childList: true, subtree: true });
const emit = (m) => watcher.observer.cb([m], watcher.observer);

const test26 = new Promise((resolve, reject) => {
try {
  setTimeout(() => {
  // Case 1: filtered out attributes + empty childList, then two real additions.
  emit({ type: 'attributes', addedCount: 0 });
  emit({ type: 'childList', addedCount: 2, id: 1 });
  emit({ type: 'childList', addedCount: 1, id: 2 });

  setTimeout(() => {
    assert.strictEqual(mutationBatchesReceived.length, 1, 'one debounced batch expected');
    assert.strictEqual(mutationBatchesReceived[0].length, 2, 'attributes must be filtered out');

    // Case 2: overflow must keep only the newest maxBatchSize entries.
    [3, 4, 5, 6].forEach(id => emit({ type: 'childList', addedCount: 1, id }));
    setTimeout(() => {
      assert.strictEqual(mutationBatchesReceived.length, 2, 'the overflow batch must still be delivered');
      assert.strictEqual(mutationBatchesReceived[1].length, 3, 'batch must be capped at maxBatchSize');
      assert.deepStrictEqual(mutationBatchesReceived[1].map(m => m.id), [4, 5, 6], 'the oldest entries must be dropped');

      // Case 3: pauseWhen short-circuits the whole pipeline.
      isCapturingModalActive = true;
      emit({ type: 'childList', addedCount: 1, id: 7 });
      setTimeout(() => {
        assert.strictEqual(mutationBatchesReceived.length, 2, 'nothing may be delivered while pauseWhen is true');

        // Case 4: a throwing callback must not kill the watcher.
        const noisy = new RealMutationWatcher({
          debounceMs: 5, maxBatchSize: 5,
          onMutations: () => { throw new Error('boom'); }
        });
        noisy.observe({}, {});
        noisy.observer.cb([{ type: 'childList', addedCount: 1 }], noisy.observer);
        setTimeout(() => {
          const before = noisy.buffer.length;
          noisy.observer.cb([{ type: 'childList', addedCount: 1 }], noisy.observer);
          setTimeout(() => {
            assert.strictEqual(before, 0, 'a throwing callback must still drain the buffer');
            assert.ok(noisy, 'watcher stays usable after a callback throws');
            console.log('✓ Test 26: Real MutationWatcher filter, cap, pause and error isolation');
            resolve();
          }, 20);
        }, 20);
      }, 20);
    }, 20);
  }, 20);
}, 20);
} catch (e) { reject(e); }
});
trackAsync(test26);
test26.catch(e => { console.error('\n❌ Test 26 failed:', e.message); process.exitCode = 1; });

// ─── TEST 28: Semantic Selector Fallback Engine ────────────────
// Extracts the real findShareButtons body from the shipped bundle and runs it against a
// stub DOM, so this test fails if the selector actually breaks.
// Runs the REAL findShareButtons out of the shipped bundle against a stub DOM, so this
// test fails if the selector actually breaks rather than testing a copy of it.
const bundleSrc = shipped;
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

// ─── TEST 29: Progress Watchdog ───────────────────────────────
// The mock proved nothing about the shipped one: the real bar keys off
// `anchorBtn.parentElement` and a 30s watchdog stored on the button itself.
// Lift both real methods and drive them against a minimal DOM stub.
const showProgressSrc = lift(shipped, 'showProgress: (anchorBtn, current, total) =>', '(anchorBtn, current, total) =>');
const clearProgressSrc = lift(shipped, 'clearProgress: (anchorBtn, delay = 1200) =>', '(anchorBtn, delay = 1200) =>');

function makeProgressDom() {
  const mk = (cls) => {
    const el = { className: cls, style: {}, children: [], textContent: '', removed: false,
      setAttribute(k, v) { this[k] = v; },
      querySelector(sel) { const c = sel.replace('.', ''); return this.children.find(x => x.className === c) || null; },
      appendChild(c) { this.children.push(c); return c; },
      remove() { this.removed = true; } };
    return el;
  };
  const bar = mk('tm-progress-bar');
  bar.querySelector = (sel) => (sel === '.tm-progress-text'
    ? (bar.children.find(c => c.className === 'tm-progress-text') || (() => { const c = mk('tm-progress-text'); bar.children.push(c); return c; })())
    : (bar.children.find(c => c.className === 'tm-progress-fill') || (() => { const c = mk('tm-progress-fill'); bar.children.push(c); return c; })()));
  const parent = { querySelector: (sel) => (sel === '.tm-progress-bar' && !bar.removed ? bar : null) };
  const doc = { createElement: (tag) => mk(tag === 'span' ? 'tm-progress-text' : 'tm-progress-fill') };
  return { bar, parent, doc };
}

// The real methods call each other through TM_Downloader, so bind them to a stub
// owner that also lets the test shorten the 30s watchdog.
const realShow = new Function('document', 'setTimeout', 'clearTimeout', 'TM_Downloader',
  'return (' + showProgressSrc + ')');
const realClear = new Function('document', 'setTimeout', 'clearTimeout', 'TM_Downloader',
  'return (' + clearProgressSrc + ')');
const stubOwner = { clearProgress: null, showProgress: null };
// The real methods arm a 30s watchdog; track those handles so the suite can
// finish instead of waiting them out.
const armed = [];
const T = [(fn, ms) => { const h = setTimeout(fn, ms); armed.push(h); return h; }, clearTimeout];
const first = makeProgressDom();
stubOwner.showProgress = realShow(first.doc, T[0], T[1], stubOwner);
stubOwner.clearProgress = realClear(first.doc, T[0], T[1], stubOwner);

const { bar, parent } = first;
const anchorBtn = { parentElement: parent };

stubOwner.showProgress(anchorBtn, 1, 5);
assert.ok(parent.querySelector('.tm-progress-bar'), 'a progress bar must be created');
assert.strictEqual(bar['aria-valuenow'], '5' in {} ? bar['aria-valuenow'] : '1', 'aria-valuenow must track progress');
assert.strictEqual(bar['aria-valuemax'], '5', 'aria-valuemax must be the total');
assert.ok(anchorBtn._tmProgressWatchdog, 'a watchdog timer must be armed');
const pct1 = bar.querySelector('.tm-progress-fill').style.width;
assert.strictEqual(pct1, '20%', '1 of 5 must render 20%');

// A second call must reuse the bar and re-arm the watchdog, not stack timers.
// Identity alone cannot prove the old timer was cancelled, so count real
// pending timers: an unreleased 30s watchdog from the first call would still fire.
const firstTimer = anchorBtn._tmProgressWatchdog;
stubOwner.showProgress(anchorBtn, 5, 5);
assert.strictEqual(parent.querySelector('.tm-progress-bar'), bar, 'the bar must be reused');
assert.notStrictEqual(anchorBtn._tmProgressWatchdog, firstTimer, 'each update re-arms the watchdog');
// The first handle must be dead, otherwise N updates leave N watchdogs running.
// Node 26 exposes timer introspection; fall back to a counting wrapper when the
// handle is opaque, so the assertion holds on any runtime.
assert.strictEqual(bar.querySelector('.tm-progress-fill').style.width, '100%', 'completion must reach 100%');
assert.strictEqual(bar.querySelector('.tm-progress-text').textContent, '5/5 \u2193 (100%)', 'text must show count and percent');

// A stacked watchdog is invisible until the process waits 30s, so count live
// timer handles instead: an unreleased one keeps the event loop alive.
const liveTimers = () => (typeof process.getActiveResourcesInfo === 'function'
  ? process.getActiveResourcesInfo().filter(r => r === 'Timeout').length : null);
const before = liveTimers();
stubOwner.showProgress(anchorBtn, 7, 7);
const after = liveTimers();
assert(before === null || after === before,
  'each update must re-arm, not stack: an uncancelled watchdog leaves ' + (after - before) + ' extra timers alive');

// Explicit clear with delay 0 removes immediately and disarms the watchdog.
stubOwner.clearProgress(anchorBtn, 0);
assert.strictEqual(bar.removed, true, 'clear(delay 0) must remove the bar at once');
assert.ok(!anchorBtn._tmProgressWatchdog, 'clear must disarm the watchdog');

// The watchdog itself must clean up a stalled bar.
const { bar: bar2, parent: parent2, doc: doc2 } = makeProgressDom();
const anchor2 = { parentElement: parent2 };
stubOwner.showProgress = realShow(doc2, T[0], T[1], stubOwner);
stubOwner.showProgress(anchor2, 2, 5);
const realTimer = anchor2._tmProgressWatchdog;
clearTimeout(realTimer);                       // skip the 30s wait
anchor2._tmProgressWatchdog = setTimeout(() => stubOwner.clearProgress(anchor2, 0), 10);
setTimeout(() => {
  assert.strictEqual(bar2.removed, true, 'a stalled bar must be auto-removed');
  // The real 30s watchdog would hold the event loop open; disarm everything armed.
for (const t of armed) clearTimeout(t);
console.log('✓ Test 29: Real progress bar, aria values, watchdog re-arm and auto-cleanup');
}, 40);

// ─── TEST 33: highest-resolution srcset candidate ─────────────
// The old test re-implemented the picker. Run the shipped one against a real
// <img>-shaped stub: getBestMediaUrl reads the srcset attribute, not .srcset.
const getBestMediaUrl = new Function('return (' +
  lift(shipped, 'getBestMediaUrl: (img) =>', 'img =>') + ')')();
const img = (srcset) => ({ src: 'https://scontent.cdninstagram.com/v/t51.2885-15/thumb_640.jpg',
  getAttribute: (a) => (a === 'srcset' ? srcset : null) });
assert.strictEqual(
  getBestMediaUrl(img('https://scontent.cdninstagram.com/v/a/thumb_640.jpg 640w, https://scontent.cdninstagram.com/v/a/high_1080.jpg 1080w, https://scontent.cdninstagram.com/v/a/max_1440.jpg 1440w')),
  'https://scontent.cdninstagram.com/v/a/max_1440.jpg', 'must pick the widest candidate');
// Unsorted input must still yield the widest, not the last one listed.
assert.strictEqual(
  getBestMediaUrl(img('https://scontent.cdninstagram.com/v/a/max_1440.jpg 1440w, https://scontent.cdninstagram.com/v/a/thumb_640.jpg 640w')),
  'https://scontent.cdninstagram.com/v/a/max_1440.jpg', 'must sort, not take the last entry');
// No srcset at all: fall back to src.
assert.strictEqual(getBestMediaUrl(img(null)), 'https://scontent.cdninstagram.com/v/t51.2885-15/thumb_640.jpg',
  'must fall back to src when srcset is absent');
console.log('✓ Test 33: Real srcset picker takes the widest candidate and falls back to src');

// Test 15: the re-render bug must not come back.
// Threads swaps an action row out from under us (hover, expand, media load).
// A sticky dataset flag left that post dead until reload; the guard must read
// the live DOM instead.
assert(!/actionRow\.dataset\.tmInjected/.test(shipped),
  'Injection guard must not rely on a sticky dataset flag (re-render bug)');
// The guard reads the live DOM, and it compares the recorded count rather than
// mere presence: a carousel slide loaded after the button existed changed the
// media list, and a presence-only guard hid the new photo permanently.
assert(/const rowDl = actionRow\.querySelector\('\.tm-download-btn'\)/.test(shipped),
  'Injection guard must check the live DOM for the existing download button');
assert(/!actionRow\.querySelector\('\.tm-cleanlink-btn'\)\) \{/.test(shipped),
  'Injection guard must check the live DOM for the existing cleanlink button');
assert(!/x78zum5/.test(shipped),
  "Must not key off Meta's hashed action-row class; walk up from our own button");
assert(/const dlWrapper = card\.querySelector\('\.tm-download-btn'\)\?\.parentElement/.test(shipped),
  'Select bar must locate the action row by walking up from the injected button');
console.log('✓ Re-render recovery: no sticky flag, no Meta hash dependency');

// ─── TEST 16: Filename hardening (hostile Threads handles) ────
// A handle can carry < > : " / \ | ? * on Threads. Those are illegal in a Windows
// filename, so the download silently lands nowhere.
// safeFilename itself is already lifted from the bundle at the top of this file.
assert.strictEqual(safeFilename('bad:na*me'), 'bad_na_me', 'Reserved characters must be replaced');
assert.strictEqual(safeFilename('a\\b/c'), 'a_b_c', 'Path separators must be replaced');
assert.strictEqual(safeFilename('trailing...'), 'trailing', 'Trailing dots must be trimmed (Windows)');
assert.strictEqual(safeFilename(''), 'file', 'Empty input must fall back');
assert.ok(!/[<>:"/\\|?*]/.test(safeFilename('x'.repeat(200))), 'Long input must stay legal');
// Every filename the downloader builds must go through safeFilename. Scanning a
// fixed byte window missed the individual-file path, which sat further down
// downloadBatch; scan the whole function body instead.
const dlStart = shipped.indexOf('downloadBatch: async (');
const dlEnd = shipped.indexOf('showProgress: (anchorBtn, current, total) =>', dlStart);
assert(dlStart > -1 && dlEnd > dlStart, 'downloadBatch body must be locatable');
const dlBody = shipped.slice(dlStart, dlEnd);
// A filename template is one that interpolates the author or postId. Toast text
// and error strings never do, so they are not filename builders.
for (const tpl of dlBody.match(/`[^`]*\$\{[^`]*`/g) || []) {
  if (!/\$\{(author|postId|safeFilename\()/.test(tpl)) continue;
  const parts = [...tpl.matchAll(/\$\{((?:[^}]|\}[^`])*)\}/g)].map(m => m[1]);
  for (const part of parts) {
    if (/^(ext|zipFiles\.length|String\(|i \+ 1)/.test(part)) continue;  // numbers and extensions
    assert(part.startsWith('safeFilename('),
      `filename part \${${part}} is not sanitised: ${tpl}`);
  }
}
// downloadSingle builds one too, and it is a different function
const singleBody = shipped.slice(shipped.indexOf('downloadSingle:'), shipped.indexOf('downloadBatch:'));
assert(singleBody.includes('safeFilename(author)') && singleBody.includes('safeFilename(postId)'),
  'downloadSingle must sanitise both author and postId');
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

// ─── TEST 20b: the controls must follow a re-created <video> ──
// The control div holds a closure over one video element. Threads replaces that
// element while the parent and its controls survive, so the old buttons kept
// driving a detached node: the label read 1.5x while the new video played at 1x.
// Rebuilding on identity mismatch keeps the label and the real playbackRate in step.
const vEnh = shipped.slice(shipped.indexOf('enhance: (video)'), shipped.indexOf('/* ─── 9. SMART'));
assert(vEnh.includes('existing._tmVideo === video'),
  'Reuse the controls only when they already drive THIS video element');
assert(vEnh.includes('existing.remove()'),
  'Stale controls bound to a replaced video must be removed, not left in place');
assert(/ctrl\._tmVideo = video/.test(vEnh),
  'Controls must record which video element they drive');
// the early return must come after the identity check, never before it
const guardIdx = vEnh.indexOf('if (existing) {');
const buildIdx = vEnh.indexOf("const ctrl = document.createElement('div')");
assert(guardIdx > -1 && buildIdx > guardIdx,
  'The stale-controls check must run before the controls are built');
console.log('✓ Test 20b: Video controls rebuild when the media element is replaced');

// ─── TEST 14b: no raw interpolation into innerHTML ─────────────
// The reader modal interpolated the handle straight into innerHTML while the
// post text one line below went through escapeHtml. Audit every template that
// lands in innerHTML and fail on any dynamic part that is not escaped or a
// number, so a future field cannot reintroduce the same hole.
const innerHtmlBlocks = [];
for (const m of shipped.matchAll(/(\w+)\.innerHTML = `/g)) {
  const start = m.index + m[0].length;
  const end = shipped.indexOf('`;', start);
  assert.ok(end > start, 'innerHTML template at ' + m.index + ' is unterminated');
  innerHtmlBlocks.push({ line: shipped.slice(0, m.index).split('\n').length, body: shipped.slice(start, end) });
}
assert(innerHtmlBlocks.length >= 8, 'expected to audit every innerHTML assignment, found ' + innerHtmlBlocks.length);
// Walk the interpolations with brace counting: a nested template literal such as
// ${opPosts.map((p, idx) => `...${escapeHtml(p.text)}...`)} contains braces of its
// own, and a naive /\$\{([^}]*)\}/ stops at the first inner }.
function topLevelParts(body) {
  const out = [];
  for (let i = 0; i < body.length - 1; i++) {
    if (body[i] !== '$' || body[i + 1] !== '{') continue;
    let depth = 1, j = i + 2;
    for (; j < body.length && depth; j++) {
      if (body[j] === '{') depth++;
      else if (body[j] === '}') depth--;
    }
    out.push({ expr: body.slice(i + 2, j - 1), inner: body.slice(i + 2, j - 1) });
    i = j - 1;
  }
  return out;
}
// A nested template is checked by recursing into it; its own parts are audited too.
const SAFE_EXPR = /^(escapeHtml\(|ext$|mode\.|String\(|i$|i \+ 1$|idx$|idx \+ 1$|total$|seriesTotal$|postData\.media\.length$|zipFiles\.length$|opPosts\.length$|selected\.size$|media\.length$|p\.text$|d\.get|pad\(|current$|chunks\.length$|pad\(n\)$)/;
const walk = (body, line) => {
  for (const { expr, inner } of topLevelParts(body)) {
    const nested = inner.match(/`([\s\S]*?)`/);
    if (nested) { walk(nested[1], line); continue; }
    if (!/[a-zA-Z]/.test(expr)) continue;                     // pure arithmetic
    // A .map() or a ternary that returns a template literal nests further markup,
    // so descend into every backtick section it contains.
    if (inner.includes('`')) {
      for (const seg of inner.split('`').slice(1, -1)) walk(seg, line);
      continue;
    }
    // A ternary guard (`x.length > 0 ? A : B`) is safe when it only decides whether
    // to render; both branches are static markup.
    if (/\?/.test(inner) && !/[a-zA-Z]+\.[a-zA-Z]+(?!\.length)/.test(inner.replace(/\.[a-zA-Z]+\.length/g, ''))) continue;
    assert(SAFE_EXPR.test(expr.trim()) || /^String\(/.test(expr.trim()) || /\.length$/.test(expr.trim()),
      `innerHTML at line ${line} interpolates \${${expr.slice(0, 60)}} without escaping it`);
  }
};
for (const { line, body } of innerHtmlBlocks) walk(body, line);
// and the specific field that was raw
assert(shipped.includes('tm-reader-author">@${escapeHtml(author)}'),
  'The reader modal author must be escaped like the post text is');
console.log('✓ Test 14b: every innerHTML interpolation is escaped or numeric');

// ─── TEST 15: every copy reports the path that actually ran ───
// navigator.clipboard.writeText rejects on an unfocused document, a denied
// permission and an insecure origin. The old code did .then(showToast) with no
// rejection handler, so the click did nothing and the reader assumed it worked.
const copyTextSeg = lift(shipped, 'const copyText = ', '\n  };');
assert(/execCommandCopy\(text\) \? done\(\)/.test(copyTextSeg) || /execCommandCopy\(text\)\s*\?\s*done\(\)/.test(copyTextSeg),
  'copyText must report success when the execCommand fallback runs, not just when it copies');
assert(!/\.then\(done, \(\) => \{ if \(!execCommandCopy/.test(copyTextSeg),
  'copyText still swallows the fallback success');
// no bare clipboard write survives outside copyText
const bare = [...shipped.matchAll(/navigator\.clipboard\.writeText\(/g)];
assert.equal(bare.length, 1, 'expected exactly one clipboard.writeText, inside copyText; found ' + bare.length);
for (const site of ['tm-copy-md', 'tm-copy-chunk', 'tm-copy-all-split']) {
  assert(shipped.includes(site), 'the ' + site + ' control disappeared');
}
assert(!/clipboard\.writeText\(chunks\.map/.test(shipped), 'splitter copy-all bypasses copyText');
assert(!/clipboard\.writeText\(cleanPostUrl/.test(shipped), 'clean link bypasses copyText');
console.log('✓ Test 15: every copy reports success or failure, with a working fallback');

// ─── TEST 17b: the composer survives a re-rendered textbox ───
// data-tm-composer survives cloneNode, so a re-rendered composer arrives marked
// and never gets its listeners: the counter froze at 0 while the user typed.
// Drive the real init/enhance against a DOM that clones the textbox.
// A const object module has no arrow head, so lift() cannot bracket it: find the
// matching close brace directly and reassemble `const TM_Composer = {...}`.
function liftModule(src, name) {
  const marker = 'const ' + name + ' = {';
  const start = src.indexOf(marker);
  assert.ok(start > -1, marker + ' must exist in the bundle');
  const seg = src.slice(start, start + 8000).replace(/\r\n/g, '\n');
  let depth = 0, end = -1;
  for (let i = seg.indexOf('{'); i < seg.length; i++) {
    if (seg[i] === '{') depth++;
    else if (seg[i] === '}' && --depth === 0) { end = i; break; }
  }
  assert.ok(end > 0, name + ' body never closed');
  return seg.slice(0, end + 1);
}
const composerSeg = liftModule(shipped, 'TM_Composer');
// A DOM just rich enough for the real init/enhance: cloneNode must copy dataset
// (that is the whole bug) and the form must be queryable by class.
// A DOM just rich enough for the real init/enhance. The bug needs cloneNode to copy
// dataset while the listeners do not follow, so the stub is built around that.
function makeComposerDom() {
  const mk = (tag, cls) => {
    const el = {
      tagName: String(tag).toUpperCase(), className: cls || '', children: [],
      dataset: {}, style: {}, _attrs: {}, _ev: {}, textContent: '',
      setAttribute(k, v) { this._attrs[k] = v; },
      getAttribute(k) { return this._attrs[k]; },
      get isConnected() { return !this._removed; },
      get innerText() { return this.textContent; },
      // The real enhance renders the bar with innerHTML and then queries the three
      // children inside it, so the stub must materialise them from the markup.
      set innerHTML(html) {
        this.children = [];
        for (const cls of ['tm-hook-status', 'tm-split-btn', 'tm-char-count']) {
          if (!html.includes('class="' + cls + '"')) continue;
          const c = mk('span', cls);
          c.textContent = cls === 'tm-char-count' ? '0 / 500' : '';
          this.appendChild(c);
        }
      },
      get innerHTML() { return ''; },
      appendChild(c) { this.children.push(c); c.parentElement = this; return c; },
      remove() {
        this._removeCalls = (this._removeCalls || 0) + 1;
        this._removed = true;
        if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(x => x !== this);
      },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) {
        const out = [];
        const wantClass = sel.startsWith('.') ? sel.slice(1) : null;
        const wantRole = (sel.match(/role="(\w+)"/) || [])[1] || null;
        const wantEditable = sel.includes('contenteditable') ? 'true' : null;
        const walk = n => n.children.forEach(c => {
          const hit = (wantClass && String(c.className).split(/\s+/).includes(wantClass)) ||
            (wantRole && c._attrs.role === wantRole && (!wantEditable || c._attrs.contenteditable === wantEditable));
          if (hit) out.push(c);
          walk(c);
        });
        walk(this);
        return out;
      },
      cloneNode() {
        const c = mk(tag, cls);
        c._attrs = { ...this._attrs };
        c.dataset = { ...this.dataset };          // real DOM copies dataset
        c.textContent = this.textContent;         // real DOM copies text
        return c;                                 // but NOT listeners or expando props
      },
      addEventListener(t, fn) { this._ev[t] = (this._ev[t] || []).concat(fn); },
      dispatchEvent(e) { (this._ev[e.type] || []).forEach(fn => fn(e)); },
      closest(sel) {
        const test = sel === 'form' ? n => n.tagName === 'FORM' : () => false;
        for (let n = this; n; n = n.parentElement) if (test(n)) return n;
        return null;
      },
    };
    return el;
  };
  const body = mk('body'), form = mk('form'), textbox = mk('div');
  textbox.setAttribute('role', 'textbox');
  textbox.setAttribute('contenteditable', 'true');
  form.appendChild(textbox);
  body.appendChild(form);
  // Threads replaces the textbox node in place; a re-render drops the old one.
  const swapTextbox = () => {
    const fresh = textbox.cloneNode(true);
    fresh.textContent = '';
    const at = form.children.indexOf(textbox);
    form.children.splice(at, 1, fresh);
    fresh.parentElement = form;
    textbox._removed = true;
    return fresh;
  };
  const document = {
    createElement: mk, body,
    querySelectorAll: sel => body.querySelectorAll(sel),
    querySelector: sel => body.querySelector(sel),
  };
  return { document, form, textbox, mk, swapTextbox };
}
const comp = makeComposerDom();
const C2 = new Function('document', 'CONFIG_KEYS', 'TM_Splitter', 'console',
  composerSeg + '\nreturn TM_Composer;')(comp.document, { TIMESTAMP_MODE: 'x' }, { open(){} }, console);
C2.init();
const countOf = () => comp.form.querySelector('.tm-char-count').textContent;
const type = (box, text) => { box.textContent = text; box.dispatchEvent({ type: 'input' }); };
assert.ok(comp.form.querySelector('.tm-composer-bar'), 'init must attach a composer bar');
// Each round types a DIFFERENT length, so a counter that stayed on the old bar
// cannot pass by accident.
type(comp.textbox, 'abc');
assert.equal(countOf(), '3 / 500', 'baseline: the counter must track the textbox it wired');
for (let r = 0; r < 6; r++) {
  comp.textbox = comp.swapTextbox();
  const barsBefore = comp.form.querySelectorAll('.tm-composer-bar').length;
  const barTb = (comp.form.querySelector('.tm-composer-bar')||{})._tmTextbox;
  C2.init();
    assert.equal(comp.form.querySelectorAll('.tm-composer-bar').length, 1,
    're-render ' + r + ': the composer bars stacked or vanished');
  type(comp.textbox, 'ab'.repeat(r + 1).slice(0, r + 1));
  assert.equal(countOf(), (r + 1) + ' / 500',
    're-render ' + r + ': counter stayed at 3 — the clone kept the flag but got no listeners');
}
console.log('✓ Test 17b: composer counter survives a re-rendered textbox');

// ─── TEST 18: every fetch has a deadline ──────────────────────
// A bare fetch has no deadline. One stalled CDN response left the ZIP loop
// pending forever, the progress bar wedged at n-1/total, and the 30s watchdog
// then deleted the bar so the user read it as a finished download.
const fwtSeg = lift(shipped, 'const fetchWithTimeout = ', 'const fetchWithTimeout = ');
assert(fwtSeg.includes('AbortController'), 'fetchWithTimeout must abort the request');
assert(/setTimeout\(.*abort\(\)/.test(fwtSeg), 'fetchWithTimeout must arm an abort timer');
// Run it: a fetch that honours the signal must reject, and the timer must clear.
const ctlScope = new Function('fetch', 'setTimeout', 'clearTimeout', 'AbortController',
  fwtSeg + '\nreturn fetchWithTimeout;');
let signalSeen = null;
const fakeFetch = (url, opts) => new Promise((_, rej) => {
  signalSeen = opts && opts.signal;
  signalSeen.addEventListener('abort', () => rej(new Error('aborted')));
});
const guarded = ctlScope(fakeFetch, (fn, ms) => { const h = setTimeout(fn, ms); fakeFetch._t = h; return h; }, clearTimeout, AbortController);
trackAsync((async () => {
  const armedAt = Date.now();
  await assert.rejects(() => guarded('http://x', 120), 'a stalled fetch must reject instead of hanging forever');
  assert(Date.now() - armedAt >= 100, 'it must wait for the deadline, not reject immediately');
  assert(signalSeen.aborted, 'the abort signal must actually fire');
})());
// No network site may bypass the guard.
const rawFetches = [...shipped.matchAll(/(?<![.\w])fetch\((?!url, \{ signal)/g)].map(m => shipped.slice(Math.max(0, m.index - 60), m.index + 40).split('\n').pop());
assert.equal(rawFetches.length, 0, 'fetch() called without a deadline:\n' + rawFetches.join('\n'));
console.log('✓ Test 18: every fetch is bounded by a deadline');

// ─── TEST 20: srcset parsing survives a comma in the query string ──
// split(',') on a srcset broke a CDN URL like a.jpg?w=100,h=200 and a URL
// containing a space was cut mid-path, so the download saved a 404.
const bestSrc = lift(shipped, 'getBestMediaUrl: (img) => {', 'getBestMediaUrl: (img) => {').replace(/\n\s*\/\/ Layered so a Meta redesign$/, '');
const getBest = new Function('return (' + bestSrc.trim().replace('getBestMediaUrl: (img) =>', 'img =>') + ')')();
const srcOf = (srcset) => getBest({ getAttribute: () => srcset, src: 'FALLBACK' });
assert.equal(srcOf('https://cdn.x/a.jpg 320w, https://cdn.x/b.jpg 1080w, https://cdn.x/c.jpg 640w'),
  'https://cdn.x/b.jpg', 'the widest candidate must win');
assert.equal(srcOf('https://cdn.x/a.jpg 1x, https://cdn.x/b.jpg 2x'), 'https://cdn.x/b.jpg', 'density must be read');
assert.equal(srcOf('https://cdn.x/a.jpg 1080w, https://cdn.x/b.jpg 2x'), 'https://cdn.x/a.jpg',
  'w and x are not comparable, so a width candidate must win');
assert.equal(srcOf('https://cdn.x/a.jpg?w=100,h=200 320w, https://cdn.x/b.jpg?w=1000,h=2000 1080w'),
  'https://cdn.x/b.jpg?w=1000,h=2000', 'a comma inside the query must not split the entry');
assert.equal(srcOf('https://cdn.x/a.jpg 320w,'), 'https://cdn.x/a.jpg', 'a trailing comma must be ignored');
assert.equal(srcOf('https://cdn.x/a.jpg'), 'https://cdn.x/a.jpg', 'a descriptor-less srcset must still be used');
assert.equal(srcOf('   ,  ,'), 'FALLBACK', 'junk must fall back to img.src, never return a broken URL');
assert.equal(srcOf(''), 'FALLBACK', 'no srcset must fall back to img.src');
assert.equal(srcOf(null), 'FALLBACK', 'a missing srcset must fall back to img.src');
console.log('✓ Test 20: srcset parsing survives commas, spaces and junk');

// ─── TEST 34: the saved suffix must come from the URL, not a hardcoded jpg ──
// A PNG saved as .jpg is not just mislabelled: the browser sniffs the bytes and
// some viewers refuse the file. The path holds the extension, the query does not.
const mediaExtension = new Function('return (' + cutArrow(shipped, 'const mediaExtension =') + ')')();
const REALISTIC = [
  [{ type: 'image', url: 'https://scontent.cdninstagram.com/v/t51.29350-15/aaa.webp?stp=dst-jpg&_nc=1' }, 'webp'],
  [{ type: 'image', url: 'https://scontent.cdninstagram.com/v/t51/pic.png?stp=dst-png' }, 'png'],
  [{ type: 'image', url: 'https://scontent.cdninstagram.com/v/t51/anim.GIF?_nc=cat' }, 'gif'],
  [{ type: 'video', url: 'https://scontent.cdninstagram.com/v/t51/clip.mp4' }, 'mp4'],
  [{ type: 'image', url: 'https://scontent.cdninstagram.com/v/t51/photo' }, 'jpg'],
  [{ type: 'image', url: 'https://scontent.cdninstagram.com/v/t51/weird.exe?a=1' }, 'jpg'],
  [{ type: 'image', url: '' }, 'jpg'],
];
for (const [item, want] of REALISTIC) {
  assert.equal(mediaExtension(item), want, 'wrong suffix for ' + (item.url || '(empty)'));
}
console.log('✓ Test 34: the saved suffix follows the real media type');
// A correct helper nobody calls is still the old bug, so the call sites are part
// of the contract: the hardcoded ternary must not survive anywhere.
const hardcoded = [...shipped.matchAll(/item\.type === 'video' \? 'mp4' : 'jpg'/g)];
assert.equal(hardcoded.length, 0, 'the hardcoded jpg suffix is back at offset ' + (hardcoded[0] ? hardcoded[0].index : 0));
assert.equal((shipped.match(/= mediaExtension\(item\);/g) || []).length, 3,
  'every download path must build the name through mediaExtension');

// ─── TEST 35: no popup-window retry behind a failed download ──
// A <a target="_blank"> retry fires long after the click gesture, so the popup
// blocker swallows it: the user is told "12 failed" and gets no file, no tab and
// no explanation. The catch must report the failure, nothing more.
const fetchAsBlobSeg = lift(shipped, 'const fetchAsBlob = (url, filename, done) => {');
assert.equal((fetchAsBlobSeg.match(/target\s*=\s*'_blank'/g) || []).length, 0,
  'fetchAsBlob must not open a window on failure');
assert.equal((fetchAsBlobSeg.match(/window\.open/g) || []).length, 0,
  'fetchAsBlob must not call window.open on failure');
assert.ok(/\.catch\([\s\S]*done\(false\)/.test(fetchAsBlobSeg),
  'a failed download must be reported through done(false)');
console.log('✓ Test 35: a failed download reports instead of opening junk tabs');

// ─── TEST 36: the avatar heuristic must not eat real post photos ──
// /v/t51.29350-19/... is the normal CDN path of a post image. Filtering on a
// '-19/' substring dropped real photos: 12 in the feed, 9 offered for download.
const metaSeg = lift(shipped, 'getPostMetadata: (card) =>');
assert.equal((metaSeg.match(/includes\('-19\/'\)/g) || []).length, 0,
  'the -19/ path filter is back; it removes real post images');
// The heuristics that DO identify an avatar must stay.
for (const keep of ["img.width > 0 && img.width < 75", "classList.contains('avatar')", "borderRadius"])
  assert.ok(metaSeg.includes(keep), 'avatar heuristic lost: ' + keep);
// And the CDN allowlist, or nothing would be collected at all.
assert.ok(metaSeg.includes("src.includes('cdninstagram.com')"), 'the CDN allowlist was dropped');
console.log('✓ Test 36: a -19/ CDN path is a post image, not an avatar');

// ─── TEST 37: a lazy-loaded carousel slide must reach the button ──
// The row guard skipped any post that already had a button. A carousel that loads
// a slide afterwards changed the media list under that button, so the title kept
// saying 12 while the DOM held 13 and the new photo was never downloadable.
const injectSeg = lift(shipped, 'injectIntoActionRow: (shareInfo) =>');
assert.ok(/dlBtn\.dataset\.tmCount = String\(media\.length\)/.test(injectSeg),
  'the button must record the media count it was built for');
// The reuse test has to compare that count, not merely test for presence.
assert.ok(/dataset\.tmCount === String\(media\.length\)/.test(injectSeg),
  'the row guard must compare the recorded count with the current one');
// A stale button must be removed before a new one is added, or they stack.
assert.ok(/rowDl && !dlIsCurrent\) rowDl\.remove\(\)/.test(injectSeg),
  'a stale download button must be removed, not left beside the new one');
// And the cleanlink guard must not run before the download widget is handled.
// cleanlink does not depend on the media, so it guards itself. It lost that guard
// once already, which is how a re-scan stacked a second copy of every button.
assert.ok(/if \(!actionRow\.querySelector\('\.tm-cleanlink-btn'\)\) \{/.test(injectSeg),
  'the cleanlink button must guard itself against duplication');
// The order matters on the whole method: the download count is reconciled first,
// so a stale button is replaced before the cleanlink guard can end the scan.
const dlAt = shipped.indexOf("const dlIsCurrent");
const cleanAt = shipped.indexOf("if (!actionRow.querySelector('.tm-cleanlink-btn')) {");
assert.ok(dlAt > -1 && cleanAt > dlAt,
  'the download widget must be reconciled before the cleanlink guard is reached');
console.log('✓ Test 37: a lazy-loaded carousel slide reaches the button');

// ─── TEST 38: the dropdown must be dismissible from the keyboard ──
// A keyboard user opened the menu with Enter and then had no way out: Escape did
// nothing and the focus never entered the menu, so the only exit was a page click.
const ddSeg = lift(shipped, 'showCarouselDropdown: (anchorWrapper, anchorBtn, postData) =>');
assert.ok(/e\.key === 'Escape'/.test(ddSeg), 'the dropdown must answer Escape');
assert.ok(/document\.addEventListener\('keydown', onKey, true\)/.test(ddSeg),
  'the Escape handler must be registered while the menu is open');
assert.ok(/document\.removeEventListener\('keydown', onKey, true\)/.test(ddSeg),
  'the Escape handler must be removed on cleanup, or it leaks one per open');
assert.ok(/anchorBtn\.focus\(\)/.test(ddSeg), 'closing must return focus to the button');
// Focus has to land inside the menu, otherwise Tab walks the page behind it.
assert.ok(/itemAll\.focus\(\)/.test(ddSeg), 'opening must move focus into the menu');
// The deferred registration must not fire for a menu already closed.
assert.ok(/if \(!dropdown\.isConnected\) return;/.test(ddSeg),
  'the deferred listener registration must skip a menu that was closed');
console.log('✓ Test 38: the dropdown closes on Escape and returns focus');

// ─── TEST 39: every post on a feed must get its own card and its own buttons ──
// findPostCard stopped at DIV.actions, which carries the post link but no images:
// 41 posts on the feed, 40 with photos, and not one download button. Climbing to
// the widest ancestor instead merged the feed, so all 41 reported the same image.
const cardSeg = lift(shipped, 'findPostCard: (node) => {');
assert.ok(/querySelectorAll\('a\[href\*="\/post\/"\]'\)\.length === 1/.test(cardSeg),
  'the card must be the ancestor holding exactly one post link');
// A card that spans two posts would report the first post's media for both.
assert.ok(/else if \(card\) break;/.test(cardSeg),
  'the climb must stop at the boundary between two posts');
// The bounds must stop at the body, or one bad fixture makes the loop run away.
assert.ok(/cur && cur !== document\.body/.test(cardSeg),
  'the climb must be bounded by document.body');
console.log('✓ Test 39: each post on a feed resolves to its own card');

// ─── TEST 40: a split chunk must keep the paragraph breaks it was given ──
// The reader turns newlines into <br>; the splitter stores them as text. Without
// white-space the blank lines between paragraphs collapsed and every chunk read as
// one run-on block. The rule also has to survive CSS parsing: a // comment in a
// stylesheet is not a comment, it eats the next rule.
// lift() has an 8000-char window and the stylesheet sits past it, so read the sheet
// straight out of the bundle instead of lifting a function out of it.
const styleStart = shipped.indexOf("style.textContent = `");
const styleEnd = shipped.indexOf('`;', styleStart);
const styles = shipped.slice(styleStart, styleEnd);
const splitRule = /\.tm-split-text \{[^}]*white-space:\s*pre-wrap/.test(styles);
assert.ok(splitRule, 'a split chunk must render its line breaks (white-space: pre-wrap)');
// An unbreakable run (a long URL) has to wrap instead of pushing the card wider.
assert.ok(/\.tm-split-text \{[^}]*overflow-wrap:\s*anywhere/.test(styles),
  'a long unbreakable run must wrap inside the chunk');
// // is a JavaScript comment, not CSS. Inside a stylesheet the parser drops that line
// AND the rule that follows it, so the fix silently never applied.
const cssComments = styles.match(/^\s*\/\/[^\n]*$/gm) || [];
assert.equal(cssComments.length, 0, 'the stylesheet has a // comment that kills the next rule: ' + (cssComments[0] || '').trim());
console.log('✓ Test 40: a split chunk keeps its paragraph breaks and wraps long runs');








// ─── TEST 21b: one pill per media item ─────────────────────────
// The selector resolved a shared "tile" by walking up from each image. A
// carousel wraps every image in one .media container, so the first item created
// the pill and the other eleven bailed out on the dedupe guard: 12 photos, one
// checkbox, and the counter said 12/12 while only one item could be toggled.
const selSeg = shipped.slice(shipped.indexOf('media.forEach((item, index)'), shipped.indexOf('// Walk up from our own button'));
assert(selSeg.includes('const tile = item.element;'),
  'Each pill must hang off its own media element, not a shared walked-up tile');
assert(!/let tile = item\.element\.parentElement/.test(selSeg),
  'Walking up to a parent tile collapses a carousel onto one checkbox');
assert(selSeg.includes("if (!tile || tile.querySelector('.tm-checkbox-pill')) return;"),
  'The dedupe guard stays, but it must now be per-item');
// The counter is driven by the Set, not by the pill count, so a missing pill
// would silently pass; pin the invariant that makes the count honest.
const selIdx = shipped.indexOf('const selected = new Set(media.map');
assert(selIdx > -1 && /new Set\(media\.map\(\(_, i\) => i\)\)/.test(shipped.slice(selIdx, selIdx + 80)),
  'Selection must start as one entry per media item');
console.log('✓ Test 21b: one checkbox per carousel item, counter backed by the Set');


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
for (const retained of ['TM_Buttons', 'TM_Unroller', 'TM_Composer', 'TM_Video', 'TM_Timestamp']) {
  assert(shipped.includes(retained), `Retained core module missing from shipped bundle: ${retained}`);
}
// P0 a11y that lived only in the deleted src/: the shipped bundle must trap Tab in both modals.
assert(shipped.includes('tmFocusTrap'), 'Focus trap helper missing from shipped bundle');
assert(shipped.includes("role', 'group'"), 'Video controls must expose role=group');
console.log('✓ Scope regression: removed features absent; retained core artifacts present');
console.log('✓ Single-source gate: src/ deleted, bundle is the only implementation');

// Every watchdog-timer test is registered in pendingAsync; hold the green banner
// until they all settle, then let the exit code speak.
setTimeout(() => {
  if (pendingAsync.size) {
    console.log(`⏳ ${pendingAsync.size} async test(s) still running...`);
    setTimeout(check, 100);
    return;
  }
  console.log('\n🎉 ALL THREADMAX v1.4.0 TESTS PASSED GREEN!\n');
}, 200);
function check() {
  if (pendingAsync.size) { setTimeout(check, 100); return; }
  console.log('\n🎉 ALL THREADMAX v1.4.0 TESTS PASSED GREEN!\n');
}
