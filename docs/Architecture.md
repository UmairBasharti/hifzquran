# Architecture.md
# HifzAI — System Architecture
# Read this before writing any code that crosses the frontend/backend boundary.
# Last updated: Post audit — all 9 issues resolved.

---

## 1. THE CORE PRINCIPLE

  The browser handles what the user sees and hears.
  Python handles everything AI and audio processing.
  They talk to each other. They never become one.

---

## 2. SYSTEM OVERVIEW

```
+================================================================+
|                     LAYER 1: BROWSER                          |
|                Next.js 16.2.6 (JavaScript only)               |
|                                                               |
|  AUDIO PIPELINE (browser side — critical):                    |
|  Mic → AudioContext({ sampleRate: 16000 }) → mono Float32    |
|      → 3s sliding window, 1.5s step (50% overlap)            |
|      → binary WebSocket → Python backend                      |
|                                                               |
|  +-----------------+  +------------------+  +--------------+  |
|  | Surah Selector  |  |   Hifz Mode UI   |  | Mic Button   |  |
|  | (search + list) |  | (word reveal,    |  | (start/stop) |  |
|  |                 |  |  error colors)   |  |              |  |
|  +-----------------+  +------------------+  +--------------+  |
+===========+====================+===============================+
            |                    |
       HTTP requests        WebSocket
       (surah data)     (16kHz mono Float32 PCM chunks)
            |                    |
+===========+====================+===============================+
|              LAYER 2: PYTHON BACKEND (FastAPI 0.124.4)        |
|                                                               |
|  +------------------+  +----------------------------------+   |
|  | HTTP /surah/{n}  |  | WebSocket ws://host:8000/ws      |   |
|  | (word data from  |  |                                  |   |
|  |  quran_data.json)|  | 1. Receive Float32 audio chunk   |   |
|  +------------------+  | 2. Silero VAD (tuned params)    |   |
|                         | 3. faster-whisper transcribe    |   |
|                         |    (constrained + initial_prompt)|  |
|                         | 4. Alignment engine             |   |
|                         |    (two-stage Arabic compare)   |   |
|                         | 5. Deduplication               |   |
|                         | 6. Send word result JSON       |   |
|                         +----------------------------------+   |
|                                                               |
|  quran_data.json — loaded fully into RAM at startup          |
+==============================================================+
            |
+===========+====================+===============================+
|              LAYER 3: SUPABASE (PostgreSQL)                   |
|  hifz_sessions table — anonymous session results (MVP)        |
+================================================================+
```

---

## 3. RESPONSIBILITY SPLIT

| Task | Process | Forbidden In |
|------|---------|--------------|
| Mic capture | Next.js — Web Audio API | Python |
| Resample to 16kHz mono | Next.js — AudioContext({ sampleRate: 16000 }) | Python |
| Sliding window chunking | Next.js — HifzMode.js | Python |
| Send Float32 PCM binary | Next.js — websocket.js | Python |
| Silero VAD | Python — via faster-whisper | Next.js |
| ASR transcription | Python — faster-whisper | Next.js |
| Constrained decoding | Python — whisper_engine.py | Next.js |
| Sliding window deduplication | Python — websocket_handler.py | Next.js |
| Word alignment | Python — alignment/engine.py | Next.js |
| Two-stage Arabic comparison | Python — alignment/engine.py | Next.js |
| Tajweed error classification | Python — tajweed/checker.py | Next.js |
| Display results | Next.js — AyahDisplay.js | Python |
| Supabase queries | Next.js API routes | Python |
| Quran text at runtime | Python — in-memory JSON | api.quran.com |

---

## 4. AUDIO PIPELINE — DETAILED

This is the most critical part of the system. Wrong audio format = silent accuracy failure.

### Browser Side (Next.js — HifzMode.js)

```
Step 1: Create AudioContext at exactly 16kHz
  const audioContext = new AudioContext({ sampleRate: 16000 })

Step 2: Open mic stream — mono, 16kHz, echo cancellation on
  const micStream = await navigator.mediaDevices.getUserMedia({
    audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true }
  })

Step 3: Connect mic to ScriptProcessor or AudioWorklet node
  → Accumulate Float32 samples into a rolling buffer

Step 4: Sliding window — every 1.5 seconds:
  → Take last 3 seconds of buffer (= 3s window, 1.5s step, 50% overlap)
  → Send as raw Float32Array binary over WebSocket

  Time: 0s    1.5s    3s     4.5s    6s
  C1:   [==========]
  C2:          [==========]
  C3:                 [==========]
```

**Why 16kHz**: Whisper is trained on 16kHz. Sending 44.1kHz causes silent accuracy loss.
**Why Float32 PCM**: No encoding overhead, no quality loss, faster-whisper reads it directly.
**Why sliding window**: Fixed hard cuts slice words at boundaries → false red highlights.

### Python Side (websocket_handler.py + whisper_engine.py)

```
Step 1: Receive Float32 binary chunk from WebSocket
Step 2: Convert bytes → numpy float32 array
Step 3: Run Silero VAD with tuned parameters:
  - min_silence_duration_ms: 800  (not default 2000 — too aggressive for Quran)
  - speech_pad_ms: 200
  - threshold: 0.4
  → If no speech: send silence notification, increment silence counter
  → If speech: proceed to Step 4

Step 4: Transcribe with constrained decoding:
  segments = whisper_model.transcribe(
    audio_array,
    language="ar",
    vad_filter=True,
    vad_parameters={ min_silence_duration_ms: 800, speech_pad_ms: 200 },
    initial_prompt=current_expected_ayah_text,  ← constrained decoding
    beam_size=5
  )

Step 5: Deduplicate — ignore any word index already confirmed in previous chunks
Step 6: Run alignment engine on new transcribed words
Step 7: Send word result JSON back over WebSocket
Step 8: Discard audio array — never store
```

---

## 5. TWO-STAGE ARABIC COMPARISON

### Why Two Stages

A user might say "الرَّحِيمِ" with the correct root word but wrong harakat.
Single-stage comparison would just say "wrong" — unhelpful.
Two-stage tells them exactly what type of error they made.

### Stage 1 — Word Matching (strips all tashkeel)

```python
import unicodedata

# Strips all diacritics from Arabic text for root word comparison
def strip_tashkeel(arabic_text):
    decomposed = unicodedata.normalize('NFD', arabic_text)
    stripped = ''.join(
        char for char in decomposed
        if unicodedata.category(char) != 'Mn'
    )
    return stripped

# Stage 1: Do the root words match regardless of tashkeel?
def words_match_root(expected_word, spoken_word):
    return strip_tashkeel(expected_word) == strip_tashkeel(spoken_word)
```

Result: correct / wrong_word / skipped

### Stage 2 — Error Type Classification (normalized tashkeel)

Only runs when Stage 1 says root matches OR to classify wrong_word type:

```python
# Normalizes Arabic text preserving tashkeel in consistent encoding
def normalize_arabic(arabic_text):
    return unicodedata.normalize('NFD', arabic_text)

# Stage 2: What type of tashkeel error was made?
def classify_error(expected_word, spoken_word):
    norm_expected = normalize_arabic(expected_word)
    norm_spoken = normalize_arabic(spoken_word)
    # compare character by character for diacritic differences
    # returns: "missing_shadda" | "wrong_harakat" | "missing_tanwin" | "wrong_word"
```

**No camel-tools. No external Arabic library. Python built-in unicodedata only.**

---

## 6. COMPONENT ARCHITECTURE — FRONTEND

```
app/page.js
  → fetches /public/surah_index.json once at mount (114 records, ~10KB)
  → renders <SurahSelector surahList={...} />

app/hifz/[surahId]/page.js
  → fetches word data from /api/surah/[surahId] on mount
  → owns all session state: hifzActive, wordStates, wordDetails, sessionComplete
  → renders <AyahDisplay />, <HifzMode />, <MicButton />, summary screen

components/SurahSelector/SurahSelector.js
  → props: surahList
  → client-side filter on every keystroke — no network call
  → on click: navigate to /hifz/[surahId]

components/AyahDisplay/AyahDisplay.js
  → props: ayahs, wordStates, hifzActive, selectedRange
  → renders each word: hidden | green | red | yellow
  → dir="rtl" lang="ar" on every Arabic container — no exceptions

components/HifzMode/HifzMode.js
  → owns: AudioContext({ sampleRate: 16000 }), WebSocket connection
  → owns: sliding window buffer (3s window, 1.5s step)
  → sends: Float32Array binary chunks over WebSocket
  → receives: word result JSON from Python
  → calls: onWordResult(result) callback to update parent state
  → manages: VAD silence timer (4s banner trigger)

components/MicButton/MicButton.js
  → props: isRecording, onStart, onStop
  → UI only — pulsing animation when recording
  → never touches audio logic

lib/websocket.js
  → exports: openHifzSession(surahNumber, startAyah, endAyah)
  → handles: reconnection on drop (retry every 3s)
  → sends: first JSON message with session metadata, then binary audio

lib/quran.js
  → exports: fetchSurahIndex() — fetches surah_index.json once
  → exports: filterSurahs(query, list) — client-side search filter
```

---

## 7. MODULE ARCHITECTURE — PYTHON BACKEND

```
main.py
  → FastAPI entry point
  → startup event: load quran_data.json → RAM, load whisper model
  → if either fails: log error and exit — never start with broken data

websocket_handler.py
  → WebSocket endpoint ws://host:8000/ws
  → receives: JSON session metadata (first message), then binary audio
  → manages: sliding window deduplication state per session
  → calls: whisper_engine.transcribe(), alignment.process()
  → sends: word results, silence alerts, sessionComplete
  → rule: discard audio immediately after transcribe() returns

asr/whisper_engine.py
  → loads tarteel-ai/whisper-base-ar-quran at startup via faster-whisper
  → exports: transcribe_audio_chunk(audio_array, expected_ayah_text)
  → always uses: language="ar", vad_filter=True, tuned VAD params, initial_prompt
  → CPU mode: compute_type="int8" | GPU mode: compute_type="float16"

alignment/engine.py
  → exports: create_session(surah_number, start_ayah, end_ayah, include_bismillah)
  → exports: process_transcription(session, transcribed_text) → [WordResult]
  → exports: skip_word(session, word_index) → updated session
  → uses: two-stage comparison (strip_tashkeel for match, normalize for error type)
  → uses: python-levenshtein for wrong_word detection
  → maintains: last_confirmed_index for deduplication across overlapping chunks

quran/loader.py
  → checks for quran_data.json on startup
  → if missing: fetches from api.quran.com, saves to disk
  → loads into memory: QURAN_DATA dict (module-level, shared across requests)
  → exports: get_surah(surah_number), get_word_list(surah_number, start, end)
  → rule: api.quran.com called HERE ONLY, ONCE at startup

quran/generate_surah_index.py
  → run manually once: python generate_surah_index.py
  → reads quran_data.json, outputs frontend/public/surah_index.json
  → 114 records: { number, nameSimple, nameArabic, ayahCount }
  → must be run before starting frontend for the first time

tajweed/checker.py
  → exports: classify_error(expected_word, spoken_word) → error_type string
  → uses: unicodedata two-stage comparison
  → returns: "missing_shadda"|"wrong_harakat"|"missing_tanwin"|"wrong_word"|"pronunciation_error"
```

---

## 8. STATE MANAGEMENT — FRONTEND

React useState only. No Redux, Zustand, or external state library.
All session state lives in app/hifz/[surahId]/page.js:

```
surahData         — word list for current Surah
selectedRange     — { startAyah: N, endAyah: N }
hifzModeActive    — boolean
isRecording       — boolean
wordStates        — { [wordIndex]: "correct"|"wrong"|"skipped" }
wordDetails       — { [wordIndex]: { spoken, expected, errorType } }
silenceWarning    — boolean (4s silence detected)
sessionComplete   — boolean
sessionSummary    — { correct, wrong, skipped, words: [...] }
```

Rule: never mutate wordStates directly.
Always: `setWordStates(prev => ({ ...prev, [wordIndex]: newStatus }))`

---

## 9. SUPABASE — MVP SCHEMA

```
Table: hifz_sessions
  id            uuid        primary key, auto-generated
  created_at    timestamp   when session ran
  surah_number  integer     1-114
  start_ayah    integer     custom range start
  end_ayah      integer     custom range end
  total_words   integer
  correct_count integer
  wrong_count   integer
  skipped_count integer
  word_results  jsonb       [{ wordIndex, status, errorType }]

RLS: anyone can INSERT (anonymous). No one can SELECT others' sessions.
```

---

## 10. ENVIRONMENT VARIABLES

```
frontend/.env.local
  NEXT_PUBLIC_SUPABASE_URL=...
  NEXT_PUBLIC_SUPABASE_ANON_KEY=...
  NEXT_PUBLIC_PYTHON_BACKEND_URL=http://localhost:8000
  NEXT_PUBLIC_PYTHON_BACKEND_WS=ws://localhost:8000

backend/.env
  SUPABASE_URL=...
  SUPABASE_SERVICE_ROLE_KEY=...
  QURAN_API_BASE_URL=https://api.quran.com/api/v4
  MODEL_NAME=tarteel-ai/whisper-base-ar-quran
```

---

## 11. STARTUP SEQUENCE

```
Terminal 1 — Python backend (start first):
  cd backend && source venv/bin/activate
  python quran/generate_surah_index.py   ← run ONCE on first setup
  uvicorn main:app --reload --host 0.0.0.0 --port 8000
  → Downloads quran_data.json if missing (~30s, one time only)
  → Loads whisper model (~150MB, one time only)
  → Log: "HifzAI backend ready. Quran loaded. Model loaded."

Terminal 2 — Next.js frontend (start second):
  cd frontend && npm install && npm run dev
  → Starts at http://localhost:3000
```

---

## 12. ERROR STATES

| Failure | User Sees | System Does |
|---------|-----------|-------------|
| Mic permission denied | "Microphone access needed" | Session cannot start |
| WebSocket fails | "Connecting..." spinner | Auto-retry every 3s |
| WebSocket drops mid-session | "Reconnecting..." banner | Auto-retry every 3s |
| Python backend offline | "Unable to load Surah" | HTTP 503 |
| Audio too quiet (4s silence) | "Try speaking closer to mic" | Session continues waiting |
| Empty ASR output | (silent) | Treated as silence, counter increments |
| quran_data.json missing | Server refuses to start | Log error, exit process |
| Whisper model fails to load | Server refuses to start | Log error, exit process |
