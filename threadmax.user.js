// ==UserScript==
// @name         ThreadMax
// @namespace    https://github.com/Stxyu-p/threadmax
// @version      1.4.0
// @description  Precision Media Downloader, Video Booster, Clean Link, Smart Timestamps, Thread Unroller, Splitter for Threads Web
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
 * - Text Splitter sentence-boundary chunker: <= 480 chars to ensure clean 1/N sub-posts.
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

  /* ─── 2. PURE CLIENT-SIDE ZIP32 ENGINE (Zero Dependencies) ── */
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

  /* ─── 3. UTILITIES & ONE-LINERS ──────────────────────────── */
  const showToast = (msg, ms = 2200) => {
    let t = document.getElementById('tm-toast');
    if (!t) { t = document.createElement('div'); t.id = 'tm-toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('tm-toast-visible');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('tm-toast-visible'), ms);
  };

  // P0 (a11y): div[role=button] must activate on Enter/Space like native buttons.
  const tmKeyActivate = (el, fn) => el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); fn(e); }
  });

  // P0 (a11y): keep Tab inside an open modal instead of walking into the feed behind it.
  // ponytail: only wraps first/last; ceiling is that a focusable element added after open can
  // escape. Upgrade: recompute the focusable list on each Tab.
  const tmFocusTrap = (modal, onEscape) => {
    const SEL = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onEscape(); return; }
      if (e.key !== 'Tab') return;
      const f = modal.querySelectorAll(SEL);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1], active = document.activeElement;
      const inside = active && modal.contains(active);
      if (e.shiftKey && (!inside || active === first)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (!inside || active === last)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  };

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
  };

  // Resolves true = file saved & verified, false = unverified/failed (P1: honest per-file counting).
  // GM_download only calls ontimeout when a timeout option is passed, and the option
  // was missing: a stalled download left the promise pending forever, the progress
  // bar wedged at 0/n, and the "individual files" loop never advanced past that file.
  const GM_DOWNLOAD_TIMEOUT_MS = 30000;
  const downloadDirect = (url, filename) => new Promise((resolve) => {
    if (typeof GM_download !== 'function') return fetchAsBlob(url, filename, resolve);
    let settled = false;
    const finish = ok => { if (!settled) { settled = true; clearTimeout(timer); resolve(ok); } };
    const fallback = () => fetchAsBlob(url, filename, finish);
    const timer = setTimeout(fallback, GM_DOWNLOAD_TIMEOUT_MS);
    try {
      GM_download({ url, name: filename, saveAs: false, timeout: GM_DOWNLOAD_TIMEOUT_MS,
        onload: () => finish(true), onerror: fallback, ontimeout: fallback });
    } catch { fallback(); }
  });

  const fetchAsBlob = (url, filename, done) => {
    fetch(url)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); })
      .then(b => { downloadBlob(b, filename); done(true); })
      // ponytail: raw <a download> fallback cannot report result → counted as unverified/failed. Upgrade: fetch-only path.
      .catch(() => { try { const a = document.createElement('a'); a.href = url; a.download = filename; a.target = '_blank'; document.body.appendChild(a); a.click(); a.remove(); } catch {} done(false); });
  };

  const cleanPostUrl = url => {
    try {
      const u = new URL(url), m = u.pathname.match(/(\/@[^/]+\/post\/[^/?#]+)/);
      return m ? `https://www.threads.com${m[1]}` : `${u.origin}${u.pathname}`;
    } catch { return (url || '').split('?')[0]; }
  };

  // Windows reserves < > : " / \ | ? * and control chars; a Threads handle can
  // contain them, which would produce a filename the OS rejects silently.
  const safeFilename = s => String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[.\s]+$/g, '').slice(0, 80) || 'file';
  const escapeHtml = str => String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]);

  const parseMetricNumber = str => !str ? 0 : (s => (parseFloat(s) || 0) * ({ k: 1e3, m: 1e6 }[s.slice(-1)] || 1))(String(str).trim().toLowerCase());

  /* ─── 4. DOM EXTRACTION (HIGH-RES MEDIA, METRICS, POST) ───── */
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

    // Layered so a Meta redesign degrades one step instead of killing every feature.
    // ponytail: 3 layers. Ceiling: a full rebrand that changes the label text AND the icon
    // geometry would still miss; upgrade: let users pin a selector from the menu.
    findShareButtons: () => {
      const res = [];
      const collect = (icon) => {
        // The icon may be the button itself, or the svg nested inside it.
        // ponytail: closest() only walks ancestors, so a button that WRAPS its
        // svg never matched. Upgrade: no need, both directions are covered.
        const svg = icon.closest?.('svg') || (icon.tagName?.toLowerCase() === 'svg' ? icon : null)
          || icon.querySelector?.('svg') || null;
        const btn = svg?.closest('[role="button"]') || svg?.parentElement;
        const wrapper = btn?.parentElement;
        // The action row is the nearest ancestor holding more than one action
        // cell; two levels up lands on a single cell on the current DOM.
        let actionRow = wrapper?.parentElement;
        for (let cur = actionRow, up = 0; cur && cur !== document.body && up < 4; cur = cur.parentElement, up++) {
          if ((cur.querySelectorAll('[role="button"]').length || 0) > 1) { actionRow = cur; break; }
        }
        if (btn && wrapper && actionRow && !res.some(r => r.shareBtn === btn)) {
          res.push({ shareSvg: svg, shareBtn: btn, shareWrapper: wrapper, actionRow });
        }
      };

      // 1. Semantic: the share button is always the labelled one, whatever icon it draws.
      document.querySelectorAll('[role="button"][aria-label*="Share" i], [role="button"][aria-label*="แชร์"]').forEach(collect);

      // 2. Icon geometry: covers feeds where the label sits on the svg, not the button.
      if (res.length === 0) {
        document.querySelectorAll('svg[title*="Share" i], svg[title*="แชร์"], svg[aria-label*="Share" i], svg[aria-label*="แชร์"]').forEach(collect);
      }

      // 3. Path hash: the pre-2026 fallback, kept because it costs one query and has
      //    survived every icon refresh so far.
      if (res.length === 0) {
        document.querySelectorAll('path[d*="M7.247 1.499"], path[d*="M7.246 1.5"], path[d*="M1.53 6.014"]').forEach(collect);
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

  /* ─── 5. IN-FEED ACTION BUTTONS & STACKING PROTECTION ─────── */
  const TM_Buttons = {
    injectIntoActionRow: (shareInfo) => {
      const { shareBtn, shareWrapper, actionRow } = shareInfo;
      // Check the live DOM, not a sticky flag: Threads re-renders an action row
      // (hover, expand, media swap) and wipes our buttons. A cached dataset
      // marker would leave that post permanently dead until reload.
      // ponytail: the button check doubles as the idempotency guard.
      if (actionRow.querySelector('.tm-download-btn, .tm-cleanlink-btn')) return;

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

        const onDlAction = (e) => {
          e.preventDefault(); e.stopPropagation();
          if (media.length === 1) TM_Downloader.downloadSingle(media[0], author, postId, 1, dlBtn);
          else TM_Buttons.showCarouselDropdown(dlWrapper, dlBtn, postData);
        };
        dlBtn.addEventListener('click', onDlAction);
        tmKeyActivate(dlBtn, onDlAction);

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

      const onLinkAction = (e) => {
        e.preventDefault(); e.stopPropagation();
        navigator.clipboard.writeText(cleanPostUrl(postUrl)).then(() => showToast('✓ คัดลอกลิงก์สะอาดแล้ว')).catch(() => showToast('⚠️ เข้าถึง Clipboard ไม่ได้'));
      };
      linkBtn.addEventListener('click', onLinkAction);
      tmKeyActivate(linkBtn, onLinkAction);

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
        const onUnrollAction = (e) => { e.preventDefault(); e.stopPropagation(); TM_Unroller.open(author, postId); };
        unrollBtn.addEventListener('click', onUnrollAction);
        tmKeyActivate(unrollBtn, onUnrollAction);
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

      const itemAll = dropdown.querySelector('[data-action="all"]');
      const itemSel = dropdown.querySelector('[data-action="select"]');
      [itemAll, itemSel].forEach(it => { it.setAttribute('role', 'button'); it.tabIndex = 0; });

      itemAll.onclick = (e) => {
        e.stopPropagation(); closeDropdown();
        TM_Downloader.downloadBatch(postData.media, postData.author, postData.postId, anchorBtn, mode);
      };

      itemSel.onclick = (e) => {
        e.stopPropagation(); closeDropdown();
        TM_Selector.activate(postData, anchorBtn);
      };
      tmKeyActivate(itemAll, (e) => itemAll.onclick(e));
      tmKeyActivate(itemSel, (e) => itemSel.onclick(e));

      // Portal clamping: position fixed in viewport, flip above when no room below (P0 a11y/mobile)
      const rect = anchorBtn.getBoundingClientRect();
      const dropdownWidth = 270;
      let left = Math.max(16, Math.min(rect.left, window.innerWidth - dropdownWidth - 16));

      dropdown.style.cssText = `position:fixed;top:-9999px;left:${left}px;z-index:2147483647;`;
      document.body.appendChild(dropdown);
      const ddHeight = dropdown.offsetHeight;
      let top = rect.bottom + 6;
      if (top + ddHeight > window.innerHeight - 8) top = Math.max(8, rect.top - 6 - ddHeight);
      dropdown.style.top = `${top}px`;

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

  /* ─── 6. BATCH DOWNLOADER & PROGRESS ──────────────────────── */
  const TM_Downloader = {
    downloadSingle: (item, author, postId, index, anchorBtn) => {
      const ext = item.type === 'video' ? 'mp4' : 'jpg';
      const filename = `${safeFilename(author)}_${safeFilename(postId)}_${String(index).padStart(3, '0')}.${ext}`;
      TM_Downloader.showProgress(anchorBtn, 1, 1);

      if (item.type === 'video') {
        downloadDirect(item.url, filename);
        setTimeout(() => TM_Downloader.clearProgress(anchorBtn), 1200);
      } else {
        fetch(item.url)
          .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); })
          .then(blob => { downloadBlob(blob, filename); TM_Downloader.clearProgress(anchorBtn); })
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
          const ok = await downloadDirect(item.url, `${safeFilename(author)}_${safeFilename(postId)}_${String(i + 1).padStart(3, '0')}.${ext}`);
          if (ok) completed++; else failed++;
          TM_Downloader.showProgress(anchorBtn, i + 1, total);
          await new Promise(r => setTimeout(r, 220));
        }
        setTimeout(() => TM_Downloader.clearProgress(anchorBtn), 1500);
        showToast(failed === 0 ? `✓ ดาวน์โหลดเรียบร้อย ${completed}/${total} ไฟล์`
          : `⚠️ ยืนยันได้ ${completed}/${total} ไฟล์ (${failed} ล้มเหลว/ตรวจสอบโฟลเดอร์)`);
        return;
      }

      // ZIP Mode
      const zipFiles = [];
      for (let i = 0; i < mediaList.length; i++) {
        const item = mediaList[i];
        const ext = item.type === 'video' ? 'mp4' : 'jpg';
        try {
          const resp = await fetch(item.url);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const buf = await resp.arrayBuffer();
          zipFiles.push({ name: `${safeFilename(author)}_${safeFilename(postId)}_${String(i + 1).padStart(3, '0')}.${ext}`, data: new Uint8Array(buf) });
          completed++;
        } catch { failed++; }
        TM_Downloader.showProgress(anchorBtn, completed + failed, total);
      }

      if (zipFiles.length > 0) {
        downloadBlob(createStoredZip(zipFiles), `${safeFilename(author)}_${safeFilename(postId)}_carousel_${zipFiles.length}items.zip`);
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

      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-label', 'ThreadMax download progress');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', String(total));
      bar.setAttribute('aria-valuenow', String(current));

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

  /* ─── 7. INTERACTIVE SELECTION MODE (Non-Destructive) ──────── */
  const TM_Selector = {
    activate: (postData, anchorBtn) => {
      const { card, media, author, postId } = postData;
      const selected = new Set(media.map((_, i) => i));

      media.forEach((item, index) => {
        // Anchor on the media element itself. A carousel puts every image inside one
        // .media wrapper, so resolving a shared "tile" made 11 of 12 items share a
        // single pill: the first item created it and the rest bailed on the guard.
        const tile = item.element;
        if (!tile || tile.querySelector('.tm-checkbox-pill')) return;

        const pill = document.createElement('div');
        pill.className = 'tm-checkbox-pill active';
        pill.dataset.index = index;
        pill.setAttribute('role', 'checkbox');
        pill.tabIndex = 0;
        pill.setAttribute('aria-checked', 'true');
        pill.setAttribute('aria-label', `เลือกไฟล์ที่ ${index + 1}`);
        pill.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

        pill.onclick = (e) => {
          e.stopPropagation(); e.preventDefault();
          if (selected.has(index)) { selected.delete(index); pill.classList.remove('active'); pill.setAttribute('aria-checked', 'false'); }
          else { selected.add(index); pill.classList.add('active'); pill.setAttribute('aria-checked', 'true'); }
          TM_Selector.updateBar(card, selected.size);
        };
        tmKeyActivate(pill, (e) => pill.onclick(e));
        tile.appendChild(pill);
      });

      // Walk up from our own button instead of guessing Meta's hashed class: the
      // wrapper we injected sits in the row, so the row is its parentElement.
      const dlWrapper = card.querySelector('.tm-download-btn')?.parentElement;
      const actionRow = dlWrapper?.parentElement || null;
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

  /* ─── 8. VIDEO PLAYER BOOSTER ─────────────────────────────── */
  const TM_Video = {
    speeds: [1.0, 1.25, 1.5, 2.0],

    init: () => {
      document.querySelectorAll('video:not([data-tm-boosted])').forEach(TM_Video.enhance);
    },

    enhance: (video) => {
      video.volume = Math.max(0, Math.min(1, TM_Config.get(CONFIG_KEYS.VIDEO_VOLUME, 0.8)));

      // Bind the volume listener exactly once. Threads re-renders video nodes and
      // drops the data attribute, so keying the listener off it re-attached a new
      // closure on every scan and leaked one per pass.
      if (!video.dataset.tmVolumeBound) {
        video.dataset.tmVolumeBound = '1';
        video.addEventListener('volumechange', () => {
          if (!video.muted) TM_Config.set(CONFIG_KEYS.VIDEO_VOLUME, video.volume);
        });
      }
      video.dataset.tmBoosted = 'true';

      const parent = video.parentElement;
      if (!parent) return;
      // The controls hold a closure over THIS video. When Threads swaps the node
      // the parent and its controls survive, so the old buttons kept driving the
      // detached video: the label said 1.5x while the new element played at 1x.
      // Rebuild whenever the existing controls point at a different element.
      const existing = parent.querySelector('.tm-video-controls');
      if (existing) {
        if (existing._tmVideo === video) return;
        existing.remove();
      }

      const ctrl = document.createElement('div');
      ctrl.className = 'tm-video-controls';
      ctrl._tmVideo = video;
      ctrl.setAttribute('role', 'group');
      ctrl.setAttribute('aria-label', 'การควบคุมวิดีโอ');
      let speedIdx = 0;

      // Static template literal: no user or network data is interpolated, so innerHTML is safe here.
      ctrl.innerHTML = `
        <button type="button" class="tm-video-btn tm-speed-btn" title="คลิกสลับความเร็ว" aria-label="ความเร็ววิดีโอ">1.0x</button>
        <button type="button" class="tm-video-btn tm-pip-btn" title="Picture-in-Picture" aria-label="Picture-in-Picture">
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

  /* ─── 9. SMART CONFIGURABLE TIMESTAMP ────────────────────── */
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

  /* ─── 10. THREAD UNROLLER & CLEAN READER (Phase 2) ────────── */
  const TM_Unroller = {
    open: (author, postId) => {
      // HONEST CAPTURE: contiguous same-author run containing the clicked post + x/y captured-total
      // display (misses become visible instead of silent — P1 parity with src/features/unroller.ts).
      const metas = TM_DOM.findShareButtons().map(s => TM_DOM.getPostMetadata(TM_DOM.findPostCard(s.actionRow)));
      const idxs = [];
      metas.forEach((m, i) => {
        if (m.author.toLowerCase() === author.toLowerCase() && m.text.length > 0) idxs.push(i);
      });
      let a = idxs.indexOf(metas.findIndex(m => m.postId === postId));
      if (a === -1) a = 0;
      let lo = a, hi = a;
      while (lo > 0 && idxs[lo - 1] === idxs[lo] - 1) lo--;
      while (hi < idxs.length - 1 && idxs[hi + 1] === idxs[hi] + 1) hi++;

      const opPosts = [];
      for (const i of idxs.slice(lo, hi + 1)) {
        const m = metas[i];
        if (!opPosts.some(p => p.text === m.text)) opPosts.push(m);
      }

      if (opPosts.length === 0) return showToast('⚠️ ไม่พบบทสนทนาต่อเนื่องของเจ้าของโพสต์');

      let seriesTotal = 0;
      for (const p of opPosts) {
        const mm = p.text.match(/\((\d+)\s*\/\s*(\d+)\)/);
        if (mm) seriesTotal = Math.max(seriesTotal, parseInt(mm[2], 10) || 0);
      }

      let modal = document.getElementById('tm-reader-modal');
      if (modal) modal.remove();

      modal = document.createElement('div');
      modal.id = 'tm-reader-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-label', 'Thread Unroller');
      const readerOpener = document.activeElement;
      modal.innerHTML = `
        <div class="tm-reader-overlay"></div>
        <div class="tm-reader-card">
          <div class="tm-reader-header">
            <div>
              <div class="tm-reader-title">📖 Thread Unroller</div>
              <div class="tm-reader-author">@${author} • จับได้ ${opPosts.length}${seriesTotal ? `/${seriesTotal}` : ''} โพสต์</div>
            </div>
            <div class="tm-reader-header-actions">
              <button type="button" class="tm-btn-primary" id="tm-copy-md">📥 คัดลอก Markdown</button>
              <button type="button" class="tm-btn-sub" id="tm-close-reader">✕ ปิด</button>
            </div>
          </div>
          <div class="tm-reader-body">
            ${seriesTotal > 0 && opPosts.length < seriesTotal ? `<div class="tm-segment-media-hint">⚠️ เก็บได้ ${opPosts.length}/${seriesTotal} — โพสต์ที่เหลือไม่อยู่ในหน้าปัจจุบัน ลองเลื่อนมาที่เธรดนี้แล้วเปิดใหม่</div>` : ''}
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
      modal.querySelector('#tm-close-reader')?.focus();

      const close = () => { releaseFocus(); modal.remove(); readerOpener?.focus?.(); };
      const releaseFocus = tmFocusTrap(modal, close);
      modal.querySelector('#tm-copy-md').onclick = () => {
        const md = `# Thread by @${author}\\n\\nURL: https://www.threads.com/@${author}/post/${postId}\\n\\n---\\n\\n` +
          opPosts.map((p, i) => `### [${i + 1}/${opPosts.length}]\\n\\n${p.text}\\n`).join('\\n---\\n\\n');
        navigator.clipboard.writeText(md).then(() => showToast('✓ คัดลอก Markdown ทั้งเธรดแล้ว'));
      };

      modal.querySelector('#tm-close-reader').onclick = close;
      modal.querySelector('.tm-reader-overlay').onclick = close;
    }
  };

  /* ─── 11. COMPOSER HOOK GUIDE & AUTO-SPLITTER (Phase 2) ───── */
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
        // Threads counts codepoints, not UTF-16 units. A 250-emoji post is 250
        // characters to the server but 500 to String.length, which would warn
        // "over 500" on a message that is actually half empty.
        // ponytail: [...str].length handles astral chars; grapheme clusters
        // (ZWJ emoji, flags) still overcount. Upgrade: Intl.Segmenter when the
        // counter needs to match Threads exactly.
        const len = [...textbox.innerText.trim()].length;
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

  /* ─── 12. ONE-CLICK THREAD SPLITTER (Phase 2.3) ────────────── */
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
            // A run with no sentence break (Thai without spaces, pasted URLs,
            // a wall of hashtags) used to come back as one oversized chunk that
            // Threads rejects outright, so the feature did nothing. Fall back to
            // word, then hard slice.
            const sentences = p.split(/(?<=[.!?\n])\s+/);
            for (const s of sentences) {
              if (s.length > maxLen) {
                if (current) { chunks.push(current); current = ''; }
                for (const word of s.split(/\s+/)) {
                  if (word.length > maxLen) {
                    for (let i = 0; i < word.length; i += maxLen) chunks.push(word.slice(i, i + maxLen));
                  } else if ((current + (current ? ' ' : '') + word).length <= maxLen) {
                    current = current + (current ? ' ' : '') + word;
                  } else { if (current) chunks.push(current); current = word; }
                }
                continue;
              }
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
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-label', 'Thread Splitter');
      const splitOpener = document.activeElement;
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

      modal.querySelector('#tm-close-split').onclick = closeSplit;
      modal.querySelector('.tm-reader-overlay').onclick = closeSplit;
      let releaseSplitFocus = tmFocusTrap(modal, closeSplit);
      modal.querySelector('#tm-close-split')?.focus();

      function closeSplit() { releaseSplitFocus(); modal.remove(); splitOpener?.focus?.(); }
    }
  };

  /* ─── 13. COMPACT ANTI-SLOP STYLES ────────────────────────── */
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
      #tm-toast { position: fixed !important; bottom: 36px !important; left: 50% !important; transform: translateX(-50%) translateY(20px) !important; background: #181818 !important; color: #f0f0f0 !important; border: 1px solid #333 !important; padding: 8px 18px !important; border-radius: 20px !important; font-size: 13px !important; font-weight: 500 !important; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.7) !important; opacity: 0 !important; pointer-events: none !important; transition: all 200ms ease !important; z-index: 9999999 !important; }
      #tm-toast.tm-toast-visible { opacity: 1 !important; transform: translateX(-50%) translateY(0) !important; }
      .tm-btn:focus-visible, .tm-btn-primary:focus-visible, .tm-btn-sub:focus-visible, .tm-btn-cancel:focus-visible, .tm-dropdown-item:focus-visible, .tm-checkbox-pill:focus-visible, .tm-video-btn:focus-visible, .tm-split-btn:focus-visible { outline: 2px solid var(--tm-accent) !important; outline-offset: 2px !important; }
      .tm-video-controls:focus-within { opacity: 1 !important; }
      @media (max-width: 768px) {
        #tm-toast { bottom: calc(36px + env(safe-area-inset-bottom)) !important; }
      }
      @media (pointer: coarse) {
        .tm-btn { min-width: 44px !important; min-height: 44px !important; }
        .tm-dropdown-item { padding: 14px 16px !important; }
        .tm-checkbox-pill { width: 32px !important; height: 32px !important; }
        .tm-video-controls { opacity: 1 !important; }
        .tm-video-btn { min-height: 36px !important; padding: 8px 12px !important; }
        .tm-btn-primary, .tm-btn-sub, .tm-btn-cancel { min-height: 44px !important; padding: 12px 16px !important; }
      }
    `;
    document.head.appendChild(style);
  }

  /* ─── 14. MUTATION OBSERVER & SINGLE-PASS SCANNER ──────────── */
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
  // A silent no-op is the worst failure mode here: the buttons simply never appear and the
  // user has no idea why. Warn once per session, then stay quiet so it cannot nag on scroll.
  let selectorMissWarned = false;
  function warnIfSelectorMissed(found) {
    if (found > 0 || selectorMissWarned) return;
    selectorMissWarned = true;
    console.warn('[ThreadMax] No post action row found. If the buttons never appear, the Threads DOM has changed and the selector needs updating.');
    showToast('⚠️ ThreadMax: หาแถวปุ่มโพสต์ไม่พบ (เว็บอาจเปลี่ยนโครงสร้าง)');
  }

  function scheduleScan() {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      const actionRows = TM_DOM.findShareButtons();
      warnIfSelectorMissed(actionRows.length);
      actionRows.forEach(TM_Buttons.injectIntoActionRow);
      TM_Video.init();
      TM_Timestamp.updateAll();
      TM_Composer.init();
    }, 250);
  }

  function initMutationWatcher() {
    const watcher = new MutationWatcher({
      debounceMs: 250,
      maxBatchSize: 50,
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
