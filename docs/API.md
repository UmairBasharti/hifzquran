# API.md
# HifzAI — API Contract
# Every endpoint, every WebSocket message, every JSON shape.
# Read this before writing any frontend or backend code that sends or receives data.
# Frontend and backend must match this contract exactly.

---

## 1. OVERVIEW

HifzAI uses two communication channels:

| Channel | Protocol | Purpose |
|---------|----------|---------|
| REST HTTP | GET/POST | Surah word data, session storage |
| WebSocket | Binary + JSON | Live audio stream, word results |

Base URLs:
- HTTP:      http://localhost:8000 (dev) / https://api.hifzai.com (prod)
- WebSocket: ws://localhost:8000/ws (dev) / wss://api.hifzai.com/ws (prod)

---

## 2. HTTP ENDPOINTS

---

### GET /surah/{surah_number}

Fetches word-by-word data for a single Surah from quran_data.json in memory.
Called once when user opens a Surah page. Never called during live recitation.

**Request**
```
GET /surah/108
```

**Response 200**
```json
{
  "surahNumber": 108,
  "nameSimple": "Al-Kawthar",
  "nameArabic": "الكوثر",
  "totalAyahs": 3,
  "bismillah": {
    "words": [
      { "index": 0, "text": "بِسْمِ",        "textStripped": "بسم" },
      { "index": 1, "text": "اللَّهِ",       "textStripped": "الله" },
      { "index": 2, "text": "الرَّحْمَٰنِ", "textStripped": "الرحمن" },
      { "index": 3, "text": "الرَّحِيمِ",   "textStripped": "الرحيم" }
    ]
  },
  "ayahs": [
    {
      "ayahNumber": 1,
      "words": [
        { "index": 4, "text": "إِنَّا",       "textStripped": "انا" },
        { "index": 5, "text": "أَعْطَيْنَاكَ","textStripped": "اعطيناك" },
        { "index": 6, "text": "الْكَوْثَرَ", "textStripped": "الكوثر" }
      ]
    },
    {
      "ayahNumber": 2,
      "words": [
        { "index": 7, "text": "فَصَلِّ",     "textStripped": "فصل" },
        { "index": 8, "text": "لِرَبِّكَ",   "textStripped": "لربك" },
        { "index": 9, "text": "وَانْحَرْ",   "textStripped": "وانحر" }
      ]
    },
    {
      "ayahNumber": 3,
      "words": [
        { "index": 10, "text": "إِنَّ",       "textStripped": "ان" },
        { "index": 11, "text": "شَانِئَكَ",  "textStripped": "شانئك" },
        { "index": 12, "text": "هُوَ",        "textStripped": "هو" },
        { "index": 13, "text": "الْأَبْتَرُ","textStripped": "الابتر" }
      ]
    }
  ]
}
```

**Notes**:
- `text` — full Uthmani text with tashkeel (used for display and Stage 2 error classification)
- `textStripped` — tashkeel stripped (pre-computed for Stage 1 word matching — saves CPU at runtime)
- `index` — global sequential word index across entire session (bismillah starts at 0)
- Bismillah is always included in the response but only used in full Surah mode

**Response 404**
```json
{ "error": "Surah not found", "surahNumber": 999 }
```

**Response 503**
```json
{ "error": "Quran data not loaded. Backend may still be starting up." }
```

---

### POST /session

Saves an anonymous session result to Supabase after session completes.
Called by Next.js API route — never directly from browser.

**Request body**
```json
{
  "surahNumber": 108,
  "startAyah": 1,
  "endAyah": 3,
  "totalWords": 14,
  "correctCount": 11,
  "wrongCount": 2,
  "skippedCount": 1,
  "wordResults": [
    { "wordIndex": 0,  "status": "correct" },
    { "wordIndex": 5,  "status": "wrong",   "errorType": "missing_shadda",
      "expected": "أَعْطَيْنَاكَ", "spoken": "اعطيناك" },
    { "wordIndex": 11, "status": "skipped" }
  ]
}
```

**Response 201**
```json
{ "sessionId": "uuid-here", "saved": true }
```

**Response 422** — validation error (missing required fields)
```json
{ "error": "Invalid session data", "detail": "surahNumber is required" }
```

---

### GET /health

Simple health check — used by deployment to confirm backend is ready.

**Response 200**
```json
{
  "status": "ready",
  "quranLoaded": true,
  "modelLoaded": true
}
```

**Response 503** — backend still starting
```json
{
  "status": "starting",
  "quranLoaded": false,
  "modelLoaded": false
}
```

---

## 3. WEBSOCKET PROTOCOL

Endpoint: `ws://localhost:8000/ws`

The WebSocket connection handles one complete Hifz session.
It opens when the user clicks "Begin Recitation" and closes when the session ends.
One connection per session — never reopen per chunk.

### Connection Lifecycle

```
Browser                              Python Backend
  |                                       |
  |  WS CONNECT /ws                       |
  |-------------------------------------->|
  |  OPEN                                 |
  |                                       |
  |  MSG 1: JSON session metadata         |
  |-------------------------------------->|
  |                                       |
  |  MSG 2: Binary audio chunk (Float32)  |
  |-------------------------------------->|
  |                                       |  transcribe + align
  |                                       |
  |  MSG: JSON word result                |
  |<--------------------------------------|
  |                                       |
  |  MSG N: Binary audio chunk            |
  |-------------------------------------->|  (repeats...)
  |                                       |
  |  MSG: JSON sessionComplete            |
  |<--------------------------------------|
  |                                       |
  |  WS CLOSE                             |
  |-------------------------------------->|
```

---

### Message 1: Session Metadata (Browser → Python, JSON)

Must be the FIRST message sent after WebSocket connects.
Sent as a JSON string (not binary).

```json
{
  "type": "sessionStart",
  "surahNumber": 108,
  "startAyah": 1,
  "endAyah": 3,
  "includeBismillah": true,
  "totalExpectedWords": 14
}
```

| Field | Type | Description |
|-------|------|-------------|
| type | string | Always "sessionStart" |
| surahNumber | integer | 1–114 |
| startAyah | integer | First Ayah in selected range |
| endAyah | integer | Last Ayah in selected range |
| includeBismillah | boolean | True for full Surah mode, false for custom range |
| totalExpectedWords | integer | Total word count for this session range |

---

### Message 2+: Audio Chunks (Browser → Python, Binary)

Sent every 1.5 seconds (sliding window step).
Format: raw Float32Array binary — 3 seconds of audio = 48,000 Float32 samples at 16kHz.

```javascript
// How to send from browser
const float32Array = new Float32Array(audioBuffer)  // 48000 samples = 3s at 16kHz
webSocket.send(float32Array.buffer)                  // send as ArrayBuffer
```

**Critical requirements**:
- Sample rate: exactly 16kHz
- Channels: mono (1 channel)
- Format: Float32 (values between -1.0 and 1.0)
- Window: 3 seconds (48,000 samples)
- Step: 1.5 seconds (send new chunk every 1.5 seconds with 50% overlap)

---

### Message: Skip Word (Browser → Python, JSON)

Sent when user manually clicks the skip button on a wrong word.
Sent as JSON string.

```json
{
  "type": "skipWord",
  "wordIndex": 5
}
```

Python backend advances session position past wordIndex 5 and marks it skipped.

---

### Message: Word Result (Python → Browser, JSON)

Sent after each audio chunk is processed. May contain multiple word results
if several words were transcribed in one chunk.

**Correct word:**
```json
{
  "type": "wordResult",
  "wordIndex": 4,
  "status": "correct",
  "word": "إِنَّا"
}
```

**Wrong word:**
```json
{
  "type": "wordResult",
  "wordIndex": 5,
  "status": "wrong",
  "word": "أَعْطَيْنَاكَ",
  "spoken": "اعطيناك",
  "errorType": "missing_shadda"
}
```

**Skipped word (after user presses skip):**
```json
{
  "type": "wordResult",
  "wordIndex": 5,
  "status": "skipped",
  "word": "أَعْطَيْنَاكَ"
}
```

**errorType values:**
| Value | Meaning |
|-------|---------|
| `missing_shadda` | Doubled consonant dropped |
| `wrong_harakat` | Wrong short vowel used |
| `missing_tanwin` | Nunation dropped at word end |
| `wrong_word` | Completely different root word |
| `pronunciation_error` | Error detected but type unclear |

---

### Message: Silence Alert (Python → Browser, JSON)

Sent when no speech detected for 4 continuous seconds.

```json
{
  "type": "silenceAlert",
  "silenceDurationSeconds": 4
}
```

Browser shows banner: "Having trouble hearing you — try speaking a little closer to the mic"
Banner auto-dismisses when next wordResult arrives.
Python never sends this more than once every 30 seconds.

---

### Message: Session Complete (Python → Browser, JSON)

Sent after the last expected word in the session range is resolved.

```json
{
  "type": "sessionComplete",
  "summary": {
    "totalWords": 14,
    "correctCount": 11,
    "wrongCount": 2,
    "skippedCount": 1,
    "completionRate": 78
  }
}
```

Browser closes WebSocket and renders summary screen after receiving this.

---

### Message: Error (Python → Browser, JSON)

Sent when backend encounters a fatal error mid-session.

```json
{
  "type": "error",
  "code": "MODEL_ERROR",
  "message": "Whisper model failed to transcribe audio chunk"
}
```

Browser shows error state and offers retry.

---

## 4. NEXT.JS API ROUTES

These are lightweight routes inside Next.js that proxy to Python or call Supabase.
They live in `frontend/app/api/`.

### GET /api/surah/[id]
- Calls Python `GET /surah/{id}`
- Returns Surah word data to the frontend page
- Handles errors from Python and returns appropriate HTTP status

### POST /api/session
- Calls Python `POST /session`
- Saves session result to Supabase
- Called after sessionComplete received from WebSocket

---

## 5. SURAH INDEX (Static File)

Not an API endpoint — a static JSON file served by Next.js.

**Location**: `frontend/public/surah_index.json`
**URL**: `http://localhost:3000/surah_index.json`
**Fetched**: once at app startup by `lib/quran.js`

**Structure** (114 records):
```json
[
  { "number": 1,   "nameSimple": "Al-Fatihah",  "nameArabic": "الفاتحة", "ayahCount": 7 },
  { "number": 2,   "nameSimple": "Al-Baqarah",  "nameArabic": "البقرة",  "ayahCount": 286 },
  ...
  { "number": 114, "nameSimple": "An-Nas",       "nameArabic": "الناس",   "ayahCount": 6 }
]
```

---

## 6. ERROR CODE REFERENCE

| HTTP Code | Meaning |
|-----------|---------|
| 200 | Success |
| 201 | Session saved |
| 404 | Surah not found |
| 422 | Invalid request data |
| 503 | Backend not ready (still loading model or Quran data) |

| WebSocket Error Code | Meaning |
|---------------------|---------|
| MODEL_ERROR | faster-whisper transcription failed |
| ALIGNMENT_ERROR | Alignment engine state corrupted |
| DATA_ERROR | Quran data not available for requested Surah |
| SESSION_ERROR | Session metadata missing or invalid |
