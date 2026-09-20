# ThreadMax — Product Specification & Architecture Plan

> **Status:** Approved & Updated (2026-09-20)  
> **Platform:** threads.com / threads.net  
> **Type:** Tampermonkey Userscript (Pure Vanilla JavaScript)  
> **Architecture:** Clean Modular / Single-File Build Pipeline  
> **Design Philosophy:** Anti-slop / Clean Minimal Precision (Solid Neutral Surfaces, Hairline Borders, Native Integration)  
> **Author:** P Choke & MIKA  

---

## 1. Executive Summary & Core Philosophy

**ThreadMax** คือ Tampermonkey Userscript ประสิทธิภาพสูงสำหรับ Threads Web (`threads.com` และ `threads.net`) พัฒนาขึ้นเพื่อแก้ปัญหาและปิดจุดบกพร่องของหน้าเว็บ Threads โดยเฉพาะ ด้วยการรวม 3 เสาหลัก:
1. **Precision Media & Playback Engine:** ดาวน์โหลดมีเดียคมชัดสูงทั้ง Carousel/Mixed Media และระบบควบคุมวิดีโอระดับ Native
2. **Reading & Composer Leverage:** ประสบการณ์การอ่านเธรดยาวอย่างลื่นไหล และเครื่องมือช่วยจัดโครงสร้างเนื้อหาเพื่อเพิ่มการเข้าถึง
3. **Growth & Relationship Intelligence:** เรดาร์วิเคราะห์โพสต์ไวรัลและตรวจจับสถานะความสัมพันธ์ของบัญชีอย่างปลอดภัย

### หลักการวิศวกรรม 5 ประการ (Engineering Invariants)
- 🛡️ **100% Client-Side & Zero-Telemetry:** ไม่ส่งข้อมูลออกนอกเครื่อง ไม่ใช้เซิร์ฟเวอร์ภายนอก ทำงานบนเบราว์เซอร์ของผู้ใช้ทั้งหมด
- ⚡ **Zero External Dependencies:** ใช้ Pure Vanilla JavaScript 100% (ไม่มี JSZip, pako, jQuery หรือ framework หนัก) ตัวเอนจิน ZIP32 ใช้โค้ดเพียวตามแบบฉบับ Telefilter
- 🎯 **Painpoint-First (Native First):** ไม่สร้างฟีเจอร์ซ้ำซ้อนกับสิ่งที่แพลตฟอร์มทำได้ดีอยู่แล้ว เน้นแก้จุดขัดใจจริงในชีวิตประจำวัน
- ✨ **Anti-Slop Clean Precision UI:** พื้นผิว Solid Neutral (`#121212`, `#1e1e1e`), เส้นขอบ Hairline (`#2a2a2a`), ไม่มีแสงฟุ้งนีออนหรือ Glassmorphism เลอะเทอะ กลมกลืนเหมือนฟังก์ชันแท้ของ Threads
- 📊 **Real Numbers & Visible Progress:** ทุกการประมวลผลต้องแสดงตัวเลขจริง (จำนวนที่เสร็จ, ทั้งหมด, เวลาที่ผ่านไป) ห้ามค้างนิ่งแบบเงียบๆ
- ✂️ **Deliberate Simplification (`ponytail:` standard):** รหัสที่มีการละเว้นหรือลดทอนความซับซ้อนโดยตั้งใจ ต้องกำกับด้วยคอมเมนต์ `ponytail:` ระบุขอบเขตและแนวทางอัปเกรดในอนาคตเสมอ

---

## 2. Roadmap & Feature Specification

```
[Phase 1: Core Media & Playback] ───► [Phase 2: Reading & Composer] ───► [Phase 3: Growth Intelligence]
 • Carousel Bulk Download (ZIP/Ind)    • Thread Unroller (1/N Reader)     • Viral Velocity Radar
 • Video Player Booster (Speed/PiP)    • Composer Hook Visual Guide       • Relationship Radar (Diff)
 • Clean Link Copy                     • One-Click Thread Splitter        • ThreadMax Studio Drawer
 • Smart Configurable Timestamp
```

---

### Phase 1: Core Media & Playback Engine (Immediate Priority)

#### 1.1 In-Feed Download Button (ปุ่มที่ 5 ใน Action Bar)
- **ตำแหน่ง:** ฝังเป็นปุ่มที่ 5 ต่อจาก Like, Comment, Repost, Share ในแท็ก `div[role="button"]` ของแต่ละโพสต์
- **รูปลักษณ์:** ไอคอน SVG ลูกศรดาวน์โหลด สไตล์เดียวกับชุดไอคอนของ Threads ขนาด 20×20px
- **พฤติกรรม:**
  - แสดงเฉพาะโพสต์ที่มีมีเดีย (Image / Video / Carousel) ซ่อนอัตโนมัติในโพสต์ข้อความล้วน
  - **Single Media Post:** กดปุ่มแล้วดาวน์โหลดทันที 1-Click
  - **Carousel Post:** แสดง Dropdown เมนูย่อย: `[Download All]` และ `[Select Download]`

#### 1.2 Carousel Bulk Downloader (ZIP / Individual Mode)
- **Engine:** Pure client-side ZIP32 generator (Telefilter pattern) พร้อมตาราง CRC32 แบบ pre-computed รวมไฟล์ `.jpg` และ `.mp4` ลงใน ZIP เดียวได้ทันทีโดยไม่เปลือง memory
- **Mode Toggle:**
  - **ZIP Mode:** รวมทุกมีเดียในโพสต์เป็นไฟล์ ZIP ก้อนเดียว
  - **Individual Mode:** สตรีมดาวน์โหลดแยกทีละไฟล์ลงเครื่องตรงๆ
- **Inline Selection (Select Mode):**
  - แสดงปุ่ม Checkbox วงกลมแบบโปร่งใสที่มุมซ้ายบนของมีเดียแต่ละชิ้นในฟีดโดยตรง ไม่เปิด Popup บังจอ
  - เลือกเฉพาะรูปหรือวิดีโอที่ต้องการ แล้วกดยืนยันดาวน์โหลด

#### 1.3 Video Player Booster (Speed + PiP + Volume Memory)
- **ปัญหาเดิม:** วิดีโอ Threads บนเว็บไม่สามารถปรับความเร็วได้ ไม่มีปุ่ม Picture-in-Picture และเปิดมาเสียงดังลั่น
- **โซลูชัน:** ฝัง Mini Floating Controller ขนาดกะทัดรัดบนตัวเล่นวิดีโอ:
  - **Speed Toggle:** ปรับความเร็วเล่นวิดีโอวนลูป `1x` → `1.25x` → `1.5x` → `2x` ด้วย `video.playbackRate`
  - **Picture-in-Picture (PiP):** ปุ่มกดแยกหน้าต่างวิดีโอลอยดูมุมจอขณะไถฟีดต่อ ด้วย `video.requestPictureInPicture()`
  - **Volume Memory:** จดจำระดับเสียงล่าสุดที่ผู้ใช้ปรับไว้ใน `GM_setValue` และปรับให้คลิปถัดไปอัตโนมัติ ป้องกันเสียงตกใจ

#### 1.4 Clean Link Copy (ตัด Tracking Code)
- **ปัญหาเดิม:** การกดแชร์ของ Threads จะแถมพารามิเตอร์ติดตามขนาดยาว เช่น `?xmt=AQG...&s=...`
- **โซลูชัน:** ปุ่มหรือตัวเลือก Copy Link ที่ล้าง URL อัตโนมัติ เหลือเฉพาะรูปแบบสะอาด:
  `https://www.threads.com/@username/post/postId`

#### 1.5 Smart Configurable Timestamp
- **ปัญหาเดิม:** Threads แสดงเฉพาะเวลาแบบสัมพัทธ์ (เช่น "2h", "1d") ทำให้ตรวจสอบลำดับเวลาที่แน่นอนของประเด็นร้อนได้ยาก
- **โซลูชัน:** ดึงข้อมูล ISO Timestamp จากแท็ก `<time datetime="...">` เดิมของโพสต์ โดยมี Setting ให้ผู้ใช้เลือกได้ 3 โหมด:
  1. **Native:** แสดงเวลาตามเดิมของ Threads (เช่น `2 ชม.`)
  2. **Absolute:** แสดงวันและเวลาจริงตามเวลาเครื่อง (เช่น `20 ก.ย. 2026, 14:30`)
  3. **Hybrid (ค่าเริ่มต้นที่แนะนำ):** แสดงควบคู่กัน (เช่น `2 ชม. (14:30)`) เห็นทั้งความสดและเวลาที่ชัดเจน

#### 1.6 Naming Convention & Real-Time Progress
- **รูปแบบชื่อไฟล์:** `{username}_{postId}_{index}.{ext}` (เช่น `kyu.line_DdfP0AgEzDF_001.jpg`)
- **Progress Indicator:** แสดงใต้ปุ่มดาวน์โหลดขณะทำงานในฟอร์แมต `{current}/{total} ↓` พร้อมเส้น Progress Bar 2px เคลียร์ตัวเองเมื่อเสร็จสิ้น

---

### Phase 2: Reading & Composer Leverage (Content Experience)

#### 2.1 Thread Unroller & Clean Reader
- **ปัญหาเดิม:** บัญชีที่โพสต์เล่าเรื่อง/ให้ความรู้ขนาดยาว (1/N, 2/N) บนเว็บ Threads อ่านยากมาก เพราะมีคอมเมนต์คนอื่นแทรก หรือต้องคอยคลิกดูทีละสเต็ป
- **โซลูชัน:**
  - เพิ่มปุ่ม `Unroll Thread` ในหน้าโพสต์ที่มีการตอบตัวเองของเจ้าของโพสต์ (OP Replies)
  - ดึงเฉพาะเนื้อหาและมีเดียของ OP เรียงร้อยต่อกันเป็นบทความเดียวใน Modal สะอาดตา (Clean Reading View)
  - มีปุ่ม `Export to Markdown` พร้อมชื่อผู้เขียน ลิงก์ต้นทาง และเนื้อหาครบถ้วน สำหรับนำไปใช้อ้างอิงหรือบันทึกใน Obsidian/Notion

#### 2.2 Composer Hook Visual Guide
- **ปัญหาเดิม:** บนหน้าจอมือถือ Threads จะตัดข้อความและซ่อนหลังปุ่ม `...ดูเพิ่มเติม` ที่ประมาณบรรทัดที่ 3 (~180–200 ตัวอักษร) หากประโยค Hook เปิดหัวไม่ดึงดูด คนจะปัดผ่านทันที
- **โซลูชัน:**
  - เพิ่มเส้น Hairline นุ่มตาในกล่องข้อความตอนพิมพ์โพสต์ (Composer) แสดงจุดตัดสายตาของจอมือถือ
  - ช่วยให้ผู้ใช้ขัดเกลาประโยคเปิดหัวให้จบใจความสำคัญได้ก่อนตกขอบ

#### 2.3 One-Click Thread Splitter (ตัวตัดแบ่งเธรดอัตโนมัติ)
- **ปัญหาเดิม:** การพิมพ์เนื้อหายาวเกิน 500 ตัวอักษร ต้องคอยตัดแปะแบ่งท่อนลงในกล่องตอบตัวเองทีละช่องและไล่พิมพ์เลข `1/3`, `2/3` ด้วยตัวเอง
- **โซลูชัน:**
  - ในกล่อง Composer มีปุ่ม `Split to Thread`
  - วิเคราะห์จุดตัดตามประโยค/ย่อหน้า แบ่งเป็นท่อนย่อยไม่เกิน 500 ตัวอักษร พร้อมรันหมายเลข `1/N`, `2/N` และกรอกลงในกล่องตอบกลับของ Threads ให้โดยอัตโนมัติ

---

### Phase 3: Growth & Relationship Intelligence (MaxPland & Telefilter Patterns)

#### 3.1 Viral Velocity Radar (เรดาร์ตรวจจับโพสต์กำลังโต)
- **กลไกการวิเคราะห์:**
  $$\text{Velocity Score} = \frac{\text{Replies} \times 2 + \text{Reposts} \times 1.5}{\text{Post Age (minutes)}}$$
- **พฤติกรรม:**
  - ตรวจจับโพสต์ในฟีดที่มีอัตราเร่งสูง แต่ **ยอดรวมคอมเมนต์ยังไม่หนาแน่น (< 30-50 คอมเมนต์)**
  - ติดป้าย Minimal Badge เล็กๆ: `⚡ Rising (15 replies/hr)`
  - เพิ่มปุ่มสวิตช์ Filter เร็วแบบ Telefilter บนแท็บบนสุด: `[All] [🔥 Rising Radar]`
- **ประโยชน์ต่อการเติบโต:** ช่วยให้ผู้ใช้เข้าไปแลกเปลี่ยนความเห็นคุณภาพ (Early High-Value Reply) ได้ทันเวลา ทำให้อัลกอริทึมดันความเห็นของเราไปอยู่ด้านบน ดึงดูดผู้ติดตามใหม่เข้าโปรไฟล์ต่อเนื่อง

#### 3.2 Relationship Radar & Mutual Auditor (ถอดแบบระบบอัจฉริยะจาก IG MaxPland)
- **กลไกความปลอดภัย (Anti-Detection & Safe Pacing):**
  - ดึงข้อมูล Followers / Following ผ่าน Session แท้ของเบราว์เซอร์
  - ทำงานแบบ Bounded Batch Scan พร้อมสุ่มดีเลย์ (Jitter 3,000–5,000ms) ไม่กระหน่ำยิง Request ป้องกันการติด Checkpoint
- **Snapshot Diff Engine (IndexedDB Vault):**
  - บันทึกสถานะผู้ติดตามลงใน IndexedDB ประจำเครื่อง
  - เปรียบเทียบความเปลี่ยนแปลงอัตโนมัติ:
    1. **Not Following Back:** บัญชีที่เราติดตาม แต่เขาไม่ได้ติดตามเรากลับ
    2. **Fans / Admirers:** บัญชีที่ติดตามเรา แต่เรายังไม่ได้ติดตามกลับ
    3. **Mutual Friends:** บัญชีที่ติดตามซึ่งกันและกัน
    4. **Lost / Gained Followers:** ติดตามว่ามีใครเพิ่งเลิกติดตามหรือกดติดตามใหม่หลังจากโพสต์ล่าสุด
- **ThreadMax Studio UI:**
  - Launcher ปุ่มไอคอนคมชัดที่มุมล่างซ้าย เปิดหน้าต่าง Studio Drawer สไตล์ Solid Neutral (`#161616`, Hairline `#282828`)
  - มีแถบความคืบหน้าแสดงสถิติจริง: `กำลังสแกน... 150/420 บัญชี (18s)`

---

## 3. Technical & Architectural Specification

### 3.1 Platform & Environment
- **Target URL:** `https://www.threads.com/*`, `https://threads.net/*`
- **Execution Timing:** `@run-at document-start`
- **Userscript Grants:**
  - `GM_download`: จัดการบันทึกไฟล์มีเดียลงระบบไฟล์
  - `GM_setValue` / `GM_getValue`: เก็บค่าการตั้งค่า (Download mode, Timestamp format, Volume)
  - `GM_registerMenuCommand`: ทางลัดเปิด Settings
  - `unsafeWindow`: เข้าถึง Context ที่จำเป็น

### 3.2 Storage Schema

| Store | Mechanism | Key / Store Name | Data Content |
| :--- | :--- | :--- | :--- |
| Settings | `GM_setValue` | `tm_config` | `{ downloadMode: 'zip'\|'individual', timestampMode: 'hybrid'\|'absolute'\|'native', videoVolume: 0.8 }` |
| Relationship Snapshots | IndexedDB | `ThreadMaxDB` (`snapshots` store) | `{ timestamp: number, followers: string[], following: string[], diff: {...} }` |

### 3.3 DOM Strategy & Selectors

- **Post Container:** `[data-pressable-container="true"]` หรือ feed item wrapper
- **Action Bar:** ชุด `div[role="button"]` ที่บรรจุ Like, Comment, Repost, Share
- **Media Targets:**
  - Image: `img[src*="cdninstagram.com"], img[src*="fbcdn.net"]` (คัดแยก Profile Avatar ออกโดยตรวจสอบ bounding box / parent layout)
  - Video: `video, video source`
- **Timestamp Node:** `time[datetime]` ดึงค่า ISO string สำหรับคำนวณ Absolute/Hybrid display

---

## 4. Non-Goals & Explicitly Rejected Features

- ❌ **Direct Copy Image to Clipboard:** ปฏิเสธ (ไม่จำเป็น เบราว์เซอร์มีคลิกขวาก๊อปปี้ หรือกดดาวน์โหลดโดยตรงได้)
- ⏸️ **Default to Following Feed:** พักไว้ก่อน (Native บุ๊กมาร์กตรง URL ได้ ไม่คุ้มค่าที่จะเพิ่ม logic ตรวจจับการเปลี่ยน route)
- ⏸️ **Unanswered Replies Hunter:** พักไว้ก่อนสำหรับเวอร์ชันถัดไป
- ❌ **Auto-Follow / Auto-Like Bot:** ห้ามทำเด็ดขาด (เสี่ยงต่อความปลอดภัยของบัญชี ขัดต่อกฎ Anti-detection)
- ❌ **Third-Party CDN / External Frameworks:** ห้ามติดตั้งไลบรารีภายนอกเด็ดขาด

---

## 5. Verification & Acceptance Criteria

1. **Phase 1 Verification:**
   - ทดสอบดาวน์โหลดทั้ง Single Image, Single Video, และ Carousel แบบ Mixed Media ได้ไฟล์ครบถ้วนทั้งแบบ ZIP และ Individual
   - ตัวเร่งสปีดวิดีโอ (1x-2x) และ PiP ใช้งานได้จริงบนทุกคลิปในฟีด
   - ปุ่ม Clean Link ตัดพารามิเตอร์ `?xmt=` ออกได้อย่างสมบูรณ์
   - ตัวเลือก Timestamp ทั้ง 3 โหมด (Native/Absolute/Hybrid) สลับใช้งานได้ถูกต้องตามเวลาท้องถิ่น
2. **Phase 2 Verification:**
   - ทดสอบ Unroll โพสต์ที่มีการตอบตัวเอง 5+ โพสต์ต่อเนื่อง แสดงผลเป็นหน้าเดียวได้สมบูรณ์ และ Export เป็น Markdown ได้ถูกต้อง
   - เส้น Hook Indicator แสดงตำแหน่งตัดข้อความตรงกับมุมมองมือถือจริง
3. **Phase 3 Verification:**
   - เรดาร์คำนวณ Velocity โพสต์ถูกต้องตามเวลาและยอดเอนเกจเมนต์ ไม่ทำให้ฟีดกระตุก
   - ระบบสแกนความสัมพันธ์ใน IndexedDB ทำงานแบบ Paced Batch ไม่เกิด Rate-limit หรือ Account Warning
