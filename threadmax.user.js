// ==UserScript==
// @name         ThreadMax
// @namespace    https://github.com/Stxyu-p/threadmax
// @version      1.4.0
// @description  Precision Media Downloader, Video Booster, Clean Link, Smart Timestamps, Thread Unroller, Splitter, Viral Radar & Relationship Auditor for Threads Web
// @author       P Choke & MIKA
// @match        https://www.threads.com/*
// @match        https://threads.com/*
// @match        https://www.threads.net/*
// @match        https://threads.net/*
// @icon         https://www.threads.net/favicon.ico
// @icon64       https://www.threads.net/favicon.ico
// @grant        GM_download
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @run-at       document-start
// @license      MIT
// ==/UserScript==

/**
 * ThreadMax v1.4.0 — Pure Vanilla JavaScript, Zero External Dependencies
 * Architecture: Clean Modular / Anti-Slop Minimal Precision
 *
 * ponytail: deliberate simplifications:
 * - Dynamic Stacking Context Elevation (z-index: 9999 on active card): eliminates sunken dropdown bugs.
 * - IndexedDB local snapshot vault: zero network telemetry, 100% private relationship auditing.
 * - Safe-Pacing Batch Scanner: 3,000–5,000ms randomized sleep jitter prevents account checkpoints.
 * - Text Splitter sentence-boundary chunker: <= 480 chars to ensure clean 1/N sub-posts.
 * - Viral Velocity heuristic: (Replies*2 + Reposts*1.5)/AgeMinutes with <50 replies guard for early surge detection.
 * - High-Res Srcset Parser: extracts maximum available resolution without full API roundtrip.
 * - Single-Pass Event Lifecycle: auto-detaches portal & modal listeners on dismiss to prevent memory leaks.
 */

(function () {
  'use strict';

  /* ─── 1. CONFIGURATION & STORAGE ─────────────────────────── */
  const CONFIG_KEYS = {
    DOWNLOAD_MODE: 'tm_download_mode',     // 'zip' | 'individual'
    TIMESTAMP_MODE: 'tm_timestamp_mode',   // 'hybrid' | 'absolute' | 'native'
    VIDEO_VOLUME: 'tm_video_volume',       // 0.0 - 1.0
    VIDEO_SPEED: 'tm_video_speed',         // 1.0, 1.25, 1.5, 2.0
    VIRAL_RADAR: 'tm_viral_radar_enabled', // true | false
    FILTER_RISING: 'tm_filter_rising'      // true | false
  };

  const TM_Config = {
    get: (k, fb) => {
      try {
        if (typeof GM_getValue === 'function') return GM_getValue(k, fb);
        const v = localStorage.getItem(k);
        return v !== null ? JSON.parse(v) : fb;
      } catch { return fb; }
    },
    set: (k, v) => {
      try {
        if (typeof GM_setValue === 'function') return GM_setValue(k, v);
        localStorage.setItem(k, JSON.stringify(v));
      } catch (e) { console.warn('[ThreadMax] Save config error:', k, e); }
    }
  };

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('⚡ เปิด ThreadMax Studio', () => TM_Studio.open());
    GM_registerMenuCommand('📦 สลับโหมดดาวน์โหลด (ZIP / แยกไฟล์)', () => {
      const next = TM_Config.get(CONFIG_KEYS.DOWNLOAD_MODE, 'zip') === 'zip' ? 'individual' : 'zip';
      TM_Config.set(CONFIG_KEYS.DOWNLOAD_MODE, next);
      showToast(`โหมดดาวน์โหลด: ${next === 'zip' ? 'รวมไฟล์ ZIP' : 'แยกทีละไฟล์'}`);
    });
    GM_registerMenuCommand('🕒 สลับรูปแบบเวลา (Hybrid / Absolute / Native)', () => {
      const modes = ['hybrid', 'absolute', 'native'];
      const next = modes[(modes.indexOf(TM_Config.get(CONFIG_KEYS.TIMESTAMP_MODE, 'hybrid')) + 1) % modes.length];
      TM_Config.set(CONFIG_KEYS.TIMESTAMP_MODE, next);
      showToast(`รูปแบบเวลา: ${next}`);
      TM_Timestamp.updateAll();
    });
  }

  /* ─── 1.5 ACTIVE GRAPHQL SNIFFER ─────────────────────────── */
  const TM_Sniffer = {
    init: () => {
      try {
        const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        if (win.__tm_sniffer_installed) return;
        win.__tm_sniffer_installed = true;

        const origFetch = win.fetch;
        win.fetch = async function (...args) {
          const url = args[0] ? String(args[0]) : '';
          const init = args[1] || {};

          if (url.includes('/api/graphql')) {
            try {
              const bodyStr = typeof init.body === 'string' ? init.body : (init.body instanceof URLSearchParams ? init.body.toString() : '');
              const params = new URLSearchParams(bodyStr);
              const docId = params.get('doc_id');
              const friendlyName = (params.get('fb_api_req_friendly_name') || '').toLowerCase();

              if (docId) {
                if (friendlyName.includes('follower') || bodyStr.includes('follower')) {
                  TM_Config.set('tm_doc_followers', docId);
                } else if (friendlyName.includes('following') || bodyStr.includes('following')) {
                  TM_Config.set('tm_doc_following', docId);
                }
              }
            } catch {}
          }
          return origFetch.apply(this, args);
        };
      } catch (e) {
        console.warn('[ThreadMax] Failed to install sniffer:', e);
      }
    }
  };
  TM_Sniffer.init();

  /* ─── 2. INDEXEDDB VAULT (Relationship Intelligence) ──────── */
  const TM_DB = {
    dbName: 'ThreadMaxDB',
    version: 1,
    db: null,

    init: () => new Promise((resolve, reject) => {
      if (TM_DB.db) return resolve(TM_DB.db);
      const req = indexedDB.open(TM_DB.dbName, TM_DB.version);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('snapshots')) {
          db.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = e => { TM_DB.db = e.target.result; resolve(TM_DB.db); };
      req.onerror = e => reject(e);
    }),

    computeRelationshipDiff: (currentFollowers = [], currentFollowing = [], prevSnapshot = null) => {
      const followerSet = new Set(currentFollowers.map(u => String(u).toLowerCase()));
      const followingSet = new Set(currentFollowing.map(u => String(u).toLowerCase()));
      const prevSet = prevSnapshot?.followers ? new Set(prevSnapshot.followers.map(u => String(u).toLowerCase())) : null;

      return {
        notFollowingBack: currentFollowing.filter(u => !followerSet.has(String(u).toLowerCase())),
        fans: currentFollowers.filter(u => !followingSet.has(String(u).toLowerCase())),
        mutual: currentFollowing.filter(u => followerSet.has(String(u).toLowerCase())),
        gained: prevSet ? currentFollowers.filter(u => !prevSet.has(String(u).toLowerCase())) : [],
        lost: prevSet ? prevSnapshot.followers.filter(u => !followerSet.has(String(u).toLowerCase())) : [],
        totalFollowers: currentFollowers.length,
        totalFollowing: currentFollowing.length
      };
    },

    saveSnapshot: async (data) => {
      const db = await TM_DB.init();
      const prev = await TM_DB.getLatestSnapshot();
      const followers = data.followers || [];
      const following = data.following || [];
      const diff = data.diff || TM_DB.computeRelationshipDiff(followers, following, prev);

      return new Promise((resolve, reject) => {
        const tx = db.transaction('snapshots', 'readwrite');
        const store = tx.objectStore('snapshots');
        const record = { timestamp: Date.now(), username: data.username || 'me', followers, following, diff };
        const req = store.add(record);
        req.onsuccess = () => resolve({ id: req.result, ...record });
        req.onerror = () => reject(req.error);
      });
    },

    getLatestSnapshot: async () => {
      const all = await TM_DB.getAllSnapshots();
      return all.length > 0 ? all[all.length - 1] : null;
    },

    getAllSnapshots: async () => {
      const db = await TM_DB.init();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('snapshots', 'readonly');
        const req = tx.objectStore('snapshots').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    }
  };

  /* ─── 3. PURE CLIENT-SIDE ZIP32 ENGINE (Zero Dependencies) ── */
  const CRC32_TABLE = new Uint32Array(256);
  (() => {
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC32_TABLE[i] = c >>> 0;
    }
  })();

  const crc32Bytes = buf => {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ buf[i]) & 0xFF];
    return (crc ^ 0xFFFFFFFF) >>> 0;
  };

  const dosTimestamp = (d = new Date()) => ({
    dosDate: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    dosTime: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
  });

  function createStoredZip(files) {
    const enc = new TextEncoder();
    const local = [], central = [];
    let offset = 0;
    const { dosDate, dosTime } = dosTimestamp();

    for (const f of files) {
      const name = enc.encode(f.name);
      const data = f.data instanceof Uint8Array ? f.data : (typeof f.data === 'string' ? enc.encode(f.data) : new Uint8Array(f.data || 0));
      const crc = crc32Bytes(data), sz = data.length;

      const lfh = new Uint8Array(30 + name.length), lv = new DataView(lfh.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(10, dosTime, true);
      lv.setUint16(12, dosDate, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, sz, true);
      lv.setUint32(22, sz, true);
      lv.setUint16(26, name.length, true);
      lfh.set(name, 30);
      local.push(lfh, data);

      const cdh = new Uint8Array(46 + name.length), cv = new DataView(cdh.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, sz, true);
      cv.setUint32(24, sz, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      cdh.set(name, 46);
      central.push(cdh);

      offset += lfh.length + sz;
    }

    const cdSz = central.reduce((a, b) => a + b.length, 0);
    const eocd = new Uint8Array(22), ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSz, true);
    ev.setUint32(16, offset, true);

    return new Blob([...local, ...central, eocd], { type: 'application/zip' });
  }

  /* ─── 4. UTILITIES & ONE-LINERS ──────────────────────────── */
  const showToast = (msg, ms = 2200) => {
    let t = document.getElementById('tm-toast');
    if (!t) { t = document.createElement('div'); t.id = 'tm-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('tm-toast-visible');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('tm-toast-visible'), ms);
  };

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
  };

  const downloadDirect = (url, filename) => {
    if (typeof GM_download === 'function') {
      GM_download({ url, name: filename, saveAs: false, onerror: () => fallbackDownload(url, filename) });
    } else fallbackDownload(url, filename);
  };

  const fallbackDownload = (url, filename) => {
    fetch(url).then(r => r.blob()).then(b => downloadBlob(b, filename)).catch(() => {
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.target = '_blank'; document.body.appendChild(a); a.click(); a.remove();
    });
  };

  const cleanPostUrl = url => {
    try {
      const u = new URL(url), m = u.pathname.match(/(\/@[^/]+\/post\/[^/?#]+)/);
      return m ? `https://www.threads.com${m[1]}` : `${u.origin}${u.pathname}`;
    } catch { return (url || '').split('?')[0]; }
  };

  const escapeHtml = str => String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]);

  const parseMetricNumber = str => !str ? 0 : (s => (parseFloat(s) || 0) * ({ k: 1e3, m: 1e6 }[s.slice(-1)] || 1))(String(str).trim().toLowerCase());

  /* ─── 4.5 RATE LIMITER (Token Bucket Guard) ────────────────── */
  class TokenBucket {
    constructor({ capacity = 10, refillRate = 2, minIntervalMs = 0 }) {
      this.capacity = capacity;
      this.refillRate = refillRate;
      this.tokens = capacity;
      this.lastRefill = Date.now();
      this.minIntervalMs = minIntervalMs;
      this.lastOpTime = 0;
    }
    refill() {
      const now = Date.now(), el = Math.max(0, (now - this.lastRefill) / 1000);
      this.tokens = Math.min(this.capacity, this.tokens + el * this.refillRate);
      this.lastRefill = now;
    }
    tryConsume(n = 1) {
      this.refill();
      const now = Date.now(), gap = now - this.lastOpTime;
      if (this.minIntervalMs > 0 && gap < this.minIntervalMs) return { allowed: false, waitMs: this.minIntervalMs - gap };
      if (this.tokens >= n) { this.tokens -= n; this.lastOpTime = Date.now(); return { allowed: true, waitMs: 0 }; }
      return { allowed: false, waitMs: Math.ceil(((n - this.tokens) / this.refillRate) * 1000) };
    }
    async consume(n = 1) {
      const r = this.tryConsume(n);
      if (r.allowed) return;
      await new Promise(res => setTimeout(res, r.waitMs));
      const retry = this.tryConsume(n);
      if (!retry.allowed) await new Promise(res => setTimeout(res, retry.waitMs));
    }
  }

  const TM_RateLimiters = {
    graphql: new TokenBucket({ capacity: 10, refillRate: 2, minIntervalMs: 300 }),
    download: new TokenBucket({ capacity: 5, refillRate: 1, minIntervalMs: 500 })
  };

  /* ─── 5. DOM EXTRACTION (HIGH-RES MEDIA, METRICS, POST) ───── */
  const TM_DOM = {
    // ponytail: extract highest resolution URL candidate from responsive srcset
    getBestMediaUrl: (img) => {
      const srcset = img.getAttribute('srcset');
      if (!srcset) return img.src;
      const candidates = srcset.split(',').map(s => {
        const [u, w] = s.trim().split(/\s+/);
        return { url: u, width: parseInt(w, 10) || 0 };
      }).filter(c => c.url);
      candidates.sort((a, b) => b.width - a.width);
      return candidates[0]?.url || img.src;
    },

    findShareButtons: () => {
      const res = [];
      const paths = document.querySelectorAll('path[d*="M7.247 1.499"], path[d*="M7.246 1.5"], path[d*="M1.53 6.014"]');
      paths.forEach(p => {
        const svg = p.closest('svg'), btn = svg?.closest('[role="button"]') || svg?.parentElement;
        const wrapper = btn?.parentElement, actionRow = wrapper?.parentElement;
        if (btn && wrapper && actionRow && !res.some(r => r.shareBtn === btn)) {
          res.push({ shareSvg: svg, shareBtn: btn, shareWrapper: wrapper, actionRow });
        }
      });
      if (res.length === 0) {
        document.querySelectorAll('svg[title*="Share" i], svg[title*="แชร์"], svg[aria-label*="Share" i], svg[aria-label*="แชร์"]').forEach(svg => {
          const btn = svg.closest('[role="button"]') || svg.parentElement, wrapper = btn?.parentElement, actionRow = wrapper?.parentElement;
          if (btn && wrapper && actionRow && !res.some(r => r.shareBtn === btn)) {
            res.push({ shareSvg: svg, shareBtn: btn, shareWrapper: wrapper, actionRow });
          }
        });
      }
      return res;
    },

    findPostCard: (node) => {
      let cur = node;
      while (cur && cur !== document.body) {
        if (cur.getAttribute?.('data-pressable-container') === 'true' || cur.tagName === 'ARTICLE') return cur;
        cur = cur.parentElement;
      }
      cur = node;
      while (cur && cur !== document.body) {
        if (cur.querySelector?.('a[href*="/post/"]')) return cur;
        cur = cur.parentElement;
      }
      return node.parentElement?.parentElement || node;
    },

    getPostMetadata: (card) => {
      const postLinkEl = card.querySelector('a[href*="/post/"]');
      let author = 'threads_user', postId = Date.now().toString(36), postUrl = window.location.href;

      if (postLinkEl?.href) {
        postUrl = cleanPostUrl(postLinkEl.href);
        const m = postUrl.match(/@([^/?#]+)\/post\/([^/?#]+)/);
        if (m) { author = m[1]; postId = m[2]; }
      } else {
        const authorEl = card.querySelector('a[href*="/@"]');
        const m = (authorEl?.getAttribute('href') || '').match(/@([^/?#]+)/);
        if (m) author = m[1];
      }

      // Media Extraction (Video + High-Res Images)
      const media = [], seen = new Set();

      card.querySelectorAll('video').forEach(video => {
        const src = video.currentSrc || video.src || video.querySelector('source')?.src;
        if (src && !seen.has(src)) { seen.add(src); media.push({ type: 'video', url: src, element: video }); }
      });

      card.querySelectorAll('img').forEach(img => {
        const src = TM_DOM.getBestMediaUrl(img);
        if (!src || seen.has(src) || src.includes('-19/')) return;

        // Skip avatar links
        const parentLink = img.closest('a');
        if (parentLink && (parentLink.getAttribute('href') || '').includes('/@') && !parentLink.getAttribute('href').includes('/post/')) return;

        // Skip small thumbnail/profile icons without forced reflow
        if (img.width > 0 && img.width < 75) return;
        if (img.classList.contains('avatar') || img.style.borderRadius?.includes('50%')) return;

        if (src.includes('cdninstagram.com') || src.includes('fbcdn.net')) {
          seen.add(src);
          media.push({ type: 'image', url: src, element: img });
        }
      });

      // Post text & metrics
      const textContainer = card.querySelector('div[dir="auto"], span[dir="auto"]');
      const text = textContainer ? textContainer.innerText.trim() : '';

      let replies = 0, reposts = 0, likes = 0, postDate = null;
      const timeEl = card.querySelector('time[datetime]');
      if (timeEl) postDate = new Date(timeEl.getAttribute('datetime'));

      card.querySelectorAll('span, div').forEach(el => {
        const t = el.innerText?.trim();
        if (/^\d+(\.\d+)?[kKmM]?$/.test(t)) {
          const num = parseMetricNumber(t);
          if (el.closest('[aria-label*="Like" i], [aria-label*="ถูกใจ" i], svg[aria-label*="Like" i]')) likes = num;
          else if (el.closest('[aria-label*="Reply" i], [aria-label*="ตอบกลับ" i], [aria-label*="Comment" i]')) replies = num;
          else if (el.closest('[aria-label*="Repost" i], [aria-label*="รีโพสต์" i]')) reposts = num;
        }
      });

      return { card, author, postId, postUrl, media, text, replies, reposts, likes, postDate };
    }
  };

  /* ─── 6. IN-FEED ACTION BUTTONS & STACKING PROTECTION ─────── */
  const TM_Buttons = {
    injectIntoActionRow: (shareInfo) => {
      const { shareBtn, shareWrapper, actionRow } = shareInfo;
      if (actionRow.dataset.tmInjected || actionRow.querySelector('.tm-download-btn, .tm-cleanlink-btn')) return;
      actionRow.dataset.tmInjected = '1';

      const card = TM_DOM.findPostCard(actionRow);
      const postData = TM_DOM.getPostMetadata(card);
      const { author, postId, postUrl, media } = postData;

      // 1. Download Button
      if (media.length > 0) {
        const dlWrapper = document.createElement('div');
        dlWrapper.className = `${shareWrapper.className || ''} tm-wrapper`.trim();
        const dlBtn = document.createElement('div');
        dlBtn.className = 'tm-download-btn tm-btn';
        dlBtn.setAttribute('role', 'button');
        dlBtn.setAttribute('tabindex', '0');
        dlBtn.title = media.length > 1 ? `ThreadMax: ดาวน์โหลดสื่อ (${media.length} ไฟล์)` : 'ThreadMax: ดาวน์โหลดสื่อ';
        dlBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
        `;

        dlBtn.addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation();
          if (media.length === 1) TM_Downloader.downloadSingle(media[0], author, postId, 1, dlBtn);
          else TM_Buttons.showCarouselDropdown(dlWrapper, dlBtn, postData);
        });

        dlWrapper.appendChild(dlBtn);
        actionRow.insertBefore(dlWrapper, shareWrapper.nextSibling);
      }

      // 2. Clean Link Button
      const linkWrapper = document.createElement('div');
      linkWrapper.className = `${shareWrapper.className || ''} tm-wrapper`.trim();
      const linkBtn = document.createElement('div');
      linkBtn.className = 'tm-cleanlink-btn tm-btn';
      linkBtn.setAttribute('role', 'button');
      linkBtn.setAttribute('tabindex', '0');
      linkBtn.title = 'ThreadMax: คัดลอกลิงก์สะอาด (ไร้ Tracking Code)';
      linkBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
        </svg>
      `;

      linkBtn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        navigator.clipboard.writeText(cleanPostUrl(postUrl)).then(() => showToast('✓ คัดลอกลิงก์สะอาดแล้ว')).catch(() => showToast('⚠️ เข้าถึง Clipboard ไม่ได้'));
      });

      linkWrapper.appendChild(linkBtn);
      const targetAnchor = actionRow.querySelector('.tm-download-btn')?.parentElement || shareWrapper;
      actionRow.insertBefore(linkWrapper, targetAnchor.nextSibling);

      // 3. Unroll Thread Button (When on post detail or OP thread)
      if (window.location.pathname.includes('/post/') && !actionRow.querySelector('.tm-unroll-btn')) {
        const unrollWrapper = document.createElement('div');
        unrollWrapper.className = `${shareWrapper.className || ''} tm-wrapper`.trim();
        const unrollBtn = document.createElement('div');
        unrollBtn.className = 'tm-unroll-btn tm-btn';
        unrollBtn.setAttribute('role', 'button');
        unrollBtn.setAttribute('tabindex', '0');
        unrollBtn.title = 'ThreadMax: รวมเนื้อหาเธรด (Unroll to Reader / Markdown)';
        unrollBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
          </svg>
        `;
        unrollBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); TM_Unroller.open(author, postId); });
        unrollWrapper.appendChild(unrollBtn);
        actionRow.appendChild(unrollWrapper);
      }
    },

    showCarouselDropdown: (anchorWrapper, anchorBtn, postData) => {
      // Clean up previous dropdown with proper event removal
      const existing = document.querySelector('.tm-dropdown');
      if (existing) {
        existing._cleanup?.();
        const wasSame = existing._anchorBtn === anchorBtn;
        existing.remove();
        if (wasSame) return;
      }

      const mode = TM_Config.get(CONFIG_KEYS.DOWNLOAD_MODE, 'zip');
      const dropdown = document.createElement('div');
      dropdown.className = 'tm-dropdown';
      dropdown._anchorBtn = anchorBtn;

      dropdown.innerHTML = `
        <div class="tm-dropdown-item" data-action="all"><span class="tm-dropdown-icon">📦</span><span>ดาวน์โหลดทั้งหมด (${postData.media.length} ไฟล์ • ${mode.toUpperCase()})</span></div>
        <div class="tm-dropdown-item" data-action="select"><span class="tm-dropdown-icon">☑️</span><span>เลือกดาวน์โหลดเฉพาะไฟล์...</span></div>
      `;

      const closeDropdown = () => { dropdown._cleanup?.(); dropdown.remove(); };

      dropdown.querySelector('[data-action="all"]').onclick = (e) => {
        e.stopPropagation(); closeDropdown();
        TM_Downloader.downloadBatch(postData.media, postData.author, postData.postId, anchorBtn, mode);
      };

      dropdown.querySelector('[data-action="select"]').onclick = (e) => {
        e.stopPropagation(); closeDropdown();
        TM_Selector.activate(postData, anchorBtn);
      };

      // Portal clamping: position fixed in viewport
      const rect = anchorBtn.getBoundingClientRect();
      const dropdownWidth = 270;
      let left = Math.max(16, Math.min(rect.left, window.innerWidth - dropdownWidth - 16));

      dropdown.style.cssText = `position:fixed;top:${rect.bottom + 6}px;left:${left}px;z-index:2147483647;`;
      document.body.appendChild(dropdown);

      const onDocClick = evt => { if (!dropdown.contains(evt.target) && !anchorBtn.contains(evt.target)) closeDropdown(); };
      const onScrollOrResize = () => closeDropdown();

      dropdown._cleanup = () => {
        document.removeEventListener('click', onDocClick, true);
        window.removeEventListener('scroll', onScrollOrResize, { capture: true });
        window.removeEventListener('resize', onScrollOrResize);
      };

      setTimeout(() => {
        document.addEventListener('click', onDocClick, true);
        window.addEventListener('scroll', onScrollOrResize, { passive: true, capture: true });
        window.addEventListener('resize', onScrollOrResize);
      }, 50);
    }
  };

  /* ─── 7. BATCH DOWNLOADER & PROGRESS ──────────────────────── */
  const TM_Downloader = {
    downloadSingle: (item, author, postId, index, anchorBtn) => {
      const ext = item.type === 'video' ? 'mp4' : 'jpg';
      const filename = `${author}_${postId}_${String(index).padStart(3, '0')}.${ext}`;
      TM_Downloader.showProgress(anchorBtn, 1, 1);

      if (item.type === 'video') {
        downloadDirect(item.url, filename);
        setTimeout(() => TM_Downloader.clearProgress(anchorBtn), 1200);
      } else {
        fetch(item.url)
          .then(r => r.blob()).then(blob => { downloadBlob(blob, filename); TM_Downloader.clearProgress(anchorBtn); })
          .catch(() => { downloadDirect(item.url, filename); TM_Downloader.clearProgress(anchorBtn); });
      }
    },

    downloadBatch: async (mediaList, author, postId, anchorBtn, mode = 'zip') => {
      const total = mediaList.length;
      let completed = 0, failed = 0;
      TM_Downloader.showProgress(anchorBtn, 0, total);

      if (mode === 'individual') {
        for (let i = 0; i < mediaList.length; i++) {
          const item = mediaList[i];
          const ext = item.type === 'video' ? 'mp4' : 'jpg';
          downloadDirect(item.url, `${author}_${postId}_${String(i + 1).padStart(3, '0')}.${ext}`);
          completed++;
          TM_Downloader.showProgress(anchorBtn, completed, total);
          await new Promise(r => setTimeout(r, 220));
        }
        setTimeout(() => TM_Downloader.clearProgress(anchorBtn), 1500);
        showToast(`✓ ดาวน์โหลดเรียบร้อย ${completed}/${total} ไฟล์`);
        return;
      }

      // ZIP Mode
      const zipFiles = [];
      for (let i = 0; i < mediaList.length; i++) {
        const item = mediaList[i];
        const ext = item.type === 'video' ? 'mp4' : 'jpg';
        try {
          const resp = await fetch(item.url);
          const buf = await resp.arrayBuffer();
          zipFiles.push({ name: `${author}_${postId}_${String(i + 1).padStart(3, '0')}.${ext}`, data: new Uint8Array(buf) });
          completed++;
        } catch { failed++; }
        TM_Downloader.showProgress(anchorBtn, completed + failed, total);
      }

      if (zipFiles.length > 0) {
        downloadBlob(createStoredZip(zipFiles), `${author}_${postId}_carousel_${zipFiles.length}items.zip`);
        showToast(failed === 0 ? `✓ ดาวน์โหลด ZIP สำเร็จ (${zipFiles.length} ไฟล์)` : `✓ โหลดได้ ${completed} ไฟล์ (${failed} ล้มเหลว)`);
      } else showToast('⚠️ ไม่สามารถดาวน์โหลดไฟล์ในโพสต์นี้ได้');

      TM_Downloader.clearProgress(anchorBtn);
    },

    showProgress: (anchorBtn, current, total) => {
      let bar = anchorBtn.parentElement.querySelector('.tm-progress-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'tm-progress-bar';
        bar.innerHTML = '<span class="tm-progress-text"></span><div class="tm-progress-track"><div class="tm-progress-fill"></div></div>';
        anchorBtn.parentElement.appendChild(bar);
      }

      if (anchorBtn._tmProgressWatchdog) clearTimeout(anchorBtn._tmProgressWatchdog);
      anchorBtn._tmProgressWatchdog = setTimeout(() => TM_Downloader.clearProgress(anchorBtn, 0), 30000);

      const pct = Math.round((current / (total || 1)) * 100);
      bar.querySelector('.tm-progress-text').textContent = `${current}/${total} ↓ (${pct}%)`;
      bar.querySelector('.tm-progress-fill').style.width = `${pct}%`;
    },

    clearProgress: (anchorBtn, delay = 1200) => {
      if (anchorBtn._tmProgressWatchdog) { clearTimeout(anchorBtn._tmProgressWatchdog); delete anchorBtn._tmProgressWatchdog; }
      const bar = anchorBtn.parentElement?.querySelector('.tm-progress-bar');
      if (bar) { if (delay <= 0) bar.remove(); else setTimeout(() => bar.remove(), delay); }
    }
  };

  /* ─── 8. INTERACTIVE SELECTION MODE (Non-Destructive) ──────── */
  const TM_Selector = {
    activate: (postData, anchorBtn) => {
      const { card, media, author, postId } = postData;
      const selected = new Set(media.map((_, i) => i));

      media.forEach((item, index) => {
        let tile = item.element.parentElement;
        while (tile && (tile.tagName === 'PICTURE' || tile.tagName === 'A' || tile.offsetWidth === 0)) tile = tile.parentElement;
        if (!tile || tile.querySelector('.tm-checkbox-pill')) return;

        const pill = document.createElement('div');
        pill.className = 'tm-checkbox-pill active';
        pill.dataset.index = index;
        pill.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

        pill.onclick = (e) => {
          e.stopPropagation(); e.preventDefault();
          if (selected.has(index)) { selected.delete(index); pill.classList.remove('active'); }
          else { selected.add(index); pill.classList.add('active'); }
          TM_Selector.updateBar(card, selected.size);
        };
        tile.appendChild(pill);
      });

      const actionRow = card.querySelector('.tm-download-btn')?.closest('.x78zum5') || card.querySelector('.tm-download-btn')?.parentElement?.parentElement;
      let bar = card.querySelector('.tm-select-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'tm-select-bar';
        if (actionRow?.parentElement) actionRow.parentElement.insertBefore(bar, actionRow);
        else card.appendChild(bar);
      }

      TM_Selector.renderBarContent(bar, card, selected, media, author, postId, anchorBtn);
    },

    renderBarContent: (bar, card, selected, media, author, postId, anchorBtn) => {
      bar.innerHTML = `
        <span class="tm-select-count">เลือก ${selected.size}/${media.length} รายการ</span>
        <div class="tm-select-actions">
          <button type="button" class="tm-btn-sub" data-action="all">เลือกทั้งหมด</button>
          <button type="button" class="tm-btn-primary" data-action="dl">ดาวน์โหลด (${selected.size})</button>
          <button type="button" class="tm-btn-cancel" data-action="cancel">ยกเลิก</button>
        </div>
      `;

      bar.querySelector('[data-action="all"]').onclick = (e) => {
        e.stopPropagation();
        const all = selected.size === media.length;
        card.querySelectorAll('.tm-checkbox-pill').forEach((pill, idx) => {
          if (all) { selected.delete(idx); pill.classList.remove('active'); }
          else { selected.add(idx); pill.classList.add('active'); }
        });
        TM_Selector.renderBarContent(bar, card, selected, media, author, postId, anchorBtn);
      };

      bar.querySelector('[data-action="dl"]').onclick = (e) => {
        e.stopPropagation();
        if (selected.size === 0) return showToast('⚠️ กรุณาเลือกอย่างน้อย 1 รายการ');
        const filtered = media.filter((_, i) => selected.has(i));
        TM_Selector.cleanup(card);
        TM_Downloader.downloadBatch(filtered, author, postId, anchorBtn, TM_Config.get(CONFIG_KEYS.DOWNLOAD_MODE, 'zip'));
      };

      bar.querySelector('[data-action="cancel"]').onclick = (e) => { e.stopPropagation(); TM_Selector.cleanup(card); };
    },

    updateBar: (card, count) => {
      const countEl = card.querySelector('.tm-select-count');
      const dlBtn = card.querySelector('[data-action="dl"]');
      if (countEl) countEl.textContent = `เลือก ${count} รายการ`;
      if (dlBtn) dlBtn.textContent = `ดาวน์โหลด (${count})`;
    },

    cleanup: (card) => {
      card.querySelectorAll('.tm-checkbox-pill').forEach(p => p.remove());
      card.querySelector('.tm-select-bar')?.remove();
    }
  };

  /* ─── 9. VIDEO PLAYER BOOSTER ─────────────────────────────── */
  const TM_Video = {
    speeds: [1.0, 1.25, 1.5, 2.0],

    init: () => {
      document.querySelectorAll('video:not([data-tm-boosted])').forEach(TM_Video.enhance);
    },

    enhance: (video) => {
      video.dataset.tmBoosted = 'true';
      video.volume = Math.max(0, Math.min(1, TM_Config.get(CONFIG_KEYS.VIDEO_VOLUME, 0.8)));

      video.addEventListener('volumechange', () => {
        if (!video.muted) TM_Config.set(CONFIG_KEYS.VIDEO_VOLUME, video.volume);
      });

      const parent = video.parentElement;
      if (!parent || parent.querySelector('.tm-video-controls')) return;

      const ctrl = document.createElement('div');
      ctrl.className = 'tm-video-controls';
      let speedIdx = 0;

      ctrl.innerHTML = `
        <button type="button" class="tm-video-btn tm-speed-btn" title="คลิกสลับความเร็ว">1.0x</button>
        <button type="button" class="tm-video-btn tm-pip-btn" title="Picture-in-Picture">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="4" width="20" height="16" rx="2"></rect>
            <rect x="13" y="11" width="7" height="7" rx="1" fill="currentColor"></rect>
          </svg>
        </button>
      `;

      ctrl.querySelector('.tm-speed-btn').onclick = (e) => {
        e.stopPropagation(); e.preventDefault();
        speedIdx = (speedIdx + 1) % TM_Video.speeds.length;
        video.playbackRate = TM_Video.speeds[speedIdx];
        e.target.textContent = `${TM_Video.speeds[speedIdx]}x`;
      };

      ctrl.querySelector('.tm-pip-btn').onclick = async (e) => {
        e.stopPropagation(); e.preventDefault();
        try {
          if (document.pictureInPictureElement === video) await document.exitPictureInPicture();
          else if (document.pictureInPictureEnabled) await video.requestPictureInPicture();
          else showToast('⚠️ เบราว์เซอร์ไม่รองรับโหมด PiP');
        } catch {}
      };

      parent.style.position = 'relative';
      parent.appendChild(ctrl);
    }
  };

  /* ─── 10. SMART CONFIGURABLE TIMESTAMP ────────────────────── */
  const TM_Timestamp = {
    updateAll: () => {
      const mode = TM_Config.get(CONFIG_KEYS.TIMESTAMP_MODE, 'hybrid');
      document.querySelectorAll('time[datetime]').forEach(timeEl => {
        const iso = timeEl.getAttribute('datetime');
        if (!iso) return;
        if (!timeEl.dataset.tmOrig) timeEl.dataset.tmOrig = timeEl.innerText.trim();
        const d = new Date(iso);
        if (isNaN(d.getTime())) return;

        if (mode === 'native') timeEl.innerText = timeEl.dataset.tmOrig;
        else if (mode === 'absolute') timeEl.innerText = TM_Timestamp.formatAbsolute(d);
        else if (mode === 'hybrid') timeEl.innerText = TM_Timestamp.formatHybrid(timeEl.dataset.tmOrig, d);
      });
    },

    formatAbsolute: d => {
      const pad = n => String(n).padStart(2, '0');
      return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },

    formatHybrid: (orig, d) => `${orig} (${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')})`
  };

  /* ─── 11. VIRAL VELOCITY RADAR (Phase 3) ──────────────────── */
  const TM_ViralRadar = {
    scan: () => {
      if (!TM_Config.get(CONFIG_KEYS.VIRAL_RADAR, true)) return;

      TM_DOM.findShareButtons().forEach(s => {
        const card = TM_DOM.findPostCard(s.actionRow);
        if (!card || card.querySelector('.tm-viral-badge')) return;

        const meta = TM_DOM.getPostMetadata(card);
        if (!meta.postDate) return;

        const ageMinutes = Math.max(1, (Date.now() - meta.postDate.getTime()) / 60000);
        const velocity = (meta.replies * 2 + meta.reposts * 1.5) / ageMinutes;

        if (ageMinutes <= 180 && meta.replies < 50 && velocity >= 0.1) {
          const header = card.querySelector('a[href*="/@"]')?.parentElement || card.querySelector('time')?.parentElement;
          if (header && !header.querySelector('.tm-viral-badge')) {
            const badge = document.createElement('span');
            badge.className = 'tm-viral-badge';
            const rate = Math.round(velocity * 60);
            badge.title = `Viral Radar: ~${rate} เอนเกจเมนต์/ชม.`;
            badge.innerHTML = `⚡ Rising (${rate}/hr)`;
            header.appendChild(badge);
          }
        }
      });
      TM_ViralRadar.applyFilter();
    },

    applyFilter: () => {
      const active = TM_Config.get(CONFIG_KEYS.FILTER_RISING, false);
      TM_DOM.findShareButtons().forEach(s => {
        const card = TM_DOM.findPostCard(s.actionRow);
        if (card) card.style.display = active && !card.querySelector('.tm-viral-badge') ? 'none' : '';
      });
    },

    injectFilterBar: () => {
      if (document.getElementById('tm-feed-filter-bar')) { TM_ViralRadar.updateFilterBarUI(); return; }
      const container = document.querySelector('main, [role="main"]');
      if (!container) return;

      const bar = document.createElement('div');
      bar.id = 'tm-feed-filter-bar';
      bar.className = 'tm-feed-filter-bar';
      bar.innerHTML = `
        <div class="tm-filter-pills">
          <button type="button" class="tm-filter-pill active" data-filter="all">ทั้งหมด</button>
          <button type="button" class="tm-filter-pill" data-filter="rising">🔥 Rising Radar</button>
        </div>
      `;

      bar.querySelectorAll('.tm-filter-pill').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const isRising = btn.dataset.filter === 'rising';
          TM_Config.set(CONFIG_KEYS.FILTER_RISING, isRising);
          TM_ViralRadar.updateFilterBarUI();
          TM_ViralRadar.applyFilter();
          showToast(isRising ? '🔥 แสดงเฉพาะโพสต์เรดาร์พุ่งแรง' : 'แสดงโพสต์ทั้งหมด');
        };
      });

      container.insertBefore(bar, container.firstChild);
      TM_ViralRadar.updateFilterBarUI();
    },

    updateFilterBarUI: () => {
      const bar = document.getElementById('tm-feed-filter-bar');
      if (!bar) return;
      const isRising = TM_Config.get(CONFIG_KEYS.FILTER_RISING, false);
      bar.querySelectorAll('.tm-filter-pill').forEach(b => b.classList.toggle('active', (b.dataset.filter === 'rising') === isRising));
    }
  };

  /* ─── 12. THREAD UNROLLER & CLEAN READER (Phase 2) ────────── */
  const TM_Unroller = {
    open: (author, postId) => {
      const opPosts = [];
      TM_DOM.findShareButtons().map(s => TM_DOM.findPostCard(s.actionRow)).forEach(c => {
        const meta = TM_DOM.getPostMetadata(c);
        if (meta.author.toLowerCase() === author.toLowerCase() && meta.text.length > 0) {
          if (!opPosts.some(p => p.text === meta.text)) opPosts.push(meta);
        }
      });

      if (opPosts.length === 0) return showToast('⚠️ ไม่พบบทสนทนาต่อเนื่องของเจ้าของโพสต์');

      let modal = document.getElementById('tm-reader-modal');
      if (modal) modal.remove();

      modal = document.createElement('div');
      modal.id = 'tm-reader-modal';
      modal.innerHTML = `
        <div class="tm-reader-overlay"></div>
        <div class="tm-reader-card">
          <div class="tm-reader-header">
            <div>
              <div class="tm-reader-title">📖 Thread Unroller</div>
              <div class="tm-reader-author">@${author} • ${opPosts.length} โพสต์ต่อเนื่อง</div>
            </div>
            <div class="tm-reader-header-actions">
              <button type="button" class="tm-btn-primary" id="tm-copy-md">📥 คัดลอก Markdown</button>
              <button type="button" class="tm-btn-sub" id="tm-close-reader">✕ ปิด</button>
            </div>
          </div>
          <div class="tm-reader-body">
            ${opPosts.map((p, idx) => `
              <div class="tm-reader-segment">
                <div class="tm-segment-badge">${idx + 1}/${opPosts.length}</div>
                <div class="tm-segment-text">${escapeHtml(p.text).replace(/\\n/g, '<br>')}</div>
                ${p.media.length > 0 ? `<div class="tm-segment-media-hint">📷 แนบมีเดีย ${p.media.length} รายการ</div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      const close = () => { document.removeEventListener('keydown', onEsc); modal.remove(); };
      const onEsc = (e) => { if (e.key === 'Escape') close(); };
      document.addEventListener('keydown', onEsc);

      modal.querySelector('#tm-copy-md').onclick = () => {
        const md = `# Thread by @${author}\\n\\nURL: https://www.threads.com/@${author}/post/${postId}\\n\\n---\\n\\n` +
          opPosts.map((p, i) => `### [${i + 1}/${opPosts.length}]\\n\\n${p.text}\\n`).join('\\n---\\n\\n');
        navigator.clipboard.writeText(md).then(() => showToast('✓ คัดลอก Markdown ทั้งเธรดแล้ว'));
      };

      modal.querySelector('#tm-close-reader').onclick = close;
      modal.querySelector('.tm-reader-overlay').onclick = close;
    }
  };

  /* ─── 13. COMPOSER HOOK GUIDE & AUTO-SPLITTER (Phase 2) ───── */
  const TM_Composer = {
    init: () => {
      document.querySelectorAll('div[role="textbox"][contenteditable="true"]:not([data-tm-composer])').forEach(TM_Composer.enhance);
    },

    enhance: (textbox) => {
      textbox.dataset.tmComposer = 'true';
      const parent = textbox.closest('form') || textbox.parentElement;
      if (!parent || parent.querySelector('.tm-composer-bar')) return;

      const bar = document.createElement('div');
      bar.className = 'tm-composer-bar';
      bar.innerHTML = `
        <div class="tm-composer-left">
          <span class="tm-hook-status"></span>
          <button type="button" class="tm-split-btn" style="display:none;">✂️ แบ่งเธรดอัตโนมัติ</button>
        </div>
        <span class="tm-char-count">0 / 500</span>
      `;
      parent.appendChild(bar);

      const countEl = bar.querySelector('.tm-char-count');
      const hookEl = bar.querySelector('.tm-hook-status');
      const splitBtn = bar.querySelector('.tm-split-btn');

      splitBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); TM_Splitter.open(textbox.innerText.trim()); };

      const update = () => {
        const len = textbox.innerText.trim().length;
        countEl.textContent = `${len} / 500`;
        if (len === 0) { hookEl.textContent = ''; hookEl.className = 'tm-hook-status'; splitBtn.style.display = 'none'; }
        else if (len <= 180) { hookEl.textContent = '✨ Hook ปลอดภัย (ไม่ถูกซ่อนบนจอมือถือ)'; hookEl.className = 'tm-hook-status tm-hook-safe'; splitBtn.style.display = 'none'; }
        else if (len <= 500) { hookEl.textContent = '📍 เกิน 180 อักษร (จะถูกซ่อนหลัง "...ดูเพิ่มเติม")'; hookEl.className = 'tm-hook-status tm-hook-cut'; splitBtn.style.display = 'none'; }
        else { hookEl.textContent = '⚠️ ข้อความยาวเกิน 500 อักษร'; hookEl.className = 'tm-hook-status tm-hook-over'; splitBtn.style.display = 'inline-flex'; }
      };

      textbox.addEventListener('input', update);
      textbox.addEventListener('keyup', update);
      update();
    }
  };

  /* ─── 14. ONE-CLICK THREAD SPLITTER (Phase 2.3) ────────────── */
  const TM_Splitter = {
    splitText: (text, maxLen = 460) => {
      if (!text || text.length <= maxLen) return [text];
      const paragraphs = text.split(/\n\s*\n/), chunks = [];
      let current = '';

      for (const p of paragraphs) {
        if ((current + (current ? '\n\n' : '') + p).length <= maxLen) {
          current = current + (current ? '\n\n' : '') + p;
        } else {
          if (current) { chunks.push(current); current = ''; }
          if (p.length <= maxLen) current = p;
          else {
            const sentences = p.split(/(?<=[.!?\n])\s+/);
            for (const s of sentences) {
              if ((current + (current ? ' ' : '') + s).length <= maxLen) current = current + (current ? ' ' : '') + s;
              else { if (current) chunks.push(current); current = s; }
            }
          }
        }
      }
      if (current) chunks.push(current);
      return chunks;
    },

    open: (rawText) => {
      const chunks = TM_Splitter.splitText(rawText);
      const total = chunks.length;

      let modal = document.getElementById('tm-splitter-modal');
      if (modal) modal.remove();

      modal = document.createElement('div');
      modal.id = 'tm-splitter-modal';
      modal.innerHTML = `
        <div class="tm-reader-overlay"></div>
        <div class="tm-reader-card">
          <div class="tm-reader-header">
            <div>
              <div class="tm-reader-title">✂️ Thread Splitter</div>
              <div class="tm-reader-author">แบ่งออกเป็น ${total} ท่อนย่อยพร้อมเลขกำกับ (1/N)</div>
            </div>
            <div class="tm-reader-header-actions">
              <button type="button" class="tm-btn-primary" id="tm-copy-all-split">📋 คัดลอกทั้งหมด</button>
              <button type="button" class="tm-btn-sub" id="tm-close-split">✕ ปิด</button>
            </div>
          </div>
          <div class="tm-reader-body">
            ${chunks.map((c, i) => `
              <div class="tm-split-item">
                <div class="tm-split-item-header">
                  <span class="tm-segment-badge">${i + 1}/${total} (${c.length} อักษร)</span>
                  <button type="button" class="tm-btn-sub tm-copy-chunk" data-index="${i}">📋 คัดลอกท่อนนี้</button>
                </div>
                <div class="tm-split-text">${escapeHtml(c)}</div>
              </div>
            `).join('')}
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      modal.querySelectorAll('.tm-copy-chunk').forEach(btn => {
        btn.onclick = () => {
          const idx = parseInt(btn.dataset.index, 10);
          navigator.clipboard.writeText(`${idx + 1}/${total}\n\n${chunks[idx]}`).then(() => showToast(`✓ คัดลอกท่อนที่ ${idx + 1}/${total} แล้ว`));
        };
      });

      modal.querySelector('#tm-copy-all-split').onclick = () => {
        navigator.clipboard.writeText(chunks.map((c, i) => `[${i + 1}/${total}]\n${c}`).join('\n\n---\n\n')).then(() => showToast('✓ คัดลอกเธรดทั้งหมด'));
      };

      const close = () => modal.remove();
      modal.querySelector('#tm-close-split').onclick = close;
      modal.querySelector('.tm-reader-overlay').onclick = close;
    }
  };

  /* ─── 15. RELATIONSHIP RADAR & MUTUAL AUDITOR (Phase 3.2) ─── */
  const TM_RelationshipAuditor = {
    isScanning: false,
    abortController: null,
    _isSwitchingTab: false,
    _isTabTransitioning: false,

    detectUsername: () => {
      const match = window.location.pathname.match(/^\/@([^/?#]+)/);
      if (match && !['explore', 'search', 'activity', 'messages', 'settings'].includes(match[1])) return match[1];
      const link = document.querySelector('a[href^="/@"]:not([href*="/post/"]), a[href*="/@"]');
      return link ? (link.getAttribute('href') || '').match(/@([^/?#]+)/)?.[1] || null : null;
    },

    sleepJitter: (min = 3000, max = 5000) => new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min)),

    fetchUserId: async (username) => {
      if (!username) return null;
      const clean = String(username).replace(/^@/, '').toLowerCase().trim();
      const validate = id => {
        const s = String(id || '').trim();
        if (/^\d{4,25}$/.test(s) && s !== '0') {
          try { TM_Config.set(`tm_uid_${clean}`, s); } catch {}
          return s;
        }
        return null;
      };

      // Tiers 0-2: Cached, cookie, DOM meta
      const cached = TM_Config.get(`tm_uid_${clean}`, null);
      if (validate(cached)) return cached;

      const cookieUid = document.cookie.match(/(?:^|;\s*)ds_user_id=(\d+)/)?.[1];
      if (validate(cookieUid)) return cookieUid;

      const deepLink = document.querySelector('meta[content*="user?id="], link[href*="user?id="]')?.getAttribute('content');
      const mDeep = deepLink?.match(/(?:barcelona|instagram):\/\/user\?id=(\d+)/i);
      if (mDeep && validate(mDeep[1])) return mDeep[1];

      // Tier 3: In-page script slice
      for (const s of document.querySelectorAll('script')) {
        const text = s.textContent || '';
        const idx = text.indexOf(clean);
        if (idx !== -1) {
          const slice = text.substring(Math.max(0, idx - 600), Math.min(text.length, idx + 600));
          const m = slice.match(/"(?:pk|user_id|target_user_id|profile_id)":"?(\d{4,25})"?/);
          if (m && validate(m[1])) return m[1];
        }
      }

      // Tier 4: Same-origin HTML fetch
      try {
        const res = await fetch(`${window.location.origin || 'https://www.threads.net'}/@${encodeURIComponent(clean)}`, { credentials: 'include' });
        if (res.ok) {
          const html = await res.text();
          const m = html.match(/(?:barcelona|instagram):\/\/user\?id=(\d+)/i) || html.match(/"(?:pk|user_id)":"?(\d{4,25})"?/);
          if (m && validate(m[1])) return m[1];
        }
      } catch {}

      return null;
    },

    fetchGraphQLList: async (type, userId, onProgress, signal) => {
      const baseOrigin = window.location.origin || 'https://www.threads.com';
      const lsd = document.querySelector('input[name="lsd"]')?.value || (typeof unsafeWindow !== 'undefined' && unsafeWindow.LSD?.token) || '';
      const docId = TM_Config.get(`tm_doc_${type}`, null);
      if (!docId) throw new Error('NO_DOC_ID');

      const usernames = [];
      let afterCursor = null, hasNext = true, page = 0;

      while (hasNext && !signal.aborted) {
        page++;
        const form = new URLSearchParams();
        if (lsd) form.set('lsd', lsd);
        form.set('variables', JSON.stringify({ userID: userId, first: 50, after: afterCursor }));
        form.set('doc_id', docId);

        await TM_RateLimiters.graphql.consume(1);
        const res = await fetch(`${baseOrigin}/api/graphql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-IG-App-ID': '238260118658252',
            'X-FB-LSD': lsd,
            'X-Requested-With': 'XMLHttpRequest'
          },
          credentials: 'include',
          body: form.toString(),
          signal
        });

        if (!res.ok) throw new Error(`GRAPHQL_${res.status}`);
        const json = await res.json();
        const edgeData = type === 'followers'
          ? (json?.data?.user?.edge_followed_by || json?.data?.viewer?.user?.edge_followed_by)
          : (json?.data?.user?.edge_follow || json?.data?.viewer?.user?.edge_follow);

        (edgeData?.edges || []).forEach(e => {
          const u = e.node?.username;
          if (u && !usernames.includes(u.toLowerCase())) usernames.push(u.toLowerCase());
        });

        if (typeof onProgress === 'function') onProgress(type, usernames.length, page);

        hasNext = edgeData?.page_info?.has_next_page || false;
        afterCursor = edgeData?.page_info?.end_cursor || null;
        if (hasNext && !signal.aborted) await TM_RelationshipAuditor.sleepJitter(2000, 3500);
      }
      return usernames;
    },

    unfollowUser: async (username, explicitUserId = null) => {
      const cleanUser = String(username).replace(/^@/, '').toLowerCase().trim();
      const uid = explicitUserId || await TM_RelationshipAuditor.fetchUserId(cleanUser);
      if (!uid) { window.open(`https://www.threads.net/@${cleanUser}`, '_blank', 'noopener'); throw new Error('USER_ID_NOT_FOUND'); }

      const csrf = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]*)/)?.[1] || '';
      const lsd = document.querySelector('input[name="lsd"]')?.value || (typeof unsafeWindow !== 'undefined' && unsafeWindow.LSD?.token) || '';
      const origin = window.location.origin || 'https://www.threads.com';

      const routes = [
        {
          url: `${origin}/api/v1/friendships/destroy/${uid}/`,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-IG-App-ID': '238260118658252', 'X-CSRFToken': csrf, 'X-FB-LSD': lsd, 'X-Requested-With': 'XMLHttpRequest' },
          body: new URLSearchParams({ user_id: uid, radio_type: 'wifi-none' }).toString()
        },
        {
          url: `${origin}/web/friendships/${uid}/unfollow/`,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRFToken': csrf, 'X-Requested-With': 'XMLHttpRequest' },
          body: ''
        }
      ];

      for (const route of routes) {
        try {
          const res = await fetch(route.url, { method: 'POST', headers: route.headers, credentials: 'include', body: route.body || undefined });
          if (res.ok) {
            const j = await res.json().catch(() => ({}));
            if (j.status === 'ok' || j.friendship_status?.following === false) return true;
          }
        } catch {}
      }
      throw new Error('UNFOLLOW_FAILED');
    },

    findAllScrollContainers: (dialog) => {
      if (!dialog) return [];
      const set = new Set();
      const links = dialog.querySelectorAll('a[href*="/@"]:not([href*="/post/"])');
      for (let i = 0; i < Math.min(3, links.length); i++) {
        let p = links[i].parentElement;
        while (p && p !== dialog && p !== document.body) {
          if (p.scrollHeight > p.clientHeight + 10 && p.clientHeight > 60) { set.add(p); break; }
          p = p.parentElement;
        }
        if (set.size > 0) break;
      }
      return set.size > 0 ? Array.from(set) : [dialog];
    },

    clickTab: (el) => {
      if (!el || TM_RelationshipAuditor._isSwitchingTab) return;
      TM_RelationshipAuditor._isSwitchingTab = true;
      const target = el.closest('a, button, [role="tab"], [role="button"]') || el;
      try {
        const ev = { bubbles: true, cancelable: true, view: window };
        target.dispatchEvent(new MouseEvent('click', ev));
        if (typeof target.click === 'function') target.click();
      } catch {}
      setTimeout(() => { TM_RelationshipAuditor._isSwitchingTab = false; }, 250);
    },

    findModalTabs: (dialog) => {
      if (!dialog) return { followersTab: null, followingTab: null };
      let followersTab = dialog.querySelector('a[href*="/followers"], a[href$="followers"]');
      let followingTab = dialog.querySelector('a[href*="/following"], a[href$="following"]');
      if (followersTab && followingTab) return { followersTab, followingTab };

      dialog.querySelectorAll('[role="tab"], [role="button"], a, button').forEach(el => {
        const s = `${el.textContent} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
        if (!followersTab && (s.includes('ผู้ติดตาม') || s.includes('follower'))) followersTab = el;
        if (!followingTab && (s.includes('กำลังติดตาม') || s.includes('following'))) followingTab = el;
      });
      return { followersTab, followingTab };
    },

    extractNumberFromText: (str) => {
      const m = String(str || '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([kmb])?/i);
      if (!m) return 0;
      let n = parseFloat(m[1]), suf = (m[2] || '').toLowerCase();
      return Math.round(n * ({ k: 1e3, m: 1e6, b: 1e9 }[suf] || 1));
    },

    liveState: {
      isCapturing: false, targetUsername: '', activeTab: 'followers',
      followers: new Set(), following: new Set(), followersTarget: 0, followingTarget: 0,
      timer: null, cleanup: null, onUpdate: null
    },

    autoScrollState: { isActive: false, timer: null, container: null, idleTicks: 0, lastCount: 0 },

    startAutoScroll: (onTick) => {
      if (TM_RelationshipAuditor.autoScrollState.isActive) return;
      TM_RelationshipAuditor.autoScrollState.isActive = true;
      TM_RelationshipAuditor.autoScrollState.idleTicks = 0;
      TM_RelationshipAuditor.autoScrollState.lastCount = 0;

      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return TM_RelationshipAuditor.stopAutoScroll();

      TM_RelationshipAuditor.autoScrollState.container = TM_RelationshipAuditor.findAllScrollContainers(dialog)[0] || dialog;

      TM_RelationshipAuditor.autoScrollState.timer = setInterval(() => {
        if (!TM_RelationshipAuditor.autoScrollState.isActive) return;
        const curDialog = document.querySelector('[role="dialog"]');
        if (!curDialog) return TM_RelationshipAuditor.stopAutoScroll();

        let c = TM_RelationshipAuditor.autoScrollState.container;
        if (!c || !curDialog.contains(c)) {
          c = TM_RelationshipAuditor.findAllScrollContainers(curDialog)[0] || curDialog;
          TM_RelationshipAuditor.autoScrollState.container = c;
        }

        const max = c.scrollHeight - c.clientHeight, prev = c.scrollTop;
        const step = Math.max(300, Math.min(600, Math.round(c.clientHeight * 0.85)));

        if (max > 0) {
          c.scrollTop = Math.min(max, c.scrollTop + step);
          c.dispatchEvent(new Event('scroll', { bubbles: true }));
        }

        const rows = curDialog.querySelectorAll('a[href*="/@"]:not([href*="/post/"])');
        const count = rows.length;
        const target = TM_RelationshipAuditor.liveState.activeTab === 'following'
          ? TM_RelationshipAuditor.liveState.followingTarget : TM_RelationshipAuditor.liveState.followersTarget;

        if ((target > 0 && count >= target) || (c.scrollTop >= max - 30 && count === TM_RelationshipAuditor.autoScrollState.lastCount)) {
          TM_RelationshipAuditor.autoScrollState.idleTicks++;
          if (TM_RelationshipAuditor.autoScrollState.idleTicks >= 5) {
            TM_RelationshipAuditor.stopAutoScroll();
            TM_RelationshipAuditor.onAutoScrollComplete?.(count);
            return;
          }
        } else {
          TM_RelationshipAuditor.autoScrollState.idleTicks = 0;
          TM_RelationshipAuditor.autoScrollState.lastCount = count;
        }
        if (typeof onTick === 'function') onTick();
      }, 450);
    },

    stopAutoScroll: () => {
      TM_RelationshipAuditor.autoScrollState.isActive = false;
      if (TM_RelationshipAuditor.autoScrollState.timer) { clearInterval(TM_RelationshipAuditor.autoScrollState.timer); TM_RelationshipAuditor.autoScrollState.timer = null; }
      TM_RelationshipAuditor.autoScrollState.container = null;
    },

    toggleAutoScroll: (onTick) => {
      if (TM_RelationshipAuditor.autoScrollState.isActive) { TM_RelationshipAuditor.stopAutoScroll(); return false; }
      TM_RelationshipAuditor.startAutoScroll(onTick); return true;
    },

    detectActiveTab: (dialog) => {
      const path = (window.location.pathname || '').toLowerCase();
      if (path.includes('/following')) return 'following';
      if (path.includes('/followers')) return 'followers';
      if (!dialog) return null;
      const { followersTab, followingTab } = TM_RelationshipAuditor.findModalTabs(dialog);
      if (followingTab?.getAttribute('aria-selected') === 'true' || followingTab?.querySelector('[aria-selected="true"]')) return 'following';
      if (followersTab?.getAttribute('aria-selected') === 'true' || followersTab?.querySelector('[aria-selected="true"]')) return 'followers';
      return null;
    },

    extractUsernamesFromDialog: (dialog) => {
      if (!dialog) return [];
      const set = new Set();
      dialog.querySelectorAll('a[href*="/@"]:not([href*="/post/"])').forEach(a => {
        const m = (a.getAttribute('href') || '').match(/@([^/?#]+)/);
        if (m && !['post', 'explore', 'search', 'activity', 'messages', 'settings'].includes(m[1].toLowerCase())) set.add(m[1].toLowerCase());
      });
      return Array.from(set);
    },

    extractUsernamesIncremental: (dialog, targetSet, activeTab = 'followers') => {
      if (!dialog) return 0;
      let count = 0;
      dialog.querySelectorAll('a[href*="/@"]:not([href*="/post/"])').forEach(a => {
        if (a._tmCapturedTab === activeTab) return;
        a._tmCapturedTab = activeTab;
        const m = (a.getAttribute('href') || '').match(/@([^/?#]+)/);
        if (m && !['post', 'explore', 'search', 'activity', 'messages', 'settings'].includes(m[1].toLowerCase())) {
          targetSet.add(m[1].toLowerCase());
          count++;
        }
      });
      return count;
    },

    startLiveCapture: (targetUsername, onUpdate) => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return false;

      const { followersTab, followingTab } = TM_RelationshipAuditor.findModalTabs(dialog);
      TM_RelationshipAuditor.stopLiveCapture();

      TM_RelationshipAuditor.liveState = {
        isCapturing: true,
        targetUsername: targetUsername || 'user',
        activeTab: TM_RelationshipAuditor.detectActiveTab(dialog) || 'followers',
        followers: new Set(),
        following: new Set(),
        followersTarget: followersTab ? TM_RelationshipAuditor.extractNumberFromText(followersTab.textContent) : 0,
        followingTarget: followingTab ? TM_RelationshipAuditor.extractNumberFromText(followingTab.textContent) : 0,
        timer: null,
        cleanup: null,
        onUpdate
      };

      const sniff = () => {
        if (!TM_RelationshipAuditor.liveState.isCapturing || TM_RelationshipAuditor._isTabTransitioning) return;
        const curDialog = document.querySelector('[role="dialog"]');
        if (!curDialog) return;

        const realTab = TM_RelationshipAuditor.detectActiveTab(curDialog);
        if (realTab && realTab !== TM_RelationshipAuditor.liveState.activeTab) {
          TM_RelationshipAuditor.switchLiveTab(realTab, false);
          return;
        }

        const curTab = TM_RelationshipAuditor.liveState.activeTab;
        TM_RelationshipAuditor.extractUsernamesIncremental(curDialog, TM_RelationshipAuditor.liveState[curTab], curTab);

        TM_RelationshipAuditor.liveState.onUpdate?.({
          followersCount: TM_RelationshipAuditor.liveState.followers.size,
          followingCount: TM_RelationshipAuditor.liveState.following.size,
          followersTarget: TM_RelationshipAuditor.liveState.followersTarget,
          followingTarget: TM_RelationshipAuditor.liveState.followingTarget,
          activeTab: TM_RelationshipAuditor.liveState.activeTab
        });
      };

      sniff();
      TM_RelationshipAuditor.liveState.timer = setInterval(sniff, 350);
      return true;
    },

    switchLiveTab: (tabName, shouldClickDOM = true) => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return;

      TM_RelationshipAuditor.stopAutoScroll();
      TM_RelationshipAuditor.onAutoScrollReset?.();
      TM_RelationshipAuditor._isTabTransitioning = true;
      TM_RelationshipAuditor.liveState.activeTab = tabName;

      if (shouldClickDOM) {
        const { followersTab, followingTab } = TM_RelationshipAuditor.findModalTabs(dialog);
        TM_RelationshipAuditor.clickTab(tabName === 'followers' ? followersTab : followingTab);
      }

      TM_RelationshipAuditor.liveState.onUpdate?.({
        followersCount: TM_RelationshipAuditor.liveState.followers.size,
        followingCount: TM_RelationshipAuditor.liveState.following.size,
        followersTarget: TM_RelationshipAuditor.liveState.followersTarget,
        followingTarget: TM_RelationshipAuditor.liveState.followingTarget,
        activeTab: TM_RelationshipAuditor.liveState.activeTab
      });

      setTimeout(() => { TM_RelationshipAuditor._isTabTransitioning = false; }, 600);
    },

    stopLiveCapture: () => {
      TM_RelationshipAuditor.stopAutoScroll();
      if (TM_RelationshipAuditor.liveState.timer) { clearInterval(TM_RelationshipAuditor.liveState.timer); TM_RelationshipAuditor.liveState.timer = null; }
      TM_RelationshipAuditor.liveState.isCapturing = false;
    },

    finishLiveCapture: async () => {
      TM_RelationshipAuditor.stopAutoScroll();
      const followers = Array.from(TM_RelationshipAuditor.liveState.followers);
      const following = Array.from(TM_RelationshipAuditor.liveState.following);
      const username = TM_RelationshipAuditor.liveState.targetUsername || 'user';
      TM_RelationshipAuditor.stopLiveCapture();

      if (followers.length === 0 && following.length === 0) {
        throw new Error('ไม่พบบัญชีที่กวาดได้ กรุณาเลื่อนดูรายชื่อในหน้าต่างก่อนคำนวณค่ะ');
      }

      const prev = await TM_DB.getLatestSnapshot();
      const diff = TM_DB.computeRelationshipDiff(followers, following, prev);
      const savedRecord = await TM_DB.saveSnapshot({ username, followers, following, diff });
      return { followers, following, diff, savedRecord };
    },

    // ponytail: unified modal harvesting contract with safe fallback
    harvestFromModal: async (onProgress, signal) => {
      if (TM_RelationshipAuditor.liveState.isCapturing && (TM_RelationshipAuditor.liveState.followers.size > 0 || TM_RelationshipAuditor.liveState.following.size > 0)) {
        return TM_RelationshipAuditor.finishLiveCapture();
      }
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) throw new Error('ไม่พบหน้าต่างรายชื่อ');
      const active = TM_RelationshipAuditor.detectActiveTab(dialog) || 'followers';
      const accounts = TM_RelationshipAuditor.extractUsernamesFromDialog(dialog);
      const followers = active === 'followers' ? accounts : [];
      const following = active === 'following' ? accounts : [];
      const prev = await TM_DB.getLatestSnapshot();
      const diff = TM_DB.computeRelationshipDiff(followers, following, prev);
      const savedRecord = await TM_DB.saveSnapshot({ username: 'me', followers, following, diff });
      return { followers, following, diff, savedRecord };
    },

    // Alias for backward compatibility & safety
    harvestTwoWayModal: async (onProgress, signal) => TM_RelationshipAuditor.harvestFromModal(onProgress, signal),

    startScan: async (targetUsername, onProgress, mode = 'auto') => {
      if (TM_RelationshipAuditor.isScanning) return;
      TM_RelationshipAuditor.isScanning = true;
      TM_RelationshipAuditor.abortController = new AbortController();
      const signal = TM_RelationshipAuditor.abortController.signal, start = Date.now();

      try {
        const dialog = document.querySelector('[role="dialog"]');
        if (mode === 'modal' || (mode === 'auto' && dialog)) {
          if (!dialog) throw new Error("ไม่พบหน้าต่างรายชื่อ: กรุณาคลิก 'ผู้ติดตาม' หรือ 'กำลังติดตาม' บนโปรไฟล์ของคุณก่อนค่ะ");
          onProgress({ status: 'modal', text: 'กำลังเชื่อมต่อหน้าต่างรายชื่อบนจอ...' });
          const modalData = await TM_RelationshipAuditor.harvestFromModal(onProgress, signal);
          const elapsed = Math.round((Date.now() - start) / 1000);
          onProgress({
            status: 'done', diff: modalData.diff, record: modalData.savedRecord,
            text: `✓ กวาดสำเร็จใน ${elapsed}s (Followers: ${modalData.followers.length}, Following: ${modalData.following.length})`
          });
          return modalData;
        }

        // Mode B: GraphQL Scan
        const uid = await TM_RelationshipAuditor.fetchUserId(targetUsername);
        if (!uid) throw new Error(`ไม่พบ User ID ของ @${targetUsername}`);

        onProgress({ status: 'following', current: 0, text: 'กำลังดึง Following ผ่าน GraphQL...' });
        const following = await TM_RelationshipAuditor.fetchGraphQLList('following', uid, (t, c) => onProgress({ status: 'following', current: c, text: `กำลังสแกน Following... ได้ ${c} บัญชี` }), signal);
        await TM_RelationshipAuditor.sleepJitter(2000, 3500);

        onProgress({ status: 'followers', current: 0, text: 'กำลังดึง Followers ผ่าน GraphQL...' });
        const followers = await TM_RelationshipAuditor.fetchGraphQLList('followers', uid, (t, c) => onProgress({ status: 'followers', current: c, text: `กำลังสแกน Followers... ได้ ${c} บัญชี` }), signal);

        const prev = await TM_DB.getLatestSnapshot();
        const diff = TM_DB.computeRelationshipDiff(followers, following, prev);
        const record = await TM_DB.saveSnapshot({ username: targetUsername, followers, following, diff });
        const elapsed = Math.round((Date.now() - start) / 1000);
        onProgress({ status: 'done', diff, record, text: `✓ สแกนสำเร็จใน ${elapsed}s (Followers: ${followers.length}, Following: ${following.length})` });
        return { followers, following, diff, savedRecord: record };
      } catch (err) {
        onProgress({ status: err.name === 'AbortError' ? 'aborted' : 'error', text: err.name === 'AbortError' ? '⏹️ ยกเลิกแล้ว' : `⚠️ ${err.message}` });
        throw err;
      } finally {
        TM_RelationshipAuditor.isScanning = false;
        TM_RelationshipAuditor.abortController = null;
      }
    },

    stopScan: () => { TM_RelationshipAuditor.abortController?.abort(); TM_RelationshipAuditor.isScanning = false; }
  };

  /* ─── 16. THREADMAX STUDIO DRAWER (Phase 3.2 UI) ───────────── */
  const TM_Studio = {
    currentTab: 'notback',
    activeDiff: null,

    injectLauncher: () => {
      if (document.getElementById('tm-studio-launcher')) return;
      const btn = document.createElement('div');
      btn.id = 'tm-studio-launcher';
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg><span>ThreadMax Studio</span>`;
      btn.onclick = () => TM_Studio.open();
      document.body.appendChild(btn);
    },

    open: async () => {
      document.getElementById('tm-studio-drawer')?.remove();

      const drawer = document.createElement('div');
      drawer.id = 'tm-studio-drawer';
      drawer.innerHTML = `
        <div class="tm-drawer-overlay"></div>
        <div class="tm-drawer-content">
          <div class="tm-drawer-header">
            <div class="tm-drawer-brand"><span class="tm-brand-icon">⚡</span><div><div class="tm-drawer-title">ThreadMax Studio</div><div class="tm-drawer-subtitle">Growth Intelligence & Precision Suite</div></div></div>
            <button type="button" class="tm-btn-sub" id="tm-close-drawer">✕</button>
          </div>
          <div class="tm-drawer-tabs">
            <div class="tm-drawer-tab active" data-tab="auditor">🔍 Mutual Auditor</div>
            <div class="tm-drawer-tab" data-tab="settings">⚙️ Settings</div>
          </div>
          <div class="tm-drawer-body">
            <div class="tm-tab-pane active" id="pane-auditor">
              <div class="tm-auditor-stats">
                <div class="tm-stat-card" data-category="notback"><div class="tm-stat-num" id="tm-stat-notback">0</div><div class="tm-stat-label">Not Following Back</div></div>
                <div class="tm-stat-card" data-category="fans"><div class="tm-stat-num" id="tm-stat-fans">0</div><div class="tm-stat-label">Fans</div></div>
                <div class="tm-stat-card" data-category="mutual"><div class="tm-stat-num" id="tm-stat-mutual">0</div><div class="tm-stat-label">Mutual</div></div>
                <div class="tm-stat-card" data-category="lost"><div class="tm-stat-num" id="tm-stat-lost">0</div><div class="tm-stat-label">Lost</div></div>
              </div>
              <div class="tm-auditor-actions" id="tm-auditor-idle-actions">
                <button type="button" class="tm-btn-primary tm-btn-pulse" id="tm-start-live-capture">🟢 Start Live Capture</button>
                <div class="tm-auditor-hint">💡 100% Safe: เปิดหน้าต่าง Followers หรือ Following บน Threads จากนั้นกดปุ่มเพื่อเริ่มออดิตแบบเรียลไทม์</div>
              </div>
              <div id="tm-live-capture-box" class="tm-live-capture-box" style="display:none;">
                <div class="tm-live-header"><div class="tm-live-title"><span class="tm-live-dot"></span><span>Live Capture Mode</span></div><span class="tm-live-badge">● CAPTURING</span></div>
                <div class="tm-live-guide">👉 เลื่อนหน้าต่างรายชื่อบนจอ (หรือใช้ Auto-Scroll) บัญชีจะถูกบันทึกอัตโนมัติ</div>
                <div class="tm-live-autoscroll-bar">
                  <button type="button" class="tm-btn-sub tm-btn-autoscroll" id="tm-btn-autoscroll">⚡ Auto-Scroll: Off</button>
                  <span class="tm-autoscroll-desc">เลื่อนลงต่อเนื่องอัตโนมัติเพื่อลดความเมื่อยล้า</span>
                </div>
                <div class="tm-live-cards">
                  <div class="tm-live-card active" id="tm-live-card-followers">
                    <div class="tm-live-card-top"><span class="tm-live-card-name">👥 Followers</span><span class="tm-live-status-pill active" id="tm-live-pill-followers">Scanning 🟢</span></div>
                    <div class="tm-live-card-metric"><span class="tm-live-val" id="tm-live-followers-cnt">0</span><span class="tm-live-max" id="tm-live-followers-total">/ 0</span></div>
                    <button type="button" class="tm-btn-sub tm-btn-switch-tab" id="tm-switch-to-followers">👉 Switch Tab</button>
                  </div>
                  <div class="tm-live-card" id="tm-live-card-following">
                    <div class="tm-live-card-top"><span class="tm-live-card-name">👤 Following</span><span class="tm-live-status-pill" id="tm-live-pill-following">Waiting ⚪</span></div>
                    <div class="tm-live-card-metric"><span class="tm-live-val" id="tm-live-following-cnt">0</span><span class="tm-live-max" id="tm-live-following-total">/ 0</span></div>
                    <button type="button" class="tm-btn-sub tm-btn-switch-tab" id="tm-switch-to-following">👉 Switch Tab</button>
                  </div>
                </div>
                <div class="tm-live-actions">
                  <button type="button" class="tm-btn-primary tm-btn-finish" id="tm-live-finish">✅ Calculate Relationships</button>
                  <button type="button" class="tm-btn-cancel" id="tm-live-cancel">⏹️ Cancel</button>
                </div>
              </div>
              <div class="tm-auditor-subtabs">
                <button type="button" class="tm-subtab active" data-filter="notback">Not Following Back (<span id="cnt-notback">0</span>)</button>
                <button type="button" class="tm-subtab" data-filter="fans">Fans (<span id="cnt-fans">0</span>)</button>
                <button type="button" class="tm-subtab" data-filter="mutual">Mutual (<span id="cnt-mutual">0</span>)</button>
                <button type="button" class="tm-subtab" data-filter="lost">Lost (<span id="cnt-lost">0</span>)</button>
                <button type="button" class="tm-subtab" data-filter="gained">Gained (<span id="cnt-gained">0</span>)</button>
              </div>
              <div class="tm-auditor-toolbar">
                <input type="text" id="tm-auditor-search" class="tm-search-input" placeholder="🔍 ค้นหาชื่อบัญชี..." />
                <button type="button" class="tm-btn-sub" id="tm-copy-auditor-list">📋 Copy List</button>
              </div>
              <div class="tm-auditor-list" id="tm-auditor-list"><div class="tm-empty-state">กด "Start Live Capture" เพื่อตรวจสอบความสัมพันธ์</div></div>
            </div>
            <div class="tm-tab-pane" id="pane-settings">
              <div class="tm-setting-row"><div><div class="tm-setting-title">Media Download Mode</div><div class="tm-setting-desc">รวมไฟล์ ZIP หรือแยกโหลดทีละไฟล์</div></div><select class="tm-select" id="tm-opt-download"><option value="zip">ZIP Archive (.zip)</option><option value="individual">Individual Files</option></select></div>
              <div class="tm-setting-row"><div><div class="tm-setting-title">Timestamp Format</div><div class="tm-setting-desc">รูปแบบการแสดงเวลาในโพสต์</div></div><select class="tm-select" id="tm-opt-timestamp"><option value="hybrid">Hybrid (2h (14:30))</option><option value="absolute">Absolute</option><option value="native">Native</option></select></div>
              <div class="tm-setting-row"><div><div class="tm-setting-title">Viral Velocity Radar</div><div class="tm-setting-desc">แสดงป้าย ⚡ Rising โพสต์พุ่งแรง (&lt; 50 คอมเมนต์)</div></div><input type="checkbox" id="tm-opt-viral" class="tm-checkbox" /></div>
              <div class="tm-setting-row"><div><div class="tm-setting-title">Rising Radar Feed Filter</div><div class="tm-setting-desc">กรองฟีดแสดงเฉพาะโพสต์ Rising</div></div><input type="checkbox" id="tm-opt-filter-rising" class="tm-checkbox" /></div>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(drawer);

      // Tabs
      drawer.querySelectorAll('.tm-drawer-tab').forEach(tab => {
        tab.onclick = () => {
          drawer.querySelectorAll('.tm-drawer-tab').forEach(t => t.classList.remove('active'));
          drawer.querySelectorAll('.tm-tab-pane').forEach(p => p.classList.remove('active'));
          tab.classList.add('active');
          drawer.querySelector(`#pane-${tab.dataset.tab}`).classList.add('active');
        };
      });

      // Settings binding
      const dlSel = drawer.querySelector('#tm-opt-download');
      dlSel.value = TM_Config.get(CONFIG_KEYS.DOWNLOAD_MODE, 'zip');
      dlSel.onchange = () => { TM_Config.set(CONFIG_KEYS.DOWNLOAD_MODE, dlSel.value); showToast('✓ บันทึกการตั้งค่าแล้ว'); };

      const tmSel = drawer.querySelector('#tm-opt-timestamp');
      tmSel.value = TM_Config.get(CONFIG_KEYS.TIMESTAMP_MODE, 'hybrid');
      tmSel.onchange = () => { TM_Config.set(CONFIG_KEYS.TIMESTAMP_MODE, tmSel.value); TM_Timestamp.updateAll(); showToast('✓ บันทึกการตั้งค่าแล้ว'); };

      const vChk = drawer.querySelector('#tm-opt-viral');
      vChk.checked = TM_Config.get(CONFIG_KEYS.VIRAL_RADAR, true);
      vChk.onchange = () => { TM_Config.set(CONFIG_KEYS.VIRAL_RADAR, vChk.checked); showToast('✓ บันทึกการตั้งค่าแล้ว'); };

      const fChk = drawer.querySelector('#tm-opt-filter-rising');
      fChk.checked = TM_Config.get(CONFIG_KEYS.FILTER_RISING, false);
      fChk.onchange = () => { TM_Config.set(CONFIG_KEYS.FILTER_RISING, fChk.checked); TM_ViralRadar.updateFilterBarUI(); TM_ViralRadar.applyFilter(); showToast('✓ บันทึกการตั้งค่าแล้ว'); };

      // Load DB snapshot
      const latest = await TM_DB.getLatestSnapshot();
      if (latest?.diff) { TM_Studio.activeDiff = latest.diff; TM_Studio.renderAuditorData(drawer, latest.diff); }

      drawer.querySelectorAll('.tm-subtab').forEach(tab => {
        tab.onclick = () => {
          drawer.querySelectorAll('.tm-subtab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          TM_Studio.currentTab = tab.dataset.filter;
          TM_Studio._listLimit = 50;
          TM_Studio.renderAuditorList(drawer);
        };
      });

      drawer.querySelector('#tm-auditor-search').oninput = () => { TM_Studio._listLimit = 50; TM_Studio.renderAuditorList(drawer); };

      drawer.querySelector('#tm-copy-auditor-list').onclick = () => {
        const list = TM_Studio.getCurrentFilteredUsers(drawer);
        if (list.length === 0) return showToast('⚠️ ไม่มีรายชื่อในหน้านี้');
        navigator.clipboard.writeText(list.map(u => `@${u}`).join('\n')).then(() => showToast(`✓ คัดลอก ${list.length} บัญชีแล้ว`));
      };

      // Live capture wiring
      const idleActions = drawer.querySelector('#tm-auditor-idle-actions'), liveBox = drawer.querySelector('#tm-live-capture-box');
      const autoScrollBtn = drawer.querySelector('#tm-btn-autoscroll');

      const resetAutoUI = () => { if (autoScrollBtn) { autoScrollBtn.textContent = '⚡ Auto-Scroll: Off'; autoScrollBtn.classList.remove('active'); } };
      TM_RelationshipAuditor.onAutoScrollReset = resetAutoUI;
      TM_RelationshipAuditor.onAutoScrollComplete = (cnt) => { resetAutoUI(); showToast(`✓ Auto-Scroll เสร็จสิ้น (${(cnt || 0).toLocaleString()} บัญชี)`); };

      if (autoScrollBtn) {
        autoScrollBtn.onclick = () => {
          const on = TM_RelationshipAuditor.toggleAutoScroll();
          autoScrollBtn.textContent = on ? '⏸️ Pause Auto-Scroll' : '⚡ Auto-Scroll: Off';
          autoScrollBtn.classList.toggle('active', on);
          showToast(on ? '⚡ Auto-Scroll เริ่มทำงาน' : '⏸️ พัก Auto-Scroll');
        };
      }

      drawer.querySelector('#tm-start-live-capture').onclick = () => {
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return showToast('⚠️ กรุณาเปิดหน้าต่าง Followers หรือ Following บนโปรไฟล์ก่อนค่ะ');
        const user = TM_RelationshipAuditor.detectUsername() || prompt('ระบุชื่อบัญชี Threads ของคุณ:');
        if (!user) return;

        const started = TM_RelationshipAuditor.startLiveCapture(user, state => {
          drawer.querySelector('#tm-live-followers-cnt').textContent = state.followersCount.toLocaleString();
          drawer.querySelector('#tm-live-following-cnt').textContent = state.followingCount.toLocaleString();
          if (state.followersTarget > 0) drawer.querySelector('#tm-live-followers-total').textContent = `/ ${state.followersTarget.toLocaleString()}`;
          if (state.followingTarget > 0) drawer.querySelector('#tm-live-following-total').textContent = `/ ${state.followingTarget.toLocaleString()}`;
          const isFollowers = state.activeTab === 'followers';
          drawer.querySelector('#tm-live-card-followers').classList.toggle('active', isFollowers);
          drawer.querySelector('#tm-live-card-following').classList.toggle('active', !isFollowers);
          drawer.querySelector('#tm-live-pill-followers').textContent = isFollowers ? 'Scanning 🟢' : 'Waiting ⚪';
          drawer.querySelector('#tm-live-pill-followers').className = `tm-live-status-pill ${isFollowers ? 'active' : ''}`.trim();
          drawer.querySelector('#tm-live-pill-following').textContent = !isFollowers ? 'Scanning 🟢' : 'Waiting ⚪';
          drawer.querySelector('#tm-live-pill-following').className = `tm-live-status-pill ${!isFollowers ? 'active' : ''}`.trim();
        });

        if (started) { idleActions.style.display = 'none'; liveBox.style.display = 'block'; showToast('🟢 เริ่มต้น Live Capture เลื่อนหน้าต่างเพื่อบันทึกบัญชี'); }
      };

      drawer.querySelector('#tm-switch-to-followers').onclick = () => { resetAutoUI(); TM_RelationshipAuditor.switchLiveTab('followers'); };
      drawer.querySelector('#tm-switch-to-following').onclick = () => { resetAutoUI(); TM_RelationshipAuditor.switchLiveTab('following'); };

      drawer.querySelector('#tm-live-finish').onclick = async () => {
        try {
          const res = await TM_RelationshipAuditor.finishLiveCapture();
          if (res?.diff) {
            TM_Studio.activeDiff = res.diff;
            TM_Studio.renderAuditorData(drawer, res.diff);
            showToast(`✓ สำเร็จ: ผู้ติดตาม ${res.followers.length.toLocaleString()} | กำลังติดตาม ${res.following.length.toLocaleString()}`);
          }
        } catch (e) { showToast(`⚠️ ${e.message}`); }
        finally { resetAutoUI(); liveBox.style.display = 'none'; idleActions.style.display = 'block'; }
      };

      drawer.querySelector('#tm-live-cancel').onclick = () => {
        TM_RelationshipAuditor.stopLiveCapture(); resetAutoUI(); liveBox.style.display = 'none'; idleActions.style.display = 'block'; showToast('⏹️ ยกเลิกการแคปเจอร์แล้ว');
      };

      const closeDrawer = () => {
        TM_RelationshipAuditor.stopLiveCapture();
        document.removeEventListener('keydown', onEsc);
        drawer.remove();
      };
      const onEsc = (e) => { if (e.key === 'Escape') closeDrawer(); };
      document.addEventListener('keydown', onEsc);

      drawer.querySelector('#tm-close-drawer').onclick = closeDrawer;
      drawer.querySelector('.tm-drawer-overlay').onclick = closeDrawer;
    },

    renderAuditorData: (drawer, diff) => {
      if (!diff) return;
      ['notback', 'fans', 'mutual', 'lost'].forEach(k => {
        const el = drawer.querySelector(`#tm-stat-${k}`), cnt = drawer.querySelector(`#cnt-${k}`);
        const len = (k === 'notback' ? diff.notFollowingBack : diff[k])?.length || 0;
        if (el) el.textContent = len;
        if (cnt) cnt.textContent = len;
      });
      const gained = drawer.querySelector('#cnt-gained');
      if (gained) gained.textContent = diff.gained?.length || 0;
      TM_Studio.renderAuditorList(drawer);
    },

    getCurrentFilteredUsers: (drawer) => {
      const diff = TM_Studio.activeDiff;
      if (!diff) return [];
      const map = { notback: diff.notFollowingBack, fans: diff.fans, mutual: diff.mutual, lost: diff.lost, gained: diff.gained };
      const source = map[TM_Studio.currentTab] || [];
      const q = (drawer.querySelector('#tm-auditor-search')?.value || '').trim().toLowerCase();
      return q ? source.filter(u => u.toLowerCase().includes(q)) : source;
    },

    renderAuditorList: (drawer) => {
      const c = drawer.querySelector('#tm-auditor-list');
      if (!c) return;
      const users = TM_Studio.getCurrentFilteredUsers(drawer);
      if (users.length === 0) { c.innerHTML = '<div class="tm-empty-state">ไม่พบบัญชีในหมวดหมู่นี้</div>'; return; }

      const PAGE = 50, limit = TM_Studio._listLimit || PAGE;
      const display = users.slice(0, limit), hasMore = users.length > limit;

      c.innerHTML = `
        <div class="tm-user-rows">
          ${display.map(u => `
            <div class="tm-user-row">
              <a class="tm-user-link" href="https://www.threads.net/@${u}" target="_blank" rel="noopener"><span class="tm-user-avatar">👤</span><span class="tm-user-name">@${escapeHtml(u)}</span></a>
              <div class="tm-user-actions">
                <button type="button" class="tm-copy-user-btn tm-btn-sub" data-user="${escapeHtml(u)}" title="Copy">📋</button>
                <button type="button" class="tm-unfollow-user-btn tm-btn-danger" data-user="${escapeHtml(u)}">Unfollow</button>
              </div>
            </div>
          `).join('')}
        </div>
        ${hasMore ? `<div style="text-align:center;padding:10px 0;"><button type="button" class="tm-btn-sub" id="tm-btn-load-more" style="width:100%;padding:8px 0;font-weight:600;">Load More (${Math.min(PAGE, users.length - limit)} / ${(users.length - limit).toLocaleString()})</button></div>` : ''}
      `;

      c.onclick = (e) => {
        const copy = e.target.closest('.tm-copy-user-btn');
        if (copy) { e.stopPropagation(); navigator.clipboard.writeText(`@${copy.dataset.user}`).then(() => showToast(`✓ คัดลอก @${copy.dataset.user}`)); return; }

        const unf = e.target.closest('.tm-unfollow-user-btn');
        if (unf && !unf.disabled) {
          e.stopPropagation();
          const u = unf.dataset.user;
          if (!confirm(`ยืนยันการเลิกติดตาม (Unfollow) @${u}?`)) return;
          unf.disabled = true; unf.textContent = 'Unfollowing...';
          TM_RelationshipAuditor.unfollowUser(u)
            .then(() => { showToast(`✓ เลิกติดตาม @${u} สำเร็จ`); unf.textContent = 'Unfollowed'; unf.className = 'tm-unfollow-user-btn tm-btn-sub'; unf.style.opacity = '0.5'; })
            .catch(() => { showToast(`⚠️ เลิกติดตาม @${u} ไม่สำเร็จ`); unf.textContent = 'Unfollow'; unf.disabled = false; });
          return;
        }

        const more = e.target.closest('#tm-btn-load-more');
        if (more) { e.stopPropagation(); TM_Studio._listLimit = (TM_Studio._listLimit || PAGE) + PAGE; TM_Studio.renderAuditorList(drawer); }
      };
    }
  };

  /* ─── 17. COMPACT ANTI-SLOP STYLES ────────────────────────── */
  function injectStyles() {
    if (document.getElementById('threadmax-styles')) return;
    const style = document.createElement('style');
    style.id = 'threadmax-styles';
    style.textContent = `
      :root {
        --tm-bg: #141414; --tm-card: #1c1c1e; --tm-border: #2c2c2e; --tm-accent: #0095f6; --tm-accent-hover: #1877f2;
        --tm-text: #f3f5f7; --tm-muted: #8e8e93; --tm-danger: #ff453a; --tm-success: #30d158;
      }
      .tm-wrapper { position: relative !important; display: flex !important; align-items: center !important; justify-content: center !important; height: 36px !important; min-width: 36px !important; }
      .tm-btn { display: flex !important; align-items: center !important; justify-content: center !important; width: 36px !important; height: 36px !important; border-radius: 50% !important; color: rgba(243, 245, 247, 0.85) !important; cursor: pointer !important; transition: all 120ms ease !important; user-select: none !important; }
      .tm-btn:hover { color: #fff !important; background-color: rgba(255, 255, 255, 0.1) !important; }
      .tm-btn:active { transform: scale(0.92) !important; }
      .tm-btn svg { pointer-events: none !important; }
      .tm-dropdown { position: fixed !important; z-index: 2147483647 !important; min-width: 260px !important; background: var(--tm-card) !important; border: 1px solid #3a3a3c !important; border-radius: 10px !important; box-shadow: 0 16px 40px rgba(0, 0, 0, 0.95) !important; padding: 6px !important; display: flex !important; flex-direction: column !important; gap: 2px !important; animation: tmFade 120ms ease !important; }
      @keyframes tmFade { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
      .tm-dropdown-item { display: flex !important; align-items: center !important; gap: 10px !important; padding: 10px 14px !important; border-radius: 6px !important; color: var(--tm-text) !important; font-size: 13px !important; font-weight: 500 !important; cursor: pointer !important; white-space: nowrap !important; }
      .tm-dropdown-item:hover { background-color: #2c2c2e !important; color: #fff !important; }
      .tm-viral-badge { display: inline-flex !important; align-items: center !important; margin-left: 8px !important; padding: 2px 8px !important; background: rgba(239, 68, 68, 0.12) !important; border: 1px solid rgba(239, 68, 68, 0.35) !important; border-radius: 12px !important; color: #f87171 !important; font-size: 11px !important; font-weight: 600 !important; }
      .tm-progress-bar { position: absolute !important; bottom: -22px !important; left: 0 !important; display: flex !important; flex-direction: column !important; gap: 3px !important; z-index: 999 !important; }
      .tm-progress-text { font-size: 11px !important; color: #aaa !important; font-family: monospace !important; }
      .tm-progress-track { width: 80px !important; height: 2px !important; background: #2a2a2a !important; border-radius: 2px !important; overflow: hidden !important; }
      .tm-progress-fill { height: 100% !important; width: 0% !important; background: var(--tm-accent) !important; transition: width 150ms ease !important; }
      .tm-checkbox-pill { position: absolute !important; top: 10px !important; right: 10px !important; width: 26px !important; height: 26px !important; border-radius: 50% !important; background: rgba(18, 18, 18, 0.75) !important; border: 1.5px solid #555 !important; display: flex !important; align-items: center !important; justify-content: center !important; cursor: pointer !important; z-index: 50 !important; }
      .tm-checkbox-pill.active { background: var(--tm-accent) !important; border-color: var(--tm-accent) !important; }
      .tm-select-bar { display: flex !important; align-items: center !important; justify-content: space-between !important; margin: 8px 0 !important; padding: 10px 14px !important; background: #161616 !important; border: 1px solid #2a2a2a !important; border-radius: 8px !important; font-size: 13px !important; color: #fff !important; }
      .tm-select-actions { display: flex !important; gap: 8px !important; }
      .tm-btn-primary { background: var(--tm-accent) !important; color: #fff !important; border: none !important; padding: 6px 14px !important; border-radius: 6px !important; font-weight: 600 !important; font-size: 12px !important; cursor: pointer !important; }
      .tm-btn-primary:hover { background: var(--tm-accent-hover) !important; }
      .tm-btn-sub { background: #242424 !important; color: #e0e0e0 !important; border: 1px solid #333 !important; padding: 6px 12px !important; border-radius: 6px !important; font-size: 12px !important; cursor: pointer !important; }
      .tm-btn-sub:hover { background: #2e2e2e !important; }
      .tm-btn-cancel { background: transparent !important; color: #888 !important; border: none !important; padding: 6px 10px !important; font-size: 12px !important; cursor: pointer !important; }
      .tm-video-controls { position: absolute !important; top: 12px !important; right: 12px !important; display: flex !important; align-items: center !important; gap: 6px !important; z-index: 40 !important; opacity: 0 !important; transition: opacity 150ms ease !important; }
      div:hover > .tm-video-controls, .tm-video-controls:hover { opacity: 1 !important; }
      .tm-video-btn { background: rgba(18, 18, 18, 0.85) !important; border: 1px solid rgba(255, 255, 255, 0.15) !important; border-radius: 6px !important; color: #fff !important; font-size: 11px !important; font-weight: 600 !important; padding: 4px 8px !important; cursor: pointer !important; display: flex !important; align-items: center !important; justify-content: center !important; }
      #tm-reader-modal, #tm-splitter-modal { position: fixed !important; inset: 0 !important; z-index: 1000000 !important; display: flex !important; align-items: center !important; justify-content: center !important; animation: tmFade 150ms ease !important; }
      .tm-reader-overlay { position: absolute !important; inset: 0 !important; background: rgba(0, 0, 0, 0.82) !important; }
      .tm-reader-card { position: relative !important; width: 90% !important; max-width: 680px !important; max-height: 85vh !important; background: var(--tm-bg) !important; border: 1px solid #2a2a2a !important; border-radius: 12px !important; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.9) !important; display: flex !important; flex-direction: column !important; overflow: hidden !important; }
      .tm-reader-header { display: flex !important; align-items: center !important; justify-content: space-between !important; padding: 16px 20px !important; border-bottom: 1px solid #242424 !important; }
      .tm-reader-title { font-size: 16px !important; font-weight: 700 !important; color: #fff !important; }
      .tm-reader-author { font-size: 12px !important; color: #888 !important; }
      .tm-reader-header-actions { display: flex !important; gap: 8px !important; }
      .tm-reader-body { padding: 20px !important; overflow-y: auto !important; display: flex !important; flex-direction: column !important; gap: 16px !important; }
      .tm-reader-segment, .tm-split-item { padding: 14px !important; background: #1a1a1a !important; border: 1px solid #282828 !important; border-radius: 8px !important; }
      .tm-segment-badge { font-size: 11px !important; font-weight: 700 !important; color: var(--tm-accent) !important; }
      .tm-segment-text, .tm-split-text { font-size: 14px !important; line-height: 1.6 !important; color: #e4e6eb !important; }
      .tm-segment-media-hint { margin-top: 8px !important; font-size: 11px !important; color: #777 !important; }
      .tm-split-item-header { display: flex !important; align-items: center !important; justify-content: space-between !important; margin-bottom: 8px !important; }
      .tm-composer-bar { display: flex !important; align-items: center !important; justify-content: space-between !important; padding: 6px 12px !important; font-size: 11px !important; color: #888 !important; border-top: 1px solid #242424 !important; }
      .tm-composer-left { display: flex !important; align-items: center !important; gap: 8px !important; }
      .tm-split-btn { background: var(--tm-accent) !important; color: #fff !important; border: none !important; border-radius: 4px !important; padding: 3px 8px !important; font-size: 11px !important; font-weight: 600 !important; cursor: pointer !important; }
      .tm-hook-safe { color: var(--tm-success) !important; }
      .tm-hook-cut { color: #f59e0b !important; }
      .tm-hook-over { color: var(--tm-danger) !important; }
      #tm-studio-launcher { position: fixed !important; bottom: 20px !important; left: 20px !important; display: flex !important; align-items: center !important; gap: 8px !important; padding: 8px 14px !important; background: var(--tm-bg) !important; border: 1px solid #2a2a2a !important; border-radius: 20px !important; color: #f0f0f0 !important; font-size: 12px !important; font-weight: 600 !important; cursor: pointer !important; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.75) !important; z-index: 99999 !important; }
      #tm-studio-launcher:hover { background: #1e1e1e !important; transform: translateY(-2px) !important; }
      #tm-studio-drawer { position: fixed !important; inset: 0 !important; z-index: 1000000 !important; display: flex !important; justify-content: flex-end !important; animation: tmFade 150ms ease !important; pointer-events: none !important; }
      .tm-drawer-overlay { position: absolute !important; inset: 0 !important; background: transparent !important; pointer-events: none !important; }
      .tm-drawer-content { position: relative !important; width: 100% !important; max-width: 440px !important; height: 100% !important; background: var(--tm-bg) !important; border-left: 1px solid #282828 !important; box-shadow: -10px 0 36px rgba(0, 0, 0, 0.9) !important; display: flex !important; flex-direction: column !important; pointer-events: auto !important; }
      .tm-drawer-header { display: flex !important; align-items: center !important; justify-content: space-between !important; padding: 16px 20px !important; border-bottom: 1px solid #242424 !important; }
      .tm-drawer-brand { display: flex !important; align-items: center !important; gap: 10px !important; }
      .tm-drawer-title { font-size: 15px !important; font-weight: 700 !important; color: #fff !important; }
      .tm-drawer-subtitle { font-size: 11px !important; color: #888 !important; }
      .tm-drawer-tabs { display: flex !important; border-bottom: 1px solid #242424 !important; }
      .tm-drawer-tab { flex: 1 !important; text-align: center !important; padding: 12px !important; font-size: 13px !important; font-weight: 600 !important; color: #777 !important; cursor: pointer !important; border-bottom: 2px solid transparent !important; }
      .tm-drawer-tab.active { color: #fff !important; border-bottom-color: var(--tm-accent) !important; }
      .tm-drawer-body { flex: 1 !important; padding: 20px !important; overflow-y: auto !important; }
      .tm-tab-pane { display: none !important; }
      .tm-tab-pane.active { display: block !important; }
      .tm-auditor-stats { display: flex !important; gap: 12px !important; margin-bottom: 16px !important; }
      .tm-stat-card { flex: 1 !important; padding: 14px !important; background: #1a1a1a !important; border: 1px solid #2a2a2a !important; border-radius: 8px !important; text-align: center !important; }
      .tm-stat-num { font-size: 22px !important; font-weight: 800 !important; color: var(--tm-accent) !important; }
      .tm-stat-label { font-size: 11px !important; color: #888 !important; margin-top: 4px !important; }
      .tm-auditor-actions { margin-bottom: 16px !important; display: flex !important; flex-direction: column !important; gap: 8px !important; }
      .tm-auditor-actions button { width: 100% !important; padding: 10px !important; }
      .tm-auditor-hint { font-size: 11px !important; color: #888 !important; line-height: 1.4 !important; text-align: center !important; }
      .tm-btn-pulse { background: #00875a !important; box-shadow: 0 0 12px rgba(0, 135, 90, 0.4) !important; }
      .tm-live-capture-box { background: #181818 !important; border: 1px solid var(--tm-accent) !important; border-radius: 10px !important; padding: 14px !important; margin-bottom: 16px !important; animation: tmFade 180ms ease !important; }
      .tm-live-header { display: flex !important; align-items: center !important; justify-content: space-between !important; margin-bottom: 8px !important; }
      .tm-live-title { display: flex !important; align-items: center !important; gap: 8px !important; font-size: 13px !important; font-weight: 700 !important; color: #fff !important; }
      .tm-live-dot { width: 8px !important; height: 8px !important; border-radius: 50% !important; background: #00ff88 !important; box-shadow: 0 0 8px #00ff88 !important; }
      .tm-live-badge { font-size: 10px !important; background: rgba(0, 255, 136, 0.15) !important; color: #00ff88 !important; border: 1px solid rgba(0, 255, 136, 0.3) !important; padding: 2px 7px !important; border-radius: 4px !important; font-weight: 600 !important; }
      .tm-live-guide { font-size: 11px !important; color: #aaa !important; line-height: 1.4 !important; margin-bottom: 10px !important; }
      .tm-live-autoscroll-bar { display: flex !important; align-items: center !important; gap: 10px !important; background: #1c1c1e !important; border: 1px solid #2c2c2e !important; border-radius: 8px !important; padding: 8px 12px !important; margin-bottom: 12px !important; }
      .tm-btn-autoscroll { flex-shrink: 0 !important; background: #2c2c2e !important; color: #e5e5ea !important; font-size: 11px !important; font-weight: 600 !important; padding: 6px 12px !important; border-radius: 6px !important; border: 1px solid #3a3a3c !important; cursor: pointer !important; }
      .tm-btn-autoscroll.active { background: #00875a !important; border-color: #00a36c !important; color: #fff !important; }
      .tm-autoscroll-desc { font-size: 11px !important; color: #888 !important; }
      .tm-live-cards { display: flex !important; gap: 10px !important; margin-bottom: 12px !important; }
      .tm-live-card { flex: 1 !important; background: #202020 !important; border: 1px solid #333 !important; border-radius: 8px !important; padding: 10px !important; text-align: center !important; }
      .tm-live-card.active { border-color: var(--tm-accent) !important; background: #142334 !important; box-shadow: 0 0 10px rgba(0, 149, 246, 0.25) !important; }
      .tm-live-card-top { display: flex !important; align-items: center !important; justify-content: space-between !important; margin-bottom: 6px !important; }
      .tm-live-card-name { font-size: 11px !important; font-weight: 600 !important; color: #888 !important; }
      .tm-live-card.active .tm-live-card-name { color: #fff !important; }
      .tm-live-status-pill { font-size: 10px !important; padding: 1px 5px !important; border-radius: 3px !important; background: #2a2a2a !important; color: #777 !important; }
      .tm-live-status-pill.active { background: rgba(0, 255, 136, 0.2) !important; color: #00ff88 !important; font-weight: 600 !important; }
      .tm-live-card-metric { font-size: 18px !important; font-weight: 700 !important; color: #fff !important; margin-bottom: 8px !important; }
      .tm-live-val { color: #00ff88 !important; }
      .tm-live-max { font-size: 12px !important; color: #777 !important; font-weight: 400 !important; }
      .tm-btn-switch-tab { width: 100% !important; font-size: 11px !important; padding: 5px 0 !important; }
      .tm-live-actions { display: flex !important; gap: 8px !important; }
      .tm-btn-finish { flex: 2 !important; background: #00875a !important; color: #fff !important; font-weight: 700 !important; }
      .tm-btn-finish:hover { background: #00a36c !important; }
      .tm-auditor-subtabs { display: flex !important; gap: 6px !important; overflow-x: auto !important; padding-bottom: 8px !important; margin-bottom: 12px !important; }
      .tm-subtab { background: #1a1a1a !important; border: 1px solid #282828 !important; border-radius: 16px !important; padding: 5px 12px !important; font-size: 11px !important; font-weight: 600 !important; color: #888 !important; cursor: pointer !important; white-space: nowrap !important; }
      .tm-subtab.active { background: var(--tm-accent) !important; color: #fff !important; border-color: var(--tm-accent) !important; }
      .tm-auditor-toolbar { display: flex !important; gap: 8px !important; margin-bottom: 14px !important; }
      .tm-search-input { flex: 1 !important; background: #181818 !important; border: 1px solid #2a2a2a !important; border-radius: 6px !important; padding: 6px 12px !important; font-size: 12px !important; color: #fff !important; outline: none !important; }
      .tm-user-rows { display: flex !important; flex-direction: column !important; gap: 6px !important; }
      .tm-user-row { display: flex !important; align-items: center !important; justify-content: space-between !important; padding: 8px 12px !important; background: #181818 !important; border: 1px solid #242424 !important; border-radius: 8px !important; }
      .tm-user-link { display: flex !important; align-items: center !important; gap: 8px !important; text-decoration: none !important; color: #e4e6eb !important; font-size: 13px !important; font-weight: 600 !important; }
      .tm-user-actions { display: flex !important; align-items: center !important; gap: 6px !important; }
      .tm-btn-danger { background-color: #241416 !important; color: #f87171 !important; border: 1px solid rgba(244, 63, 94, 0.35) !important; padding: 3px 9px !important; font-size: 11px !important; font-weight: 600 !important; border-radius: 6px !important; cursor: pointer !important; }
      .tm-setting-row { display: flex !important; align-items: center !important; justify-content: space-between !important; padding: 14px 0 !important; border-bottom: 1px solid #222 !important; }
      .tm-setting-title { font-size: 13px !important; font-weight: 600 !important; color: #f0f0f0 !important; }
      .tm-setting-desc { font-size: 11px !important; color: #777 !important; margin-top: 2px !important; }
      .tm-select { background: #202020 !important; color: #f0f0f0 !important; border: 1px solid #333 !important; padding: 6px 10px !important; border-radius: 6px !important; font-size: 12px !important; outline: none !important; }
      .tm-checkbox { width: 18px !important; height: 18px !important; accent-color: var(--tm-accent) !important; }
      #tm-toast { position: fixed !important; bottom: 36px !important; left: 50% !important; transform: translateX(-50%) translateY(20px) !important; background: #181818 !important; color: #f0f0f0 !important; border: 1px solid #333 !important; padding: 8px 18px !important; border-radius: 20px !important; font-size: 13px !important; font-weight: 500 !important; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.7) !important; opacity: 0 !important; pointer-events: none !important; transition: all 200ms ease !important; z-index: 9999999 !important; }
      #tm-toast.tm-toast-visible { opacity: 1 !important; transform: translateX(-50%) translateY(0) !important; }
      .tm-feed-filter-bar { display: flex !important; align-items: center !important; justify-content: center !important; padding: 8px 16px !important; margin: 0 auto 12px auto !important; max-width: 620px !important; width: 100% !important; box-sizing: border-box !important; }
      .tm-filter-pills { display: flex !important; background: #181818 !important; border: 1px solid #282828 !important; border-radius: 20px !important; padding: 3px !important; gap: 4px !important; }
      .tm-filter-pill { background: transparent !important; color: #888 !important; border: none !important; padding: 5px 14px !important; border-radius: 16px !important; font-size: 12px !important; font-weight: 600 !important; cursor: pointer !important; }
      .tm-filter-pill.active { background: #282828 !important; color: #fff !important; }
      .tm-empty-state { text-align: center !important; padding: 30px 20px !important; color: #666 !important; font-size: 12px !important; line-height: 1.6 !important; background: #181818 !important; border-radius: 8px !important; }
    `;
    document.head.appendChild(style);
  }

  /* ─── 18. MUTATION OBSERVER & SINGLE-PASS SCANNER ──────────── */
  class MutationWatcher {
    constructor({ debounceMs = 250, maxBatchSize = 50, pauseWhen = () => false, filter = () => true, onMutations }) {
      this.debounceMs = debounceMs;
      this.maxBatchSize = maxBatchSize;
      this.pauseWhen = pauseWhen;
      this.filter = filter;
      this.onMutations = onMutations;
      this.observer = null;
      this.buffer = [];
      this.timer = null;
      this.paused = false;
    }

    observe(target, options) {
      if (this.observer) this.observer.disconnect();
      this.observer = new MutationObserver(mutations => {
        if (this.pauseWhen() || this.paused) return;
        const filtered = mutations.filter(this.filter);
        if (filtered.length === 0) return;
        this.buffer.push(...filtered);
        if (this.buffer.length > this.maxBatchSize) this.buffer = this.buffer.slice(-this.maxBatchSize);
        if (!this.timer) this.timer = setTimeout(() => this.flush(), this.debounceMs);
      });
      this.observer.observe(target, options);
    }

    flush() {
      this.timer = null;
      if (this.buffer.length === 0) return;
      const batch = this.buffer.splice(0, this.maxBatchSize);
      try { this.onMutations(batch); } catch (e) { console.error('[ThreadMax] MutationWatcher error:', e); }
    }

    pause() { this.paused = true; }
    resume() { this.paused = false; }
    disconnect() { if (this.observer) this.observer.disconnect(); if (this.timer) clearTimeout(this.timer); this.buffer = []; }
  }

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      if (TM_RelationshipAuditor.liveState?.isCapturing) return;
      TM_DOM.findShareButtons().forEach(TM_Buttons.injectIntoActionRow);
      TM_Video.init();
      TM_Timestamp.updateAll();
      TM_ViralRadar.injectFilterBar();
      TM_ViralRadar.scan();
      TM_Composer.init();
      TM_Studio.injectLauncher();
    }, 250);
  }

  function initMutationWatcher() {
    const watcher = new MutationWatcher({
      debounceMs: 250,
      maxBatchSize: 50,
      pauseWhen: () => TM_RelationshipAuditor.liveState?.isCapturing,
      filter: m => m.type === 'childList' && m.addedNodes.length > 0,
      onMutations: () => scheduleScan()
    });
    watcher.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    injectStyles();
    scheduleScan();
    initMutationWatcher();
    console.info('[ThreadMax] v1.4.0 initialized successfully');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
