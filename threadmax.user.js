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
// @run-at       document-idle
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
    get: (key, fallback) => {
      try {
        if (typeof GM_getValue === 'function') {
          return GM_getValue(key, fallback);
        }
        const val = localStorage.getItem(key);
        return val !== null ? JSON.parse(val) : fallback;
      } catch (e) {
        return fallback;
      }
    },
    set: (key, value) => {
      try {
        if (typeof GM_setValue === 'function') {
          GM_setValue(key, value);
          return;
        }
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        console.warn('[ThreadMax] Failed to save config:', key, e);
      }
    }
  };

  // Register Tampermonkey Menu Commands
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('⚡ เปิด ThreadMax Studio', () => TM_Studio.open());
    GM_registerMenuCommand('📦 สลับโหมดดาวน์โหลด (ZIP / แยกไฟล์)', () => {
      const current = TM_Config.get(CONFIG_KEYS.DOWNLOAD_MODE, 'zip');
      const next = current === 'zip' ? 'individual' : 'zip';
      TM_Config.set(CONFIG_KEYS.DOWNLOAD_MODE, next);
      showToast(`โหมดดาวน์โหลด: ${next === 'zip' ? 'รวมไฟล์ ZIP' : 'แยกทีละไฟล์'}`);
    });
    GM_registerMenuCommand('🕒 สลับรูปแบบเวลา (Hybrid / Absolute / Native)', () => {
      const current = TM_Config.get(CONFIG_KEYS.TIMESTAMP_MODE, 'hybrid');
      const modes = ['hybrid', 'absolute', 'native'];
      const next = modes[(modes.indexOf(current) + 1) % modes.length];
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
              const bodyStr = typeof init.body === 'string'
                ? init.body
                : (init.body instanceof URLSearchParams ? init.body.toString() : '');
              const params = new URLSearchParams(bodyStr);
              const docId = params.get('doc_id');
              const friendlyName = params.get('fb_api_req_friendly_name') || '';

              if (docId) {
                if (friendlyName.toLowerCase().includes('follower') || bodyStr.includes('follower')) {
                  TM_Config.set('tm_doc_followers', docId);
                  console.info('[ThreadMax Sniffer] Captured Live Followers doc_id:', docId);
                } else if (friendlyName.toLowerCase().includes('following') || bodyStr.includes('following')) {
                  TM_Config.set('tm_doc_following', docId);
                  console.info('[ThreadMax Sniffer] Captured Live Following doc_id:', docId);
                }
              }
            } catch (e) {}
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

    init: () => {
      return new Promise((resolve, reject) => {
        if (TM_DB.db) return resolve(TM_DB.db);
        const req = indexedDB.open(TM_DB.dbName, TM_DB.version);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('snapshots')) {
            db.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true });
          }
        };
        req.onsuccess = (e) => {
          TM_DB.db = e.target.result;
          resolve(TM_DB.db);
        };
        req.onerror = (e) => reject(e);
      });
    },

    computeRelationshipDiff: (currentFollowers, currentFollowing, prevSnapshot = null) => {
      const followerSet = new Set((currentFollowers || []).map(u => String(u).toLowerCase()));
      const followingSet = new Set((currentFollowing || []).map(u => String(u).toLowerCase()));

      // 1. Not following back: We follow them, but they do NOT follow back
      const notFollowingBack = (currentFollowing || []).filter(u => !followerSet.has(String(u).toLowerCase()));

      // 2. Fans / Admirers: They follow us, but we do NOT follow them back
      const fans = (currentFollowers || []).filter(u => !followingSet.has(String(u).toLowerCase()));

      // 3. Mutual Friends: Both follow each other
      const mutual = (currentFollowing || []).filter(u => followerSet.has(String(u).toLowerCase()));

      // 4. Lost & Gained (relative to previous snapshot)
      let gained = [];
      let lost = [];
      if (prevSnapshot && Array.isArray(prevSnapshot.followers)) {
        const prevFollowerSet = new Set(prevSnapshot.followers.map(u => String(u).toLowerCase()));
        gained = (currentFollowers || []).filter(u => !prevFollowerSet.has(String(u).toLowerCase()));
        lost = prevSnapshot.followers.filter(u => !followerSet.has(String(u).toLowerCase()));
      }

      return {
        notFollowingBack,
        fans,
        mutual,
        gained,
        lost,
        totalFollowers: (currentFollowers || []).length,
        totalFollowing: (currentFollowing || []).length
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
        const record = {
          timestamp: Date.now(),
          username: data.username || 'me',
          followers,
          following,
          diff
        };
        const req = store.add(record);
        req.onsuccess = () => resolve({ id: req.result, ...record });
        req.onerror = () => reject(req.error);
      });
    },

    getLatestSnapshot: async () => {
      const db = await TM_DB.init();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('snapshots', 'readonly');
        const store = tx.objectStore('snapshots');
        const req = store.getAll();
        req.onsuccess = () => {
          const all = req.result;
          resolve(all && all.length > 0 ? all[all.length - 1] : null);
        };
        req.onerror = () => reject(req.error);
      });
    },

    getAllSnapshots: async () => {
      const db = await TM_DB.init();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('snapshots', 'readonly');
        const store = tx.objectStore('snapshots');
        const req = store.getAll();
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
      for (let k = 0; k < 8; k++) {
        c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
      }
      CRC32_TABLE[i] = c >>> 0;
    }
  })();

  function crc32Bytes(uint8Array) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < uint8Array.length; i++) {
      crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ uint8Array[i]) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function dosTimestamp(date = new Date()) {
    const d = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    const t = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    return { dosDate: d, dosTime: t };
  }

  function createStoredZip(files) {
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
      cdhView.setUint16(36, 0, true);
      cdhView.setUint32(38, 0, true);
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

    return new Blob([...localParts, ...centralParts, eocd], { type: 'application/zip' });
  }

  /* ─── 4. UTILITIES & HELPERS ──────────────────────────────── */
  function showToast(msg, duration = 2200) {
    let toast = document.getElementById('tm-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'tm-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('tm-toast-visible');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.remove('tm-toast-visible');
    }, duration);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1500);
  }

  function downloadDirect(url, filename) {
    if (typeof GM_download === 'function') {
      GM_download({
        url: url,
        name: filename,
        saveAs: false,
        onerror: () => fallbackDownload(url, filename)
      });
    } else {
      fallbackDownload(url, filename);
    }
  }

  function fallbackDownload(url, filename) {
    fetch(url)
      .then(res => res.blob())
      .then(blob => downloadBlob(blob, filename))
      .catch(() => {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      });
  }

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

  function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(text).replace(/[&<>"']/g, m => map[m]);
  }

  /* ─── 5. DOM EXTRACTION (POST, METRICS, ACTIONS) ──────────── */
  const TM_DOM = {
    findShareButtons: () => {
      const results = [];
      const sharePaths = Array.from(document.querySelectorAll('path[d*="M7.247 1.499"], path[d*="M7.246 1.5"], path[d*="M1.53 6.014"]'));
      
      sharePaths.forEach(sp => {
        const svg = sp.closest('svg');
        if (!svg) return;
        const btn = svg.closest('[role="button"]') || svg.parentElement;
        const wrapper = btn ? btn.parentElement : null;
        const actionRow = wrapper ? wrapper.parentElement : null;
        if (btn && wrapper && actionRow && !results.some(r => r.shareBtn === btn)) {
          results.push({ shareSvg: svg, shareBtn: btn, shareWrapper: wrapper, actionRow });
        }
      });

      if (results.length === 0) {
        const titleSvgs = Array.from(document.querySelectorAll('svg[title*="Share" i], svg[title*="แชร์"], svg[title*="分享"], svg[aria-label*="Share" i], svg[aria-label*="แชร์"]'));
        titleSvgs.forEach(svg => {
          const btn = svg.closest('[role="button"]') || svg.parentElement;
          const wrapper = btn ? btn.parentElement : null;
          const actionRow = wrapper ? wrapper.parentElement : null;
          if (btn && wrapper && actionRow && !results.some(r => r.shareBtn === btn)) {
            results.push({ shareSvg: svg, shareBtn: btn, shareWrapper: wrapper, actionRow });
          }
        });
      }

      return results;
    },

    findPostCard: (startNode) => {
      let curr = startNode;
      while (curr && curr !== document.body) {
        if (curr.getAttribute?.('data-pressable-container') === 'true' || curr.tagName === 'ARTICLE') {
          return curr;
        }
        curr = curr.parentElement;
      }
      curr = startNode;
      while (curr && curr !== document.body) {
        if (curr.querySelector?.('a[href*="/post/"]')) {
          return curr;
        }
        curr = curr.parentElement;
      }
      return startNode.parentElement?.parentElement || startNode;
    },

    getPostMetadata: (card) => {
      // 1. Post Link, Author & Post ID
      const postLinkEl = card.querySelector('a[href*="/post/"]');
      let author = 'threads_user';
      let postId = Date.now().toString(36);
      let postUrl = window.location.href;

      if (postLinkEl && postLinkEl.href) {
        postUrl = cleanPostUrl(postLinkEl.href);
        const match = postUrl.match(/@([^/?#]+)\/post\/([^/?#]+)/);
        if (match) {
          author = match[1];
          postId = match[2];
        }
      } else {
        const authorEl = card.querySelector('a[href*="/@"]');
        if (authorEl) {
          const href = authorEl.getAttribute('href') || '';
          const match = href.match(/@([^/?#]+)/);
          if (match) author = match[1];
        }
      }

      // 2. Media Extraction
      const media = [];
      const seenUrls = new Set();

      card.querySelectorAll('video').forEach(video => {
        const src = video.currentSrc || video.src || video.querySelector('source')?.src;
        if (src && !seenUrls.has(src)) {
          seenUrls.add(src);
          media.push({ type: 'video', url: src, element: video });
        }
      });

      card.querySelectorAll('img').forEach(img => {
        const src = img.src;
        if (!src || seenUrls.has(src)) return;

        const parentLink = img.closest('a');
        if (parentLink) {
          const href = parentLink.getAttribute('href') || '';
          if (href.includes('/@') && !href.includes('/post/')) return;
        }

        if (src.includes('-19/')) return;
        const rect = img.getBoundingClientRect();
        if (rect.width > 0 && rect.width < 75) return;
        const style = window.getComputedStyle(img);
        if (style.borderRadius.includes('50%')) return;

        if (src.includes('cdninstagram.com') || src.includes('fbcdn.net')) {
          seenUrls.add(src);
          media.push({ type: 'image', url: src, element: img });
        }
      });

      // 3. Post Text Content
      const textContainer = card.querySelector('div[dir="auto"], span[dir="auto"]');
      const text = textContainer ? textContainer.innerText.trim() : '';

      // 4. Metrics & Post Date for Viral Radar
      let replies = 0;
      let reposts = 0;
      let likes = 0;
      let postDate = null;

      const timeEl = card.querySelector('time[datetime]');
      if (timeEl && timeEl.getAttribute('datetime')) {
        postDate = new Date(timeEl.getAttribute('datetime'));
      }

      // Parse engagement numbers from action buttons or spans
      card.querySelectorAll('span, div').forEach(el => {
        const t = el.innerText?.trim();
        if (/^\d+(\.\d+)?[kKmM]?$/.test(t)) {
          const num = parseMetricNumber(t);
          if (el.closest('[aria-label*="Like" i], [aria-label*="ถูกใจ" i], svg[aria-label*="Like" i]')) likes = num;
          else if (el.closest('[aria-label*="Reply" i], [aria-label*="ตอบกลับ" i], [aria-label*="Comment" i]')) replies = num;
          else if (el.closest('[aria-label*="Repost" i], [aria-label*="รีโพสต์" i]')) reposts = num;
        }
      });

      return {
        card,
        author,
        postId,
        postUrl,
        media,
        text,
        replies,
        reposts,
        likes,
        postDate
      };
    }
  };

  function parseMetricNumber(str) {
    if (!str) return 0;
    const s = str.trim().toLowerCase();
    if (s.endsWith('k')) return parseFloat(s) * 1000;
    if (s.endsWith('m')) return parseFloat(s) * 1000000;
    return parseInt(s, 10) || 0;
  }

  /* ─── 6. IN-FEED ACTION BUTTONS & STACKING PROTECTION ─────── */
  const TM_Buttons = {
    injectIntoActionRow: (shareInfo) => {
      const { shareBtn, shareWrapper, actionRow } = shareInfo;
      if (actionRow.querySelector('.tm-download-btn, .tm-cleanlink-btn')) return;

      const card = TM_DOM.findPostCard(actionRow);
      const postData = TM_DOM.getPostMetadata(card);
      const { author, postId, postUrl, media } = postData;

      // 1. Download Button (when media exists)
      if (media.length > 0) {
        const dlWrapper = document.createElement('div');
        dlWrapper.className = `${shareWrapper.className || ''} tm-wrapper`.trim();

        const dlBtn = document.createElement('div');
        dlBtn.className = 'tm-download-btn tm-btn';
        dlBtn.setAttribute('role', 'button');
        dlBtn.setAttribute('tabindex', '0');
        dlBtn.setAttribute('title', media.length > 1 ? `ThreadMax: ดาวน์โหลดสื่อ (${media.length} ไฟล์)` : 'ThreadMax: ดาวน์โหลดสื่อ');
        dlBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
        `;

        dlBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();

          if (media.length === 1) {
            TM_Downloader.downloadSingle(media[0], author, postId, 1, dlBtn);
          } else {
            TM_Buttons.showCarouselDropdown(dlWrapper, dlBtn, postData);
          }
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
      linkBtn.setAttribute('title', 'ThreadMax: คัดลอกลิงก์สะอาด (ไร้ Tracking Code)');
      linkBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
        </svg>
      `;

      linkBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const clean = cleanPostUrl(postUrl);
        navigator.clipboard.writeText(clean).then(() => {
          showToast('✓ คัดลอกลิงก์สะอาดแล้ว');
        }).catch(() => {
          showToast('⚠️ ไม่สามารถเข้าถึง Clipboard ได้');
        });
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
        unrollBtn.setAttribute('title', 'ThreadMax: รวมเนื้อหาเธรด (Unroll to Reader / Markdown)');
        unrollBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
          </svg>
        `;
        unrollBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          TM_Unroller.open(author, postId);
        });
        unrollWrapper.appendChild(unrollBtn);
        actionRow.appendChild(unrollWrapper);
      }
    },

    showCarouselDropdown: (anchorWrapper, anchorBtn, postData) => {
      // Toggle close if already open for this button
      const existing = document.querySelector('.tm-dropdown');
      if (existing) {
        const wasSameAnchor = existing._anchorBtn === anchorBtn;
        existing.remove();
        if (wasSameAnchor) return;
      }

      const mode = TM_Config.get(CONFIG_KEYS.DOWNLOAD_MODE, 'zip');
      const dropdown = document.createElement('div');
      dropdown.className = 'tm-dropdown';
      dropdown._anchorBtn = anchorBtn;

      const allItem = document.createElement('div');
      allItem.className = 'tm-dropdown-item';
      allItem.innerHTML = `<span class="tm-dropdown-icon">📦</span><span>ดาวน์โหลดทั้งหมด (${postData.media.length} ไฟล์ • ${mode.toUpperCase()})</span>`;

      const selectItem = document.createElement('div');
      selectItem.className = 'tm-dropdown-item';
      selectItem.innerHTML = `<span class="tm-dropdown-icon">☑️</span><span>เลือกดาวน์โหลดเฉพาะไฟล์...</span>`;

      let cleanupListeners = null;
      const closeDropdown = () => {
        dropdown.remove();
        if (typeof cleanupListeners === 'function') cleanupListeners();
      };

      allItem.onclick = (e) => {
        e.stopPropagation();
        closeDropdown();
        TM_Downloader.downloadBatch(postData.media, postData.author, postData.postId, anchorBtn, mode);
      };

      selectItem.onclick = (e) => {
        e.stopPropagation();
        closeDropdown();
        TM_Selector.activate(postData, anchorBtn);
      };

      dropdown.appendChild(allItem);
      dropdown.appendChild(selectItem);

      // Mount to document.body via Fixed Portal to prevent stacking context & feed clipping
      const rect = anchorBtn.getBoundingClientRect();
      const dropdownWidth = 270;
      let left = rect.left;
      if (left + dropdownWidth > window.innerWidth - 16) {
        left = window.innerWidth - dropdownWidth - 16;
      }
      if (left < 16) left = 16;

      dropdown.style.position = 'fixed';
      dropdown.style.top = `${rect.bottom + 6}px`;
      dropdown.style.left = `${left}px`;
      dropdown.style.zIndex = '2147483647';

      document.body.appendChild(dropdown);

      const onDocClick = (evt) => {
        if (!dropdown.contains(evt.target) && !anchorBtn.contains(evt.target)) {
          closeDropdown();
        }
      };

      const onScrollOrResize = () => closeDropdown();

      cleanupListeners = () => {
        document.removeEventListener('click', onDocClick, true);
        window.removeEventListener('scroll', onScrollOrResize, true);
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
    downloadSingle: (mediaItem, author, postId, index, anchorBtn) => {
      const ext = mediaItem.type === 'video' ? 'mp4' : 'jpg';
      const filename = `${author}_${postId}_${String(index).padStart(3, '0')}.${ext}`;
      TM_Downloader.showProgress(anchorBtn, 1, 1);

      if (mediaItem.type === 'video') {
        downloadDirect(mediaItem.url, filename);
        setTimeout(() => TM_Downloader.clearProgress(anchorBtn), 1200);
      } else {
        fetch(mediaItem.url)
          .then(r => r.blob())
          .then(blob => {
            downloadBlob(blob, filename);
            TM_Downloader.clearProgress(anchorBtn);
          })
          .catch(() => {
            downloadDirect(mediaItem.url, filename);
            TM_Downloader.clearProgress(anchorBtn);
          });
      }
    },

    downloadBatch: async (mediaList, author, postId, anchorBtn, mode = 'zip') => {
      const total = mediaList.length;
      let completed = 0;
      let failed = 0;

      TM_Downloader.showProgress(anchorBtn, 0, total);

      if (mode === 'individual') {
        for (let i = 0; i < mediaList.length; i++) {
          const item = mediaList[i];
          const ext = item.type === 'video' ? 'mp4' : 'jpg';
          const filename = `${author}_${postId}_${String(i + 1).padStart(3, '0')}.${ext}`;
          downloadDirect(item.url, filename);
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
        const entryName = `${author}_${postId}_${String(i + 1).padStart(3, '0')}.${ext}`;

        try {
          const resp = await fetch(item.url);
          const buf = await resp.arrayBuffer();
          zipFiles.push({ name: entryName, data: new Uint8Array(buf) });
          completed++;
        } catch (err) {
          console.warn('[ThreadMax] Failed to fetch media in ZIP build:', item.url, err);
          failed++;
        }
        TM_Downloader.showProgress(anchorBtn, completed + failed, total);
      }

      if (zipFiles.length > 0) {
        const zipBlob = createStoredZip(zipFiles);
        const zipName = `${author}_${postId}_carousel_${zipFiles.length}items.zip`;
        downloadBlob(zipBlob, zipName);
        showToast(failed === 0 ? `✓ ดาวน์โหลด ZIP สำเร็จ (${zipFiles.length} ไฟล์)` : `✓ โหลดได้ ${completed} ไฟล์ (${failed} ล้มเหลว)`);
      } else {
        showToast('⚠️ ไม่สามารถดาวน์โหลดไฟล์ในโพสต์นี้ได้');
      }
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
      const pct = Math.round((current / (total || 1)) * 100);
      bar.querySelector('.tm-progress-text').textContent = `${current}/${total} ↓ (${pct}%)`;
      bar.querySelector('.tm-progress-fill').style.width = `${pct}%`;
    },

    clearProgress: (anchorBtn) => {
      const bar = anchorBtn.parentElement.querySelector('.tm-progress-bar');
      if (bar) {
        setTimeout(() => bar.remove(), 1200);
      }
    }
  };

  /* ─── 8. INTERACTIVE SELECTION MODE (Non-Destructive) ──────── */
  const TM_Selector = {
    activate: (postData, anchorBtn) => {
      const { card, media, author, postId } = postData;
      const selectedIndices = new Set(media.map((_, i) => i));

      media.forEach((item, index) => {
        let tile = item.element.parentElement;
        while (tile && (tile.tagName === 'PICTURE' || tile.tagName === 'A' || tile.offsetWidth === 0)) {
          tile = tile.parentElement;
        }
        if (!tile || tile.querySelector('.tm-checkbox-pill')) return;

        const pill = document.createElement('div');
        pill.className = 'tm-checkbox-pill active';
        pill.dataset.index = index;
        pill.innerHTML = `
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        `;

        pill.onclick = (e) => {
          e.stopPropagation();
          e.preventDefault();
          if (selectedIndices.has(index)) {
            selectedIndices.delete(index);
            pill.classList.remove('active');
          } else {
            selectedIndices.add(index);
            pill.classList.add('active');
          }
          TM_Selector.updateBar(card, selectedIndices.size);
        };

        tile.appendChild(pill);
      });

      const actionRow = card.querySelector('.x78zum5:has(.tm-download-btn)') || card.querySelector('.tm-download-btn')?.closest('.x78zum5');
      let bar = card.querySelector('.tm-select-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'tm-select-bar';
        if (actionRow && actionRow.parentElement) {
          actionRow.parentElement.insertBefore(bar, actionRow);
        } else {
          card.appendChild(bar);
        }
      }

      TM_Selector.renderBarContent(bar, card, selectedIndices, media, author, postId, anchorBtn);
    },

    renderBarContent: (bar, card, selectedIndices, media, author, postId, anchorBtn) => {
      bar.innerHTML = `
        <span class="tm-select-count">เลือก ${selectedIndices.size}/${media.length} รายการ</span>
        <div class="tm-select-actions">
          <button type="button" class="tm-btn-sub" data-action="toggle-all">เลือกทั้งหมด</button>
          <button type="button" class="tm-btn-primary" data-action="download">ดาวน์โหลด (${selectedIndices.size})</button>
          <button type="button" class="tm-btn-cancel" data-action="cancel">ยกเลิก</button>
        </div>
      `;

      bar.querySelector('[data-action="toggle-all"]').onclick = (e) => {
        e.stopPropagation();
        const allSelected = selectedIndices.size === media.length;
        card.querySelectorAll('.tm-checkbox-pill').forEach((pill, idx) => {
          if (allSelected) {
            selectedIndices.delete(idx);
            pill.classList.remove('active');
          } else {
            selectedIndices.add(idx);
            pill.classList.add('active');
          }
        });
        TM_Selector.renderBarContent(bar, card, selectedIndices, media, author, postId, anchorBtn);
      };

      bar.querySelector('[data-action="download"]').onclick = (e) => {
        e.stopPropagation();
        if (selectedIndices.size === 0) {
          showToast('⚠️ กรุณาเลือกอย่างน้อย 1 รายการ');
          return;
        }
        const filtered = media.filter((_, i) => selectedIndices.has(i));
        TM_Selector.cleanup(card);
        const mode = TM_Config.get(CONFIG_KEYS.DOWNLOAD_MODE, 'zip');
        TM_Downloader.downloadBatch(filtered, author, postId, anchorBtn, mode);
      };

      bar.querySelector('[data-action="cancel"]').onclick = (e) => {
        e.stopPropagation();
        TM_Selector.cleanup(card);
      };
    },

    updateBar: (card, count) => {
      const countEl = card.querySelector('.tm-select-count');
      const dlBtn = card.querySelector('.tm-btn-primary');
      if (countEl) countEl.textContent = `เลือก ${count} รายการ`;
      if (dlBtn) dlBtn.textContent = `ดาวน์โหลด (${count})`;
    },

    cleanup: (card) => {
      card.querySelectorAll('.tm-checkbox-pill').forEach(p => p.remove());
      const bar = card.querySelector('.tm-select-bar');
      if (bar) bar.remove();
    }
  };

  /* ─── 9. VIDEO PLAYER BOOSTER ─────────────────────────────── */
  const TM_Video = {
    speeds: [1.0, 1.25, 1.5, 2.0],

    init: () => {
      const videos = document.querySelectorAll('video');
      videos.forEach(video => TM_Video.enhance(video));
    },

    enhance: (video) => {
      if (video.dataset.tmBoosted) return;
      video.dataset.tmBoosted = 'true';

      const savedVolume = TM_Config.get(CONFIG_KEYS.VIDEO_VOLUME, 0.8);
      video.volume = Math.max(0, Math.min(1, savedVolume));

      video.addEventListener('volumechange', () => {
        if (!video.muted) {
          TM_Config.set(CONFIG_KEYS.VIDEO_VOLUME, video.volume);
        }
      });

      const parent = video.parentElement;
      if (!parent || parent.querySelector('.tm-video-controls')) return;

      const ctrl = document.createElement('div');
      ctrl.className = 'tm-video-controls';

      let currentSpeedIdx = 0;
      ctrl.innerHTML = `
        <button type="button" class="tm-video-btn tm-speed-btn" title="คลิกเพื่อสลับความเร็ว">1.0x</button>
        <button type="button" class="tm-video-btn tm-pip-btn" title="Picture-in-Picture (ลอยหน้าต่าง)">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="4" width="20" height="16" rx="2"></rect>
            <rect x="13" y="11" width="7" height="7" rx="1" fill="currentColor"></rect>
          </svg>
        </button>
      `;

      const speedBtn = ctrl.querySelector('.tm-speed-btn');
      speedBtn.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        currentSpeedIdx = (currentSpeedIdx + 1) % TM_Video.speeds.length;
        const newSpeed = TM_Video.speeds[currentSpeedIdx];
        video.playbackRate = newSpeed;
        speedBtn.textContent = `${newSpeed}x`;
      };

      const pipBtn = ctrl.querySelector('.tm-pip-btn');
      pipBtn.onclick = async (e) => {
        e.stopPropagation();
        e.preventDefault();
        try {
          if (document.pictureInPictureElement === video) {
            await document.exitPictureInPicture();
          } else if (document.pictureInPictureEnabled) {
            await video.requestPictureInPicture();
          } else {
            showToast('⚠️ เบราว์เซอร์ไม่รองรับโหมด PiP');
          }
        } catch (err) {
          console.warn('[ThreadMax] PiP error:', err);
        }
      };

      parent.style.position = 'relative';
      parent.appendChild(ctrl);
    }
  };

  /* ─── 10. SMART CONFIGURABLE TIMESTAMP ────────────────────── */
  const TM_Timestamp = {
    updateAll: () => {
      const mode = TM_Config.get(CONFIG_KEYS.TIMESTAMP_MODE, 'hybrid');
      const timeNodes = document.querySelectorAll('time[datetime]');

      timeNodes.forEach(timeEl => {
        const iso = timeEl.getAttribute('datetime');
        if (!iso) return;

        if (!timeEl.dataset.tmOrig) {
          timeEl.dataset.tmOrig = timeEl.innerText.trim();
        }

        const orig = timeEl.dataset.tmOrig;
        const date = new Date(iso);
        if (isNaN(date.getTime())) return;

        if (mode === 'native') {
          timeEl.innerText = orig;
        } else if (mode === 'absolute') {
          timeEl.innerText = TM_Timestamp.formatAbsolute(date);
        } else if (mode === 'hybrid') {
          const hhmm = String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
          timeEl.innerText = `${orig} (${hhmm})`;
        }
      });
    },

    formatAbsolute: (d) => {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      const hours = String(d.getHours()).padStart(2, '0');
      const mins = String(d.getMinutes()).padStart(2, '0');
      return `${day}/${month}/${year} ${hours}:${mins}`;
    }
  };

  /* ─── 11. VIRAL VELOCITY RADAR (Phase 3) ──────────────────── */
  const TM_ViralRadar = {
    scan: () => {
      const enabled = TM_Config.get(CONFIG_KEYS.VIRAL_RADAR, true);
      if (!enabled) return;

      const shareItems = TM_DOM.findShareButtons();
      shareItems.forEach(shareInfo => {
        const card = TM_DOM.findPostCard(shareInfo.actionRow);
        if (!card || card.querySelector('.tm-viral-badge')) return;

        const meta = TM_DOM.getPostMetadata(card);
        if (!meta.postDate) return;

        const ageMinutes = Math.max(1, (Date.now() - meta.postDate.getTime()) / 60000);
        // Velocity score: (Replies*2 + Reposts*1.5) / AgeMinutes
        const velocity = (meta.replies * 2 + meta.reposts * 1.5) / ageMinutes;

        // Trigger badge if early high acceleration (< 180 min age, replies < 50, and velocity >= 0.1)
        if (ageMinutes <= 180 && meta.replies < 50 && velocity >= 0.1) {
          const authorHeader = card.querySelector('a[href*="/@"]')?.parentElement || card.querySelector('time')?.parentElement;
          if (authorHeader && !authorHeader.querySelector('.tm-viral-badge')) {
            const badge = document.createElement('span');
            badge.className = 'tm-viral-badge';
            const ratePerHour = Math.round(velocity * 60);
            badge.title = `ThreadMax Viral Radar: อัตราเร่ง ~${ratePerHour} เอนเกจเมนต์/ชม.`;
            badge.innerHTML = `⚡ Rising (${ratePerHour}/hr)`;
            authorHeader.appendChild(badge);
          }
        }
      });

      TM_ViralRadar.applyFilter();
    },

    applyFilter: () => {
      const filterActive = TM_Config.get(CONFIG_KEYS.FILTER_RISING, false);
      const shareItems = TM_DOM.findShareButtons();
      shareItems.forEach(shareInfo => {
        const card = TM_DOM.findPostCard(shareInfo.actionRow);
        if (!card) return;
        if (filterActive) {
          const isRising = card.querySelector('.tm-viral-badge') !== null;
          card.style.display = isRising ? '' : 'none';
        } else {
          card.style.display = '';
        }
      });
    },

    injectFilterBar: () => {
      if (document.getElementById('tm-feed-filter-bar')) {
        TM_ViralRadar.updateFilterBarUI();
        return;
      }

      // Look for the main feed container or feed column
      const container = document.querySelector('main') || document.querySelector('[role="main"]');
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
          const filter = btn.dataset.filter;
          const isRising = filter === 'rising';
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
      bar.querySelectorAll('.tm-filter-pill').forEach(btn => {
        if (btn.dataset.filter === 'rising') {
          btn.classList.toggle('active', isRising);
        } else {
          btn.classList.toggle('active', !isRising);
        }
      });
    }
  };

  /* ─── 12. THREAD UNROLLER & CLEAN READER (Phase 2) ────────── */
  const TM_Unroller = {
    open: (author, postId) => {
      const allCards = TM_DOM.findShareButtons().map(s => TM_DOM.findPostCard(s.actionRow));
      const opPosts = [];

      allCards.forEach(c => {
        const meta = TM_DOM.getPostMetadata(c);
        if (meta.author.toLowerCase() === author.toLowerCase() && meta.text.length > 0) {
          if (!opPosts.some(p => p.text === meta.text)) {
            opPosts.push(meta);
          }
        }
      });

      if (opPosts.length === 0) {
        showToast('⚠️ ไม่พบบทสนทนาต่อเนื่องของเจ้าของโพสต์');
        return;
      }

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

      modal.querySelector('#tm-copy-md').onclick = () => {
        const mdText = `# Thread by @${author}\\n\\nURL: https://www.threads.com/@${author}/post/${postId}\\n\\n---\\n\\n` +
          opPosts.map((p, i) => `### [${i + 1}/${opPosts.length}]\\n\\n${p.text}\\n`).join('\\n---\\n\\n');
        navigator.clipboard.writeText(mdText).then(() => {
          showToast('✓ คัดลอก Markdown ทั้งเธรดแล้ว');
        });
      };

      modal.querySelector('#tm-close-reader').onclick = () => modal.remove();
      modal.querySelector('.tm-reader-overlay').onclick = () => modal.remove();
      const onEsc = (e) => {
        if (e.key === 'Escape') {
          modal.remove();
          document.removeEventListener('keydown', onEsc);
        }
      };
      document.addEventListener('keydown', onEsc);
    }
  };

  /* ─── 13. COMPOSER HOOK GUIDE & AUTO-SPLITTER (Phase 2) ───── */
  const TM_Composer = {
    init: () => {
      const textboxes = document.querySelectorAll('div[role="textbox"][contenteditable="true"]');
      textboxes.forEach(tb => TM_Composer.enhance(tb));
    },

    enhance: (textbox) => {
      if (textbox.dataset.tmComposer) return;
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

      splitBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        TM_Splitter.open(textbox.innerText.trim());
      };

      const update = () => {
        const len = textbox.innerText.trim().length;
        countEl.textContent = `${len} / 500`;

        if (len === 0) {
          hookEl.textContent = '';
          hookEl.className = 'tm-hook-status';
          splitBtn.style.display = 'none';
        } else if (len <= 180) {
          hookEl.textContent = '✨ Hook ปลอดภัย (ไม่ถูกซ่อนบนจอมือถือ)';
          hookEl.className = 'tm-hook-status tm-hook-safe';
          splitBtn.style.display = 'none';
        } else if (len <= 500) {
          hookEl.textContent = '📍 เกิน 180 อักษร (จะถูกซ่อนหลัง "...ดูเพิ่มเติม")';
          hookEl.className = 'tm-hook-status tm-hook-cut';
          splitBtn.style.display = 'none';
        } else {
          hookEl.textContent = '⚠️ ข้อความยาวเกิน 500 อักษร';
          hookEl.className = 'tm-hook-status tm-hook-over';
          splitBtn.style.display = 'inline-flex';
        }
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
            // Split by sentence
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
          const formatted = `${idx + 1}/${total}\n\n${chunks[idx]}`;
          navigator.clipboard.writeText(formatted).then(() => {
            showToast(`✓ คัดลอกท่อนที่ ${idx + 1}/${total} แล้ว`);
          });
        };
      });

      modal.querySelector('#tm-copy-all-split').onclick = () => {
        const full = chunks.map((c, i) => `[${i + 1}/${total}]\n${c}`).join('\n\n---\n\n');
        navigator.clipboard.writeText(full).then(() => {
          showToast('✓ คัดลอกเธรดที่แบ่งแล้วทั้งหมด');
        });
      };

      modal.querySelector('#tm-close-split').onclick = () => modal.remove();
      modal.querySelector('.tm-reader-overlay').onclick = () => modal.remove();
    }
  };

  /* ─── 15. RELATIONSHIP RADAR & MUTUAL AUDITOR (Phase 3.2) ─── */
  const TM_RelationshipAuditor = {
    isScanning: false,
    abortController: null,

    detectUsername: () => {
      // 1. Check current URL if on a profile page
      const match = window.location.pathname.match(/^\/@([^/?#]+)/);
      if (match && !['explore', 'search', 'activity', 'messages', 'settings'].includes(match[1])) {
        return match[1];
      }
      // 2. Find profile link in sidebar navigation
      const profileLink = document.querySelector('a[href^="/@"]:not([href*="/post/"])');
      if (profileLink) {
        const m = (profileLink.getAttribute('href') || '').match(/@([^/?#]+)/);
        if (m) return m[1];
      }
      // 3. Check avatar image link
      const avatarLink = document.querySelector('a[href*="/@"]');
      if (avatarLink) {
        const m = (avatarLink.getAttribute('href') || '').match(/@([^/?#]+)/);
        if (m) return m[1];
      }
      return null;
    },

    sleepJitter: (min = 3000, max = 5000) => {
      const ms = Math.floor(Math.random() * (max - min + 1)) + min;
      return new Promise(resolve => setTimeout(resolve, ms));
    },

    fetchUserId: async (username) => {
      if (!username) return null;
      const cleanUser = String(username).replace(/^@/, '').toLowerCase().trim();

      // Helper: Validate and persist numeric User ID
      const validateAndCache = (id) => {
        if (!id) return null;
        const str = String(id).trim();
        if (/^\d{4,25}$/.test(str) && str !== '0') {
          try {
            TM_Config.set(`tm_uid_${cleanUser}`, str);
          } catch (e) {}
          return str;
        }
        return null;
      };

      // Tier 0: Check persistent cache from previous scans
      try {
        const cached = TM_Config.get(`tm_uid_${cleanUser}`, null);
        if (cached && validateAndCache(cached)) {
          return String(cached);
        }
      } catch (e) {}

      // Tier 1: Check document.cookie (ds_user_id) if target is the logged-in user
      try {
        const currentDetected = (TM_RelationshipAuditor.detectUsername() || '').toLowerCase();
        const isSelf = !currentDetected || currentDetected === cleanUser;
        if (isSelf) {
          const mCookie = document.cookie.match(/(?:^|;\s*)ds_user_id=(\d+)/);
          if (mCookie && validateAndCache(mCookie[1])) {
            return validateAndCache(mCookie[1]);
          }
        }
      } catch (e) {}

      // Tier 2: Check current page DOM meta / link tags for app deep-link user ID
      try {
        const metaTags = document.querySelectorAll('meta[content*="user?id="], link[href*="user?id="]');
        for (const tag of metaTags) {
          const val = tag.getAttribute('content') || tag.getAttribute('href') || '';
          const m = val.match(/(?:barcelona|instagram):\/\/user\?id=(\d+)/i);
          if (m && validateAndCache(m[1])) {
            return validateAndCache(m[1]);
          }
        }
      } catch (e) {}

      // Tier 3: Scan in-page <script> tags for JSON containing user ID near target username
      try {
        const scripts = document.querySelectorAll('script');
        for (const s of scripts) {
          const text = s.textContent || '';
          if (text.includes(cleanUser)) {
            const idx = text.indexOf(cleanUser);
            const slice = text.substring(Math.max(0, idx - 600), Math.min(text.length, idx + 600));
            const m = slice.match(/"(?:pk|user_id|target_user_id|profile_id)":"?(\d{4,25})"?/);
            if (m && validateAndCache(m[1])) {
              return validateAndCache(m[1]);
            }
          }
        }
      } catch (e) {}

      // Tier 4: Same-origin HTML fetch of the user profile page
      try {
        const baseOrigin = window.location.origin || 'https://www.threads.net';
        const profileUrl = `${baseOrigin}/@${encodeURIComponent(cleanUser)}`;
        const pageRes = await fetch(profileUrl, {
          credentials: 'include',
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          }
        });
        if (pageRes.ok) {
          const html = await pageRes.text();
          // Check app deep link
          const mBarc = html.match(/(?:barcelona|instagram):\/\/user\?id=(\d+)/i);
          if (mBarc && validateAndCache(mBarc[1])) return validateAndCache(mBarc[1]);

          // Check script slice near username
          const idx = html.indexOf(cleanUser);
          if (idx !== -1) {
            const slice = html.substring(Math.max(0, idx - 600), Math.min(html.length, idx + 600));
            const m = slice.match(/"(?:pk|user_id|target_user_id|profile_id)":"?(\d{4,25})"?/);
            if (m && validateAndCache(m[1])) return validateAndCache(m[1]);
          }

          // Check general user_id pattern
          const mUser = html.match(/"user_id":"?(\d{4,25})"?/);
          if (mUser && validateAndCache(mUser[1])) return validateAndCache(mUser[1]);
        }
      } catch (e) {}

      // Tier 5: REST API endpoints (same-origin first, then alternate origin)
      const testOrigins = [
        window.location.origin,
        'https://www.threads.com',
        'https://www.threads.net'
      ].filter((v, i, a) => v && a.indexOf(v) === i);

      for (const origin of testOrigins) {
        try {
          const res = await fetch(`${origin}/api/v1/users/web_profile_info/?username=${encodeURIComponent(cleanUser)}`, {
            headers: {
              'X-IG-App-ID': '238260118658252',
              'X-Requested-With': 'XMLHttpRequest'
            },
            credentials: 'include'
          });
          if (res.ok) {
            const json = await res.json();
            const id = json?.data?.user?.pk || json?.data?.user?.id;
            if (id && validateAndCache(id)) return validateAndCache(id);
          }
        } catch (e) {}
      }

      // Tier 6: Manual input prompt fallback (with permanent cache)
      try {
        const manual = prompt(
          `[ThreadMax] ไม่สามารถตรวจหา User ID ของ @${cleanUser} อัตโนมัติได้\n\nหากคุณทราบ User ID สามารถระบุตัวเลขได้ที่นี่ หรือกด Cancel:`
        );
        if (manual && /^\d+$/.test(manual.trim())) {
          return validateAndCache(manual.trim());
        }
      } catch (e) {}

      return null;
    },

    fetchGraphQLList: async (type, userId, onProgress, signal) => {
      const baseOrigin = window.location.origin || 'https://www.threads.com';
      const lsd = document.querySelector('input[name="lsd"]')?.value ||
                  (typeof unsafeWindow !== 'undefined' && unsafeWindow.LSD?.token) || '';

      const docId = TM_Config.get(`tm_doc_${type}`, null);
      if (!docId) {
        throw new Error('NO_DOC_ID');
      }

      const usernames = [];
      let afterCursor = null;
      let hasNext = true;
      let page = 0;

      while (hasNext && !signal.aborted) {
        page++;
        const variables = {
          userID: userId,
          first: 50,
          after: afterCursor
        };

        const form = new URLSearchParams();
        if (lsd) form.set('lsd', lsd);
        form.set('variables', JSON.stringify(variables));
        form.set('doc_id', docId);

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

        if (!res.ok) {
          throw new Error(`GRAPHQL_${res.status}`);
        }

        const json = await res.json();
        const edgeData = type === 'followers'
          ? (json?.data?.user?.edge_followed_by || json?.data?.viewer?.user?.edge_followed_by)
          : (json?.data?.user?.edge_follow || json?.data?.viewer?.user?.edge_follow);

        const edges = edgeData?.edges || [];
        for (const e of edges) {
          const u = e.node?.username;
          if (u && !usernames.includes(u.toLowerCase())) {
            usernames.push(u.toLowerCase());
          }
        }

        if (typeof onProgress === 'function') {
          onProgress(type, usernames.length, page);
        }

        hasNext = edgeData?.page_info?.has_next_page || false;
        afterCursor = edgeData?.page_info?.end_cursor || null;

        if (hasNext && !signal.aborted) {
          await TM_RelationshipAuditor.sleepJitter(2000, 3500);
        }
      }

      return usernames;
    },

    findScrollableContainer: (dialog) => {
      if (!dialog) return null;
      const all = [dialog, ...Array.from(dialog.querySelectorAll('*'))];
      for (const el of all) {
        if (el.scrollHeight > el.clientHeight && el.clientHeight > 120) {
          const style = window.getComputedStyle(el);
          if (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflow === 'auto' || style.overflow === 'scroll') {
            return el;
          }
        }
      }
      return dialog;
    },

    extractUsernamesFromDialog: (dialog) => {
      if (!dialog) return [];
      const links = Array.from(dialog.querySelectorAll('a[href*="/@"]'));
      const found = new Set();
      links.forEach(a => {
        const href = a.getAttribute('href') || '';
        if (href.includes('/post/')) return;
        const m = href.match(/@([^/?#]+)/);
        if (m) {
          const u = m[1].toLowerCase();
          if (!['post', 'explore', 'search', 'activity', 'messages', 'settings'].includes(u)) {
            found.add(u);
          }
        }
      });
      return Array.from(found);
    },

    extractUsernamesIncremental: (dialog, targetSet) => {
      if (!dialog) return 0;
      const links = dialog.querySelectorAll('a[href*="/@"]:not([href*="/post/"])');
      let count = 0;
      for (let i = 0; i < links.length; i++) {
        const a = links[i];
        if (a._tmTagged) continue;
        a._tmTagged = true;

        const href = a.getAttribute('href') || '';
        const m = href.match(/@([^/?#]+)/);
        if (m) {
          const u = m[1].toLowerCase();
          if (!['post', 'explore', 'search', 'activity', 'messages', 'settings'].includes(u)) {
            if (targetSet) targetSet.add(u);
            count++;
          }
        }
      }
      return count;
    },

    findAllScrollContainers: (dialog) => {
      if (!dialog) return [];
      const containers = new Set();

      // Priority 1: Check elements with explicit scrollable overflow-y and scrollable height
      const all = Array.from(dialog.querySelectorAll('*'));
      for (const el of all) {
        if (el.scrollHeight > el.clientHeight + 10 && el.clientHeight > 60) {
          try {
            const style = window.getComputedStyle(el);
            const oy = style.overflowY;
            if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') {
              containers.add(el);
            }
          } catch (_) {}
        }
      }

      // Priority 2: Trace upward from user account links (for virtual lists or mock testing)
      if (containers.size === 0) {
        const links = dialog.querySelectorAll('a[href*="/@"]:not([href*="/post/"])');
        for (const a of links) {
          let p = a.parentElement;
          while (p && p !== dialog && p !== document.body) {
            if (p.scrollHeight > p.clientHeight + 10 && p.clientHeight > 60) {
              containers.add(p);
            }
            p = p.parentElement;
          }
          if (containers.size > 0) break;
        }
      }

      // Priority 3: Fallback to dialog itself
      if (containers.size === 0 && dialog.scrollHeight > dialog.clientHeight + 10) {
        containers.add(dialog);
      }

      return Array.from(containers).length > 0 ? Array.from(containers) : [dialog];
    },

    clickTab: (el) => {
      if (!el) return;
      try {
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      } catch (_) {}
      if (typeof el.click === 'function') {
        try { el.click(); } catch (_) {}
      }
    },

    findModalTabs: (dialog) => {
      if (!dialog) return { followersTab: null, followingTab: null };

      const allElements = Array.from(dialog.querySelectorAll('a, div[role="tab"], div[role="button"], button, div, span'));
      let followersTab = null;
      let followingTab = null;

      const followersRegex = /(^ผู้ติดตาม(\s+[\d,kmb\.]+)?$|^([\d,kmb\.]+\s+)?ผู้ติดตาม$|^followers(\s+[\d,kmb\.]+)?$|^([\d,kmb\.]+\s+)?followers$)/i;
      const followingRegex = /(^กำลังติดตาม(\s+[\d,kmb\.]+)?$|^([\d,kmb\.]+\s+)?กำลังติดตาม$|^following(\s+[\d,kmb\.]+)?$|^([\d,kmb\.]+\s+)?following$)/i;

      for (const el of allElements) {
        const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
        if (!followersTab && followersRegex.test(text)) {
          followersTab = el.closest('[role="tab"], [role="button"], a, button') || el;
        }
        if (!followingTab && followingRegex.test(text)) {
          followingTab = el.closest('[role="tab"], [role="button"], a, button') || el;
        }
      }

      if (!followersTab || !followingTab) {
        for (const el of allElements) {
          const text = (el.textContent || '').trim();
          if (!followersTab && text.includes('ผู้ติดตาม') && text.length < 40) {
            followersTab = el.closest('[role="tab"], [role="button"], a, button') || el;
          }
          if (!followingTab && text.includes('กำลังติดตาม') && text.length < 40) {
            followingTab = el.closest('[role="tab"], [role="button"], a, button') || el;
          }
        }
      }

      return { followersTab, followingTab };
    },

    extractNumberFromText: (str) => {
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
    },

    liveState: {
      isCapturing: false,
      targetUsername: '',
      activeTab: 'followers',
      followers: new Set(),
      following: new Set(),
      followersTarget: 0,
      followingTarget: 0,
      timer: null,
      observer: null,
      cleanup: null,
      onUpdate: null
    },

    autoScrollState: {
      isActive: false,
      timer: null,
      container: null,
      idleTicks: 0,
      lastCount: 0
    },

    startAutoScroll: (onTick) => {
      if (TM_RelationshipAuditor.autoScrollState.isActive) return;
      TM_RelationshipAuditor.autoScrollState.isActive = true;
      TM_RelationshipAuditor.autoScrollState.idleTicks = 0;
      TM_RelationshipAuditor.autoScrollState.lastCount = 0;
      TM_RelationshipAuditor.autoScrollState.container = null;

      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) {
        TM_RelationshipAuditor.stopAutoScroll();
        return;
      }

      // Pre-resolve and cache scroll container once to eliminate full-DOM querying every tick
      const initContainers = TM_RelationshipAuditor.findAllScrollContainers(dialog);
      TM_RelationshipAuditor.autoScrollState.container = initContainers[0] || dialog;

      const step = () => {
        if (!TM_RelationshipAuditor.autoScrollState.isActive) return;
        const currentDialog = document.querySelector('[role="dialog"]');
        if (!currentDialog) {
          TM_RelationshipAuditor.stopAutoScroll();
          return;
        }

        let c = TM_RelationshipAuditor.autoScrollState.container;
        if (!c || !currentDialog.contains(c)) {
          const fresh = TM_RelationshipAuditor.findAllScrollContainers(currentDialog);
          c = fresh[0] || currentDialog;
          TM_RelationshipAuditor.autoScrollState.container = c;
        }

        const maxScroll = c.scrollHeight - c.clientHeight;
        const prevTop = c.scrollTop;
        const stepSize = Math.max(300, Math.min(600, Math.round(c.clientHeight * 0.85)));

        let scrolledAny = false;
        if (maxScroll > 0) {
          if (c.scrollTop + stepSize < maxScroll) {
            c.scrollTop += stepSize;
          } else {
            c.scrollTop = maxScroll;
          }

          if (c.scrollTop !== prevTop || c.scrollTop >= maxScroll - 20) {
            scrolledAny = true;
          }

          c.dispatchEvent(new Event('scroll', { bubbles: true }));
          try {
            c.dispatchEvent(new WheelEvent('wheel', {
              deltaY: stepSize,
              bubbles: true,
              cancelable: true
            }));
          } catch (_) {}
        }

        // Trigger intersection observers by ensuring any loader/spinner is in view
        const loaders = currentDialog.querySelectorAll('[role="progressbar"], svg[aria-label*="Loading"], div[data-visualcompletion="loading-state"]');
        if (loaders.length > 0) {
          try {
            loaders[loaders.length - 1].scrollIntoView({ block: 'end' });
          } catch (_) {}
        }

        const rows = currentDialog.querySelectorAll('a[href*="/@"]:not([href*="/post/"])');
        const currentCount = rows.length;

        // Check if target count has been reached
        const activeTab = TM_RelationshipAuditor.liveState.activeTab;
        const targetNumber = activeTab === 'following'
          ? TM_RelationshipAuditor.liveState.followingTarget
          : TM_RelationshipAuditor.liveState.followersTarget;

        const isTargetReached = targetNumber > 0 && currentCount >= targetNumber;

        if (isTargetReached || (currentCount === TM_RelationshipAuditor.autoScrollState.lastCount && !scrolledAny)) {
          TM_RelationshipAuditor.autoScrollState.idleTicks++;
          const maxIdle = isTargetReached ? 3 : 6;
          if (TM_RelationshipAuditor.autoScrollState.idleTicks >= maxIdle) {
            TM_RelationshipAuditor.stopAutoScroll();
            if (typeof TM_RelationshipAuditor.onAutoScrollComplete === 'function') {
              TM_RelationshipAuditor.onAutoScrollComplete(currentCount);
            }
            return;
          }
        } else {
          TM_RelationshipAuditor.autoScrollState.idleTicks = 0;
          TM_RelationshipAuditor.autoScrollState.lastCount = currentCount;
        }

        if (typeof onTick === 'function') onTick();
      };

      TM_RelationshipAuditor.autoScrollState.timer = setInterval(step, 450);
    },

    stopAutoScroll: () => {
      TM_RelationshipAuditor.autoScrollState.isActive = false;
      if (TM_RelationshipAuditor.autoScrollState.timer) {
        clearInterval(TM_RelationshipAuditor.autoScrollState.timer);
        TM_RelationshipAuditor.autoScrollState.timer = null;
      }
      TM_RelationshipAuditor.autoScrollState.container = null;
    },

    toggleAutoScroll: (onTick) => {
      if (TM_RelationshipAuditor.autoScrollState.isActive) {
        TM_RelationshipAuditor.stopAutoScroll();
        return false;
      } else {
        TM_RelationshipAuditor.startAutoScroll(onTick);
        return true;
      }
    },

    detectActiveTab: (dialog) => {
      if (!dialog) return null;
      const { followersTab, followingTab } = TM_RelationshipAuditor.findModalTabs(dialog);

      if (followingTab) {
        if (followingTab.getAttribute('aria-selected') === 'true') return 'following';
        if (followingTab.querySelector('[aria-selected="true"]')) return 'following';
      }
      if (followersTab) {
        if (followersTab.getAttribute('aria-selected') === 'true') return 'followers';
        if (followersTab.querySelector('[aria-selected="true"]')) return 'followers';
      }

      try {
        const getWeight = (el) => {
          if (!el) return 0;
          let w = 0;
          const style = window.getComputedStyle(el);
          if (parseFloat(style.borderBottomWidth) > 0 && style.borderBottomStyle !== 'none') w += 30;
          const m = (style.color || '').match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
          if (m) {
            const brightness = (parseInt(m[1]) + parseInt(m[2]) + parseInt(m[3])) / 3;
            if (brightness > 200) w += 20;
            else if (brightness < 160) w -= 10;
          }
          if (el.querySelector('div[style*="height: 2px"], div[style*="bottom: 0"]')) w += 40;
          return w;
        };

        const f1w = getWeight(followersTab);
        const f2w = getWeight(followingTab);
        if (f2w > f1w + 15) return 'following';
        if (f1w > f2w + 15) return 'followers';
      } catch (_) {}

      return null;
    },

    startLiveCapture: (targetUsername, onUpdate) => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return false;

      const { followersTab, followingTab } = TM_RelationshipAuditor.findModalTabs(dialog);
      const followersTarget = followersTab ? TM_RelationshipAuditor.extractNumberFromText(followersTab.textContent) : 0;
      const followingTarget = followingTab ? TM_RelationshipAuditor.extractNumberFromText(followingTab.textContent) : 0;

      TM_RelationshipAuditor.stopLiveCapture();

      const initialTab = TM_RelationshipAuditor.detectActiveTab(dialog) || 'followers';

      TM_RelationshipAuditor.liveState = {
        isCapturing: true,
        targetUsername: targetUsername || 'user',
        activeTab: initialTab,
        followers: new Set(),
        following: new Set(),
        followersTarget,
        followingTarget,
        timer: null,
        cleanup: null,
        onUpdate
      };

      let isSniffing = false;
      let lastFollowersSize = -1;
      let lastFollowingSize = -1;

      const sniff = () => {
        if (!TM_RelationshipAuditor.liveState.isCapturing || isSniffing) return;
        const currentDialog = document.querySelector('[role="dialog"]');
        if (!currentDialog) return;

        isSniffing = true;
        try {
          // Fast incremental parse: only processes links that haven't been tagged yet!
          const targetSet = TM_RelationshipAuditor.liveState[TM_RelationshipAuditor.liveState.activeTab];
          if (targetSet) {
            TM_RelationshipAuditor.extractUsernamesIncremental(currentDialog, targetSet);
          }

          const curFollowersSize = TM_RelationshipAuditor.liveState.followers.size;
          const curFollowingSize = TM_RelationshipAuditor.liveState.following.size;

          // Only fire DOM updates when numbers actually change
          if (curFollowersSize !== lastFollowersSize || curFollowingSize !== lastFollowingSize) {
            lastFollowersSize = curFollowersSize;
            lastFollowingSize = curFollowingSize;

            if (typeof TM_RelationshipAuditor.liveState.onUpdate === 'function') {
              TM_RelationshipAuditor.liveState.onUpdate({
                followersCount: curFollowersSize,
                followingCount: curFollowingSize,
                followersTarget: TM_RelationshipAuditor.liveState.followersTarget,
                followingTarget: TM_RelationshipAuditor.liveState.followingTarget,
                activeTab: TM_RelationshipAuditor.liveState.activeTab
              });
            }
          }
        } finally {
          isSniffing = false;
        }
      };

      // Click delegation on Threads modal tabs
      const handleDialogClick = (e) => {
        const { followersTab: fTab, followingTab: gTab } = TM_RelationshipAuditor.findModalTabs(dialog);
        if (gTab && (gTab === e.target || gTab.contains(e.target))) {
          TM_RelationshipAuditor.switchLiveTab('following');
        } else if (fTab && (fTab === e.target || fTab.contains(e.target))) {
          TM_RelationshipAuditor.switchLiveTab('followers');
        }
      };
      dialog.addEventListener('click', handleDialogClick, true);

      // Initial fast sniff
      sniff();

      // Throttled scroll listener via requestAnimationFrame (avoids 60fps synchronous layout thrashing)
      let rafId = null;
      const scrollHandler = () => {
        if (rafId) return;
        rafId = requestAnimationFrame(() => {
          rafId = null;
          sniff();
        });
      };
      dialog.addEventListener('scroll', scrollHandler, { passive: true, capture: true });

      // Gentle polling interval (350ms) to catch network batch arrivals
      TM_RelationshipAuditor.liveState.timer = setInterval(sniff, 350);

      TM_RelationshipAuditor.liveState.cleanup = () => {
        dialog.removeEventListener('click', handleDialogClick, true);
        dialog.removeEventListener('scroll', scrollHandler, { capture: true });
        if (rafId) cancelAnimationFrame(rafId);
      };

      return true;
    },

    switchLiveTab: (tabName) => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return;
      const { followersTab, followingTab } = TM_RelationshipAuditor.findModalTabs(dialog);

      TM_RelationshipAuditor.liveState.activeTab = tabName;

      // Invalidate tagged anchors so new tab items are recognized
      dialog.querySelectorAll('a[href*="/@"]').forEach(a => { delete a._tmTagged; });

      if (tabName === 'followers' && followersTab) {
        TM_RelationshipAuditor.clickTab(followersTab);
      } else if (tabName === 'following' && followingTab) {
        TM_RelationshipAuditor.clickTab(followingTab);
      }

      // Clear cached scroll container to ensure auto-scroller re-acquires for new tab
      if (TM_RelationshipAuditor.autoScrollState) {
        TM_RelationshipAuditor.autoScrollState.container = null;
      }

      if (typeof TM_RelationshipAuditor.liveState.onUpdate === 'function') {
        TM_RelationshipAuditor.liveState.onUpdate({
          followersCount: TM_RelationshipAuditor.liveState.followers.size,
          followingCount: TM_RelationshipAuditor.liveState.following.size,
          followersTarget: TM_RelationshipAuditor.liveState.followersTarget,
          followingTarget: TM_RelationshipAuditor.liveState.followingTarget,
          activeTab: TM_RelationshipAuditor.liveState.activeTab
        });
      }
    },

    stopLiveCapture: () => {
      TM_RelationshipAuditor.stopAutoScroll();
      if (TM_RelationshipAuditor.liveState.timer) {
        clearInterval(TM_RelationshipAuditor.liveState.timer);
        TM_RelationshipAuditor.liveState.timer = null;
      }
      if (TM_RelationshipAuditor.liveState.observer) {
        TM_RelationshipAuditor.liveState.observer.disconnect();
        TM_RelationshipAuditor.liveState.observer = null;
      }
      if (typeof TM_RelationshipAuditor.liveState.cleanup === 'function') {
        TM_RelationshipAuditor.liveState.cleanup();
        TM_RelationshipAuditor.liveState.cleanup = null;
      }
      TM_RelationshipAuditor.liveState.isCapturing = false;
    },

    finishLiveCapture: async () => {
      TM_RelationshipAuditor.stopAutoScroll();
      const followers = Array.from(TM_RelationshipAuditor.liveState.followers);
      const following = Array.from(TM_RelationshipAuditor.liveState.following);
      const targetUsername = TM_RelationshipAuditor.liveState.targetUsername || 'user';

      TM_RelationshipAuditor.stopLiveCapture();

      if (followers.length === 0 && following.length === 0) {
        throw new Error('No accounts captured yet. Please scroll the modal to capture accounts before calculating.');
      }

      const prevSnapshot = await TM_DB.getLatestSnapshot();
      const diff = TM_DB.computeRelationshipDiff(followers, following, prevSnapshot);
      const savedRecord = await TM_DB.saveSnapshot({
        username: targetUsername,
        followers,
        following,
        diff
      });

      return { followers, following, diff, savedRecord };
    },

    harvestFromModal: (onProgress, signal) => {
      return TM_RelationshipAuditor.finishLiveCapture();
    },

    captureModalDOM: () => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return [];
      return TM_RelationshipAuditor.extractUsernamesFromDialog(dialog);
    },

    startScan: async (targetUsername, onProgressUpdate, mode = 'auto') => {
      if (TM_RelationshipAuditor.isScanning) return;
      TM_RelationshipAuditor.isScanning = true;
      TM_RelationshipAuditor.abortController = new AbortController();
      const signal = TM_RelationshipAuditor.abortController.signal;
      const startTime = Date.now();

      try {
        const openDialog = document.querySelector('[role="dialog"]');

        // MODE A: Modal Harvester (Direct or Auto if Modal is Open)
        if (mode === 'modal' || (mode === 'auto' && openDialog)) {
          if (!openDialog) {
            throw new Error("ไม่พบหน้าต่างรายชื่อ: กรุณาคลิกที่ 'ผู้ติดตาม' หรือ 'กำลังติดตาม' บนหน้าโปรไฟล์ของคุณก่อน แล้วกดปุ่มนี้อีกครั้งค่ะ");
          }

          onProgressUpdate({ status: 'modal', text: 'กำลังเชื่อมต่อหน้าต่างรายชื่อบนจอ...' });
          const modalData = await TM_RelationshipAuditor.harvestTwoWayModal(onProgressUpdate, signal);

          if (!modalData || (modalData.followers.length === 0 && modalData.following.length === 0)) {
            throw new Error('ไม่พบบัญชีในหน้าต่างที่เปิดอยู่ กรุณาเลื่อนดูให้แน่ใจว่าโหลดรายชื่อแล้วค่ะ');
          }

          const followers = modalData.followers;
          const following = modalData.following;

          const prevSnapshot = await TM_DB.getLatestSnapshot();
          const diff = TM_DB.computeRelationshipDiff(followers, following, prevSnapshot);
          const savedRecord = await TM_DB.saveSnapshot({
            username: targetUsername,
            followers,
            following,
            diff
          });

          const elapsed = Math.round((Date.now() - startTime) / 1000);
          onProgressUpdate({
            status: 'done',
            diff,
            record: savedRecord,
            text: `✓ กวาดสำเร็จใน ${elapsed}s (ผู้ติดตาม: ${followers.length.toLocaleString()}, กำลังติดตาม: ${following.length.toLocaleString()})`
          });

          return { followers, following, diff, savedRecord };
        }

        // MODE B: GraphQL / API Background Scan
        let userId = await TM_RelationshipAuditor.fetchUserId(targetUsername);
        if (!userId) {
          throw new Error(`ไม่พบ User ID ของ @${targetUsername}`);
        }

        let following = [];
        let followers = [];
        let successGql = false;

        try {
          if (TM_Config.get('tm_doc_following', null)) {
            onProgressUpdate({ status: 'following', current: 0, text: `กำลังดึง Following ผ่าน GraphQL...` });
            following = await TM_RelationshipAuditor.fetchGraphQLList('following', userId, (t, count) => {
              onProgressUpdate({ status: 'following', current: count, text: `กำลังสแกน Following... ได้ ${count} บัญชี` });
            }, signal);

            await TM_RelationshipAuditor.sleepJitter(2000, 3500);

            onProgressUpdate({ status: 'followers', current: 0, text: `กำลังดึง Followers ผ่าน GraphQL...` });
            followers = await TM_RelationshipAuditor.fetchGraphQLList('followers', userId, (t, count) => {
              onProgressUpdate({ status: 'followers', current: count, text: `กำลังสแกน Followers... ได้ ${count} บัญชี` });
            }, signal);

            successGql = true;
          }
        } catch (gqlErr) {
          console.warn('[ThreadMax] GraphQL execution fallback:', gqlErr);
        }

        if (!successGql) {
          // If no doc_id or GraphQL rejected, check if modal is open to seamlessly harvest
          const dialog = document.querySelector('[role="dialog"]');
          if (dialog) {
            onProgressUpdate({ status: 'modal', text: 'สลับไปกวาดรายชื่อจากหน้าต่างที่เปิดอยู่บนจอ...' });
            const modalData = await TM_RelationshipAuditor.harvestTwoWayModal(onProgressUpdate, signal);
            followers = (modalData && modalData.followers) || [];
            following = (modalData && modalData.following) || [];
          } else {
            throw new Error(
              `เซิร์ฟเวอร์ Threads จำกัดการดึง API ทางตรง\n\n👉 วิธีแก้ไขง่ายและปลอดภัย 100%:\nกรุณาคลิกที่ "ผู้ติดตาม 1,250 คน" บนหน้าโปรไฟล์ของคุณ เพื่อเปิดหน้าต่างรายชื่อ จากนั้นกดปุ่ม "📥 สแกนจากหน้าต่างที่เปิดอยู่" ค่ะ`
            );
          }
        }

        // Compute Diff
        const prevSnapshot = await TM_DB.getLatestSnapshot();
        const diff = TM_DB.computeRelationshipDiff(followers, following, prevSnapshot);

        const savedRecord = await TM_DB.saveSnapshot({
          username: targetUsername,
          followers,
          following,
          diff
        });

        const elapsed = Math.round((Date.now() - startTime) / 1000);
        onProgressUpdate({
          status: 'done',
          diff,
          record: savedRecord,
          text: `✓ สแกนสำเร็จใน ${elapsed}s (Followers: ${followers.length}, Following: ${following.length})`
        });

        return { followers, following, diff, savedRecord };
      } catch (err) {
        if (err.message === 'Aborted') {
          onProgressUpdate({ status: 'aborted', text: '⏹️ ยกเลิกการสแกนแล้ว' });
        } else {
          onProgressUpdate({ status: 'error', text: `⚠️ ${err.message}` });
        }
        throw err;
      } finally {
        TM_RelationshipAuditor.isScanning = false;
        TM_RelationshipAuditor.abortController = null;
      }
    },

    stopScan: () => {
      if (TM_RelationshipAuditor.abortController) {
        TM_RelationshipAuditor.abortController.abort();
      }
      TM_RelationshipAuditor.isScanning = false;
    }
  };

  /* ─── 16. THREADMAX STUDIO DRAWER (Phase 3.2 UI) ───────────── */
  const TM_Studio = {
    currentTab: 'notback',
    activeDiff: null,

    injectLauncher: () => {
      if (document.getElementById('tm-studio-launcher')) return;
      const btn = document.createElement('div');
      btn.id = 'tm-studio-launcher';
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
        </svg>
        <span>ThreadMax Studio</span>
      `;
      btn.onclick = () => TM_Studio.open();
      document.body.appendChild(btn);
    },

    open: async () => {
      let drawer = document.getElementById('tm-studio-drawer');
      if (drawer) drawer.remove();

      drawer = document.createElement('div');
      drawer.id = 'tm-studio-drawer';
      drawer.innerHTML = `
        <div class="tm-drawer-overlay"></div>
        <div class="tm-drawer-content">
          <div class="tm-drawer-header">
            <div class="tm-drawer-brand">
              <span class="tm-brand-icon">⚡</span>
              <div>
                <div class="tm-drawer-title">ThreadMax Studio</div>
                <div class="tm-drawer-subtitle">Growth Intelligence & Precision Suite</div>
              </div>
            </div>
            <button type="button" class="tm-btn-sub" id="tm-close-drawer">✕</button>
          </div>

          <div class="tm-drawer-tabs">
            <div class="tm-drawer-tab active" data-tab="auditor">🔍 Mutual Auditor</div>
            <div class="tm-drawer-tab" data-tab="settings">⚙️ Settings</div>
          </div>

          <div class="tm-drawer-body">
            <!-- TAB: MUTUAL AUDITOR -->
            <div class="tm-tab-pane active" id="pane-auditor">
              <div class="tm-auditor-stats">
                <div class="tm-stat-card" data-category="notback">
                  <div class="tm-stat-num" id="tm-stat-notback">0</div>
                  <div class="tm-stat-label">Not Following Back</div>
                </div>
                <div class="tm-stat-card" data-category="fans">
                  <div class="tm-stat-num" id="tm-stat-fans">0</div>
                  <div class="tm-stat-label">Fans</div>
                </div>
                <div class="tm-stat-card" data-category="mutual">
                  <div class="tm-stat-num" id="tm-stat-mutual">0</div>
                  <div class="tm-stat-label">Mutual</div>
                </div>
                <div class="tm-stat-card" data-category="lost">
                  <div class="tm-stat-num" id="tm-stat-lost">0</div>
                  <div class="tm-stat-label">Lost</div>
                </div>
              </div>

              <div class="tm-auditor-actions" id="tm-auditor-idle-actions">
                <button type="button" class="tm-btn-primary tm-btn-pulse" id="tm-start-live-capture">
                  🟢 Start Live Capture
                </button>
                <div class="tm-auditor-hint">
                  💡 100% Safe & Private: Open your Followers or Following modal on Threads, then start live capture to audit relationships in real time.
                </div>
              </div>

              <!-- LIVE CAPTURE ACTIVE BOX -->
              <div id="tm-live-capture-box" class="tm-live-capture-box" style="display:none;">
                <div class="tm-live-header">
                  <div class="tm-live-title">
                    <span class="tm-live-dot"></span>
                    <span>Live Capture Mode</span>
                  </div>
                  <span class="tm-live-badge">● CAPTURING</span>
                </div>

                <div class="tm-live-guide">
                  👉 Scroll the Threads modal (or use Auto-Scroll). Accounts are captured in real time.
                </div>

                <div class="tm-live-autoscroll-bar">
                  <button type="button" class="tm-btn-sub tm-btn-autoscroll" id="tm-btn-autoscroll">
                    ⚡ Auto-Scroll: Off
                  </button>
                  <span class="tm-autoscroll-desc">Glides down automatically to relieve hand fatigue</span>
                </div>

                <div class="tm-live-cards">
                  <div class="tm-live-card active" id="tm-live-card-followers">
                    <div class="tm-live-card-top">
                      <span class="tm-live-card-name">👥 Followers</span>
                      <span class="tm-live-status-pill active" id="tm-live-pill-followers">Scanning 🟢</span>
                    </div>
                    <div class="tm-live-card-metric">
                      <span class="tm-live-val" id="tm-live-followers-cnt">0</span>
                      <span class="tm-live-max" id="tm-live-followers-total">/ 0</span>
                    </div>
                    <button type="button" class="tm-btn-sub tm-btn-switch-tab" id="tm-switch-to-followers">
                      👉 Switch to Tab
                    </button>
                  </div>

                  <div class="tm-live-card" id="tm-live-card-following">
                    <div class="tm-live-card-top">
                      <span class="tm-live-card-name">👤 Following</span>
                      <span class="tm-live-status-pill" id="tm-live-pill-following">Waiting ⚪</span>
                    </div>
                    <div class="tm-live-card-metric">
                      <span class="tm-live-val" id="tm-live-following-cnt">0</span>
                      <span class="tm-live-max" id="tm-live-following-total">/ 0</span>
                    </div>
                    <button type="button" class="tm-btn-sub tm-btn-switch-tab" id="tm-switch-to-following">
                      👉 Switch to Tab
                    </button>
                  </div>
                </div>

                <div class="tm-live-actions">
                  <button type="button" class="tm-btn-primary tm-btn-finish" id="tm-live-finish">
                    ✅ Calculate Relationships
                  </button>
                  <button type="button" class="tm-btn-cancel" id="tm-live-cancel">
                    ⏹️ Cancel
                  </button>
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
                <input type="text" id="tm-auditor-search" class="tm-search-input" placeholder="🔍 Search usernames..." />
                <button type="button" class="tm-btn-sub" id="tm-copy-auditor-list" title="Copy all usernames in current view">📋 Copy List</button>
              </div>

              <div class="tm-auditor-list" id="tm-auditor-list">
                <div class="tm-empty-state">
                  Click "Start Live Capture" to safely audit your follower relationships.
                </div>
              </div>
            </div>

            <!-- TAB: SETTINGS -->
            <div class="tm-tab-pane" id="pane-settings">
              <div class="tm-setting-row">
                <div>
                  <div class="tm-setting-title">Media Download Mode</div>
                  <div class="tm-setting-desc">Bundle post media into ZIP or save individually</div>
                </div>
                <select class="tm-select" id="tm-opt-download">
                  <option value="zip">ZIP Archive (.zip)</option>
                  <option value="individual">Individual Files</option>
                </select>
              </div>

              <div class="tm-setting-row">
                <div>
                  <div class="tm-setting-title">Timestamp Format</div>
                  <div class="tm-setting-desc">Choose how post creation timestamps are displayed in feed</div>
                </div>
                <select class="tm-select" id="tm-opt-timestamp">
                  <option value="hybrid">Hybrid (e.g. 2h (14:30))</option>
                  <option value="absolute">Absolute (Date & Time)</option>
                  <option value="native">Native (Threads original)</option>
                </select>
              </div>

              <div class="tm-setting-row">
                <div>
                  <div class="tm-setting-title">Viral Velocity Radar</div>
                  <div class="tm-setting-desc">Badge ⚡ Rising on fast-growing posts (&lt; 50 comments)</div>
                </div>
                <input type="checkbox" id="tm-opt-viral" class="tm-checkbox" />
              </div>

              <div class="tm-setting-row">
                <div>
                  <div class="tm-setting-title">Rising Radar Feed Filter</div>
                  <div class="tm-setting-desc">Filter feed to display only Rising posts</div>
                </div>
                <input type="checkbox" id="tm-opt-filter-rising" class="tm-checkbox" />
              </div>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(drawer);

      // Tab switching
      drawer.querySelectorAll('.tm-drawer-tab').forEach(tab => {
        tab.onclick = () => {
          drawer.querySelectorAll('.tm-drawer-tab').forEach(t => t.classList.remove('active'));
          drawer.querySelectorAll('.tm-tab-pane').forEach(p => p.classList.remove('active'));
          tab.classList.add('active');
          drawer.querySelector(`#pane-${tab.dataset.tab}`).classList.add('active');
        };
      });

      // Bind Settings
      const dlSelect = drawer.querySelector('#tm-opt-download');
      dlSelect.value = TM_Config.get(CONFIG_KEYS.DOWNLOAD_MODE, 'zip');
      dlSelect.onchange = () => {
        TM_Config.set(CONFIG_KEYS.DOWNLOAD_MODE, dlSelect.value);
        showToast('✓ Settings saved');
      };

      const timeSelect = drawer.querySelector('#tm-opt-timestamp');
      timeSelect.value = TM_Config.get(CONFIG_KEYS.TIMESTAMP_MODE, 'hybrid');
      timeSelect.onchange = () => {
        TM_Config.set(CONFIG_KEYS.TIMESTAMP_MODE, timeSelect.value);
        TM_Timestamp.updateAll();
        showToast('✓ Settings saved');
      };

      const viralCheck = drawer.querySelector('#tm-opt-viral');
      viralCheck.checked = TM_Config.get(CONFIG_KEYS.VIRAL_RADAR, true);
      viralCheck.onchange = () => {
        TM_Config.set(CONFIG_KEYS.VIRAL_RADAR, viralCheck.checked);
        showToast('✓ Settings saved');
      };

      const filterRisingCheck = drawer.querySelector('#tm-opt-filter-rising');
      filterRisingCheck.checked = TM_Config.get(CONFIG_KEYS.FILTER_RISING, false);
      filterRisingCheck.onchange = () => {
        TM_Config.set(CONFIG_KEYS.FILTER_RISING, filterRisingCheck.checked);
        TM_ViralRadar.updateFilterBarUI();
        TM_ViralRadar.applyFilter();
        showToast('✓ Settings saved');
      };

      // Load latest snapshot from IndexedDB
      const latestSnapshot = await TM_DB.getLatestSnapshot();
      if (latestSnapshot && latestSnapshot.diff) {
        TM_Studio.activeDiff = latestSnapshot.diff;
        TM_Studio.renderAuditorData(drawer, latestSnapshot.diff);
      }

      // Auditor Sub-tabs click
      drawer.querySelectorAll('.tm-subtab').forEach(tab => {
        tab.onclick = () => {
          drawer.querySelectorAll('.tm-subtab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          TM_Studio.currentTab = tab.dataset.filter;
          TM_Studio._listLimit = 50;
          TM_Studio.renderAuditorList(drawer);
        };
      });

      // Search input filter
      const searchInput = drawer.querySelector('#tm-auditor-search');
      searchInput.oninput = () => {
        TM_Studio._listLimit = 50;
        TM_Studio.renderAuditorList(drawer);
      };

      // Copy list button
      drawer.querySelector('#tm-copy-auditor-list').onclick = () => {
        const list = TM_Studio.getCurrentFilteredUsers(drawer);
        if (list.length === 0) {
          showToast('⚠️ No accounts to copy');
          return;
        }
        const text = list.map(u => `@${u}`).join('\n');
        navigator.clipboard.writeText(text).then(() => {
          showToast(`✓ Copied ${list.length} accounts to clipboard`);
        });
      };

      // Human-Assist Live Capture wiring
      const idleActions = drawer.querySelector('#tm-auditor-idle-actions');
      const liveBox = drawer.querySelector('#tm-live-capture-box');
      const startLiveBtn = drawer.querySelector('#tm-start-live-capture');
      const finishLiveBtn = drawer.querySelector('#tm-live-finish');
      const cancelLiveBtn = drawer.querySelector('#tm-live-cancel');
      const autoScrollBtn = drawer.querySelector('#tm-btn-autoscroll');
      const switchFollowersBtn = drawer.querySelector('#tm-switch-to-followers');
      const switchFollowingBtn = drawer.querySelector('#tm-switch-to-following');

      const cardFollowers = drawer.querySelector('#tm-live-card-followers');
      const cardFollowing = drawer.querySelector('#tm-live-card-following');
      const pillFollowers = drawer.querySelector('#tm-live-pill-followers');
      const pillFollowing = drawer.querySelector('#tm-live-pill-following');
      const followersCnt = drawer.querySelector('#tm-live-followers-cnt');
      const followersTotal = drawer.querySelector('#tm-live-followers-total');
      const followingCnt = drawer.querySelector('#tm-live-following-cnt');
      const followingTotal = drawer.querySelector('#tm-live-following-total');

      const resetAutoScrollUI = () => {
        if (autoScrollBtn) {
          autoScrollBtn.textContent = '⚡ Auto-Scroll: Off';
          autoScrollBtn.classList.remove('active');
        }
      };

      TM_RelationshipAuditor.onAutoScrollComplete = (count) => {
        resetAutoScrollUI();
        const activeTab = TM_RelationshipAuditor.liveState.activeTab;
        const tabLabel = activeTab === 'following' ? 'Following' : 'Followers';
        showToast(`✓ Auto-Scroll completed (${(count || 0).toLocaleString()} ${tabLabel} scanned)`);
      };

      if (autoScrollBtn) {
        autoScrollBtn.onclick = () => {
          const isNowActive = TM_RelationshipAuditor.toggleAutoScroll();
          if (isNowActive) {
            autoScrollBtn.textContent = '⏸️ Pause Auto-Scroll';
            autoScrollBtn.classList.add('active');
            showToast('⚡ Auto-Scroll enabled');
          } else {
            resetAutoScrollUI();
            showToast('⏸️ Auto-Scroll paused');
          }
        };
      }

      startLiveBtn.onclick = () => {
        const openDialog = document.querySelector('[role="dialog"]');
        if (!openDialog) {
          showToast('⚠️ Please open Followers or Following modal on your profile first');
          return;
        }

        const username = TM_RelationshipAuditor.detectUsername() || prompt('Please enter your Threads username (e.g. choke.dev):');
        if (!username) return;

        const started = TM_RelationshipAuditor.startLiveCapture(username, (state) => {
          followersCnt.textContent = state.followersCount.toLocaleString();
          followingCnt.textContent = state.followingCount.toLocaleString();

          if (state.followersTarget > 0) {
            followersTotal.textContent = `/ ${state.followersTarget.toLocaleString()}`;
          }
          if (state.followingTarget > 0) {
            followingTotal.textContent = `/ ${state.followingTarget.toLocaleString()}`;
          }

          if (state.activeTab === 'followers') {
            cardFollowers.classList.add('active');
            cardFollowing.classList.remove('active');
            pillFollowers.textContent = 'Scanning 🟢';
            pillFollowers.className = 'tm-live-status-pill active';
            pillFollowing.textContent = 'Waiting ⚪';
            pillFollowing.className = 'tm-live-status-pill';
          } else {
            cardFollowing.classList.add('active');
            cardFollowers.classList.remove('active');
            pillFollowing.textContent = 'Scanning 🟢';
            pillFollowing.className = 'tm-live-status-pill active';
            pillFollowers.textContent = 'Waiting ⚪';
            pillFollowers.className = 'tm-live-status-pill';
          }
        });

        if (!started) {
          showToast('⚠️ Could not attach to modal');
          return;
        }

        idleActions.style.display = 'none';
        liveBox.style.display = 'block';
        showToast('🟢 Live Capture started. Scroll the list to capture accounts.');
      };

      switchFollowersBtn.onclick = () => {
        TM_RelationshipAuditor.switchLiveTab('followers');
      };

      switchFollowingBtn.onclick = () => {
        TM_RelationshipAuditor.switchLiveTab('following');
      };

      finishLiveBtn.onclick = async () => {
        finishLiveBtn.disabled = true;
        finishLiveBtn.textContent = 'Calculating...';
        try {
          const result = await TM_RelationshipAuditor.finishLiveCapture();
          if (result && result.diff) {
            TM_Studio.activeDiff = result.diff;
            TM_Studio.renderAuditorData(drawer, result.diff);
            TM_Studio.renderAuditorList(drawer);
            showToast(`✓ Audit complete: ${result.followers.length.toLocaleString()} Followers | ${result.following.length.toLocaleString()} Following`);
          }
        } catch (err) {
          showToast(`⚠️ ${err.message}`);
        } finally {
          finishLiveBtn.disabled = false;
          finishLiveBtn.textContent = '✅ Calculate Relationships';
          resetAutoScrollUI();
          liveBox.style.display = 'none';
          idleActions.style.display = 'block';
        }
      };

      cancelLiveBtn.onclick = () => {
        TM_RelationshipAuditor.stopLiveCapture();
        resetAutoScrollUI();
        liveBox.style.display = 'none';
        idleActions.style.display = 'block';
        showToast('⏹️ Live Capture cancelled');
      };

      // Close handlers
      const handleEscape = (e) => {
        if (e.key === 'Escape') {
          TM_RelationshipAuditor.stopLiveCapture();
          drawer.remove();
          document.removeEventListener('keydown', handleEscape);
        }
      };
      document.addEventListener('keydown', handleEscape);

      drawer.querySelector('#tm-close-drawer').onclick = () => {
        TM_RelationshipAuditor.stopLiveCapture();
        drawer.remove();
        document.removeEventListener('keydown', handleEscape);
      };
      drawer.querySelector('.tm-drawer-overlay').onclick = () => {
        TM_RelationshipAuditor.stopLiveCapture();
        drawer.remove();
        document.removeEventListener('keydown', handleEscape);
      };
    },

    renderAuditorData: (drawer, diff) => {
      if (!diff) return;
      drawer.querySelector('#tm-stat-notback').textContent = (diff.notFollowingBack || []).length;
      drawer.querySelector('#tm-stat-fans').textContent = (diff.fans || []).length;
      drawer.querySelector('#tm-stat-mutual').textContent = (diff.mutual || []).length;
      drawer.querySelector('#tm-stat-lost').textContent = (diff.lost || []).length;

      drawer.querySelector('#cnt-notback').textContent = (diff.notFollowingBack || []).length;
      drawer.querySelector('#cnt-fans').textContent = (diff.fans || []).length;
      drawer.querySelector('#cnt-mutual').textContent = (diff.mutual || []).length;
      drawer.querySelector('#cnt-lost').textContent = (diff.lost || []).length;
      drawer.querySelector('#cnt-gained').textContent = (diff.gained || []).length;

      TM_Studio.renderAuditorList(drawer);
    },

    getCurrentFilteredUsers: (drawer) => {
      const diff = TM_Studio.activeDiff;
      if (!diff) return [];
      let source = [];
      if (TM_Studio.currentTab === 'notback') source = diff.notFollowingBack || [];
      else if (TM_Studio.currentTab === 'fans') source = diff.fans || [];
      else if (TM_Studio.currentTab === 'mutual') source = diff.mutual || [];
      else if (TM_Studio.currentTab === 'lost') source = diff.lost || [];
      else if (TM_Studio.currentTab === 'gained') source = diff.gained || [];

      const query = (drawer.querySelector('#tm-auditor-search')?.value || '').trim().toLowerCase();
      if (!query) return source;
      return source.filter(u => u.toLowerCase().includes(query));
    },

    renderAuditorList: (drawer) => {
      const listContainer = drawer.querySelector('#tm-auditor-list');
      if (!listContainer) return;
      const users = TM_Studio.getCurrentFilteredUsers(drawer);

      if (users.length === 0) {
        listContainer.innerHTML = '<div class="tm-empty-state">No accounts found in this view</div>';
        return;
      }

      const PAGE_SIZE = 50;
      const currentLimit = TM_Studio._listLimit || PAGE_SIZE;
      const displayUsers = users.slice(0, currentLimit);
      const hasMore = users.length > currentLimit;

      listContainer.innerHTML = `
        <div class="tm-user-rows">
          ${displayUsers.map(u => `
            <div class="tm-user-row">
              <a class="tm-user-link" href="https://www.threads.net/@${u}" target="_blank" rel="noopener">
                <span class="tm-user-avatar">👤</span>
                <span class="tm-user-name">@${escapeHtml(u)}</span>
              </a>
              <button type="button" class="tm-copy-user-btn tm-btn-sub" data-user="${escapeHtml(u)}" title="Copy username">📋</button>
            </div>
          `).join('')}
        </div>
        ${hasMore ? `
          <div class="tm-list-more-box" style="text-align: center; padding: 12px 0;">
            <button type="button" class="tm-btn-sub tm-btn-load-more" id="tm-btn-load-more" style="width: 100%; padding: 8px 0; font-weight: 600; cursor: pointer;">
              Load More (${Math.min(PAGE_SIZE, users.length - currentLimit)} of ${(users.length - currentLimit).toLocaleString()} remaining)
            </button>
          </div>
        ` : ''}
      `;

      // Delegated click handler on container (zero individual listener overhead)
      listContainer.onclick = (e) => {
        const copyBtn = e.target.closest('.tm-copy-user-btn');
        if (copyBtn) {
          e.stopPropagation();
          const u = copyBtn.dataset.user;
          navigator.clipboard.writeText(`@${u}`).then(() => {
            showToast(`✓ Copied @${u}`);
          });
          return;
        }

        const moreBtn = e.target.closest('#tm-btn-load-more');
        if (moreBtn) {
          e.stopPropagation();
          TM_Studio._listLimit = (TM_Studio._listLimit || PAGE_SIZE) + PAGE_SIZE;
          TM_Studio.renderAuditorList(drawer);
        }
      };
    }
  };

  /* ─── 16. ANTI-SLOP STYLES (Solid Surface, Hairline) ──────── */
  function injectStyles() {
    if (document.getElementById('threadmax-styles')) return;
    const style = document.createElement('style');
    style.id = 'threadmax-styles';
    style.textContent = `
      /* Action Row Item Wrapper */
      .tm-wrapper {
        position: relative !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        height: 36px !important;
        min-width: 36px !important;
        box-sizing: border-box !important;
      }

      /* Common Button Styles */
      .tm-btn {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 36px !important;
        height: 36px !important;
        padding: 0 !important;
        margin: 0 !important;
        border-radius: 50% !important;
        color: rgba(243, 245, 247, 0.85) !important;
        cursor: pointer !important;
        transition: color 150ms ease, background-color 150ms ease, transform 100ms ease !important;
        user-select: none !important;
        box-sizing: border-box !important;
      }
      .tm-btn svg {
        display: block !important;
        margin: 0 auto !important;
        pointer-events: none !important;
      }
      .tm-btn:hover {
        color: #ffffff !important;
        background-color: rgba(255, 255, 255, 0.1) !important;
      }
      .tm-btn:active {
        transform: scale(0.92) !important;
      }

      /* Dropdown Menu (Fixed Body Portal + High Contrast Card) */
      .tm-dropdown {
        position: fixed !important;
        z-index: 2147483647 !important;
        min-width: 260px !important;
        background: #1c1c1e !important;
        border: 1px solid #3a3a3c !important;
        border-radius: 10px !important;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.95), 0 0 0 1px rgba(255, 255, 255, 0.08) !important;
        padding: 6px !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 2px !important;
        animation: tmFadeIn 120ms ease !important;
      }
      @keyframes tmFadeIn {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .tm-dropdown-item {
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
        padding: 10px 14px !important;
        border-radius: 6px !important;
        color: #f3f5f7 !important;
        font-size: 13px !important;
        font-weight: 500 !important;
        cursor: pointer !important;
        transition: background-color 120ms ease !important;
        white-space: nowrap !important;
      }
      .tm-dropdown-item:hover {
        background-color: #2c2c2e !important;
        color: #ffffff !important;
      }
      .tm-dropdown-icon {
        font-size: 15px !important;
      }

      /* Viral Velocity Badge */
      .tm-viral-badge {
        display: inline-flex !important;
        align-items: center !important;
        margin-left: 8px !important;
        padding: 2px 8px !important;
        background: rgba(239, 68, 68, 0.12) !important;
        border: 1px solid rgba(239, 68, 68, 0.35) !important;
        border-radius: 12px !important;
        color: #f87171 !important;
        font-size: 11px !important;
        font-weight: 600 !important;
        letter-spacing: 0.3px !important;
        vertical-align: middle !important;
      }

      /* Progress Bar */
      .tm-progress-bar {
        position: absolute !important;
        bottom: -22px !important;
        left: 0 !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 3px !important;
        z-index: 999 !important;
      }
      .tm-progress-text {
        font-size: 11px !important;
        color: #aaaaaa !important;
        font-family: monospace !important;
      }
      .tm-progress-track {
        width: 80px !important;
        height: 2px !important;
        background-color: #2a2a2a !important;
        border-radius: 2px !important;
        overflow: hidden !important;
      }
      .tm-progress-fill {
        height: 100% !important;
        width: 0% !important;
        background-color: #0095f6 !important;
        transition: width 150ms ease !important;
      }

      /* Checkbox Pill on Media Items */
      .tm-checkbox-pill {
        position: absolute !important;
        top: 10px !important;
        right: 10px !important;
        width: 26px !important;
        height: 26px !important;
        border-radius: 50% !important;
        background-color: rgba(18, 18, 18, 0.75) !important;
        border: 1.5px solid #555555 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        cursor: pointer !important;
        z-index: 50 !important;
        transition: all 150ms ease !important;
      }
      .tm-checkbox-pill svg {
        opacity: 0 !important;
        transform: scale(0.6) !important;
        transition: all 150ms ease !important;
      }
      .tm-checkbox-pill.active {
        background-color: #0095f6 !important;
        border-color: #0095f6 !important;
      }
      .tm-checkbox-pill.active svg {
        opacity: 1 !important;
        transform: scale(1) !important;
      }

      /* Selection Floating Bar */
      .tm-select-bar {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        margin: 8px 0 !important;
        padding: 10px 14px !important;
        background-color: #161616 !important;
        border: 1px solid #2a2a2a !important;
        border-radius: 8px !important;
        font-size: 13px !important;
        color: #ffffff !important;
      }
      .tm-select-actions {
        display: flex !important;
        gap: 8px !important;
      }
      .tm-btn-primary {
        background-color: #0095f6 !important;
        color: #ffffff !important;
        border: none !important;
        padding: 6px 14px !important;
        border-radius: 6px !important;
        font-weight: 600 !important;
        font-size: 12px !important;
        cursor: pointer !important;
        transition: background-color 150ms ease !important;
      }
      .tm-btn-primary:hover { background-color: #1877f2 !important; }
      .tm-btn-sub {
        background-color: #242424 !important;
        color: #e0e0e0 !important;
        border: 1px solid #333333 !important;
        padding: 6px 12px !important;
        border-radius: 6px !important;
        font-size: 12px !important;
        cursor: pointer !important;
        transition: background-color 150ms ease !important;
      }
      .tm-btn-sub:hover { background-color: #2e2e2e !important; }
      .tm-btn-cancel {
        background: transparent !important;
        color: #888888 !important;
        border: none !important;
        padding: 6px 10px !important;
        font-size: 12px !important;
        cursor: pointer !important;
      }
      .tm-btn-cancel:hover { color: #cccccc !important; }

      /* Video Booster Controls */
      .tm-video-controls {
        position: absolute !important;
        top: 12px !important;
        right: 12px !important;
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        z-index: 40 !important;
        opacity: 0 !important;
        transition: opacity 150ms ease !important;
      }
      div:hover > .tm-video-controls, .tm-video-controls:hover {
        opacity: 1 !important;
      }
      .tm-video-btn {
        background-color: rgba(18, 18, 18, 0.85) !important;
        border: 1px solid rgba(255, 255, 255, 0.15) !important;
        border-radius: 6px !important;
        color: #ffffff !important;
        font-size: 11px !important;
        font-weight: 600 !important;
        padding: 4px 8px !important;
        cursor: pointer !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
      }
      .tm-video-btn:hover {
        background-color: #000000 !important;
        border-color: rgba(255, 255, 255, 0.35) !important;
      }

      /* Thread Unroller & Splitter Modal */
      #tm-reader-modal, #tm-splitter-modal {
        position: fixed !important;
        inset: 0 !important;
        z-index: 1000000 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        animation: tmFadeIn 150ms ease !important;
      }
      .tm-reader-overlay {
        position: absolute !important;
        inset: 0 !important;
        background: rgba(0, 0, 0, 0.82) !important;
      }
      .tm-reader-card {
        position: relative !important;
        width: 90% !important;
        max-width: 680px !important;
        max-height: 85vh !important;
        background: #141414 !important;
        border: 1px solid #2a2a2a !important;
        border-radius: 12px !important;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.9) !important;
        display: flex !important;
        flex-direction: column !important;
        overflow: hidden !important;
      }
      .tm-reader-header {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        padding: 16px 20px !important;
        border-bottom: 1px solid #242424 !important;
      }
      .tm-reader-title {
        font-size: 16px !important;
        font-weight: 700 !important;
        color: #ffffff !important;
      }
      .tm-reader-author {
        font-size: 12px !important;
        color: #888888 !important;
        margin-top: 2px !important;
      }
      .tm-reader-header-actions {
        display: flex !important;
        gap: 8px !important;
      }
      .tm-reader-body {
        padding: 20px !important;
        overflow-y: auto !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 16px !important;
      }
      .tm-reader-segment, .tm-split-item {
        padding: 14px !important;
        background: #1a1a1a !important;
        border: 1px solid #282828 !important;
        border-radius: 8px !important;
        position: relative !important;
      }
      .tm-split-item-header {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        margin-bottom: 8px !important;
      }
      .tm-segment-badge {
        display: inline-block !important;
        font-size: 11px !important;
        font-weight: 700 !important;
        color: #0095f6 !important;
      }
      .tm-segment-text, .tm-split-text {
        font-size: 14px !important;
        line-height: 1.6 !important;
        color: #e4e6eb !important;
      }
      .tm-segment-media-hint {
        margin-top: 8px !important;
        font-size: 11px !important;
        color: #777777 !important;
      }

      /* Composer Bar */
      .tm-composer-bar {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        padding: 6px 12px !important;
        font-size: 11px !important;
        color: #888888 !important;
        border-top: 1px solid #242424 !important;
      }
      .tm-composer-left {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
      }
      .tm-split-btn {
        background: #0095f6 !important;
        color: #fff !important;
        border: none !important;
        border-radius: 4px !important;
        padding: 3px 8px !important;
        font-size: 11px !important;
        font-weight: 600 !important;
        cursor: pointer !important;
      }
      .tm-hook-status { font-weight: 500 !important; }
      .tm-hook-safe { color: #10b981 !important; }
      .tm-hook-cut { color: #f59e0b !important; }
      .tm-hook-over { color: #ef4444 !important; }

      /* Studio Floating Launcher */
      #tm-studio-launcher {
        position: fixed !important;
        bottom: 20px !important;
        left: 20px !important;
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        padding: 8px 14px !important;
        background: #141414 !important;
        border: 1px solid #2a2a2a !important;
        border-radius: 20px !important;
        color: #f0f0f0 !important;
        font-size: 12px !important;
        font-weight: 600 !important;
        cursor: pointer !important;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.75) !important;
        z-index: 99999 !important;
        transition: transform 120ms ease, background 120ms ease !important;
      }
      #tm-studio-launcher:hover {
        background: #1e1e1e !important;
        transform: translateY(-2px) !important;
      }

      /* Studio Drawer Modal */
      #tm-studio-drawer {
        position: fixed !important;
        inset: 0 !important;
        z-index: 1000000 !important;
        display: flex !important;
        justify-content: flex-end !important;
        animation: tmFadeIn 150ms ease !important;
        pointer-events: none !important;
      }
      .tm-drawer-overlay {
        position: absolute !important;
        inset: 0 !important;
        background: transparent !important;
        pointer-events: none !important;
      }
      .tm-drawer-content {
        position: relative !important;
        width: 100% !important;
        max-width: 440px !important;
        height: 100% !important;
        background: #141414 !important;
        border-left: 1px solid #282828 !important;
        box-shadow: -10px 0 36px rgba(0, 0, 0, 0.9) !important;
        display: flex !important;
        flex-direction: column !important;
        pointer-events: auto !important;
      }
      .tm-drawer-header {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        padding: 16px 20px !important;
        border-bottom: 1px solid #242424 !important;
      }
      .tm-drawer-brand {
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
      }
      .tm-brand-icon {
        font-size: 20px !important;
      }
      .tm-drawer-title {
        font-size: 15px !important;
        font-weight: 700 !important;
        color: #ffffff !important;
      }
      .tm-drawer-subtitle {
        font-size: 11px !important;
        color: #888888 !important;
      }
      .tm-drawer-tabs {
        display: flex !important;
        border-bottom: 1px solid #242424 !important;
      }
      .tm-drawer-tab {
        flex: 1 !important;
        text-align: center !important;
        padding: 12px !important;
        font-size: 13px !important;
        font-weight: 600 !important;
        color: #777777 !important;
        cursor: pointer !important;
        border-bottom: 2px solid transparent !important;
      }
      .tm-drawer-tab.active {
        color: #ffffff !important;
        border-bottom-color: #0095f6 !important;
      }
      .tm-drawer-body {
        flex: 1 !important;
        padding: 20px !important;
        overflow-y: auto !important;
      }
      .tm-tab-pane {
        display: none !important;
      }
      .tm-tab-pane.active {
        display: block !important;
      }
      .tm-auditor-stats {
        display: flex !important;
        gap: 12px !important;
        margin-bottom: 16px !important;
      }
      .tm-stat-card {
        flex: 1 !important;
        padding: 14px !important;
        background: #1a1a1a !important;
        border: 1px solid #2a2a2a !important;
        border-radius: 8px !important;
        text-align: center !important;
      }
      .tm-stat-num {
        font-size: 22px !important;
        font-weight: 800 !important;
        color: #0095f6 !important;
      }
      .tm-stat-label {
        font-size: 11px !important;
        color: #888888 !important;
        margin-top: 4px !important;
      }
      .tm-auditor-actions {
        margin-bottom: 16px !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 8px !important;
      }
      .tm-auditor-actions button {
        width: 100% !important;
        padding: 10px !important;
      }
      .tm-btn-secondary {
        background: #202020 !important;
        color: #e4e6eb !important;
        border: 1px solid #333333 !important;
        border-radius: 8px !important;
        font-weight: 600 !important;
        font-size: 13px !important;
        cursor: pointer !important;
        transition: all 140ms ease !important;
      }
      .tm-btn-secondary:hover {
        background: #282828 !important;
        border-color: #0095f6 !important;
        color: #ffffff !important;
      }
      .tm-empty-state {
        text-align: center !important;
        padding: 30px 20px !important;
        color: #666666 !important;
        font-size: 12px !important;
        line-height: 1.6 !important;
        background: #181818 !important;
        border-radius: 8px !important;
      }
      .tm-setting-row {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        padding: 14px 0 !important;
        border-bottom: 1px solid #222222 !important;
      }
      .tm-setting-title {
        font-size: 13px !important;
        font-weight: 600 !important;
        color: #f0f0f0 !important;
      }
      .tm-setting-desc {
        font-size: 11px !important;
        color: #777777 !important;
        margin-top: 2px !important;
      }
      .tm-select {
        background: #202020 !important;
        color: #f0f0f0 !important;
        border: 1px solid #333333 !important;
        padding: 6px 10px !important;
        border-radius: 6px !important;
        font-size: 12px !important;
        outline: none !important;
      }
      .tm-checkbox {
        width: 18px !important;
        height: 18px !important;
        accent-color: #0095f6 !important;
      }

      /* Clean Toast */
      #tm-toast {
        position: fixed !important;
        bottom: 36px !important;
        left: 50% !important;
        transform: translateX(-50%) translateY(20px) !important;
        background-color: #181818 !important;
        color: #f0f0f0 !important;
        border: 1px solid #333333 !important;
        padding: 8px 18px !important;
        border-radius: 20px !important;
        font-size: 13px !important;
        font-weight: 500 !important;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.7) !important;
        opacity: 0 !important;
        pointer-events: none !important;
        transition: transform 200ms ease, opacity 200ms ease !important;
        z-index: 9999999 !important;
      }
      #tm-toast.tm-toast-visible {
        opacity: 1 !important;
        transform: translateX(-50%) translateY(0) !important;
      }

      /* Feed Top Filter Bar */
      .tm-feed-filter-bar {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        padding: 8px 16px !important;
        margin: 0 auto 12px auto !important;
        max-width: 620px !important;
        width: 100% !important;
        box-sizing: border-box !important;
        z-index: 100 !important;
      }
      .tm-filter-pills {
        display: flex !important;
        background: #181818 !important;
        border: 1px solid #282828 !important;
        border-radius: 20px !important;
        padding: 3px !important;
        gap: 4px !important;
      }
      .tm-filter-pill {
        background: transparent !important;
        color: #888888 !important;
        border: none !important;
        padding: 5px 14px !important;
        border-radius: 16px !important;
        font-size: 12px !important;
        font-weight: 600 !important;
        cursor: pointer !important;
        transition: all 140ms ease !important;
      }
      .tm-filter-pill:hover {
        color: #ffffff !important;
      }
      .tm-filter-pill.active {
        background: #282828 !important;
        color: #ffffff !important;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4) !important;
      }

      /* Auditor Live Capture Box & Controls */
      .tm-auditor-hint {
        font-size: 11px !important;
        color: #888888 !important;
        line-height: 1.4 !important;
        margin-top: 8px !important;
        text-align: center !important;
      }
      .tm-btn-pulse {
        background: #00875a !important;
        box-shadow: 0 0 12px rgba(0, 135, 90, 0.4) !important;
      }
      .tm-btn-pulse:hover {
        background: #00a36c !important;
      }
      .tm-live-capture-box {
        background: #181818 !important;
        border: 1px solid #0095f6 !important;
        border-radius: 10px !important;
        padding: 14px !important;
        margin-bottom: 16px !important;
        animation: tmFadeIn 180ms ease !important;
      }
      .tm-live-header {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        margin-bottom: 8px !important;
      }
      .tm-live-title {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        font-size: 13px !important;
        font-weight: 700 !important;
        color: #ffffff !important;
      }
      .tm-live-dot {
        width: 8px !important;
        height: 8px !important;
        border-radius: 50% !important;
        background: #00ff88 !important;
        box-shadow: 0 0 8px #00ff88 !important;
        animation: tmPulse 1.4s infinite ease-in-out !important;
      }
      @keyframes tmPulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.3); opacity: 0.6; }
      }
      .tm-live-badge {
        font-size: 10px !important;
        background: rgba(0, 255, 136, 0.15) !important;
        color: #00ff88 !important;
        border: 1px solid rgba(0, 255, 136, 0.3) !important;
        padding: 2px 7px !important;
        border-radius: 4px !important;
        font-weight: 600 !important;
      }
      .tm-live-guide {
        font-size: 11px !important;
        color: #aaaaaa !important;
        line-height: 1.4 !important;
        margin-bottom: 10px !important;
      }
      .tm-live-autoscroll-bar {
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
        background: #1c1c1e !important;
        border: 1px solid #2c2c2e !important;
        border-radius: 8px !important;
        padding: 8px 12px !important;
        margin-bottom: 12px !important;
      }
      .tm-btn-autoscroll {
        flex-shrink: 0 !important;
        background: #2c2c2e !important;
        color: #e5e5ea !important;
        font-size: 11px !important;
        font-weight: 600 !important;
        padding: 6px 12px !important;
        border-radius: 6px !important;
        border: 1px solid #3a3a3c !important;
        cursor: pointer !important;
        transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease !important;
        white-space: nowrap !important;
        transform: none !important;
        animation: none !important;
      }
      .tm-btn-autoscroll:hover {
        background: #3a3a3c !important;
        color: #ffffff !important;
      }
      .tm-btn-autoscroll.active {
        background: #00875a !important;
        border-color: #00a36c !important;
        color: #ffffff !important;
        box-shadow: none !important;
        transform: none !important;
        animation: none !important;
      }
      .tm-autoscroll-desc {
        font-size: 11px !important;
        color: #888888 !important;
        line-height: 1.3 !important;
        flex: 1 !important;
      }
      .tm-live-cards {
        display: flex !important;
        gap: 10px !important;
        margin-bottom: 12px !important;
      }
      .tm-live-card {
        flex: 1 !important;
        background: #202020 !important;
        border: 1px solid #333333 !important;
        border-radius: 8px !important;
        padding: 10px !important;
        text-align: center !important;
        transition: border-color 140ms ease, background 140ms ease !important;
      }
      .tm-live-card.active {
        border-color: #0095f6 !important;
        background: #142334 !important;
        box-shadow: 0 0 10px rgba(0, 149, 246, 0.25) !important;
      }
      .tm-live-card-top {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        margin-bottom: 6px !important;
      }
      .tm-live-card-name {
        font-size: 11px !important;
        font-weight: 600 !important;
        color: #888888 !important;
      }
      .tm-live-card.active .tm-live-card-name {
        color: #ffffff !important;
      }
      .tm-live-status-pill {
        font-size: 10px !important;
        padding: 1px 5px !important;
        border-radius: 3px !important;
        background: #2a2a2a !important;
        color: #777777 !important;
      }
      .tm-live-status-pill.active {
        background: rgba(0, 255, 136, 0.2) !important;
        color: #00ff88 !important;
        font-weight: 600 !important;
      }
      .tm-live-card-metric {
        font-size: 18px !important;
        font-weight: 700 !important;
        color: #ffffff !important;
        margin-bottom: 8px !important;
      }
      .tm-live-val {
        color: #00ff88 !important;
      }
      .tm-live-max {
        font-size: 12px !important;
        color: #777777 !important;
        font-weight: 400 !important;
        margin-left: 3px !important;
      }
      .tm-btn-switch-tab {
        width: 100% !important;
        font-size: 11px !important;
        padding: 5px 0 !important;
      }
      .tm-live-actions {
        display: flex !important;
        gap: 8px !important;
      }
      .tm-btn-finish {
        flex: 2 !important;
        background: #00875a !important;
        color: #ffffff !important;
        font-weight: 700 !important;
      }
      .tm-btn-finish:hover {
        background: #00a36c !important;
      }
      .tm-auditor-subtabs {
        display: flex !important;
        gap: 6px !important;
        overflow-x: auto !important;
        padding-bottom: 8px !important;
        margin-bottom: 12px !important;
      }
      .tm-subtab {
        background: #1a1a1a !important;
        border: 1px solid #282828 !important;
        border-radius: 16px !important;
        padding: 5px 12px !important;
        font-size: 11px !important;
        font-weight: 600 !important;
        color: #888888 !important;
        cursor: pointer !important;
        white-space: nowrap !important;
        transition: all 120ms ease !important;
      }
      .tm-subtab:hover {
        color: #ffffff !important;
        border-color: #383838 !important;
      }
      .tm-subtab.active {
        background: #0095f6 !important;
        color: #ffffff !important;
        border-color: #0095f6 !important;
      }
      .tm-auditor-toolbar {
        display: flex !important;
        gap: 8px !important;
        margin-bottom: 14px !important;
      }
      .tm-search-input {
        flex: 1 !important;
        background: #181818 !important;
        border: 1px solid #2a2a2a !important;
        border-radius: 6px !important;
        padding: 6px 12px !important;
        font-size: 12px !important;
        color: #ffffff !important;
        outline: none !important;
      }
      .tm-search-input:focus {
        border-color: #0095f6 !important;
      }
      .tm-user-rows {
        display: flex !important;
        flex-direction: column !important;
        gap: 6px !important;
      }
      .tm-user-row {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        padding: 8px 12px !important;
        background: #181818 !important;
        border: 1px solid #242424 !important;
        border-radius: 8px !important;
        transition: background 120ms ease !important;
      }
      .tm-user-row:hover {
        background: #202020 !important;
      }
      .tm-user-link {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        text-decoration: none !important;
        color: #e4e6eb !important;
        font-size: 13px !important;
        font-weight: 600 !important;
      }
      .tm-user-link:hover {
        color: #0095f6 !important;
      }
      .tm-user-avatar {
        font-size: 14px !important;
      }
      .tm-copy-user-btn {
        padding: 3px 8px !important;
        font-size: 11px !important;
      }
    `;
    document.head.appendChild(style);
  }

  /* ─── 17. SCAN & MUTATION OBSERVER ────────────────────────── */
  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      // Pause heavy background feed scanning when modal live capture is running
      if (typeof TM_RelationshipAuditor !== 'undefined' && TM_RelationshipAuditor.liveState && TM_RelationshipAuditor.liveState.isCapturing) {
        return;
      }
      const shareItems = TM_DOM.findShareButtons();
      shareItems.forEach(shareInfo => {
        TM_Buttons.injectIntoActionRow(shareInfo);
      });
      TM_Video.init();
      TM_Timestamp.updateAll();
      TM_ViralRadar.injectFilterBar();
      TM_ViralRadar.scan();
      TM_Composer.init();
      TM_Studio.injectLauncher();
    }, 250);
  }

  function init() {
    injectStyles();
    scheduleScan();

    const observer = new MutationObserver((mutations) => {
      let shouldScan = false;
      for (const m of mutations) {
        if (m.addedNodes.length > 0) {
          shouldScan = true;
          break;
        }
      }
      if (shouldScan) scheduleScan();
    });

    observer.observe(document.body, { childList: true, subtree: true });
    console.info('[ThreadMax] v1.4.0 initialized successfully');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
