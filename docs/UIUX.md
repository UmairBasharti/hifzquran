# UIUX.md
# HifzAI — UI/UX Rules and Design System
# Read this before writing any component, page, or CSS class.
# HifzAI must feel like a natural part of Quran.com — clean, calm, trustworthy.

---

## 1. DESIGN PRINCIPLES

1. **Calm over flashy** — this app is used during acts of worship. No animations
   that distract. No bold colors competing with the Quran text. The Quran is the hero.

2. **Arabic first** — every layout decision must work for RTL Arabic text first.
   English UI labels are secondary.

3. **Quran.com compatible** — HifzAI must look like it belongs inside Quran.com.
   Use compatible colors, spacing, and typography so integration feels native.

4. **Accessible always** — errors use color + icon + text. Never color alone.
   Minimum touch targets 44x44px. Keyboard navigation on all interactive elements.

5. **Simple and fast** — no loading skeletons, no complex transitions. If data
   is not ready, show a subtle spinner. Never block the user from seeing content.

---

## 2. ARABIC FONT — CRITICAL

### Font: UthmanicHafs (Official Quran Foundation Font)

The Quran Foundation provides the UthmanicHafs font directly via their CDN, used by Quran.com itself for rendering Uthmani script with full tashkeel support.

```css
@font-face {
  font-family: 'UthmanicHafs';
  src: url('https://verses.quran.foundation/fonts/quran/hafs/uthmanic_hafs/UthmanicHafs1Ver18.woff2')
       format('woff2'),
       url('https://verses.quran.foundation/fonts/quran/hafs/uthmanic_hafs/UthmanicHafs1Ver18.ttf')
       format('truetype');
  font-display: swap;
}
```

Add this to `frontend/app/layout.js` global styles or a global CSS file.

### Arabic Text Rules
- Font family: `'UthmanicHafs', 'Traditional Arabic', 'Scheherazade', serif`
- Minimum font size for Quran text: **28px** (tashkeel must be readable)
- Line height for Arabic Quran text: **2.2** (tashkeel needs vertical space)
- Text direction: `dir="rtl"` attribute on the container element
- Language: `lang="ar"` attribute on the container element
- Text alignment: `text-align: right` inside RTL containers

```javascript
// Every Arabic word or Ayah container — no exceptions
<div dir="rtl" lang="ar" className="font-uthmanic text-3xl leading-loose text-right">
  {arabicWordText}
</div>
```

### English UI Font
- System font stack: `ui-sans-serif, system-ui, sans-serif` (Tailwind default)
- No custom English font needed — system fonts load instantly

---

## 3. COLOR SYSTEM

### Word State Colors (most important)

| State | Color Name | Hex | Tailwind | Usage |
|-------|-----------|-----|----------|-------|
| Correct | Green | #22C55E | `text-green-500` | Word revealed correctly |
| Wrong | Red | #EF4444 | `text-red-500` | Wrong word or tashkeel error |
| Skipped | Amber | #F59E0B | `text-amber-500` | Manually skipped word |
| Hidden | Transparent | — | `invisible` | Word not yet recited |
| Current | Soft blue outline | #93C5FD | `ring-2 ring-blue-300` | Next expected word |

### UI Colors (compatible with Quran.com)

| Element | Color | Hex | Tailwind |
|---------|-------|-----|----------|
| Page background | Off-white | #FAFAFA | `bg-gray-50` |
| Card / panel | White | #FFFFFF | `bg-white` |
| Border | Light gray | #E5E7EB | `border-gray-200` |
| Primary button | Teal/green | #059669 | `bg-emerald-600` |
| Primary button hover | Darker teal | #047857 | `bg-emerald-700` |
| Body text | Dark gray | #111827 | `text-gray-900` |
| Secondary text | Medium gray | #6B7280 | `text-gray-500` |
| Error banner | Light red bg | #FEF2F2 | `bg-red-50` |
| Warning banner | Light amber bg | #FFFBEB | `bg-amber-50` |

### Dark Mode
Not required for MVP. Do not implement dark mode yet.

---

## 4. WORD STATE VISUAL RULES

### Hidden Word (Hifz Mode — not yet recited)
```javascript
// Word slot is invisible but still occupies space — layout never reflows
<span
  className="invisible inline-block"
  style={{ minWidth: '2ch' }}
  dir="rtl"
  lang="ar"
>
  {wordText}
</span>
```

Critical: use `invisible` not `hidden`. The word must take up its space
even when invisible. If you use `hidden`, the Ayah line collapses and
reflows when words appear — jarring and confusing for the user.

### Correct Word (green, revealed)
```javascript
<span className="text-green-500 font-uthmanic text-3xl" dir="rtl" lang="ar">
  {wordText}
</span>
```

### Wrong Word (red, with error label and retry prompt)
```javascript
<span className="inline-flex flex-col items-center gap-1">
  <span className="text-red-500 font-uthmanic text-3xl" dir="rtl" lang="ar">
    {wordText}
  </span>
  <span className="text-xs text-red-400">{errorTypeLabel}</span>
  <span className="text-xs text-gray-400">Try again</span>
</span>
```

### Skipped Word (amber, after user presses skip)
```javascript
<span className="text-amber-500 font-uthmanic text-3xl opacity-70" dir="rtl" lang="ar">
  {wordText}
</span>
```

### Current Expected Word (subtle blue ring — system listening for this)
```javascript
<span
  className="invisible inline-block ring-2 ring-blue-300 ring-offset-1 rounded"
  dir="rtl" lang="ar"
>
  {wordText}
</span>
```

---

## 5. PAGE LAYOUTS

### Home Page (Surah Selector)

```
+--------------------------------------------------+
|  HifzAI                            [About]       |
+--------------------------------------------------+
|                                                  |
|   Memorize the Quran — Free, Forever             |
|                                                  |
|   [Search: type surah name or number...      ]   |
|                                                  |
|   +--------+  +--------+  +--------+            |
|   | 1      |  | 2      |  | 3      |            |
|   | الفاتحة|  | البقرة |  | آل عمران|            |
|   |Al-Fat..|  |Al-Baq..|  |Ali Imr.|            |
|   | 7 ayahs|  |286 ayas|  |200 ayas|            |
|   +--------+  +--------+  +--------+            |
|                                                  |
|   (grid of all 114 surahs, scrollable)           |
+--------------------------------------------------+
```

- Search bar: full width, auto-focused on load
- Surah cards: 3 columns desktop, 2 columns tablet, 1 column mobile
- Each card: Surah number, Arabic name (RTL), English name, Ayah count
- Clicking card navigates to /hifz/[surahNumber]

### Hifz Mode Page (before session starts)

```
+--------------------------------------------------+
|  ← Back        Surah Al-Kawthar (108)            |
+--------------------------------------------------+
|                                                  |
|  Ayah Range:  [From: 1 ▼]  [To: 3 ▼]           |
|                                                  |
|  بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ         |
|                                                  |
|  ١  إِنَّا أَعْطَيْنَاكَ الْكَوْثَرَ            |
|  ٢  فَصَلِّ لِرَبِّكَ وَانْحَرْ                 |
|  ٣  إِنَّ شَانِئَكَ هُوَ الْأَبْتَرُ            |
|                                                  |
|         [  Start Hifz Mode  ]                    |
|                                                  |
+--------------------------------------------------+
```

### Hifz Mode Page (session active)

```
+--------------------------------------------------+
|  [Show Text]        Al-Kawthar · Ayah 1 of 3    |
|                     🎤 ●●● (pulsing)             |
+--------------------------------------------------+
|                                                  |
|  ١  [GREEN] [GREEN] [HIDDEN/RING]                |
|  ٢  [HIDDEN] [HIDDEN] [HIDDEN]                   |
|  ٣  [HIDDEN] [HIDDEN] [HIDDEN] [HIDDEN]          |
|                                                  |
+--------------------------------------------------+
|  Having trouble? ↑ (silence banner — dismissible)|
+--------------------------------------------------+
```

- Only Ayah numbers visible when text is hidden
- Current expected word has subtle blue ring
- Mic icon pulses while recording is active
- "Show Text" button always visible top-left — exits Hifz Mode

### Wrong Word State (inline)

```
+--------------------------------------------------+
|  ١  [GREEN]  [RED ✗]          [HIDDEN/RING]     |
|              أَعْطَيْنَاكَ                       |
|              missing shadda   [→ Skip]           |
|              Try again                           |
+--------------------------------------------------+
```

- Wrong word in red with error type below it
- Skip button (→) appears next to wrong word
- System stays on this word until correct or skipped

### Session Summary Screen

```
+--------------------------------------------------+
|  Session Complete — Al-Kawthar                   |
+--------------------------------------------------+
|  ✅ Correct    11  (78%)                         |
|  ❌ Wrong       2  (14%)                         |
|  ⏭ Skipped     1   (7%)                         |
+--------------------------------------------------+
|  Word Breakdown:                                 |
|  ✅ بِسْمِ           correct                    |
|  ✅ اللَّهِ           correct                    |
|  ❌ أَعْطَيْنَاكَ    missing shadda              |
|     You said: اعطيناك                           |
|  ⏭ الْكَوْثَرَ      skipped                     |
+--------------------------------------------------+
|  [ Try Again ]          [ Return to Surah ]      |
+--------------------------------------------------+
```

---

## 6. COMPONENT RULES

### Mic Button
- Size: 64x64px minimum (large enough for comfortable tap)
- States: idle (gray mic icon) | recording (green mic + pulsing ring)
- Pulsing animation: `animate-pulse` Tailwind class on the ring
- Label: "Begin Recitation" (idle) | "Recording..." (active)

### Silence Warning Banner
- Position: fixed bottom of screen, above page edge
- Style: `bg-amber-50 border border-amber-200 text-amber-800`
- Text: "Having trouble hearing you — try speaking a little closer to the mic"
- Dismiss: auto-dismisses when next word result arrives
- Frequency: shown max once every 30 seconds

### Skip Button
- Appears only next to wrong (red) words
- Icon: → arrow (right-pointing, not left — skip forward)
- Style: `text-gray-400 hover:text-gray-600 text-sm`
- Label: "Skip" — small, unobtrusive, never draws attention from the word

### Error Type Labels
Plain English only — no Arabic technical terms in MVP:
- `missing_shadda` → "Missing shadda"
- `wrong_harakat` → "Wrong vowel"
- `missing_tanwin` → "Missing tanwin"
- `wrong_word` → "Wrong word"
- `pronunciation_error` → "Pronunciation error"

---

## 7. RTL RULES — NEVER SKIP THESE

Every Arabic text element must have BOTH of these:
- `dir="rtl"` — on the container element
- `lang="ar"` — on the container element

Ayah word order: Arabic reads right to left. Words in an Ayah flow RTL.
Use `flex flex-row-reverse` or rely on `dir="rtl"` for natural word flow.

```javascript
// Correct — words flow RTL naturally
<div dir="rtl" lang="ar" className="flex gap-2 flex-wrap justify-end">
  {ayahWords.map(function(wordObject, wordIndex) {
    return (
      <WordDisplay
        key={wordIndex}
        wordText={wordObject.text}
        wordState={wordStates[wordObject.index]}
      />
    )
  })}
</div>
```

Ayah numbers: rendered in Arabic-Indic numerals (١ ٢ ٣) or Western (1 2 3).
Either is acceptable — be consistent across all Ayahs.

---

## 8. SPACING AND SIZING

| Element | Value |
|---------|-------|
| Quran text font size | 28px minimum (text-3xl) |
| Quran text line height | 2.2 (leading-loose or custom) |
| Page horizontal padding | 16px mobile, 24px tablet, 32px desktop |
| Surah card padding | 16px |
| Button min height | 44px |
| Button min width | 120px |
| Icon button size | 44x44px minimum |
| Summary row padding | 12px vertical |

---

## 9. WHAT NOT TO BUILD

- No animations on Arabic text (words revealing is already engaging)
- No sound effects or audio cues
- No confetti or celebration animations
- No dark mode (Post-MVP)
- No custom illustrations or mascots
- No sidebar navigation — single page flow only
- No modal dialogs — use inline states instead
