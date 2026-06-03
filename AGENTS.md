<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AGENTS.md — HifzAI Cross-Platform Agent Rules
# Read by Antigravity IDE, Claude Code, Cursor, and any AGENTS.md-compatible agent.
# Mirrors CLAUDE.md — all rules identical. CLAUDE.md is the source of truth.
# Read this file completely before taking any action in this project.
# Every rule here is mandatory. None are optional or suggestions.
# Last updated: 2026-06-04 — aligned with running codebase.

---

## 1. WHAT YOU ARE BUILDING

You are helping build **HifzAI** — a free, open-source Quran memorization
(Hifz) web application that replicates and improves on Tarteel AI's core
feature set, designed to be integrated into Quran.com and gifted to the
global Muslim community at zero cost.

### The Core User Experience
A user opens the app, searches for a Surah by name or number, selects a
custom Ayah range (e.g. Ayah 3 to Ayah 7), and clicks "Start Hifz Mode."
All Arabic text immediately hides — only Ayah numbers remain visible.
The system starts listening to the user's microphone. As the user recites
from memory, each correct word is revealed on screen in real time. Wrong
words, skipped words, and tashkeel errors are flagged instantly with color
and labels — exactly like Tarteel AI, but completely free and open source.

### HifzAI Privacy Advantage Over Tarteel
Tarteel AI stores user audio in the cloud every 20 seconds and uses it
for model training. HifzAI processes audio in memory only and discards
it immediately after transcription — no audio ever stored anywhere.
This is a genuine competitive and ethical advantage. Never compromise it.

### Project Identity
- **Name**: HifzAI
- **GitHub**: https://github.com/UmairBasharti/hifzquran
- **Owner**: Umair Basharti
- **License**: MIT — fully open source
- **Target users**: Global Muslim community, anyone memorizing the Quran
- **Language**: English UI only (MVP)
- **Quran script**: Uthmani only
- **Qira'at**: Hafs 'an 'Asim only

---

## 2. SYSTEM ARCHITECTURE

This project has exactly TWO separate running processes.
They must never be merged into one.

```
+---------------------------------------------------------------------+
|                        USER'S BROWSER                               |
|                   Next.js 16.2.6 Frontend                           |
|                     (JavaScript .js only)                           |
|                                                                     |
|  AUDIO PIPELINE (browser side):                                     |
|  Mic → AudioContext(16kHz, mono) → Float32 PCM chunks               |
|      → resample to 16kHz before sending → WebSocket binary          |
+--------------------+----------------------------+-------------------+
                     |                            |
               HTTP requests              WebSocket stream
               (light tasks only)        (16kHz mono Float32 PCM)
                     |                            |
                     v                            v
       +---------------------+    +----------------------------------+
       |  Next.js API Routes |    |   Python FastAPI (Port 8000)    |
       |                     |    |                                  |
       |  - Supabase queries |    |  - faster-whisper 1.2.1        |
       |  - Surah metadata   |    |    tarteel-ai Quran model       |
       |  - Session state    |    |  - Silero VAD (tuned params)   |
       |  - Auth (Post-MVP)  |    |  - Sliding window + overlap    |
       +---------------------+    |  - Constrained decoding        |
                                  |  - Alignment engine            |
                                  |  - Tajweed checker             |
                                  |  - quran_data.json (in RAM)   |
                                  +----------------------------------+
```

### Responsibility Split — Never Violate This

| Responsibility | Lives In | Never In |
|----------------|----------|----------|
| Microphone capture | Next.js — Web Audio API | Python |
| Audio resampling to 16kHz | Next.js — before WebSocket send | Python |
| Sending 16kHz mono Float32 chunks | Next.js WebSocket client | — |
| ASR transcription | Python — faster-whisper | Next.js |
| VAD (voice activity detection) | Python — Silero via faster-whisper | Next.js |
| Sliding window overlap logic | Python — websocket_handler.py | Next.js |
| Constrained decoding (initial_prompt) | Python — whisper_engine.py | Next.js |
| Word alignment and error detection | Python — alignment/engine.py | Next.js |
| Two-stage Arabic comparison | Python — alignment/engine.py | Next.js |
| Tajweed signal processing | Python — tajweed/checker.py | Next.js |
| Displaying results to user | Next.js — React components | Python |
| Supabase queries | Next.js API routes | Python |
| Quran text at runtime | Python — in-memory JSON | api.quran.com calls |
| surah_index.json for search | Next.js — /public/surah_index.json | Python |

---

## 3. TECH STACK — EXACT VERSIONS

### Frontend
| Tool | Version | Notes |
|------|---------|-------|
| Next.js | 16.2.6 | App Router ONLY — never Pages Router |
| React | 19.2.4 | |
| JavaScript | ES2024 | Plain JS ONLY — zero TypeScript |
| Tailwind CSS | latest | No custom .css files |
| @supabase/supabase-js | latest | |

### Backend
| Tool | Version | Notes |
|------|---------|-------|
| Python | 3.13 | |
| FastAPI | 0.124.4 | Async throughout — never sync |
| Uvicorn | latest | |
| faster-whisper | 1.2.1 | Only permitted ASR engine |
| supabase-py | latest | |
| (amplitude normalization is handled with numpy — no librosa needed) | | |
| numpy | latest | |
| python-dotenv | latest | |
| python-levenshtein | latest | Word distance comparison |

### Arabic Normalization — Built-In Python Only
**No camel-tools. No external Arabic NLP library.**
Arabic Unicode normalization is handled entirely by Python's built-in
`unicodedata` module — zero external dependencies.

```python
import unicodedata

# Strips all tashkeel (diacritics) from Arabic text for word matching
def strip_tashkeel(arabic_text):
    normalized = unicodedata.normalize('NFD', arabic_text)
    stripped = ''.join(
        character for character in normalized
        if unicodedata.category(character) != 'Mn'
    )
    return stripped

# Returns NFD-normalized Arabic text (tashkeel preserved, encoding standardized)
def normalize_arabic(arabic_text):
    return unicodedata.normalize('NFD', arabic_text)
```

### Infrastructure
| Tool | Role |
|------|------|
| Supabase | PostgreSQL + auth |
| api.quran.com | Quran text source — startup only |

---

## 4. AUDIO PIPELINE — CRITICAL TECHNICAL RULES

These rules exist because whisper models are trained on 16kHz mono audio.
Sending the wrong format silently destroys accuracy.

### Rule: Always Capture at 16kHz Mono in the Browser

```javascript
// CORRECT — forces 16kHz mono AudioContext
const audioContext = new AudioContext({ sampleRate: 16000 })
const microphoneStream = await navigator.mediaDevices.getUserMedia({
  audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true }
})
```

```javascript
// WRONG — uses device default (44.1kHz or 48kHz)
const audioContext = new AudioContext()
```

### Rule: Send Float32 PCM, Not Compressed Audio

Do not send MP3, Opus, or WebM audio over the WebSocket.
Send raw Float32 PCM binary data directly — no encoding/decoding overhead.

### Rule: Use Sliding Window With Overlap — Never Hard Fixed Cuts

Fixed 2-3 second hard cuts will slice words at boundaries and cause false
errors. Use a sliding window instead:
- Window size: 6 seconds of audio
- Step size: 0.8 seconds (overlapping updates)
- Each chunk contains the last 5.2 seconds of the previous chunk
- The alignment engine deduplicates results from overlapping windows

```
Time: 0s       0.8s      1.6s        2.4s
Chunk 1: [========================]
Chunk 2:         [========================]
Chunk 3:                 [========================]
```

### Rule: Do NOT Use initial_prompt — Quran-Fine-Tuned Model Only

**Tested and proven**: passing the expected Ayah text as `initial_prompt`
caused Whisper to **parrot it back from silence/noise**, making words turn
green before the user actually recited. The Quran-fine-tuned model
(`OdyAsh/faster-whisper-base-ar-quran`) already recognizes Quranic vocabulary
without that crutch. Rely on the alignment engine (which only advances on
matching words) to reject stray/hallucinated text.

```python
# CORRECT — let the fine-tuned model transcribe freely, alignment guards accuracy
segments, info = whisper_model.transcribe(
    audio_chunk_float32,
    language="ar",
    beam_size=whisper_beam_size,
    condition_on_previous_text=False,
    vad_filter=True,
    vad_parameters={"min_silence_duration_ms": 800, "speech_pad_ms": 200, "threshold": 0.4},
    no_speech_threshold=0.3,
)

# WRONG — initial_prompt causes hallucination from silence
segments, info = whisper_model.transcribe(
    audio_chunk_float32, language="ar",
    initial_prompt=expected_ayah_text  # DO NOT DO THIS
)
```

### Rule: Tune VAD Parameters for Quran Recitation

faster-whisper's default VAD parameters are tuned for general speech.
Quran recitation has longer pauses between words and Ayahs. Override:

```python
whisper_model.transcribe(
    audio_chunk,
    language="ar",
    vad_filter=True,
    vad_parameters={
        "min_silence_duration_ms": 800,   # default 2000 — too aggressive for Quran
        "speech_pad_ms": 200,             # default 400 — pad around speech segments
        "threshold": 0.4                  # default 0.5 — slightly more sensitive
    },
    initial_prompt=current_expected_ayah_arabic_text
)
```

---

## 5. ARABIC COMPARISON — TWO-STAGE APPROACH

All Arabic word comparison uses a two-stage process. Never compare raw strings.

### Stage 1 — Word Matching (strips tashkeel)
Determines whether the user said the right word at all.

```python
# Compares two Arabic words ignoring tashkeel — determines correct vs wrong word
def words_match_root(expected_word, spoken_word):
    stripped_expected = strip_tashkeel(expected_word)
    stripped_spoken = strip_tashkeel(spoken_word)
    return stripped_expected == stripped_spoken
```

### Stage 2 — Error Classification (keeps tashkeel)
Only runs when Stage 1 says the root word matches but something is wrong,
or when performing fine-grained tajweed error type detection.

```python
# Classifies the tajweed error type by comparing normalized tashkeel
def classify_tajweed_error(expected_word, spoken_word):
    normalized_expected = normalize_arabic(expected_word)
    normalized_spoken = normalize_arabic(spoken_word)
    # compare character by character for diacritic differences
    # returns: "missing_shadda", "wrong_harakat", "missing_tanwin", "wrong_word"
```

---

## 6. DIRECTORY STRUCTURE

```
hifzquran/
├── CLAUDE.md
├── AGENTS.md
├── README.md
├── .gitignore
│
├── docs/
│   ├── PRD.md
│   ├── Architecture.md
│   ├── TechStack.md
│   ├── API.md
│   ├── QuranData.md
│   ├── Database.md
│   ├── UIUX.md
│   ├── Deployment.md
│   └── Security.md
│
├── frontend/
│   ├── .env.local                          (frontend secrets — never commit)
│   ├── app/
│   │   ├── layout.js
│   │   ├── page.js                         (Surah search and selector)
│   │   ├── error.js                        (Error boundary)
│   │   ├── loading.js                      (Loading skeleton)
│   │   ├── not-found.js                    (404 page)
│   │   ├── hifz/
│   │   │   └── [id]/
│   │   │       └── page.js                 (Hifz session page)
│   │   └── api/
│   │       └── session/
│   │           └── route.js                (Session save proxy to backend)
│   ├── components/
│   │   ├── SurahSelector/
│   │   │   └── SurahSelector.js
│   │   └── HifzSession/
│   │       ├── HifzSession.js              (WebSocket + audio capture + mode switching)
│   │       ├── WordRenderer.js             (QCF Mushaf glyph rendering)
│   │       ├── AudioPlayer.js              (Listen mode — multi-qari recitation playback)
│   │       └── SessionSummary.js           (End-of-session results + tajweed breakdown)
│   ├── lib/
│   │   ├── audio.js                        (AudioRecorder — 16kHz AudioWorklet capture)
│   │   ├── websocket.js                    (WebSocket client — auto-reconnect)
│   │   ├── quran.js                        (Surah index search/filter)
│   │   ├── surah_meanings.js               (English translations of 114 surah names)
│   │   └── supabase.js
│   └── public/
│       ├── audio-processor.js              (AudioWorklet — ring buffer + downsampling)
│       ├── surah_index.json                (114 records — generated by generate_surah_index.py)
│       └── fonts/                          (Uthmani + 604 QCF page fonts)
│
└── backend/
    ├── .env                                (backend secrets — never commit)
    ├── main.py
    ├── websocket_handler.py                (WebSocket session + sliding window dispatch)
    ├── supabase_db.py                      (Optional Supabase client)
    ├── asr/
    │   └── whisper_engine.py               (Whisper model + VAD + noise gate)
    ├── alignment/
    │   └── engine.py                       (Fuzzy alignment + backtracking + stuck detection)
    ├── quran/
    │   ├── loader.py                       (Quran data fetch + cache)
    │   ├── normalization.py                (Arabic normalization — strip/fold/alef)
    │   ├── generate_surah_index.py         (run once — outputs frontend/public/surah_index.json)
    │   └── quran_data.json                 (auto-generated, gitignored)
    ├── tajweed/
    │   └── checker.py
    └── requirements.txt
```

---

## 7. HARD RULES — NEVER BREAK THESE

### Language Rules
1. **JavaScript only** — .js extension everywhere in frontend. No .ts, .tsx, .jsx, tsconfig.json
2. **App Router only** — all pages in app/. No pages/ directory ever.

### Audio Rules
3. **Always capture at 16kHz mono** — AudioContext({ sampleRate: 16000 }) always
4. **Sliding window overlap** — 6s window, 0.8s step. Never hard fixed cuts.
5. **Never use initial_prompt** — causes hallucination; the fine-tuned model doesn't need it
6. **Tuned VAD parameters** — always override defaults (min_silence_duration_ms: 800)
7. **Never store audio** — process in memory, discard immediately after transcription

### Arabic Rules
8. **Two-stage comparison always** — Stage 1: strip tashkeel for word match. Stage 2: compare normalized tashkeel for error type
9. **Never compare raw Arabic strings** — always use unicodedata.normalize('NFD') first
10. **Always RTL on Arabic text** — dir="rtl" lang="ar" on every Arabic container

### Code Style Rules
11. **async/await always** — never .then() .catch() anywhere
12. **Full descriptive names** — never res, req, cb, fn, val, tmp, e
13. **One comment per function** — plain English above every function
14. **Multi-line readable code** — never one-liner chains for the sake of brevity
15. **Max 2 levels of nesting** — extract to named functions if deeper
16. **Descriptive catch messages** — state exactly what failed in every catch block
17. **Simple over clever** — junior developer must be able to read and debug every line

### Data Rules
18. **No camel-tools** — use Python's built-in unicodedata only
19. **No Quran fetch at runtime** — quran_data.json loaded at startup, used from memory
20. **No hardcoded secrets** — .env.local (frontend) and .env (backend) only
21. **Supabase RLS on every table** — no exceptions

### Scope Rules
22. **MVP only** — no user accounts, dashboards, history until explicitly instructed
23. **ASR model locked** — OdyAsh/faster-whisper-base-ar-quran (or env override), no substitutes

---

## 8. MVP FEATURES

- [x] Surah search and selection by name or number (all 114 Surahs)
- [x] Custom Ayah range selection (start Ayah to end Ayah)
- [x] Hifz Mode — all Arabic text hidden, only Ayah numbers visible
- [x] Live mic at 16kHz mono via sliding window WebSocket chunks
- [x] ASR transcription (fine-tuned Quran Whisper, no initial_prompt — see §4)
- [x] Real-time word-by-word reveal as user recites correctly
- [x] Two-stage word error detection (root match + tashkeel error type)
- [x] Basic tajweed error classification in feedback
- [x] Repeat Until Correct — session holds on wrong word until corrected or skipped
- [x] Session summary with word-by-word breakdown
- [x] Three session modes — Listen / Read / Memorize (Hifz)
- [x] Listen mode — recitation audio playback with word-by-word highlight and **reciter (qari)
      selection (12 reciters)**. This is audio *playback* only and does not change the ASR:
      recitation-checking remains Hafs 'an 'Asim only (see §1). Word timings + audio come from
      api.quran.com at request time (audio is not Quran text, so it is exempt from the
      "no runtime Quran fetch" rule).

## POST-MVP — DO NOT BUILD YET
- User accounts / auth / dashboard / history
- Mobile app / multilingual UI
- Per-Surah offline mode (IndexedDB cache) — DEFERRED. The core Hifz loop depends on the live
  ASR WebSocket to the Python backend, so true offline recitation-checking is impossible without
  on-device ASR. An IndexedDB/Cache-API store of the surah JSON + QCF page fonts would only enable
  offline *reading*, not Hifz. Revisit only when on-device/WASM ASR is on the table.

---

## 9. TESTING ORDER

```
Phase 1: Surah Al-Kawthar  (Ch. 108 — 3 Ayahs) — end-to-end system validation
Phase 2: Surah Al-Ikhlas   (Ch. 112 — 4 Ayahs)
Phase 3: Surah Al-Falaq    (Ch. 113 — 5 Ayahs)
Phase 4: Surah Al-Nas      (Ch. 114 — 6 Ayahs)
Phase 5: Full Quran        — ONLY after all 4 above pass correctly
```

---

## 10. DOCS TO READ BEFORE TOUCHING RELATED CODE

| Before working on | Read |
|-------------------|------|
| Any API endpoint | docs/API.md |
| Database / Supabase | docs/Database.md |
| Any UI component | docs/UIUX.md |
| Arabic text / Quran data | docs/QuranData.md |
| Docker / deployment | docs/Deployment.md |
| Audio handling / privacy | docs/Security.md |
| System design | docs/Architecture.md |

---

## 11. QUICK REFERENCE TABLE

| Rule | Never | Always |
|------|-------|--------|
| Language | .ts .tsx .jsx TypeScript | .js plain JavaScript |
| Router | Pages Router | App Router |
| Async | .then() .catch() | async/await + try/catch |
| Names | res req cb fn val e | Full descriptive English |
| Code density | One-liner chains | Multi-line readable |
| Nesting | More than 2 levels | Extract to named functions |
| Catch messages | console.error(e) | Specific descriptive message |
| ASR model | Any other model | OdyAsh/faster-whisper-base-ar-quran |
| Audio format | 44.1kHz stereo compressed | 16kHz mono Float32 PCM |
| Audio chunking | Fixed hard cuts | 6s sliding window 0.8s step |
| Decoding | initial_prompt (causes hallucination) | Open decoding + alignment guard |
| VAD params | Default faster-whisper params | Quran-tuned (silence 800ms) |
| Arabic comparison | Raw string equality | Two-stage: strip then normalize |
| Arabic display | LTR, no lang/dir | dir="rtl" lang="ar" always |
| Arabic library | camel-tools | unicodedata built-in only |
| Audio storage | Store or log anywhere | Process in memory, discard |
| Quran fetch | At runtime during session | Startup only into quran_data.json |
| Secrets | Hardcoded anywhere | .env.local and .env only |
| Database | Tables without RLS | RLS on every table |
| Scope | Post-MVP features | MVP list only |

