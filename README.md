<div align="center">

# ⚡ ThreadMax <sub>v1.4.0</sub>

**Precision Media Intelligence, Native Video Booster, Thread Unroller & Growth Suite for Threads Web**

*Anti-Slop Minimal Precision · Zero Dependencies · In-Memory ZIP32 · 100% Client-Side Privacy*  
*Engineered for [threads.net](https://www.threads.net/) & [threads.com](https://www.threads.com/)*

[![Version: v1.4.0](https://img.shields.io/badge/Version-v1.4.0-10b981?style=for-the-badge)](https://github.com/Stxyu-p/threadmax)
[![Platform: Threads Web](https://img.shields.io/badge/Platform-threads.net-black?style=for-the-badge&logo=threads&logoColor=white)](https://www.threads.net/)
[![License: MIT](https://img.shields.io/badge/License-MIT-f59e0b?style=for-the-badge)](LICENSE)

![Dependencies: Zero](https://img.shields.io/badge/Dependencies-Zero-success?style=flat-square)
![Engine: Vanilla JS](https://img.shields.io/badge/Engine-Pure%20ES2022-cyan?style=flat-square)
![Storage: IndexedDB](https://img.shields.io/badge/Storage-IndexedDB%20Vault-blue?style=flat-square)
![Safety: Safe Pacing](https://img.shields.io/badge/Safety-Anti--Detection%20Jitter-purple?style=flat-square)

</div>

---

## 📸 Interface Preview

<p align="center">
  <img src="shot_clean.png" alt="ThreadMax Clean UI & Video Controller" width="100%">
</p>

<p align="center">
  <img src="shot_v110.png" alt="ThreadMax Studio Drawer & Harvester" width="100%">
</p>

---

## ⚡ Core Pillars & Capabilities

| Capability | Module | What It Does | Technical Advantage |
| :--- | :---: | :--- | :--- |
| **In-Feed Action Trigger** | 📥 | Injects a discrete 5th action icon directly beside Like, Comment, Repost, and Share. | Zero layout shift; auto-detects media type and adjusts dropdown context. |
| **In-Memory ZIP32 Compiler** | 📦 | Compresses multi-slide carousels into a single `.zip` archive on the fly. | Zero external libraries (no JSZip); uses pre-computed CRC32 table for instant compression. |
| **Video Player Booster** | 🎬 | Floating overlay controller with cycle playback speed (**1.0x → 1.25x → 1.5x → 2.0x**), **PiP**, and volume memory. | Pure DOM binding to `HTMLVideoElement`; automatically persists volume to avoid audio shock. |
| **Clean Link Sanitizer** | 🔗 | 1-Click URL copy that strips Meta tracking junk (`?xmt=`, `?s=`, etc.). | Exports pristine canonical URLs `https://www.threads.net/@user/post/id`. |
| **Smart Timestamps** | ⏱️ | Formats relative timestamps into **Hybrid** (`2h (14:30)`), **Absolute**, or **Native**. | Parses `<time datetime="...">` ISO strings into localized machine time. |
| **Thread Unroller** | 📖 | Collects long author threads (1/N, 2/N) into a unified modal reader with **1-Click Markdown Export**. | Eliminates feed noise and provides clean copy for Obsidian and Notion. |
| **Composer Hook Guide** | ✍️ | Renders a subtle hairline marker inside the composer indicating the 180-char mobile cutoff. | Visual feedback ensures key hooks never get hidden behind `...more`. |
| **1-Click Thread Splitter** | ✂️ | Automatically chunks texts >500 characters into numbered `1/N` segments with sentence preservation. | Pre-fills reply boxes sequentially without manual copy-pasting. |
| **Viral Velocity Radar** | 🚀 | Detects rising discussions early with mathematical engagement scoring. | Identifies high-traction threads while comments are still low (<30). |
| **Relationship Auditor** | 👥 | Local IndexedDB snapshot diffing: Non-followers back, Fans, Mutuals, and Gained/Lost accounts. | 100% local IndexedDB storage with bounded batch scanning (3,000–5,000ms jitter). |

---

## 🔬 Under the Hood: Engineering Invariants

### 1. The Viral Velocity Algorithm

To discover viral posts early without waiting for platform algorithm feeds to saturate, ThreadMax computes real-time velocity metrics directly from client-side DOM telemetry:

$$\text{Velocity Score} = \frac{(\text{Replies} \times 2) + (\text{Reposts} \times 1.5)}{\text{Post Age (minutes)}}$$

When a post exceeds the sensitivity threshold with $\text{Replies} < 30$, ThreadMax attaches a discrete `⚡ Rising` indicator, enabling creators and analysts to contribute early high-value responses.

### 2. Meta Virtualized DOM & Stacking Context Breakout

Threads Web aggressively recycles DOM nodes and traps popups within constrained `overflow: hidden` bounding boxes. ThreadMax implements an **Out-of-Flow Stacking Portal**:
- Action dropdowns and modals escape parent CSS stacking contexts (`z-index: 9999`).
- Viewport bounds checking prevents clipping at the edges of the screen.
- Active listeners auto-dismiss on scroll or external pointer clicks.

### 3. Pure Client-Side ZIP32 Engine

Traditional browser downloaders rely on bulky multi-megabyte dependencies like JSZip. ThreadMax incorporates an ultra-lightweight ZIP32 packager:
- **Pre-computed 256-entry CRC32 table** generates checksums with bitwise speed.
- In-memory `Uint8Array` binary builder streams headers, file data, and central directory records directly to `Blob`.
- Memory footprint remains strictly bounded to active media asset size (<30MB RSS).

---

## 🚀 Installation & Setup

1. Install a userscript manager in your browser:
   - [Tampermonkey](https://www.tampermonkey.net/) (Recommended)
   - [Violentmonkey](https://violentmonkey.github.io/)
2. Install **ThreadMax**:
   - Install directly via GitHub Raw:  
     👉 **[Install threadmax.user.js](https://raw.githubusercontent.com/Stxyu-p/threadmax/main/threadmax.user.js)**
3. Navigate to [threads.net](https://www.threads.net/) or [threads.com](https://www.threads.com/). The discrete `⚡ ThreadMax Studio` trigger appears at the bottom-left corner of the screen.

---

## ⚙️ Configuration & Studio Drawer

Click `⚡ ThreadMax Studio` or use Tampermonkey menu to customize:

| Setting | Options | Default |
| :--- | :--- | :--- |
| **Download Mode** | Stored ZIP (`.zip`) / Individual Files | `Stored ZIP` |
| **Timestamp Mode** | `Hybrid` / `Absolute` / `Native` | `Hybrid` |
| **Video Speed** | `1.0x` / `1.25x` / `1.5x` / `2.0x` | `1.0x` |
| **Viral Radar** | Enabled / Disabled | `Enabled` |
| **Audit Batch Size** | Bounded 20 profiles / jitter 3.5s–6.0s | Enforced |

---

## 🧪 Verification & Test Suite

Run syntax check and local tests:

```powershell
# 1. Lexical and syntax validation
node --check threadmax.user.js

# 2. Automated test suite
node threadmax.test.cjs
```

---

## 📄 License

Distributed under the [MIT License](LICENSE).  
Copyright (c) 2026 P Choke & MIKA.

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
