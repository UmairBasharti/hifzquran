# Security.md
# HifzAI — Security and Privacy Rules
# Read this before writing any code that handles audio, user data, or secrets.
# HifzAI's privacy-first approach is a core product feature — never compromise it.

---

## 1. THE CORE PRIVACY PROMISE

HifzAI processes microphone audio in memory only and discards it immediately
after transcription. No audio is ever stored, logged, uploaded, or retained.

This is not just a technical rule — it is what makes HifzAI ethically better
than Tarteel AI. Tarteel uploads user recitation audio to their cloud servers
every 20 seconds and uses it for model training. Free users cannot opt out.

HifzAI will never do this. This promise must be enforced at the code level.

---

## 2. AUDIO PRIVACY RULES — ABSOLUTE

These rules are non-negotiable. No exception exists for any reason.

### Rule 1: Audio Is Never Written to Disk
Raw microphone audio must never be written to:
- Any file on the server or container filesystem
- Any database table or Supabase storage bucket
- Any log file or logging service
- Any temporary directory

```python
# CORRECT — process and immediately discard
async def handle_audio_chunk(audio_bytes):
    try:
        audio_array = numpy.frombuffer(audio_bytes, dtype=numpy.float32)
        transcribed_text = await transcribe_audio_chunk(audio_array)
        audio_array = None   # explicitly release reference
        return transcribed_text
    except Exception as error:
        audio_array = None   # release even on error
        console.error('Audio chunk processing failed:', error)
        return None
```

### Rule 2: Audio Is Never Logged
Do not log:
- Audio byte length (could be used to infer speech duration)
- Audio content descriptions
- Transcription outputs tied to identifiable sessions

Safe to log:
- Word result status (correct/wrong/skipped) without user identity
- Error types for debugging
- Session counts for monitoring (no content)

### Rule 3: Audio Is Never Sent Anywhere Except the Local Python Backend
The only destination for microphone audio is the local Python FastAPI server
over a WebSocket connection. Audio must never be forwarded to:
- Any cloud ASR API (Google, AWS, Azure, OpenAI)
- Any analytics service
- Any third-party endpoint

This is enforced by architecture — the ASR model runs locally.

### Rule 4: WebSocket Audio Is Not Logged by Nginx or Any Proxy
Ensure Nginx and any reverse proxy is NOT configured to log request bodies.
Default Nginx config does not log WebSocket frame content — do not add it.

---

## 3. SECRET MANAGEMENT

### What Goes Where

| Secret | File | Committed? |
|--------|------|------------|
| Supabase URL (frontend) | frontend/.env.local | ❌ Never |
| Supabase anon key (frontend) | frontend/.env.local | ❌ Never |
| Supabase service role key (backend) | backend/.env | ❌ Never |
| Supabase URL (backend) | backend/.env | ❌ Never |
| Example files (no values) | *.env.example | ✅ Yes |

### The anon Key vs Service Role Key
- **Anon key**: safe to expose in browser. Supabase RLS enforces access control.
  Use in frontend code. Prefix with NEXT_PUBLIC_ so Next.js exposes it.
- **Service role key**: bypasses all RLS — full database access.
  Use ONLY in Python backend. Never in frontend. Never in any browser-visible code.

### Hardcoded Secret Detection
Before every commit, check:
```bash
grep -r "SUPABASE" frontend/app/         # should only see process.env references
grep -r "supabase.co" backend/           # should only be in .env loading code
grep -r "eyJ" .                          # JWT tokens hardcoded — never acceptable
```

---

## 4. SUPABASE SECURITY

### Row Level Security — Mandatory on Every Table
```sql
-- Always run this immediately after CREATE TABLE
ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;

-- MVP hifz_sessions: anonymous insert only, no reads
CREATE POLICY "allow_anonymous_insert"
  ON hifz_sessions FOR INSERT TO anon WITH CHECK (true);
-- No SELECT policy = no one can read any session data
```

### What Is and Is Not Stored in Supabase

Stored (safe — no PII, no audio):
- Surah number tested
- Ayah range tested
- Word counts (correct, wrong, skipped)
- Error types per word
- Timestamp of session

Never stored:
- Any audio or audio metadata
- IP addresses
- Device fingerprints
- User names or emails (MVP — no accounts)
- Exact recitation text typed by users

---

## 5. HTTPS AND WEBSOCKET SECURITY

### Always HTTPS in Production
- Frontend on Vercel: HTTPS enforced automatically
- Backend on VPS: use Certbot + Let's Encrypt (see Deployment.md Section 6)
- Never serve HTTP in production — browser will block mic access on HTTP

### WebSocket: wss:// in Production
- Development: `ws://localhost:8000/ws` (unencrypted, local only — acceptable)
- Production: `wss://api.hifzai.com/ws` (encrypted — mandatory)
- Browsers block WebSocket mic access on unencrypted ws:// connections
  from HTTPS pages — this will silently break the mic in production

### WebSocket Origin Validation (Python backend)
```python
# In websocket_handler.py — validate origin to prevent unauthorized connections
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "https://hifzai.com",
    "https://quran.com",       # when integrated
    "https://www.quran.com"
]

async def websocket_endpoint(websocket: WebSocket):
    origin = websocket.headers.get("origin", "")
    if origin not in ALLOWED_ORIGINS:
        await websocket.close(code=1008)
        return
    await websocket.accept()
```

---

## 6. CONTENT SECURITY

### Quran Text Integrity
The Quran is the word of Allah — its text must never be corrupted.

- Never generate, infer, or reconstruct Quran text from memory or AI
- Always use quran_data.json as the single source of truth
- If quran_data.json is missing or unreadable, refuse to start — log error and exit
- Never display a Quran word unless it came directly from quran_data.json

### ASR Output Is Never Displayed as Quran Text
The ASR transcription of what the user said is used ONLY for comparison.
It is displayed in the error UI (e.g. "You said: اعطيناك") for debugging.
It is never presented as the correct Quran text under any circumstance.

---

## 7. DEPENDENCY SECURITY

### Keep Dependencies Minimal
Every dependency is a potential attack surface. HifzAI's backend has
intentionally few dependencies:
- No torch (replaced by faster-whisper's bundled CTranslate2)
- No camel-tools (replaced by Python built-in unicodedata)
- No heavy ML frameworks beyond what faster-whisper requires

### Check for Known Vulnerabilities
```bash
# Python — run periodically
pip install safety
safety check -r requirements.txt

# Node — run periodically
npm audit
```

### Never Install Packages Not in requirements.txt or package.json
If a new package is needed, document why in the relevant docs file
and add it explicitly to the dependency file. Never use pip install
or npm install ad-hoc without updating the requirements file.

---

## 8. BROWSER MIC SECURITY

### HTTPS Required for Mic Access
The browser's `navigator.mediaDevices.getUserMedia()` API only works on:
- HTTPS pages (production)
- localhost (development only)

If you attempt to use it on an HTTP page in production, the browser returns
a permission denied error with no explanation to the user. This is a browser
security requirement — not a bug in the code.

### Mic Permission UX
When mic permission is denied, show:
"Microphone access is needed for Hifz Mode. Please allow microphone access
in your browser settings and refresh the page."

Never show technical error messages like "getUserMedia failed" or "DOMException".

### Mic Stream Cleanup
When a session ends (complete, error, or user exits), always stop the mic stream:
```javascript
// Stop all mic tracks when session ends — releases the mic indicator in browser
function stopMicrophoneStream(microphoneStream) {
  microphoneStream.getTracks().forEach(function(track) {
    track.stop()
  })
}
```

Failing to stop tracks leaves the browser showing the active mic indicator
(red dot in browser tab) even after the session is over — alarming to users.

---

## 9. SECURITY CHECKLIST BEFORE ANY DEPLOYMENT

```
[ ] All .env files are in .gitignore and not committed
[ ] No hardcoded API keys or secrets anywhere in source code
[ ] Supabase RLS enabled on every table with appropriate policies
[ ] Service role key is ONLY in backend/.env — never in frontend
[ ] WebSocket origin validation is active in websocket_handler.py
[ ] Production backend is behind HTTPS (Certbot / Let's Encrypt)
[ ] Production WebSocket uses wss:// not ws://
[ ] Nginx does not log WebSocket frame content
[ ] Audio is never written to disk — confirmed by code review
[ ] Mic stream is stopped when session ends
[ ] quran_data.json loaded from verified api.quran.com source
[ ] safety check and npm audit show no critical vulnerabilities
```
