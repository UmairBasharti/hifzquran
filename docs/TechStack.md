# TechStack.md
# HifzAI — Complete Technology Stack
# Every tool, every version, every install command, every reason.
# Last updated: Post audit — all 9 issues resolved.

---

## 1. FRONTEND

### Next.js 16.2.6
- **Why**: Used by Quran.com — matching framework makes integration seamless
- **Router**: App Router ONLY. Never Pages Router.
- **Install**: `npx create-next-app@16.2.6 frontend --no-typescript --use-npm`
- **Run**: `npm run dev` (port 3000)

### React 19.1.7
- Bundled with Next.js 16.2.6 — no separate install

### JavaScript ES2024 — Plain JS Only
- No TypeScript. No .ts .tsx .jsx. No tsconfig.json. Ever.
- async/await always. Never .then() chains.
- Reason: project owner has basic coding experience — TypeScript adds
  friction and blocks progress for non-expert developers.

### Tailwind CSS (latest)
- `npm install -D tailwindcss postcss autoprefixer && npx tailwindcss init -p`
- No custom .css files — utility classes only

### @supabase/supabase-js (latest)
- `npm install @supabase/supabase-js`

---

## 2. BACKEND

### Python 3.13
- camel-tools removed from project — Python 3.13 is unblocked
- `python3.13 -m venv backend/venv`
- Always activate venv before installing or running anything

### FastAPI 0.124.4
- `pip install fastapi==0.124.4`
- All endpoints must be async — never sync def for route handlers

### Uvicorn (latest)
- `pip install uvicorn[standard]`
- Run: `uvicorn main:app --reload --host 0.0.0.0 --port 8000`

### faster-whisper 1.2.1
- `pip install faster-whisper==1.2.1`
- The ONLY permitted ASR engine — no substitutes ever
- Model: `tarteel-ai/whisper-base-ar-quran` (MIT license, ~150MB)
- Downloads automatically from HuggingFace on first run
- CPU mode: `WhisperModel("tarteel-ai/whisper-base-ar-quran", device="cpu", compute_type="int8")`
- GPU mode: `WhisperModel("tarteel-ai/whisper-base-ar-quran", device="cuda", compute_type="float16")`

#### Critical: Always use constrained decoding + tuned VAD
```python
segments, info = whisper_model.transcribe(
    audio_float32_array,
    language="ar",
    vad_filter=True,
    vad_parameters={
        "min_silence_duration_ms": 800,  # default 2000 — too aggressive for Quran
        "speech_pad_ms": 200,
        "threshold": 0.4
    },
    initial_prompt=current_expected_ayah_arabic_text,  # constrained decoding
    beam_size=5
)
```

### Arabic Normalization — unicodedata (Python built-in)
**No camel-tools. No external Arabic library. Zero extra dependencies.**
Python's built-in `unicodedata` module handles all Arabic Unicode normalization.

```python
import unicodedata

# Strip all tashkeel for Stage 1 word root matching
def strip_tashkeel(arabic_text):
    decomposed = unicodedata.normalize('NFD', arabic_text)
    return ''.join(c for c in decomposed if unicodedata.category(c) != 'Mn')

# Normalize encoding for Stage 2 tashkeel error classification
def normalize_arabic(arabic_text):
    return unicodedata.normalize('NFD', arabic_text)
```

### librosa (latest)
- `pip install librosa`
- Used for audio amplitude normalization before ASR
- Ensures consistent model performance across whisper/loud/normal speech

### numpy (latest)
- `pip install numpy` (usually auto-installed as dependency)
- Audio buffer manipulation and Float32 array handling

### python-dotenv (latest)
- `pip install python-dotenv`

### supabase-py (latest)
- `pip install supabase`

### python-levenshtein (latest)
- `pip install python-levenshtein`
- Fast C-based edit distance for wrong-word detection in alignment engine

### httpx (latest)
- `pip install httpx`
- Used by loader.py to fetch quran_data.json from api.quran.com at startup

---

## 3. AUDIO PIPELINE — TECHNICAL REQUIREMENTS

This section is critical. Wrong audio format silently destroys accuracy.

### Why 16kHz Mono
Whisper is trained on 16kHz mono audio. Browsers default to 44.1kHz or 48kHz
stereo. Sending the wrong sample rate causes silent accuracy loss — the model
still returns text but with significantly higher word error rate.

### Browser Audio Setup (always use this exact pattern)
```javascript
// Forces 16kHz mono — the only correct way to capture for Whisper
const audioContext = new AudioContext({ sampleRate: 16000 })
const micStream = await navigator.mediaDevices.getUserMedia({
  audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true }
})
```

### Send Format: Raw Float32 PCM Binary
Do NOT send: MP3, Opus, WebM, or any compressed format.
Send: raw Float32Array binary directly over WebSocket.
Reason: no encoding overhead, no quality loss, faster-whisper reads it natively.

### Sliding Window: 3 Second Window, 1.5 Second Step
Do NOT use fixed hard cuts (every 2-3s). They slice words at boundaries.
Use sliding window with 50% overlap:

```
Window size: 3 seconds = 48,000 samples at 16kHz
Step size:   1.5 seconds (send new chunk every 1.5s)
Overlap:     each chunk includes last 1.5s of previous chunk

Time:  0s    1.5s    3s     4.5s    6s
C1:    [==========]
C2:           [==========]
C3:                  [==========]
```

The alignment engine tracks `last_confirmed_word_index` to deduplicate
results from overlapping chunks.

---

## 4. COMPLETE requirements.txt

```
fastapi==0.124.4
uvicorn[standard]
faster-whisper==1.2.1
librosa
numpy
python-dotenv
supabase
python-levenshtein
websockets
python-multipart
httpx
```

No camel-tools. No torch. No heavy ML dependencies beyond faster-whisper.

---

## 5. COMPLETE package.json

```json
{
  "name": "hifzai-frontend",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "16.2.6",
    "react": "19.1.7",
    "react-dom": "19.1.7",
    "@supabase/supabase-js": "latest"
  },
  "devDependencies": {
    "tailwindcss": "latest",
    "postcss": "latest",
    "autoprefixer": "latest"
  }
}
```

Do NOT add Redux, Zustand, Axios, React Query, or any other library
without explicit approval.

---

## 6. AI MODEL

### tarteel-ai/whisper-base-ar-quran
- **Source**: https://huggingface.co/tarteel-ai/whisper-base-ar-quran
- **License**: MIT — free to use and distribute
- **WER**: ~5.75% on Quranic recitation — production grade
- **Size**: ~150MB — auto-downloads on first run to HuggingFace cache
- **Why this and no other**: Only open-source model fine-tuned on Quranic
  Arabic with tashkeel preservation. General Arabic ASR strips diacritics,
  making tajweed error detection impossible.

---

## 7. QURAN DATA

### api.quran.com (Quran Foundation API)
- Free, no API key required for content endpoints
- Fetched ONCE at Python backend startup → saved to quran_data.json
- Never called during live sessions — only in-memory JSON used at runtime
- Key endpoint: `GET https://api.quran.com/api/v4/verses/by_chapter/{n}?words=true&word_fields=text_uthmani`

### surah_index.json (frontend static file)
- Location: `frontend/public/surah_index.json`
- Size: ~10KB — 114 records (number, nameSimple, nameArabic, ayahCount)
- Generated by: `python backend/quran/generate_surah_index.py` (run once)
- Fetched by browser once at app startup, stored in React state
- Used for client-side search only — never for Quran word text

---

## 8. DATABASE

### Supabase
- Free tier: 500MB DB, sufficient for MVP
- PostgreSQL with built-in RLS — mandatory on every table
- MVP table: hifz_sessions (see docs/Database.md)
- Post-MVP: users table, progress tracking via Supabase Auth

---

## 9. HOSTING

### Development
- Frontend: localhost:3000
- Backend: localhost:8000
- No Docker needed for development

### Production
- Frontend: Vercel (free — auto-deploys from GitHub)
- Backend: Hetzner CX21 (~$5/month) or Hugging Face Spaces
- Database: Supabase cloud free tier

---

## 10. TOOLS NOT USED — AND WHY

| Tool | Rejected Because |
|------|-----------------|
| TypeScript | Project owner uses basic JS. Blocks progress. |
| camel-tools | 200MB install, CMake/Boost deps, Python 3.12 lock. One function replaced by 5 lines of unicodedata. |
| openai/whisper | 4x slower than faster-whisper. Same weights, worse performance. |
| whisper-large-v3 | Not Quran-tuned. Drops tashkeel. Wrong tool. |
| Cloud ASR APIs | Sends audio to third parties — privacy violation. |
| Redux/Zustand | Overkill. React useState is sufficient for MVP. |
| Axios | fetch() is built into every modern browser. |
| Django/Flask | Too heavy / no native async WebSocket. |
| Pages Router | Deprecated. App Router is current standard. |
| Fixed audio chunks | Slices words at boundaries → false errors. Sliding window used instead. |
| Default VAD params | min_silence_duration_ms=2000 too aggressive for Quran. Tuned to 800ms. |

---

## 11. FULL SETUP FROM ZERO

```bash
# Clone
git clone https://github.com/UmairBasharti/hifzai.git && cd hifzai

# Backend
python3.13 -m venv backend/venv
source backend/venv/bin/activate
cd backend && pip install -r requirements.txt

# Generate surah index (run once)
python quran/generate_surah_index.py

# Start backend (downloads Quran + model on first run ~2min)
uvicorn main:app --reload --host 0.0.0.0 --port 8000
# Wait for: "HifzAI backend ready. Quran loaded. Model loaded."

# Frontend (new terminal)
cd frontend && npm install && npm run dev
# Open http://localhost:3000
```

---

## 12. VERSION LOCK POLICY

| Package | Locked | Reason |
|---------|--------|--------|
| faster-whisper | 1.2.1 | ASR output format must not change between sessions |
| FastAPI | 0.124.4 | WebSocket API must be stable |
| Next.js | 16.2.6 | App Router behavior must be predictable |
| Python | 3.13 | |
| All others | latest | Utility packages with stable public APIs |
