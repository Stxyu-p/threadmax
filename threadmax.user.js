// ==UserScript==
// @name         ThreadMax
// @namespace    https://github.com/Stxyu-p/threadmax
// @version      1.0.0
// @description  Precision Media Downloader, Video Booster, Clean Link & Smart Timestamps for Threads Web
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
 * ThreadMax v1.0.0 — Pure Vanilla JavaScript, Zero External Dependencies
 * Architecture: Clean Modular / Anti-Slop Minimal Precision
 *
 * ponytail: deliberate simplifications:
 * - Single-file architecture without bundlers: straightforward debugging in Tampermonkey editor.
 * - Stored ZIP (compression level 0): instant client-side packing without memory-heavy deflate.
 * - Polling MutationObserver with 250ms debounce: avoids layout thrashing on infinite scroll.
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
      lfhView.setUint16(6, 0x0800, true); // UTF-8 filename flag
      lfhView.setUint16(8, 0, true);      // Stored (no compression)
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
      return url.split('?')[0];
    }
  }

  /* ─── 4. DOM EXTRACTION (POST, MEDIA, ACTIONS) ────────────── */
  const TM_DOM = {
    findPosts: () => {
      const candidates = Array.from(document.querySelectorAll('div[data-pressable-container="true"], article'));
      return candidates.filter(card => {
        if (card.offsetHeight < 60) return false;
        // Avoid nested pressable containers
        let p = card.parentElement;
        while (p && p !== document.body) {
          if (p.getAttribute?.('data-pressable-container') === 'true') return false;
          p = p.parentElement;
        }
        return true;
      });
    },

    getPostMetadata: (card) => {
      // 1. Author
      const authorEl = card.querySelector('a[href*="/@"]');
      let author = 'threads_user';
      if (authorEl) {
        const href = authorEl.getAttribute('href') || '';
        const match = href.match(/@([^/?#]+)/);
        if (match) author = match[1];
        else author = authorEl.innerText.trim().replace(/^@/, '').split('\n')[0] || author;
      }

      // 2. Post ID & Clean URL
      const linkEl = card.querySelector('a[href*="/post/"]');
      let postId = Date.now().toString(36);
      let postUrl = window.location.href;
      if (linkEl && linkEl.href) {
        postUrl = cleanPostUrl(linkEl.href);
        const match = postUrl.match(/\/post\/([^/?#]+)/);
        if (match) postId = match[1];
      }

      // 3. Media Items (Images & Videos)
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

      // Images (Exclude profile pictures & small icons)
      card.querySelectorAll('img').forEach(img => {
        const src = img.src;
        if (!src || seenUrls.has(src)) return;

        // Skip avatar links
        const parentLink = img.closest('a');
        if (parentLink) {
          const href = parentLink.getAttribute('href') || '';
          if (href.includes('/@') && !href.includes('/post/')) return;
        }

        // Check size & circular styling (avatars are round)
        const rect = img.getBoundingClientRect();
        if (rect.width > 0 && rect.width < 75) return;
        const style = window.getComputedStyle(img);
        if (style.borderRadius.includes('50%')) return;

        // Verify CDN origin
        if (src.includes('cdninstagram.com') || src.includes('fbcdn.net')) {
          seenUrls.add(src);
          media.push({ type: 'image', url: src, element: img });
        }
      });

      // 4. Action Row (Like, Comment, Repost, Share)
      const shareSvg = card.querySelector('svg[aria-label*="Share" i], svg[aria-label*="แชร์"], svg[aria-label*="分享"], svg[aria-label*="Bagikan" i]');
      let actionRow = null;
      let shareButton = null;

      if (shareSvg) {
        shareButton = shareSvg.closest('button') || shareSvg.closest('div[role="button"]');
        if (shareButton) {
          actionRow = shareButton.parentElement;
        }
      }

      return {
        card,
        author,
        postId,
        postUrl,
        media,
        actionRow,
        shareButton
      };
    }
  };

  /* ─── 5. IN-FEED BUTTON & DROPDOWN ────────────────────────── */
  const TM_Buttons = {
    inject: (postData) => {
      const { card, author, postId, postUrl, media, shareButton, actionRow } = postData;
      if (!shareButton || !actionRow) return;
      if (actionRow.querySelector('.tm-download-btn')) return;

      // 1. Download Button (Only for posts with media)
      if (media.length > 0) {
        const dlBtn = document.createElement('div');
        dlBtn.className = 'tm-download-btn tm-btn';
        dlBtn.setAttribute('role', 'button');
        dlBtn.setAttribute('tabindex', '0');
        dlBtn.setAttribute('title', media.length > 1 ? `ThreadMax: ดาวน์โหลดสื่อ (${media.length} รายการ)` : 'ThreadMax: ดาวน์โหลดสื่อ');
        dlBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
        `;

        dlBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();

          if (media.length === 1) {
            // Single media post -> Instant download
            TM_Downloader.downloadSingle(media[0], author, postId, 1, dlBtn);
          } else {
            // Carousel -> Dropdown menu
            TM_Buttons.showCarouselDropdown(dlBtn, postData);
          }
        });

        shareButton.parentNode.insertBefore(dlBtn, shareButton.nextSibling);
      }

      // 2. Clean Link Button
      if (!actionRow.querySelector('.tm-cleanlink-btn')) {
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

        const targetAnchor = actionRow.querySelector('.tm-download-btn') || shareButton;
        targetAnchor.parentNode.insertBefore(linkBtn, targetAnchor.nextSibling);
      }
    },

    showCarouselDropdown: (anchorBtn, postData) => {
      document.querySelectorAll('.tm-dropdown').forEach(d => d.remove());

      const mode = TM_Config.get(CONFIG_KEYS.DOWNLOAD_MODE, 'zip');
      const dropdown = document.createElement('div');
      dropdown.className = 'tm-dropdown';

      dropdown.innerHTML = `
        <div class="tm-dropdown-item" data-action="all">
          <span class="tm-dropdown-icon">📦</span>
          <span>ดาวน์โหลดทั้งหมด (${postData.media.length} ไฟล์ • ${mode.toUpperCase()})</span>
        </div>
        <div class="tm-dropdown-item" data-action="select">
          <span class="tm-dropdown-icon">☑️</span>
          <span>เลือกดาวน์โหลดเฉพาะไฟล์...</span>
        </div>
      `;

      dropdown.querySelector('[data-action="all"]').onclick = (e) => {
        e.stopPropagation();
        dropdown.remove();
        TM_Downloader.downloadBatch(postData.media, postData.author, postData.postId, anchorBtn, mode);
      };

      dropdown.querySelector('[data-action="select"]').onclick = (e) => {
        e.stopPropagation();
        dropdown.remove();
        TM_Selector.activate(postData, anchorBtn);
      };

      // Close on outside click
      const onDocClick = (evt) => {
        if (!dropdown.contains(evt.target) && evt.target !== anchorBtn) {
          dropdown.remove();
          document.removeEventListener('click', onDocClick);
        }
      };
      setTimeout(() => document.addEventListener('click', onDocClick), 50);

      anchorBtn.parentElement.appendChild(dropdown);
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
          .catch(err => {
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
          await new Promise(r => setTimeout(r, 220)); // Pacing to prevent browser choking
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

  /* ─── 7. INTERACTIVE SELECTION MODE ───────────────────────── */
  const TM_Selector = {
    activate: (postData, anchorBtn) => {
      const { card, media, author, postId } = postData;
      const selectedIndices = new Set(media.map((_, i) => i)); // default select all

      // Inject checkboxes
      media.forEach((item, index) => {
        const wrapper = item.element.parentElement;
        if (!wrapper || wrapper.querySelector('.tm-checkbox-pill')) return;

        wrapper.style.position = 'relative';
        const pill = document.createElement('div');
        pill.className = 'tm-checkbox-pill active';
        pill.dataset.index = index;
        pill.innerHTML = `
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
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

        wrapper.appendChild(pill);
      });

      // Floating Selection Action Bar
      let bar = card.querySelector('.tm-select-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'tm-select-bar';
        card.appendChild(bar);
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

  /* ─── 10. ANTI-SLOP STYLES (Solid Surface, Hairline) ──────── */
  function injectStyles() {
    if (document.getElementById('threadmax-styles')) return;
    const style = document.createElement('style');
    style.id = 'threadmax-styles';
    style.textContent = `
      /* Common Button Styles */
      .tm-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        color: #777777;
        cursor: pointer;
        transition: color 150ms ease, background-color 150ms ease;
        user-select: none;
        margin-left: 2px;
      }
      .tm-btn:hover {
        color: #f3f5f7;
        background-color: rgba(255, 255, 255, 0.08);
      }

      /* Dropdown Menu (Solid Surface + Hairline) */
      .tm-dropdown {
        position: absolute;
        top: 42px;
        left: 0;
        z-index: 10000;
        min-width: 220px;
        background-color: #141414;
        border: 1px solid #282828;
        border-radius: 10px;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.65);
        padding: 6px;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .tm-dropdown-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 9px 12px;
        border-radius: 6px;
        color: #e4e6eb;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: background-color 120ms ease;
      }
      .tm-dropdown-item:hover {
        background-color: #242424;
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
        color: #999999;
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

      /* Checkbox Pill on Media Items */
      .tm-checkbox-pill {
        position: absolute;
        top: 10px;
        left: 10px;
        width: 26px;
        height: 26px;
        border-radius: 50%;
        background-color: rgba(18, 18, 18, 0.75);
        border: 1.5px solid #444444;
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
        margin-top: 10px;
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
        z-index: 999999;
      }
      #tm-toast.tm-toast-visible {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    `;
    document.head.appendChild(style);
  }

  /* ─── 11. SCAN & MUTATION OBSERVER ────────────────────────── */
  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      const posts = TM_DOM.findPosts();
      posts.forEach(card => {
        const postData = TM_DOM.getPostMetadata(card);
        TM_Buttons.inject(postData);
      });
      TM_Video.init();
      TM_Timestamp.updateAll();
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
    console.info('[ThreadMax] v1.0.0 initialized successfully');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
