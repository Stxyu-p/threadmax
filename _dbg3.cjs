const fs = require('fs');
const src = fs.readFileSync(__dirname + '/threadmax.user.js', 'utf8');
// The fix: the body starts after the FIRST `=>` on the declaration line, and the
// body ends at the first newline that is not inside the body. Never look for `{`:
// a following statement can have braces before the real body does.
function cutArrow(src, from) {
  const i = src.indexOf(from);
  const seg = src.slice(i, i + 2000).replace(/\r\n/g, '\n');
  const arrow = seg.indexOf('=>');
  const head = seg.slice(0, arrow + 2);
  let depth = 0, end = seg.length;
  for (let k = arrow + 2; k < seg.length; k++) {
    const c = seg[k];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === '\n' && depth <= 0) { end = k; break; }
  }
  const out = seg.slice(0, end)
    .replace(from, '').replace(/;\s*$/, '').replace(/^\s*=\s*/, '').trim();
  console.log('MARKER=' + JSON.stringify(from));
  console.log('OUT>>' + out + '<<');
  try { new Function('return (' + out + ')'); console.log('PARSES OK\n'); }
  catch (e) { console.log('FAIL ' + e.message + '\n'); }
}
for (const m of ['const safeFilename =', 'const mediaExtension =', 'const escapeHtml =',
                 'const crc32Bytes =', 'const cleanPostUrl =', 'const parseMetricNumber ='])
  cutArrow(src, m);
