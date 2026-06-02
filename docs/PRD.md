# PRD.md
# HifzAI — Product Requirements Document
# This document defines what HifzAI is, who it is for, what it must do,
# and what "done" looks like for every feature.
# Read this before building any feature. Every requirement here is final
# unless explicitly updated by the project owner (Umair Basharti).
# Last updated: All open questions resolved. No open questions remain.

---

## 1. PRODUCT OVERVIEW

### What Is HifzAI

HifzAI is a free, open-source web application that helps Muslims memorize
the Quran (Hifz) using real-time AI-powered speech recognition.

It is a direct alternative to Tarteel AI's premium Hifz feature — rebuilt
from the ground up using open-source models and tools, made freely available
to the global Muslim community at zero cost, with no paywalls ever.

The end goal is for HifzAI to be integrated into Quran.com — the world's
most visited Quran platform — so that millions of users get access to
AI-assisted Quran memorization without paying for a subscription.

### Problem Being Solved

### HifzAI Privacy Advantage Over Tarteel
Tarteel AI stores every user's recitation audio in the cloud every 20 seconds
and uses it for model training. Free users cannot opt out. HifzAI processes audio
in memory only and discards it immediately after transcription — no audio ever
stored, logged, or sent to any third party. This is a genuine ethical advantage
that must never be compromised.

Tarteel AI offers an excellent Hifz feature: it listens to your recitation,
hides the text, reveals words as you say them correctly, and flags mistakes.
But it sits behind a paid subscription. For the majority of the global Muslim
population — many of whom are in lower-income countries — this is a barrier.

HifzAI removes that barrier entirely. Same quality. Zero cost. Open source.

### Who This Is For

- **Primary user**: Anyone globally trying to memorize the Quran from memory
- **Secondary user**: Quran.com's engineering team — who will integrate HifzAI
- **Geography**: Global — the app is designed for any country, any device
- **Languages**: English UI only in MVP — Arabic content throughout always
- **Device**: Desktop and laptop browsers in MVP — mobile browser next

---

## 2. PERSONAS

### Persona 1 — The Hafiz Student (Primary)

**Name**: Ahmed, 19 years old, university student in Pakistan
**Goal**: Memorize Juz Amma (the last 30 chapters) for his university Quran competition
**Current problem**: He knows the Surahs but makes small mistakes he cannot catch
on his own — wrong harakat, skipped words, slight pronunciation errors
**How HifzAI helps**: He opens the app on his laptop, selects Surah Al-Mulk,
hides the text, and recites. Every mistake is highlighted instantly. He repeats
until all words are green. No teacher required. No subscription required.
**What would make him leave**: Poor accuracy (more than 1 false error per Ayah),
high latency (words reveal more than 2 seconds after he says them), broken UI

### Persona 2 — The Revision Practitioner (Secondary)

**Name**: Fatima, 35 years old, teacher in the UK
**Goal**: Revise (muraja'a) specific Ayah ranges she memorized years ago
**Current problem**: She does not need full Surahs — she wants to test herself
on Ayah 10 to 25 of Al-Baqarah specifically, not all 286 Ayahs
**How HifzAI helps**: Custom Ayah range selector — she picks exactly which
Ayahs to test and the system hides only those, leaving the rest visible
**What would make her leave**: Forced to always do full Surahs, no range control

### Persona 3 — The Quran.com Engineering Team (Integration User)

**Goal**: Embed HifzAI into Quran.com with minimal custom code
**Need**: A well-documented, clean JavaScript SDK and Python backend that can
be deployed alongside Quran.com's existing Next.js infrastructure
**What would make them reject HifzAI**: Poor documentation, TypeScript conflicts
with their codebase, hardcoded values, missing error handling, no deployment guide

---

## 3. CORE DESIGN DECISIONS
## (These mirror Tarteel AI's proven behavior — follow exactly)

### Decision 1: Bismillah Handling

Bismillah (بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ) is treated as the first
expected sequence of every Surah recitation session. It is hidden along with
the rest of the Surah text when Hifz Mode begins.

The alignment engine processes Bismillah the same as any other Quranic word.
There is NO special-case logic for it. The constrained alignment simply knows
it is the first expected sequence and accepts it at any speed — slow, fast,
or with a long pause after it. The system does not penalize the user for
reciting Bismillah slowly before picking up pace on the Surah.

This works naturally because the alignment engine tracks position, not pace.
As long as the words are correct in order, the speed does not matter.

**Implementation note**: Load Bismillah as word index 0 through 3 of the
session word list before the Surah's first Ayah words. Use the standard
Uthmani text: بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ

### Decision 2: Low Volume and Whispering

HifzAI supports whispering and quiet recitation — exactly as Tarteel does.
Tarteel explicitly markets this capability: the system works whether the user
is reciting normally, quietly in a library, or whispering so as not to
wake sleeping children.

This is achieved technically through two layers:
1. Voice Activity Detection (VAD) in the Python backend using faster-whisper's
   built-in VAD filter — this detects speech at any volume level, not just
   loud speech
2. Audio normalization in the preprocessing step before ASR — the audio chunk
   amplitude is normalized before being passed to the model

User-facing behavior:
- If speech is detected at any volume: process normally, no message shown
- If NO speech is detected for 4 consecutive seconds: show a non-intrusive
  banner: "Having trouble hearing you — try speaking a little closer to the mic"
- The banner disappears automatically when speech is detected again
- Never block the session or force the user to stop — only a gentle nudge
- Never show this message more than once every 30 seconds to avoid annoyance

### Decision 3: Wrong Word Behavior — Repeat Until Correct

When the user says a wrong word, HifzAI uses Tarteel's "Repeat Until Correct"
model. The system does NOT auto-advance past a wrong word.

Exact behavior:
1. User says the wrong word — it appears in red with the error type label
2. The system holds position on that word and keeps listening
3. The user says the word again — if correct this time, it turns green and
   the session advances to the next word
4. If wrong again, it stays red and the system continues waiting
5. There is no limit on retry attempts — the user can try as many times as needed
6. A subtle "Try again" text appears under the red word to guide the user
7. The user can tap the red word to hear the correct pronunciation from
   a reference Qari audio clip (if audio is available for that Surah)

**Important**: The session never advances automatically past a wrong word.
The user must say the correct word OR manually skip it using the skip button.
A manual skip button (arrow icon) is always visible next to wrong words.

### Decision 4: Session Summary Screen

After completing a Hifz session, a full summary screen is shown with:

- Total words in the session range
- Number of correct words (with percentage)
- Number of wrong words (with percentage)
- Number of skipped words (with percentage)
- A word-by-word breakdown list showing:
  - The Arabic word
  - Its status (Correct / Wrong / Skipped)
  - If wrong: what the user said vs what was expected
  - If wrong: the error type label (Missing shadda, Wrong harakat, etc.)
- Two action buttons: "Try Again" (restarts same session) and "Return to Surah"

---

## 4. CORE USER JOURNEYS

### Journey 1 — Standard Hifz Session (Most Common)

```
1.  User opens HifzAI in browser
2.  User sees a search bar — types "Kawthar" or "108"
3.  Surah Al-Kawthar appears in results — user clicks it
4.  Full Surah page loads — Bismillah + all 3 Ayahs visible in Arabic
5.  User sees "Start Hifz Mode" button — clicks it
6.  All Arabic text hides — only Ayah numbers (1, 2, 3) remain visible
7.  A mic icon and "Begin Recitation" button appear
8.  User clicks "Begin Recitation" — browser asks for mic permission
9.  User grants mic permission — recording and VAD begin
10. User recites Bismillah slowly — each word reveals green as said
11. User recites Ayah 1 — correct words reveal green as spoken
12. User says a wrong word — word appears in red with error label and "Try again"
13. User repeats the word correctly — turns green, session advances
14. User completes all 3 Ayahs
15. Summary screen appears with full word-by-word breakdown
16. User taps "Try Again" to restart or "Return to Surah" to go back
```

### Journey 2 — Custom Ayah Range Session

```
1.  User searches and opens Surah Al-Baqarah
2.  User sees "Custom Range" option before clicking Start Hifz Mode
3.  User sets: From Ayah 255 (Ayat ul Kursi) to Ayah 257
4.  User clicks "Start Hifz Mode"
5.  Only Ayahs 255-257 text hides — rest of Surah stays visible
6.  Bismillah is NOT included in range sessions — only Ayah text is tested
7.  Recitation begins — only the 3 selected Ayahs are evaluated
8.  Session summary shows only the words from the selected range
```

### Journey 3 — Whispering / Quiet Recitation

```
1.  User is in a library or quiet room — opens HifzAI
2.  User starts Hifz session and whispers the recitation
3.  System picks up the whispered words via VAD normalization
4.  Session proceeds normally — words reveal as said
5.  If user stops mid-recitation for 4 seconds (thinking):
    Banner appears: "Having trouble hearing you — try speaking a little closer"
6.  User resumes — banner disappears — session continues from where it stopped
```

### Journey 4 — Offline Session (After First Load)

```
1.  User previously loaded Surah Al-Mulk while online
2.  User opens HifzAI with no internet connection
3.  Surah Al-Mulk is available from browser cache
4.  Hifz Mode starts and runs fully offline
5.  If user tries to open a Surah not yet cached:
    Message shown: "Connect to the internet and open this Surah once to use it offline"
```

---

## 5. MVP FEATURE SPECIFICATIONS

Every feature below must be built for MVP. Each has a clear definition
of done so there is no ambiguity about when it is complete.

---

### Feature 1: Surah Search and Selection

**What it does**: Lets the user find and open any of the 114 Surahs by
typing the Surah name in English, the Surah name in Arabic, or the Surah
number (1 to 114).

**Data source**: `frontend/public/surah_index.json` — a static 114-record JSON file (~10KB)
containing only: Surah number, English name, Arabic name, and total Ayah count.
This file is bundled with the frontend, served as a static asset, and fetched once
at app startup then stored in React state for instant client-side filtering.
The full `quran_data.json` (8-15MB) lives ONLY in the Python backend — never the frontend.

**Acceptance criteria — all must pass before this feature is done**:
- [ ] Search bar is visible and focused on page load
- [ ] Typing "Kawthar" returns Surah 108 in results
- [ ] Typing "108" returns Surah 108 in results
- [ ] Typing the Arabic name "الكوثر" returns Surah 108 in results
- [ ] Results appear within 200ms of each keystroke — no server call required
      (search runs client-side against surah_index.json — a 114-record file (~10KB) containing
      only Surah names, Arabic names, numbers, and Ayah counts, fetched once at app startup
      and kept in React state. The full quran_data.json never loads in the frontend.)
- [ ] Clicking a result navigates to that Surah's page
- [ ] The Surah page shows: Surah name, Surah number, Bismillah, all Ayahs in Uthmani Arabic
- [ ] Arabic text is rendered RTL (dir="rtl" lang="ar") on every Ayah
- [ ] Page works on Chrome, Firefox, and Safari on desktop

---

### Feature 2: Custom Ayah Range Selector

**What it does**: Before entering Hifz Mode, the user can choose a specific
start Ayah and end Ayah within the current Surah. Only those Ayahs will be
hidden and tested. Bismillah is NOT included in custom range sessions.

**Acceptance criteria**:
- [ ] "Custom Range" option is visible on the Surah page before Hifz Mode starts
- [ ] User can set a start Ayah number and an end Ayah number
- [ ] Start Ayah cannot be greater than End Ayah — show validation error if so
- [ ] End Ayah cannot exceed the total Ayah count of the Surah
- [ ] Selecting the full Surah range is the default (Ayah 1 to last Ayah)
- [ ] When Hifz Mode starts with a custom range, only that range of Ayah text hides
- [ ] The alignment engine only evaluates words within the selected range
- [ ] Words outside the selected range are never flagged as errors
- [ ] Bismillah is excluded from custom range sessions (only included in full Surah mode)

---

### Feature 3: Hifz Mode — Text Hiding

**What it does**: When "Start Hifz Mode" is clicked, all Arabic word text
within the selected range (plus Bismillah for full Surah mode) disappears.
Only Ayah numbers remain visible.

**Acceptance criteria**:
- [ ] Clicking "Start Hifz Mode" hides all Arabic word text in selected range
- [ ] In full Surah mode, Bismillah text is also hidden
- [ ] In custom range mode, Bismillah remains visible
- [ ] Ayah numbers remain visible (1, 2, 3 etc.)
- [ ] No Arabic text is visible in the DOM — use conditional rendering not CSS opacity
- [ ] Hidden word slots still occupy their correct space — no layout reflow when revealed
- [ ] A "Show Text" escape button is always visible — clicking it exits Hifz Mode
- [ ] Clicking "Show Text" immediately reveals all hidden text and stops the session

---

### Feature 4: Live Microphone Capture via WebSocket

**What it does**: Captures the user's microphone audio continuously and streams
2-3 second chunks to the Python FastAPI backend over a persistent WebSocket
connection for real-time transcription and alignment.

**Acceptance criteria**:
- [ ] Browser requests microphone permission when "Begin Recitation" is clicked
- [ ] If permission is denied, message shown: "Microphone access is needed for
      Hifz Mode. Please allow microphone access in your browser settings."
- [ ] Audio is captured using Web Audio API at exactly 16kHz mono
      (AudioContext({ sampleRate: 16000 }) — never device default 44.1kHz or 48kHz)
- [ ] Audio is sent as raw Float32 PCM binary — never compressed MP3, Opus, or WebM
- [ ] VAD (Voice Activity Detection) is active from session start
- [ ] Audio chunks of 2-3 seconds are sent to Python backend as binary over WebSocket
- [ ] The WebSocket connection opens once before first chunk and stays open all session
- [ ] If WebSocket drops, auto-reconnect is attempted every 3 seconds
- [ ] UI shows "Reconnecting..." banner during reconnection attempts
- [ ] Raw audio is never stored anywhere — sent and immediately discarded
- [ ] Mic icon shows a pulsing animation while recording is active
- [ ] If no speech detected for 4 continuous seconds, show banner:
      "Having trouble hearing you — try speaking a little closer to the mic"
- [ ] Banner disappears automatically when speech is detected again
- [ ] Banner does not appear more than once every 30 seconds

---

### Feature 5: Real-Time Word-by-Word Reveal

**What it does**: As each word is correctly recited, it appears on screen
in green in its exact correct position — while the user is still speaking.

**Acceptance criteria**:
- [ ] Words appear on screen within 2 seconds of being correctly spoken
- [ ] Words appear in their exact correct position in the Ayah (not appended at end)
- [ ] Correctly spoken words are displayed in green (Tailwind green-500 / #22C55E)
- [ ] Hidden word slots reserve space so layout does not reflow on reveal
- [ ] The next expected word position has a subtle visual indicator (faint outline
      or soft grey placeholder) so user knows where the system is listening
- [ ] Arabic words render RTL within each Ayah line

---

### Feature 6: Word-Level Error Detection with Repeat Until Correct

**What it does**: The alignment engine classifies each word as correct, wrong,
or skipped. Wrong words trigger the Repeat Until Correct flow — the session
holds position until the user says the word correctly or manually skips it.

**The three word states**:

| State | Meaning | Color | Icon |
|-------|---------|-------|------|
| Correct | Said correctly | Green #22C55E | Checkmark |
| Wrong | Said differently than expected | Red #EF4444 | X mark |
| Skipped | Manually skipped by user | Yellow #EAB308 | Arrow |

**Repeat Until Correct behavior**:
- [ ] When a word is wrong, it appears in red and session holds on that word
- [ ] "Try again" text appears below the wrong word
- [ ] System keeps listening for the correct word — no timeout
- [ ] If user says the word correctly on retry, it turns green and session advances
- [ ] If user says wrong again, it stays red and system keeps waiting
- [ ] A skip button (arrow icon) is always visible next to wrong words
- [ ] Clicking skip marks the word as skipped (yellow) and advances the session

**Accuracy requirements**:
- [ ] All Arabic comparison uses two-stage approach:
      Stage 1: strip tashkeel from both words (unicodedata) — determines correct/wrong/skipped
      Stage 2: compare normalized tashkeel character by character — determines error type
- [ ] Never compare raw Arabic strings — always normalize with unicodedata.normalize("NFD")
- [ ] Wrong word detection uses Levenshtein distance at word level after normalization
- [ ] Tashkeel errors are detected by Unicode diacritic comparison after normalization

---

### Feature 7: Basic Tajweed Error Classification

**What it does**: When a word is marked as Wrong, the system provides a plain
English label describing the type of error detected.

**MVP tajweed error labels**:

| Error Type | Meaning | Detection Method |
|------------|---------|-----------------|
| Missing shadda | User dropped a doubled consonant | Unicode tashkeel comparison |
| Wrong harakat | User used wrong short vowel (fatha/kasra/damma) | Unicode tashkeel comparison |
| Missing tanwin | User dropped nunation at word end | Unicode tashkeel comparison |
| Wrong word | Completely different word said | Levenshtein word distance |
| Skipped | Word manually skipped by user | Session state tracking |

**Acceptance criteria**:
- [ ] When a word is wrong, the error type label appears below the red word in English
- [ ] Error type is determined by comparing normalized Unicode of spoken vs expected
- [ ] If error type cannot be determined, default label is "Pronunciation error"
- [ ] Tajweed checking logic runs in Python only — never in JavaScript
- [ ] Labels are plain English — no Arabic technical terminology in MVP

---

### Feature 8: Session Summary Screen

**What it does**: After the last word of the session is processed (correct or
manually skipped), a full summary screen replaces the Surah view.

**Acceptance criteria**:
- [ ] Summary screen shows automatically after the session ends
- [ ] Header shows: Surah name, Ayah range tested, total time taken
- [ ] Stats row shows: Total words / Correct (%) / Wrong (%) / Skipped (%)
- [ ] Word-by-word breakdown list shows every word in the session with:
      - The Arabic word (rendered RTL, dir="rtl" lang="ar")
      - Status badge: Correct (green) / Wrong (red) / Skipped (yellow)
      - If wrong: what the user said vs what was expected (both in Arabic)
      - If wrong: the error type label in English
- [ ] "Try Again" button restarts the same session with same Surah and range
- [ ] "Return to Surah" button goes back to the Surah page with text visible

---

### Feature 9: Per-Surah Offline Mode

**What it does**: After a user loads a Surah while online, that Surah's text
and the AI model are cached so future sessions run without internet.

**Acceptance criteria**:
- [ ] Quran text for a visited Surah is cached in browser IndexedDB after first load
- [ ] A download icon on each Surah card in search results shows offline status:
      Cloud icon with arrow = not cached / Checkmark = available offline
- [ ] If user is offline and opens a non-cached Surah, show:
      "Connect to the internet and open this Surah once to make it available offline"
- [ ] Offline sessions are functionally identical to online sessions in
      accuracy, speed, and word reveal behavior
- [ ] Cached Surah data persists across browser restarts (IndexedDB is persistent)

---

## 6. NON-FUNCTIONAL REQUIREMENTS

### Performance
- Word reveal latency: Under 2 seconds from correct word spoken to word appearing
- Search results: Under 200ms from keystroke to results rendering
- Page load: Under 3 seconds for Surah page to be fully interactive
- WebSocket reconnect: Under 5 seconds automatic reconnect on dropped connection
- Low volume / whisper detection: Same latency as normal volume — no degradation

### Accuracy
- ASR word accuracy target: 90%+ on Al-Kawthar, Al-Ikhlas, Al-Falaq, Al-Nas
- False error rate: Fewer than 1 false error per Ayah on the 4 test Surahs
- The alignment engine must handle the user pausing mid-Ayah without losing position
- Whispering must work without reducing accuracy below 85%

### Reliability
- Python backend starts without errors on a clean install
- Next.js frontend builds without errors or warnings on a clean install
- WebSocket connection survives 10+ consecutive minutes of continuous recitation
- Repeat Until Correct flow has no timeout — session never auto-ends

### Accessibility
- All interactive elements are keyboard accessible
- Error states use both color AND icon AND text label — never color alone
- Arabic text always has dir="rtl" and lang="ar" attributes
- Minimum Arabic font size: 24px (tashkeel must be readable at this size)
- Mic permission denial message is in plain non-technical English

### Privacy
- Zero microphone audio stored anywhere at any time
- No analytics or tracking in MVP
- No user accounts or login required in MVP — fully anonymous use
- Audio processed in memory only — never written to disk, database, or logs

---

## 7. OUT OF SCOPE FOR MVP

The following are explicitly excluded. Do not build, partially build,
or add placeholder UI for any of these.

- User accounts, login, or registration
- Progress tracking, streaks, or dashboards
- Mistake history stored across sessions
- Multiple reciters or reference audio playback (except the skip-tap reference clip)
- IndoPak or Madani Mushaf scripts (Uthmani only in MVP)
- Tajweed color-coding on the Mushaf display
- Social features of any kind
- Mobile native app (iOS or Android)
- Multilingual UI
- Admin panel
- Email notifications
- Payment or subscription system (HifzAI is always free — no payment ever)

---

## 8. SUCCESS CRITERIA

HifzAI MVP is complete when ALL of the following are true:

- [ ] All 9 MVP features pass their acceptance criteria listed above
- [ ] Testing Phase 1-4 (Kawthar, Ikhlas, Falaq, Nas) all pass fully
- [ ] Word reveal latency is under 2 seconds on a standard laptop
- [ ] False error rate is under 1 per Ayah on the 4 test Surahs
- [ ] Whispering test passes — quiet recitation recognized correctly
- [ ] Bismillah recited slowly before Surah does not cause false errors
- [ ] Repeat Until Correct holds correctly and does not auto-advance
- [ ] Session summary shows accurate word-by-word breakdown
- [ ] App runs locally with one setup command each for frontend and backend
- [ ] GitHub repository is public with MIT license and a clear README.md
- [ ] Audio captured at 16kHz mono Float32 PCM — confirmed by code review
- [ ] Sliding window overlap implemented — no hard fixed audio cuts
- [ ] Constrained decoding with initial_prompt active for all sessions
- [ ] No raw audio stored anywhere — confirmed by code review
- [ ] All Arabic text renders correctly RTL in Chrome, Firefox, and Safari
- [ ] Quran.com engineering team can integrate using only docs/API.md

---

## 9. RESOLVED DECISIONS LOG

All questions from initial planning are now resolved:

| Question | Resolution |
|----------|------------|
| Audio format | 16kHz mono Float32 PCM in browser. Sliding window 3s/1.5s step. Constrained decoding with initial_prompt. VAD tuned to silence 800ms. |
| Arabic comparison | Two-stage: strip tashkeel for word match (Stage 1), normalize NFD for error type (Stage 2). Built-in unicodedata only — no camel-tools. |
| Privacy vs Tarteel | HifzAI never stores audio. Tarteel uploads every 20s to cloud. Documented as a product advantage. |
| Bismillah handling | Treated as first sequence in full Surah mode, excluded in custom range mode. No special logic. Pace-agnostic. |
| Low volume / whispering | VAD + audio normalization handles any volume. Gentle banner after 4s silence. Never blocks session. |
| Wrong word behavior | Repeat Until Correct — same as Tarteel. Session holds on wrong word until correct or manually skipped. |
| Session summary | Full word-by-word breakdown with what user said vs expected, plus error type label for each wrong word. |
