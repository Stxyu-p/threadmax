# ThreadMax ⚡

**Precision Media Downloader, Video Booster, Clean Link, Smart Timestamps, Thread Unroller & Growth Intelligence for Threads Web.**

A high-performance, zero-dependency Tampermonkey userscript engineered to eliminate web friction, unlock 1-click high-res media extraction, boost reading velocity, and provide engagement growth intelligence on `threads.com` and `threads.net`.

---

## 🚀 Key Capabilities

| Feature | Category | Description |
| :--- | :--- | :--- |
| **Carousel & Bulk Downloader** | Media Engine | 1-Click download for single media; interactive carousel selector; zero-dep client-side **ZIP32 packing** with pre-computed CRC32 tables. |
| **Video Player Booster** | Media Engine | Overlay video controller with cycling playback speed (**1.0x → 1.25x → 1.5x → 2.0x**), **Picture-in-Picture (PiP)**, and automatic **volume memory**. |
| **Clean Link Sanitizer** | Utility | Strips Meta tracking parameters (`?xmt=`, `?s=`, etc.) for clean, shareable post URLs. |
| **Smart Timestamps** | Reading | Configurable timestamp modes: **Hybrid** (`2h (14:30)`), **Absolute** (`20/09/2026 14:30`), or **Native**. |
| **Thread Unroller** | Reading | Concentrates all author replies in long threads into a unified Clean Reader modal with **1-Click Markdown Export**. |
| **Composer Hook Guide** | Creator Tool | Real-time viewport cutoff detection warning creators when text exceeds the 180-character mobile fold. |
| **One-Click Thread Splitter** | Creator Tool | Automatically chunks long texts (>500 chars) into numbered `1/N` thread segments preserving sentence and paragraph integrity. |
| **Viral Velocity Radar** | Growth Radar | Detects rapidly rising posts ($(\text{Replies}\times 2 + \text{Reposts}\times 1.5)/\text{Age}$) and injects subtle `⚡ Rising` badges for early engagement. |
| **Mutual Relationship Auditor** | Studio | Local IndexedDB snapshot diffing to audit mutual followers, non-followers back, fans, and lost/gained connections with safe pacing. |

---

## 🛠️ Architecture & Invariants

- **100% Client-Side & Zero Telemetry:** Operates strictly within the user's browser session. No data is ever transmitted to external servers.
- **Zero External Dependencies:** Built entirely in pure vanilla JavaScript without bulky libraries (no external JSZip, jQuery, or bloated frameworks).
- **Anti-Slop Clean Precision UI:** Dark OLED palette (`#141414`, `#1e1e1e`), hairline precision borders (`#282828`), and native layout integration (`yDiff = 0px`).
- **Resilient Stacking Protection:** Dynamically manages CSS stacking contexts (`z-index: 9999`) to prevent sunken popups or layout overlaps across virtualized feeds.

---

## 📦 Installation

1. Install a userscript manager (e.g. [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/)).
2. Install **ThreadMax**:
   - **Local / Direct:** Copy the contents of [`threadmax.user.js`](./threadmax.user.js) into your userscript manager.
   - **Target Domains:** Automatically matches `https://www.threads.com/*` and `https://www.threads.net/*`.

---

## ⚙️ Configuration

Open **ThreadMax Studio** by clicking the discrete `⚡ ThreadMax Studio` button at the bottom-left corner of the page or via the Tampermonkey extension menu:

- **Download Mode:** Choose between Stored ZIP (`.zip`) or sequential Individual downloads.
- **Timestamp Mode:** Toggle between `Hybrid` (recommended), `Absolute`, and `Native`.
- **Viral Velocity Radar:** Toggle live rising badges and sensitivity thresholds.

---

## 📄 License

MIT License © 2026 P Choke & MIKA.

---

## 🌟 Featured Engineering Projects

A curated collection of local-first, zero-telemetry, and performance-critical systems built by [@Stxyu-p](https://github.com/Stxyu-p):

| Project | Platform / Target | Architecture & Core Highlights | Links & Distribution |
| :--- | :--- | :--- | :--- |
| **🐾 [NovelClaw](https://github.com/Stxyu-p/NovelClaw)** | Web Novels / AI Reader | Single-binary Go application (`novelclaw.exe`) with embedded zero-dependency web reader, 9Router/LLM translation pipeline, persistent glossary & context memory, and SSE job streaming. | [![Go](https://img.shields.io/badge/Go-1.22+-00ADD8?style=flat-square&logo=go&logoColor=white)](https://github.com/Stxyu-p/NovelClaw) · [GitHub](https://github.com/Stxyu-p/NovelClaw) |
| **⚡ [IG MaxPland](https://github.com/Stxyu-p/ig-maxpland)** | Instagram Web | Clean Architecture (18 decoupled modules), stealth seen-telemetry interceptor (`fetch`/`XHR`/`sendBeacon`), zero-bounce clean feed engine, and safe dormant radar with randomized jitter pacing. | [![Greasy Fork](https://img.shields.io/badge/Greasy%20Fork-v3.0.0-red?style=flat-square&logo=greasyfork&logoColor=white)](https://greasyfork.org/th/scripts/595787-ig-maxpland) · [GitHub](https://github.com/Stxyu-p/ig-maxpland) |
| **⚡ [Telefilter Desktop](https://github.com/Stxyu-p/telefilter-desktop)** | Telegram WebK | Ultra-compact 34px inline toolbar, pure client-side ZIP32 multi-album packing engine, deep virtualized DOM harvester, and 100% client-side privacy vault. | [![Greasy Fork](https://img.shields.io/badge/Greasy%20Fork-v5.0.0-red?style=flat-square&logo=greasyfork&logoColor=white)](https://greasyfork.org/th/scripts/596222-telefilter-desktop-edition-v5) · [GitHub](https://github.com/Stxyu-p/telefilter-desktop) |
| **⚡ [ThreadMax](https://github.com/Stxyu-p/threadmax)** | Threads Web | 1-Click carousel & bulk media extraction with in-memory ZIP32 compiler, video speed booster & PiP, clean link tracking sanitizer, and clean reader thread unroller. | [![Tampermonkey](https://img.shields.io/badge/Tampermonkey-Userscript-00485B?style=flat-square&logo=tampermonkey&logoColor=white)](https://github.com/Stxyu-p/threadmax) · [GitHub](https://github.com/Stxyu-p/threadmax) |
| **🧠 [memcore](https://github.com/Stxyu-p/memcore)** | Multi-Agent Memory | Governed, local-first memory engine for multi-agent workflows — SQLite + WAL + FTS5, immutable versioning, tombstone guards, and journal-first admission. | [![GitHub](https://img.shields.io/badge/Release-v0.6.0-10b981?style=flat-square&logo=github&logoColor=white)](https://github.com/Stxyu-p/memcore) · [GitHub](https://github.com/Stxyu-p/memcore) |

<div align="center">
<sub>Crafted with engineering discipline · Local-First · Zero Telemetry · High Performance</sub>
</div>

