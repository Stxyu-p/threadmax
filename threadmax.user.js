// ==UserScript==
// @name         ThreadMax
// @namespace    https://github.com/Stxyu-p/threadmax
// @version      1.1.0
// @description  Precision Media Downloader, Video Booster, Clean Link, Smart Timestamps & Thread Unroller for Threads Web
// @author       P Choke & MIKA
// @match        https://www.threads.com/*
// @match        https://threads.com/*
// @match        https://www.threads.net/*
// @match        https://threads.net/*
// @grant        GM_download
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

/**
 * ThreadMax v1.1.0 — Pure Vanilla JavaScript, Zero External Dependencies
 * Architecture: Clean Modular / Anti-Slop Minimal Precision
 *
 * ponytail: deliberate simplifications:
 * - Direct SVG path matching (M7.247 1.499) for Share button: 100% language-independent.
 * - Non-destructive Media Tile overlay: attaches checkboxes to parent DIV without touching <picture> tags.
 * - Fixed-position floating dropdown tethered via getBoundingClientRect(): zero container clipping.
 * - Stored ZIP (compression level 0): instant client-side packing without memory-heavy deflate.
 */

(function () {
  'use strict';

  /* ─── 1. CONFIGURATION & STORAGE ─────────────────────────── */
  const CONFIG_KEYS = {
    DOWNLOAD_MODE: 'tm_download_mode',     // 'zip' | 'individual'
    TIMESTAMP_MODE: 'tm_timestamp_mode',   // 'hybrid' | 'absolute' | 'native'
    VIDEO_VOLUME: 'tm_video_volume',       // 0.0 - 1.0
    VIDEO_SPEED: 'tm_video_speed'          // 1.0, 1.25, 1.5, 2.0
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

  /* ─── 2. PURE CLIENT-SIDE ZIP32 ENGINE (Zero Dependencies) ── */
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

  /* ─── 3. UTILITIES & HELPERS ──────────────────────────────── */
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

  /* ─── 4. DOM EXTRACTION (POST, MEDIA, ACTIONS) ────────────── */
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

      // Videos
      card.querySelectorAll('video').forEach(video => {
        const src = video.currentSrc || video.src || video.querySelector('source')?.src;
        if (src && !seenUrls.has(src)) {
          seenUrls.add(src);
          media.push({ type: 'video', url: src, element: video });
        }
      });

      // Images (Exclude profile avatars: size check, -19/ cdn pattern, avatar links)
      card.querySelectorAll('img').forEach(img => {
        const src = img.src;
        if (!src || seenUrls.has(src)) return;

        // Skip avatar links
        const parentLink = img.closest('a');
        if (parentLink) {
          const href = parentLink.getAttribute('href') || '';
          if (href.includes('/@') && !href.includes('/post/')) return;
        }

        // Avatar check
        if (src.includes('-19/')) return;
        const rect = img.getBoundingClientRect();
        if (rect.width > 0 && rect.width < 75) return;
        const style = window.getComputedStyle(img);
        if (style.borderRadius.includes('50%')) return;

        // Check CDN origin
        if (src.includes('cdninstagram.com') || src.includes('fbcdn.net')) {
          seenUrls.add(src);
          media.push({ type: 'image', url: src, element: img });
        }
      });

      // 3. Post Text Content
      const textContainer = card.querySelector('div[dir="auto"], span[dir="auto"]');
      const text = textContainer ? textContainer.innerText.trim() : '';

      return {
        card,
        author,
        postId,
        postUrl,
        media,
        text
      };
    }
  };

  /* ─── 5. IN-FEED BUTTON & DROPDOWN ────────────────────────── */
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
        dlWrapper.className = shareWrapper.className || 'tm-wrapper';

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
            TM_Buttons.showCarouselDropdown(dlBtn, postData);
          }
        });

        dlWrapper.appendChild(dlBtn);
        actionRow.insertBefore(dlWrapper, shareWrapper.nextSibling);
      }

      // 2. Clean Link Button
      const linkWrapper = document.createElement('div');
      linkWrapper.className = shareWrapper.className || 'tm-wrapper';

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
        unrollWrapper.className = shareWrapper.className || 'tm-wrapper';
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

    showCarouselDropdown: (anchorBtn, postData) => {
      document.querySelectorAll('.tm-dropdown').forEach(d => d.remove());

      const mode = TM_Config.get(CONFIG_KEYS.DOWNLOAD_MODE, 'zip');
      const dropdown = document.createElement('div');
      dropdown.className = 'tm-dropdown';

      const allItem = document.createElement('div');
      allItem.className = 'tm-dropdown-item';
      allItem.innerHTML = `<span class="tm-dropdown-icon">📦</span><span>ดาวน์โหลดทั้งหมด (${postData.media.length} ไฟล์ • ${mode.toUpperCase()})</span>`;

      const selectItem = document.createElement('div');
      selectItem.className = 'tm-dropdown-item';
      selectItem.innerHTML = `<span class="tm-dropdown-icon">☑️</span><span>เลือกดาวน์โหลดเฉพาะไฟล์...</span>`;

      allItem.onclick = (e) => {
        e.stopPropagation();
        dropdown.remove();
        TM_Downloader.downloadBatch(postData.media, postData.author, postData.postId, anchorBtn, mode);
      };

      selectItem.onclick = (e) => {
        e.stopPropagation();
        dropdown.remove();
        TM_Selector.activate(postData, anchorBtn);
      };

      dropdown.appendChild(allItem);
      dropdown.appendChild(selectItem);

      // Fixed positioning tethered to anchor button (Zero container clipping)
      const rect = anchorBtn.getBoundingClientRect();
      dropdown.style.position = 'fixed';
      dropdown.style.top = `${rect.bottom + 8}px`;

      const dropdownWidth = 240;
      let left = rect.left + (rect.width / 2) - (dropdownWidth / 2);
      if (left + dropdownWidth > window.innerWidth - 12) {
        left = window.innerWidth - dropdownWidth - 12;
      }
      if (left < 12) left = 12;
      dropdown.style.left = `${left}px`;

      document.body.appendChild(dropdown);

      // Close on outside click
      const onDocClick = (evt) => {
        if (!dropdown.contains(evt.target) && evt.target !== anchorBtn) {
          dropdown.remove();
          document.removeEventListener('click', onDocClick);
        }
      };
      setTimeout(() => document.addEventListener('click', onDocClick), 50);
    }
  };

  /* ─── 6. BATCH DOWNLOADER & PROGRESS ──────────────────────── */
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

  /* ─── 7. INTERACTIVE SELECTION MODE (Non-Destructive) ──────── */
  const TM_Selector = {
    activate: (postData, anchorBtn) => {
      const { card, media, author, postId } = postData;
      const selectedIndices = new Set(media.map((_, i) => i));

      // Inject checkboxes on valid parent DIV tiles (NEVER inside <picture>)
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

      // Selection bar placed above action row (Clean native look)
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

  /* ─── 8. VIDEO PLAYER BOOSTER ─────────────────────────────── */
  const TM_Video = {
    speeds: [1.0, 1.25, 1.5, 2.0],

    init: () => {
      const videos = document.querySelectorAll('video');
      videos.forEach(video => TM_Video.enhance(video));
    },

    enhance: (video) => {
      if (video.dataset.tmBoosted) return;
      video.dataset.tmBoosted = 'true';

      // 1. Volume Memory
      const savedVolume = TM_Config.get(CONFIG_KEYS.VIDEO_VOLUME, 0.8);
      video.volume = Math.max(0, Math.min(1, savedVolume));

      video.addEventListener('volumechange', () => {
        if (!video.muted) {
          TM_Config.set(CONFIG_KEYS.VIDEO_VOLUME, video.volume);
        }
      });

      // 2. Wrap and inject overlay controller
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

      // Speed button handler
      const speedBtn = ctrl.querySelector('.tm-speed-btn');
      speedBtn.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        currentSpeedIdx = (currentSpeedIdx + 1) % TM_Video.speeds.length;
        const newSpeed = TM_Video.speeds[currentSpeedIdx];
        video.playbackRate = newSpeed;
        speedBtn.textContent = `${newSpeed}x`;
      };

      // PiP button handler
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

  /* ─── 9. SMART CONFIGURABLE TIMESTAMP ─────────────────────── */
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

  /* ─── 10. THREAD UNROLLER & CLEAN READER (Phase 2) ────────── */
  const TM_Unroller = {
    open: (author, postId) => {
      // Gather all posts by the same author in view
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

      // Build Reader Modal
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

      // Markdown Export
      modal.querySelector('#tm-copy-md').onclick = () => {
        const mdText = `# Thread by @${author}\\n\\nURL: https://www.threads.com/@${author}/post/${postId}\\n\\n---\\n\\n` +
          opPosts.map((p, i) => `### [${i + 1}/${opPosts.length}]\\n\\n${p.text}\\n`).join('\\n---\\n\\n');
        navigator.clipboard.writeText(mdText).then(() => {
          showToast('✓ คัดลอก Markdown ทั้งเธรดแล้ว');
        });
      };

      // Close handlers
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

  function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(text).replace(/[&<>"']/g, m => map[m]);
  }

  /* ─── 11. COMPOSER HOOK GUIDE & AUTO-SPLITTER (Phase 2) ───── */
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
        <span class="tm-hook-status"></span>
        <span class="tm-char-count">0 / 500</span>
      `;
      parent.appendChild(bar);

      const countEl = bar.querySelector('.tm-char-count');
      const hookEl = bar.querySelector('.tm-hook-status');

      const update = () => {
        const len = textbox.innerText.trim().length;
        countEl.textContent = `${len} / 500`;

        if (len === 0) {
          hookEl.textContent = '';
          hookEl.className = 'tm-hook-status';
        } else if (len <= 180) {
          hookEl.textContent = '✨ Hook ปลอดภัย (ไม่ถูกซ่อนบนจอมือถือ)';
          hookEl.className = 'tm-hook-status tm-hook-safe';
        } else if (len <= 500) {
          hookEl.textContent = '📍 เกิน 180 อักษร (จะถูกซ่อนหลัง "...ดูเพิ่มเติม")';
          hookEl.className = 'tm-hook-status tm-hook-cut';
        } else {
          hookEl.textContent = '⚠️ ข้อความยาวเกิน 500 อักษร';
          hookEl.className = 'tm-hook-status tm-hook-over';
        }
      };

      textbox.addEventListener('input', update);
      textbox.addEventListener('keyup', update);
      update();
    }
  };

  /* ─── 12. ANTI-SLOP STYLES (Solid Surface, Hairline) ──────── */
  function injectStyles() {
    if (document.getElementById('threadmax-styles')) return;
    const style = document.createElement('style');
    style.id = 'threadmax-styles';
    style.textContent = `
      /* Common Button Styles — Matching Native Threads Icons */
      .tm-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        color: rgba(243, 245, 247, 0.85);
        cursor: pointer;
        transition: color 150ms ease, background-color 150ms ease, transform 100ms ease;
        user-select: none;
      }
      .tm-btn:hover {
        color: #ffffff;
        background-color: rgba(255, 255, 255, 0.1);
      }
      .tm-btn:active {
        transform: scale(0.92);
      }

      /* Dropdown Menu (Fixed Positioning + Solid Surface) */
      .tm-dropdown {
        z-index: 100000;
        min-width: 240px;
        background-color: #161616;
        border: 1px solid #2e2e2e;
        border-radius: 10px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.75);
        padding: 6px;
        display: flex;
        flex-direction: column;
        gap: 2px;
        animation: tmFadeIn 120ms ease;
      }
      @keyframes tmFadeIn {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .tm-dropdown-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        border-radius: 6px;
        color: #f3f5f7;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: background-color 120ms ease;
      }
      .tm-dropdown-item:hover {
        background-color: #262626;
      }
      .tm-dropdown-icon {
        font-size: 15px;
      }

      /* Progress Bar */
      .tm-progress-bar {
        position: absolute;
        bottom: -22px;
        left: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
        z-index: 999;
      }
      .tm-progress-text {
        font-size: 11px;
        color: #aaaaaa;
        font-family: monospace;
      }
      .tm-progress-track {
        width: 80px;
        height: 2px;
        background-color: #2a2a2a;
        border-radius: 2px;
        overflow: hidden;
      }
      .tm-progress-fill {
        height: 100%;
        width: 0%;
        background-color: #0095f6;
        transition: width 150ms ease;
      }

      /* Checkbox Pill on Media Items (Safe absolute positioning) */
      .tm-checkbox-pill {
        position: absolute;
        top: 10px;
        right: 10px;
        width: 26px;
        height: 26px;
        border-radius: 50%;
        background-color: rgba(18, 18, 18, 0.75);
        border: 1.5px solid #555555;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 50;
        transition: all 150ms ease;
      }
      .tm-checkbox-pill svg {
        opacity: 0;
        transform: scale(0.6);
        transition: all 150ms ease;
      }
      .tm-checkbox-pill.active {
        background-color: #0095f6;
        border-color: #0095f6;
      }
      .tm-checkbox-pill.active svg {
        opacity: 1;
        transform: scale(1);
      }

      /* Selection Floating Bar */
      .tm-select-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin: 8px 0;
        padding: 10px 14px;
        background-color: #161616;
        border: 1px solid #2a2a2a;
        border-radius: 8px;
        font-size: 13px;
        color: #ffffff;
      }
      .tm-select-actions {
        display: flex;
        gap: 8px;
      }
      .tm-btn-primary {
        background-color: #0095f6;
        color: #ffffff;
        border: none;
        padding: 6px 14px;
        border-radius: 6px;
        font-weight: 600;
        font-size: 12px;
        cursor: pointer;
        transition: background-color 150ms ease;
      }
      .tm-btn-primary:hover { background-color: #1877f2; }
      .tm-btn-sub {
        background-color: #242424;
        color: #e0e0e0;
        border: 1px solid #333333;
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 12px;
        cursor: pointer;
        transition: background-color 150ms ease;
      }
      .tm-btn-sub:hover { background-color: #2e2e2e; }
      .tm-btn-cancel {
        background: transparent;
        color: #888888;
        border: none;
        padding: 6px 10px;
        font-size: 12px;
        cursor: pointer;
      }
      .tm-btn-cancel:hover { color: #cccccc; }

      /* Video Booster Controls */
      .tm-video-controls {
        position: absolute;
        top: 12px;
        right: 12px;
        display: flex;
        align-items: center;
        gap: 6px;
        z-index: 40;
        opacity: 0;
        transition: opacity 150ms ease;
      }
      div:hover > .tm-video-controls, .tm-video-controls:hover {
        opacity: 1;
      }
      .tm-video-btn {
        background-color: rgba(18, 18, 18, 0.85);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 6px;
        color: #ffffff;
        font-size: 11px;
        font-weight: 600;
        padding: 4px 8px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .tm-video-btn:hover {
        background-color: #000000;
        border-color: rgba(255, 255, 255, 0.35);
      }

      /* Thread Unroller Modal */
      #tm-reader-modal {
        position: fixed;
        inset: 0;
        z-index: 1000000;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: tmFadeIn 150ms ease;
      }
      .tm-reader-overlay {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.82);
      }
      .tm-reader-card {
        position: relative;
        width: 90%;
        max-width: 680px;
        max-height: 85vh;
        background: #141414;
        border: 1px solid #2a2a2a;
        border-radius: 12px;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.9);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .tm-reader-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        border-bottom: 1px solid #242424;
      }
      .tm-reader-title {
        font-size: 16px;
        font-weight: 700;
        color: #ffffff;
      }
      .tm-reader-author {
        font-size: 12px;
        color: #888888;
        margin-top: 2px;
      }
      .tm-reader-header-actions {
        display: flex;
        gap: 8px;
      }
      .tm-reader-body {
        padding: 20px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .tm-reader-segment {
        padding: 14px;
        background: #1a1a1a;
        border: 1px solid #282828;
        border-radius: 8px;
        position: relative;
      }
      .tm-segment-badge {
        display: inline-block;
        font-size: 11px;
        font-weight: 700;
        color: #0095f6;
        margin-bottom: 6px;
      }
      .tm-segment-text {
        font-size: 14px;
        line-height: 1.6;
        color: #e4e6eb;
      }
      .tm-segment-media-hint {
        margin-top: 8px;
        font-size: 11px;
        color: #777777;
      }

      /* Composer Bar */
      .tm-composer-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 12px;
        font-size: 11px;
        color: #888888;
        border-top: 1px solid #242424;
      }
      .tm-hook-status { font-weight: 500; }
      .tm-hook-safe { color: #10b981; }
      .tm-hook-cut { color: #f59e0b; }
      .tm-hook-over { color: #ef4444; }

      /* Clean Toast */
      #tm-toast {
        position: fixed;
        bottom: 36px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background-color: #181818;
        color: #f0f0f0;
        border: 1px solid #333333;
        padding: 8px 18px;
        border-radius: 20px;
        font-size: 13px;
        font-weight: 500;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.7);
        opacity: 0;
        pointer-events: none;
        transition: transform 200ms ease, opacity 200ms ease;
        z-index: 9999999;
      }
      #tm-toast.tm-toast-visible {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    `;
    document.head.appendChild(style);
  }

  /* ─── 13. SCAN & MUTATION OBSERVER ────────────────────────── */
  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      const shareItems = TM_DOM.findShareButtons();
      shareItems.forEach(shareInfo => {
        TM_Buttons.injectIntoActionRow(shareInfo);
      });
      TM_Video.init();
      TM_Timestamp.updateAll();
      TM_Composer.init();
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
    console.info('[ThreadMax] v1.1.0 initialized successfully');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
