# API reference

The backend (`backend/main.py`, FastAPI, port 8000) exposes three REST endpoints and one WebSocket. The Next.js app adds one small proxy route. Nothing here needs an account: HifzAI is anonymous by design.

| Endpoint | Kind | Purpose |
|---|---|---|
| `GET /health` | REST | Is the backend ready (Quran data and speech model loaded)? |
| `GET /surah/{n}` | REST | The full structured text of one surah |
| `POST /session` | REST | Save one finished, anonymous session (optional, needs Supabase) |
| `/ws` | WebSocket | The live recitation session |
| `POST /api/session` | Next.js route | Forwards `POST /session` so the browser never talks to Supabase |

Base URLs in development: backend `http://127.0.0.1:8000`, frontend `http://localhost:3000`.

---

## REST

### `GET /health`

Used to check readiness. While the Quran data or the model is still loading, the endpoint answers `503` so a client can poll it.

`200` when ready:

```json
{ "status": "ready", "quranLoaded": true, "modelLoaded": true }
```

`503` while starting (FastAPI wraps the same object in `detail`):

```json
{ "detail": { "status": "starting", "quranLoaded": true, "modelLoaded": false } }
```

### `GET /surah/{n}`

Returns the structured data for surah `n` (1 to 114). The text comes from `backend/quran/quran_data.json`, which is built once from api.quran.com and cached.

```json
{
  "nameSimple": "Al-Fatihah",
  "nameArabic": "الفاتحة",
  "totalAyahs": 7,
  "bismillah": null,
  "ayahs": [
    {
      "ayahNumber": 1,
      "words": [
        {
          "index": 0,
          "text": "بِسْمِ",
          "textStripped": "بسم",
          "codeV1": "ﭑ",
          "page": 1,
          "line": 2,
          "audioUrl": "https://verses.quran.com/wbw/0"
        }
      ],
      "end": { "codeV1": "ﭕ", "page": 1, "line": 2 }
    }
  ]
}
```

- `index` is the word's position inside the surah and is the key used everywhere else (`wordIndex`).
- `text` is the Uthmani text with all marks. `textStripped` is the normalised form the matcher compares against (see [Architecture](ARCHITECTURE.md)).
- `codeV1`, `page` and `line` select the glyph and its place on the Madani Mushaf page; `end` is the ayah-end marker glyph. `bismillah` is `{ "words": [...] }` with the four basmala words (placed in front of the recitation when `includeBismillah` is true), and is `null` for Al-Fatihah, where the basmala is ayah 1 itself.

Errors: `404` `{ "detail": { "error": "Surah not found", "surahNumber": 999 } }`, and `503` `{ "detail": "Quran data not loaded yet" }` during startup. A non-numeric `n` is rejected with `422`.

### `POST /session`

Saves a completed session as one row in the `hifz_sessions` table (see [Database](DATABASE.md)). It stores counts and per-word results only: no audio, no name, no account.

Request body:

```json
{
  "surahNumber": 1,
  "startAyah": 1,
  "endAyah": 7,
  "totalWords": 29,
  "correctCount": 27,
  "wrongCount": 1,
  "skippedCount": 1,
  "wordResults": [
    { "wordIndex": 11, "status": "wrong", "errorType": "wrong_word", "expected": "…", "spoken": "…" },
    { "wordIndex": 17, "status": "skipped" }
  ]
}
```

| Field | Rule |
|---|---|
| `surahNumber` | integer, 1 to 114 |
| `startAyah`, `endAyah` | integers, at least 1, and `endAyah >= startAyah` |
| `totalWords` | integer, at least 1 |
| `correctCount`, `wrongCount`, `skippedCount` | integers, at least 0 |
| `wordResults[].status` | `"correct"`, `"wrong"` or `"skipped"` |
| `wordResults[].errorType` | optional text, see the error types below |

Responses:

| Status | Body | When |
|---|---|---|
| `201` | `{ "sessionId": "<uuid>", "saved": true }` | Row saved |
| `201` | `{ "sessionId": null, "saved": false }` | Supabase is not configured (normal in local development) |
| `422` | FastAPI validation error | A field breaks a rule above |
| `500` | `{ "detail": { "error": "Failed to save session", "saved": false } }` | The insert failed |

The validation rules mirror the database `CHECK` constraints, so a bad request gets a clear `422` instead of a database error.

### `POST /api/session` (Next.js)

`frontend/app/api/session/route.js` takes the same body, forwards it to the backend's `POST /session`, and returns the backend's JSON with status `201`. If the backend call fails, it returns `500 { "error": "Failed to save session" }`. The backend address comes from `PYTHON_BACKEND_URL` (falling back to `NEXT_PUBLIC_PYTHON_BACKEND_URL`, then `http://127.0.0.1:8000`).

---

## WebSocket `/ws`

One WebSocket is one recitation session. The browser connects when the reciter presses **Start Reciting** and closes it when the session ends.

Address: the browser uses `NEXT_PUBLIC_PYTHON_BACKEND_WS` (for example `ws://localhost:8000`) and appends `/ws`. If that variable is empty it uses `ws://<the page's host>:8000/ws`.

### Connecting

| Check | Result |
|---|---|
| The `Origin` header is not in `ALLOWED_ORIGINS` | The server closes with code `1008` before accepting |
| `MAX_CONCURRENT_SESSIONS` (default 10) sessions are already running | The server accepts, sends `{"type":"error","code":"CAPACITY_ERROR",…}`, then closes with `1013` (try again later) |
| Otherwise | The connection is accepted |

### Messages from the browser

**`sessionStart`** (JSON text frame). Sent right after the socket opens, and again after a reconnect.

```json
{
  "type": "sessionStart",
  "surahNumber": 1,
  "startAyah": 1,
  "endAyah": 7,
  "includeBismillah": true,
  "resumeFromWordIndex": 0
}
```

`includeBismillah` defaults to `true`. `resumeFromWordIndex` defaults to `0`; after a dropped connection the browser sends the global word index where the reciter had got to, and the server continues from there.

**Audio** (binary frames). Raw little-endian `Float32` samples, 16 kHz, mono. The browser's AudioWorklet (`frontend/public/audio-processor.js`) resamples the microphone and sends overlapping windows of audio. The server only keeps the newest frame it has not processed yet (see [Architecture](ARCHITECTURE.md)).

**`skipWord`** (JSON). The reciter pressed **Skip**:

```json
{ "type": "skipWord", "wordIndex": 17 }
```

A word that is already correct cannot be skipped.

### Messages from the server

**`wordResult`**: the outcome for one word. A word can be reported again later: a wrong or skipped word becomes `correct` if the reciter goes back and says it properly.

```json
{ "type": "wordResult", "wordIndex": 11, "status": "wrong",
  "word": "ٱلرَّحْمَٰنِ", "spoken": "الرحمن", "errorType": "wrong_word" }
```

| Field | Meaning |
|---|---|
| `wordIndex` | The `index` of the word in the surah data |
| `status` | `correct`, `wrong` or `skipped` |
| `word` | The reference text of the word |
| `spoken` | What the recogniser heard (`null` for a skipped word) |
| `errorType` | Only on `wrong`: `missing_shadda`, `wrong_harakat`, `missing_tanwin`, `wrong_word` or `pronunciation_error` |

**`silenceAlert`**: no speech was detected for 4 seconds. Sent at most once per silent stretch; it clears when speech returns.

```json
{ "type": "silenceAlert", "silenceDurationSeconds": 4 }
```

**`sessionComplete`**: every word in the range now has a result.

```json
{ "type": "sessionComplete",
  "summary": { "totalWords": 29, "correctCount": 27, "wrongCount": 1,
               "skippedCount": 1, "completionRate": 93.1 } }
```

`completionRate` is `correctCount / totalWords` as a percentage with one decimal. The browser also counts the per-word results itself, so the summary screen does not depend on this message alone.

**`error`**:

```json
{ "type": "error", "code": "SESSION_ERROR", "message": "No words found for Surah 1 ayahs 9-12" }
```

| `code` | Cause |
|---|---|
| `CAPACITY_ERROR` | The server is at `MAX_CONCURRENT_SESSIONS` |
| `SESSION_ERROR` | `sessionStart` could not be turned into a word list (for example an ayah range outside the surah) |
| `SERVER_ERROR` | An unexpected failure in the session |

### Reconnecting

If the socket drops without the browser closing it, the client reconnects after 3 seconds, backing off up to 15 seconds, and gives up after 5 failed attempts. On every successful open it sends `sessionStart` again with `resumeFromWordIndex`, so the reciter keeps their place.
