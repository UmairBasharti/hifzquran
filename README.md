# HifzAI — Free, Open-Source Quran Memorization

**HifzAI** is a free, open-source Quran memorization (Hifz) web app that helps you test and strengthen your memorization in real time. Press the mic, recite from memory — HifzAI listens, hides the text, and reveals each word as you get it right, instantly flagging mistakes.

Built to replicate and improve on [Tarteel AI](https://tarteel.ai)'s core feature set, designed to be gifted to the global Muslim community at zero cost.

> **Privacy first**: Unlike Tarteel, HifzAI processes all audio in memory only and discards it immediately after transcription — no audio is ever stored anywhere.

---

## Features

- **Surah search & selection** — all 114 Surahs, searchable by name, number, or Arabic
- **Custom ayah range** — choose exactly which ayahs to practice (e.g., Ayah 3 to 7)
- **Three session modes**:
  - 🎧 **Listen** — follow along with professional Qari recitation (12 reciters available)
  - 📖 **Read** — read the Uthmani text with word-by-word tracking
  - 🧠 **Memorize (Hifz)** — text hides, reveals word-by-word as you recite correctly
- **Real-time ASR** — Quran-fine-tuned Whisper model transcribes your recitation live
- **Word-by-word feedback** — correct (green), wrong (red), skipped (amber)
- **Tajweed error detection** — identifies missing shadda, wrong harakat, missing tanwin
- **Backtracking** — go back and fix a mistake, the word re-marks as correct
- **Session summary** — detailed word-by-word breakdown with "How to fix it" tips
- **Authentic Mushaf layout** — QCF v1 page fonts render the exact Madani-Mushaf glyphs

---

## Architecture

HifzAI has **two separate processes** that run side by side:

| Process | Tech | Port | Role |
|---------|------|------|------|
| **Frontend** | Next.js 16 (App Router) | 3000 | UI, mic capture, WebSocket client |
| **Backend** | Python FastAPI | 8000 | ASR (faster-whisper), alignment, tajweed |

The browser captures mic audio at 16kHz mono, streams it via WebSocket to the Python backend, which runs a Quran-fine-tuned Whisper model and returns word-by-word results in real time.

---

## Quick Start

### Prerequisites

- **Python 3.11+** (3.13 recommended)
- **Node.js 18+**
- **A microphone** (for Hifz mode)

### 1. Clone the repo

```bash
git clone https://github.com/UmairBasharti/hifzquran.git
cd hifzquran
```

### 2. Start the backend

```bash
cd backend

# Create a virtual environment
python -m venv venv

# Activate it
# Windows:
.\venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start the server
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

On first startup, the backend will:
1. Download the Quran text from api.quran.com (~60-90s, one-time only)
2. Download the Whisper model from HuggingFace (~500MB, one-time only)

### 3. Start the frontend

Open a **new terminal**:

```bash
cd frontend

# Install dependencies
npm install

# Start the dev server
npm run dev
```

### 4. Open in browser

Go to **[http://localhost:3000](http://localhost:3000)**, pick a Surah, and start reciting!

---

## Environment Variables

### Frontend (`frontend/.env.local`)

```env
NEXT_PUBLIC_PYTHON_BACKEND_URL=http://127.0.0.1:8000
NEXT_PUBLIC_PYTHON_BACKEND_WS=ws://127.0.0.1:8000
NEXT_PUBLIC_SUPABASE_URL=           # optional
NEXT_PUBLIC_SUPABASE_ANON_KEY=      # optional
```

### Backend (`backend/.env`)

```env
QURAN_API_BASE_URL=https://api.quran.com/api/v4
MODEL_NAME=OdyAsh/faster-whisper-base-ar-quran
PORT=8000
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
SUPABASE_URL=                       # optional
SUPABASE_SERVICE_ROLE_KEY=          # optional
```

Supabase is optional — the app works fully without it (session saving is disabled).

---

## Project Structure

```
hifzquran/
├── frontend/                      # Next.js 16 (App Router, JavaScript only)
│   ├── app/
│   │   ├── page.js                # Home — Surah search & selection
│   │   ├── hifz/[id]/page.js      # Hifz session page
│   │   └── api/session/route.js   # Session save proxy
│   ├── components/
│   │   ├── HifzSession/           # Core session UI (HifzSession, WordRenderer, AudioPlayer, SessionSummary)
│   │   └── SurahSelector/         # Surah search grid
│   ├── lib/                       # Audio capture, WebSocket, Quran data helpers
│   └── public/
│       ├── audio-processor.js     # AudioWorklet for mic capture
│       ├── fonts/                 # Uthmani + QCF page fonts (604 woff2 files)
│       └── surah_index.json       # 114 surah metadata
│
└── backend/                       # Python FastAPI
    ├── main.py                    # Server entry + REST endpoints
    ├── websocket_handler.py       # WebSocket session handler
    ├── asr/whisper_engine.py      # Whisper model loading + transcription
    ├── alignment/engine.py        # Word-by-word alignment engine
    ├── quran/
    │   ├── loader.py              # Quran data fetcher + cache
    │   └── normalization.py       # Arabic text normalization
    ├── tajweed/checker.py         # Tajweed error classification
    └── requirements.txt
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16.2.6, React 19, Tailwind CSS 4 |
| Backend | FastAPI 0.124.4, Python 3.13 |
| ASR | faster-whisper 1.2.1 (`OdyAsh/faster-whisper-base-ar-quran`) |
| Quran text | api.quran.com (fetched once at startup, cached locally) |
| Quran fonts | QCF v1 page fonts (Madani Mushaf glyphs) |
| Database | Supabase (optional — for session persistence) |

---

## GPU Support

The backend auto-detects CUDA GPUs. On a GPU, transcription runs in ~0.2s per chunk with beam search (5). On CPU, it uses int8 quantization and greedy decoding to stay responsive.

To force a specific device:

```env
ASR_DEVICE=cuda          # or "cpu"
ASR_COMPUTE_TYPE=float16 # or "int8"
```

---

## Testing

```bash
cd backend
python -m pytest -x -v
```

Test order follows the PRD — start with the shortest Surahs:
1. Al-Kawthar (108 — 3 ayahs)
2. Al-Ikhlas (112 — 4 ayahs)
3. Al-Falaq (113 — 5 ayahs)
4. An-Nas (114 — 6 ayahs)

---

## Contributing

Contributions are welcome! Please read [`AGENTS.md`](AGENTS.md) before making changes — it contains the full architecture rules, coding standards, and design decisions.

---

## License

MIT — fully open source. Built for the Ummah. 🕌
