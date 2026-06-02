# Deployment.md
# HifzAI — How to Run Locally and Deploy to Production
# Read this before setting up any environment or writing any Docker/server config.

---

## 1. LOCAL DEVELOPMENT SETUP (From Zero)

### Prerequisites
- Python 3.13 installed
- Node.js 20+ installed
- npm installed
- Git installed
- A Supabase account (free tier) — supabase.com

### Step 1 — Clone the repo
```bash
git clone https://github.com/UmairBasharti/hifzai.git
cd hifzai
```

### Step 2 — Backend setup
```bash
# Create virtual environment
python3.13 -m venv backend/venv

# Activate it
source backend/venv/bin/activate        # Linux / Mac
backend\venv\Scripts\activate           # Windows

# Install all dependencies
cd backend
pip install -r requirements.txt

# Copy env file and fill in Supabase credentials
cp .env.example .env
# Edit backend/.env with your values
```

### Step 3 — Generate Quran data (first time only)
```bash
# Still in backend/ with venv active
# This fetches all 114 Surahs from api.quran.com (~60-90 seconds, one time only)
uvicorn main:app --reload --host 0.0.0.0 --port 8000
# Backend startup auto-fetches quran_data.json if missing

# After backend is ready, generate the frontend surah index
python quran/generate_surah_index.py
# Outputs: ../frontend/public/surah_index.json
```

### Step 4 — Frontend setup
```bash
# New terminal
cd frontend
npm install

# Copy env file and fill in credentials
cp .env.local.example .env.local
# Edit frontend/.env.local with your values

# Start frontend
npm run dev
# Open http://localhost:3000
```

### First Run Notes
- quran_data.json download: ~60-90 seconds, happens once, cached forever after
- Whisper model download: ~150MB, happens once, cached in ~/.cache/huggingface/
- All subsequent starts: under 10 seconds

### Confirming Everything Works
```
Backend ready log:  "HifzAI backend ready. Quran loaded. Model loaded."
Frontend ready log: "ready - started server on localhost:3000"
Health check:       GET http://localhost:8000/health → { "status": "ready" }
```

---

## 2. ENVIRONMENT FILES

### backend/.env
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
QURAN_API_BASE_URL=https://api.quran.com/api/v4
MODEL_NAME=tarteel-ai/whisper-base-ar-quran
PORT=8000
```

### backend/.env.example (commit this — no secrets)
```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
QURAN_API_BASE_URL=https://api.quran.com/api/v4
MODEL_NAME=tarteel-ai/whisper-base-ar-quran
PORT=8000
```

### frontend/.env.local
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_PYTHON_BACKEND_URL=http://localhost:8000
NEXT_PUBLIC_PYTHON_BACKEND_WS=ws://localhost:8000
```

### frontend/.env.local.example (commit this — no secrets)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_PYTHON_BACKEND_URL=http://localhost:8000
NEXT_PUBLIC_PYTHON_BACKEND_WS=ws://localhost:8000
```

---

## 3. .gitignore

```
# Environment files — never commit
.env
.env.local
backend/.env
frontend/.env.local

# Python
backend/venv/
__pycache__/
*.pyc
*.pyo

# Quran data — large file, regenerated on first run
backend/quran/quran_data.json

# HuggingFace model cache
~/.cache/huggingface/

# Node
frontend/node_modules/
frontend/.next/

# OS
.DS_Store
Thumbs.db
```

---

## 4. DOCKER — BACKEND

For production deployment. Not needed for local development.

### backend/Dockerfile
```dockerfile
FROM python:3.13-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose port
EXPOSE 8000

# Start command
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### backend/docker-compose.yml
```yaml
version: '3.8'

services:
  backend:
    build: .
    ports:
      - "8000:8000"
    env_file:
      - .env
    volumes:
      - quran_data:/app/quran/quran_data.json
      - model_cache:/root/.cache/huggingface
    restart: unless-stopped

volumes:
  quran_data:
  model_cache:
```

Volumes are critical — they persist quran_data.json and the Whisper model
across container restarts so they are not re-downloaded every deploy.

### Build and run
```bash
cd backend
docker compose up --build
```

---

## 5. PRODUCTION HOSTING

### Frontend — Vercel (recommended, free)
```bash
# Install Vercel CLI
npm install -g vercel

# From frontend/ directory
vercel

# Set environment variables in Vercel dashboard:
# NEXT_PUBLIC_SUPABASE_URL
# NEXT_PUBLIC_SUPABASE_ANON_KEY
# NEXT_PUBLIC_PYTHON_BACKEND_URL  (your production backend URL)
# NEXT_PUBLIC_PYTHON_BACKEND_WS   (your production WebSocket URL)
```

Vercel auto-deploys on every push to main branch.
Next.js 16.2.6 is natively supported by Vercel — no config needed.

### Backend — VPS (Hetzner CX21, ~$5/month)
```bash
# On server (Ubuntu 22.04)
sudo apt update
sudo apt install python3.13 python3.13-venv docker.io nginx certbot

# Clone repo
git clone https://github.com/UmairBasharti/hifzai.git
cd hifzai/backend

# Create .env with production values
nano .env

# Run with Docker
docker compose up -d

# Setup Nginx reverse proxy (see Section 6)
# Setup SSL with certbot (see Section 6)
```

### Alternative Backend — Hugging Face Spaces (free GPU tier)
- Create a Space at huggingface.co/spaces
- Type: Docker
- Push backend/ to the Space repository
- Set environment variables in Space settings
- Free A10G GPU available — model inference will be faster

---

## 6. NGINX CONFIG (Production)

```nginx
# /etc/nginx/sites-available/hifzai

server {
    listen 80;
    server_name api.hifzai.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name api.hifzai.com;

    ssl_certificate     /etc/letsencrypt/live/api.hifzai.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.hifzai.com/privkey.pem;

    # HTTP endpoints
    location / {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebSocket endpoint — critical config
    location /ws {
        proxy_pass http://localhost:8000/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600;    # 1 hour — keep WS alive during long sessions
        proxy_send_timeout 3600;
    }
}
```

The WebSocket config is critical. Without `proxy_http_version 1.1`,
`Upgrade`, and `Connection "upgrade"` headers, WebSocket connections
will fail silently in production even though they work locally.

```bash
# Enable site and get SSL cert
sudo ln -s /etc/nginx/sites-available/hifzai /etc/nginx/sites-enabled/
sudo certbot --nginx -d api.hifzai.com
sudo systemctl reload nginx
```

---

## 7. PRODUCTION ENVIRONMENT VARIABLES

Update frontend `.env.local` (or Vercel dashboard) for production:
```
NEXT_PUBLIC_PYTHON_BACKEND_URL=https://api.hifzai.com
NEXT_PUBLIC_PYTHON_BACKEND_WS=wss://api.hifzai.com
```

Note: `wss://` not `ws://` in production — WebSocket over SSL.

---

## 8. STARTUP ORDER — ALWAYS FOLLOW THIS

```
1. Backend starts first
   → Downloads quran_data.json if missing
   → Loads Whisper model
   → Logs "HifzAI backend ready"
   → Health endpoint returns { "status": "ready" }

2. Frontend starts second (or deploys to Vercel)
   → On first user visit: fetches surah_index.json from /public
   → Connects to backend on demand when user opens a Surah

Never start frontend before backend is ready.
If backend is not ready, Surah pages will show an error state.
This is expected — both must be running for the app to work.
```

---

## 9. COMMON ISSUES AND FIXES

| Issue | Cause | Fix |
|-------|-------|-----|
| `quran_data.json not found` | Backend not fully started | Wait for "HifzAI backend ready" log |
| Model download stuck | Slow internet, first run only | Wait — ~150MB, can take 5+ minutes |
| WebSocket fails in production | Missing Nginx upgrade headers | Add Upgrade + Connection headers (Section 6) |
| Arabic font not loading | CDN blocked or slow | Check console for font load error |
| `camel_tools` import error | Old code before audit | Remove all camel_tools imports — use unicodedata |
| Audio not recognized | Wrong sample rate | Ensure AudioContext({ sampleRate: 16000 }) |
| False errors on correct words | No initial_prompt set | Add initial_prompt to transcribe() call |
| VAD cuts off mid-word | Default silence threshold | Set min_silence_duration_ms: 800 |
