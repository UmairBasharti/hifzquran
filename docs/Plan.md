# HifzAI — Step 1 Execution Plan (Fix the pipeline & prove it on the current model)

> **This file is the single source of truth for the current work.** It is written to be handed to a
> coding agent (Antigravity IDE, Gemini 3.1 Pro – high) that has the repo + `docs/` but **no other
> chat history**. Read this top-to-bottom before touching code. Every finding below was verified
> against the actual code and live data on 2026-06-02 — file:line references are real.

---

## 0. Read-first context (do not skip)

### 0.1 What HifzAI is
A free, open-source Quran-memorization (Hifz) web app that replicates Tarteel AI's core loop: the
user picks a Surah + Ayah range, hits "Start," **all Arabic text hides**, the mic listens, and each
correctly-recited word is **revealed in real time**; wrong/skipped words are flagged. Audio is
processed **in memory and never stored** (HifzAI's privacy advantage over Tarteel). Full product
rules live in `/AGENTS.md` (identical to `/CLAUDE.md`) — **that file's HARD RULES are mandatory.**

### 0.2 Architecture (two processes — never merge them)
```
Browser (Next.js 16 App Router, plain JS)
  Mic → AudioContext(16kHz mono) → Float32 PCM → WebSocket (binary)  →  Python FastAPI :8000
  Light HTTP (surah metadata, session save) ─────────── Next.js API routes ──┘
Python backend: faster-whisper (CTranslate2) ASR + Silero VAD + alignment engine + tajweed checker.
Quran text is loaded once into memory at startup (backend/quran/quran_data.json), never fetched at runtime.
```

### 0.3 Repo map (the files that matter for Step 1)
| File | Role |
|---|---|
| `backend/main.py` | FastAPI app, lifespan (loads Quran + model), `/health`, `/surah/{n}`, `/session`, mounts `/ws` |
| `backend/websocket_handler.py` | One WS = one session. Receiver keeps only freshest audio chunk; processor transcribes + aligns |
| `backend/asr/whisper_engine.py` | Model load, device/compute auto-detect, `transcribe_audio_chunk()` (VAD + initial_prompt) |
| `backend/alignment/engine.py` | `HifzSession`, `process_transcription()`, `skip_word()` — the fuzzy monotonic aligner |
| `backend/tajweed/checker.py` | `classify_error()` → missing_shadda / wrong_harakat / missing_tanwin / wrong_word / pronunciation_error |
| `backend/quran/loader.py` | Fetches/caches Quran data from api.quran.com; builds word objects (text, glyph, **audioUrl**) |
| `backend/quran/normalization.py` | `normalize_for_match` (Stage 1, strips tashkeel), `normalize_for_match_alef`, `normalize_for_tashkeel` (Stage 2) |
| `frontend/lib/audio.js` | `AudioRecorder` — mic capture, 16 kHz downsample, sliding-window chunking |
| `frontend/lib/websocket.js` | `openHifzSession()` — WS client, auto-reconnect + resume |
| `frontend/components/HifzSession/HifzSession.js` | Session orchestration, cursor, builds `wordResults` for the summary |
| `frontend/components/HifzSession/WordRenderer.js` | Mushaf QCF-glyph rendering, hide/reveal logic |
| `frontend/components/HifzSession/SessionSummary.js` | Accuracy ring, word breakdown, **Detailed Mistakes cards + audio playback** |
| `backend/test_*.py` | pytest suite (run with the venv: `backend/venv/Scripts/python.exe -m pytest`) |

### 0.4 Mandatory conventions (from AGENTS.md — enforce in every change)
- **Frontend = plain JavaScript `.js` only.** No TypeScript, no Pages Router (App Router only).
- **`async/await` + `try/catch` only** — never `.then()/.catch()`.
- **Full descriptive variable names** — never `res`, `req`, `e`, `cb`, `val`, `tmp`.
- **One plain-English comment above every function.** Max 2 levels of nesting (extract functions).
- **Arabic comparison is two-stage**: Stage 1 strips tashkeel for word match; Stage 2 keeps tashkeel
  for error type. Never compare raw Arabic strings — always normalize first.
- **Arabic containers always `dir="rtl" lang="ar"`.**
- **Audio:** 16 kHz mono Float32 PCM; constrained decoding (`initial_prompt`); tuned VAD; **never store audio.**
- **No `camel-tools`** — `unicodedata`/regex only. **No hardcoded secrets** (`.env` / `.env.local`).
- **ASR model is swappable via `MODEL_NAME`** but the default stays the locked Tarteel base (see §0.6).

### 0.5 Hardware target
Dev/first deploy machine: **Lenovo LOQ 15IRX9** — Intel i5-13450HX, 16 GB RAM, **NVIDIA RTX 4050
Laptop GPU, 6 GB VRAM** (+ Intel iGPU, which CTranslate2 ignores). The base model (~74M params)
runs on this GPU in well under 0.1 s/window. large-v3-turbo (~809M) would also fit in 6 GB at
`int8_float16` (~1.5–2 GB) — but see §0.6: that's a *later, gated* decision.

### 0.6 Model decision (already settled — do not switch in Step 1)
- Current model = `OdyAsh/faster-whisper-base-ar-quran` (a CTranslate2 build of **`tarteel-ai/whisper-base-ar-quran`**).
  **We are already running Tarteel's own base ASR brain**, so the word-accuracy ceiling ≈ Tarteel's.
  The perceived gap is in the **alignment + UX layer, not the model.**
- The latency you may have seen is a **CPU artifact** — it disappears on the RTX 4050. That's why
  Step 1 enables the GPU *first*, then fixes alignment, then re-judges.
- The candidate upgrade `MaddoggProduction/whisper-l-v3-turbo-quran-lora` is a **solo community LoRA**
  (not org-backed), Apache-2.0, base `whisper-large-v3-turbo`, published **WER 12.69%** on its own test
  set (not comparable to base's 5.75%, and not obviously better), and its own card warns it is
  **prone to hallucination/repetition loops** — exactly our risk area. It also can't be loaded
  directly by faster-whisper (LoRA must be merged → converted to CTranslate2). **Verdict: deferred to
  Step 2, only if §1.9.3 triggers.**

### 0.7 The tashkeel reality (critical — sets expectations for §1.4)
**No ASR model "detects tashkeel errors," and neither fully does Tarteel.** A model only *transcribes*.
Worse, in our pipeline **Stage-1 matching strips tashkeel**, so a recitation with correct letters but
wrong harakat/shadda has an identical stripped form → it reveals **correct** and never reaches the
wrong-word path. Therefore `classify_error`'s diacritic types (missing_shadda/wrong_harakat/
missing_tanwin) are **architecturally unreachable from the "stuck" path** — live, it will return
`wrong_word`/`pronunciation_error` ~100% of the time. Compounding it: `initial_prompt` biases Whisper
toward the *expected* tashkeel regardless of what was said, so spoken diacritics can't be trusted.
**Conclusion: word-level detection is the reliable, ship-it feature. Diacritic feedback is best-effort
and requires a Stage-2-on-match redesign (§1.4.4) — not a model upgrade.**

---

## 1. Current state — what already exists (so you don't redo it)

**Already built and working:**
- Full 114-surah pipeline; `quran_data.json` cached and re-fetched **with `audioUrl`** per word
  (e.g. `https://verses.quran.com/wbw/108_001_001.mp3` — verified HTTP 200). (`loader.py:144,166`)
- Fuzzy, monotonic alignment with resync + manual skip + reconnect/resume.
- Mushaf QCF v1 glyph rendering; clean Quran.com-style UI; session summary with accuracy ring,
  word-by-word breakdown, **Detailed Mistakes cards + per-word audio Play button + "How to fix it" tips**.
- `classify_error` is now **imported and called** from `engine.py` `_flag_current_wrong` (recent change).
- **23 unit tests pass** (`test_alignment.py`, `test_tajweed.py`, `test_normalization.py`, `test_data_integrity.py`).

**Recently changed (and partly broken — see §2):** tajweed wiring into the stuck path; `audio_url`
added to the Quran fetch; SessionSummary revamped with mistake cards + audio + tips.

---

## 2. Verified findings to fix in Step 1 (severity-ordered, with evidence)

| # | Sev | Finding | Where | Evidence |
|---|-----|---------|-------|----------|
| **F1** | 🔴 | **Repeated words marked `skipped` not `correct`.** Global echo-dedup suppresses *every* confirmed word, so any legitimately repeated word (e.g. `ٱللَّهُ`, Ar-Rahman's 31× refrain) can't re-confirm and gets marked skipped. | `engine.py:80-86,185-186` | Reproduced: Al-Ikhlas idx 8 `ٱللَّهُ` → `skipped` |
| **F2** | 🔴 | **Audio playback is dead end-to-end.** Backend stores `audioUrl`, SessionSummary reads `word.audioUrl`, but `HifzSession.js` never copies `audioUrl` into `wordResults` → button never renders. | `HifzSession.js:204-212` vs `SessionSummary.js:215` | grep: `audioUrl` exists only at the consumer |
| **F3** | 🔴 | **"You said" shows the wrong word (echo bug).** `_flag_current_wrong` uses `transcribed_text.split()[0]`, which in a 6 s window is usually an earlier *confirmed* word, not the stuck attempt — corrupts both the card and `classify_error` input (and the saved session). | `engine.py:148-151` | Reproduced: stuck on `ٱللَّهُ` reported `You said: قل` |
| **F4** | 🔴 | **Reconnect test hangs CI.** Expects "wrong" after a single mismatched chunk, but engine needs 3 stuck chunks → `receive_json()` blocks forever. | `test_websocket_reconnect.py:57-65` | `pytest` exit code 124 (timeout) |
| **F5** | 🟠 | **Tashkeel error types unreachable live** (see §0.7). Cards will say "Wrong word" ~always; badge is hardcoded `خطأ تجويد` even for wrong words. | `engine.py` Stage-1 + `SessionSummary.js:196` | Probe: `classify_error` works in isolation but only the wrong-root path reaches it |
| **F6** | 🟠 | **Skipped words produce no mistake card** (cards filter `status==="wrong"`), yet the test instructions say "skip past it." | `SessionSummary.js:186` | Logic read |
| **F7** | 🟠 | **Single shared model + per-connection `to_thread` + `cpu_threads=all` + no connection cap** → multi-user CPU/VRAM blowup + thread-safety risk; **Origin header is not auth** (spoofable) → DoS. | `whisper_engine.py:32-34`, `websocket_handler.py:26-31,108` | Code read |
| **F8** | 🟡 | **False "wrong" fires too fast** (`STUCK_CHUNK_LIMIT=3` counts chunks, not wall-clock; GPU does 3 inferences in <1 s) and **short words (≤3 letters) need an exact match** (threshold 0.7 gives them 0 tolerance). | `engine.py:18,9,69-77` | Math + code read |
| **F9** | 🟡 | **No hallucination guards** (`no_speech_threshold`/`log_prob_threshold`/`compression_ratio_threshold` unset); `initial_prompt` can "complete" un-recited words. | `whisper_engine.py:88-100` | Code read |
| **F10** | 🟡 | **Deprecated `ScriptProcessorNode` on main thread** (jank) + per-sample `Array.push`/`splice` on a 96k array each callback (GC churn). | `audio.js:78,94-110` | Code read |
| **F11** | ⚪ | `new Audio(url).play()` per click (unhandled promise rejection, overlapping playback); expected word shown twice; "Actual word" label is confusing. | `SessionSummary.js:217,201-241` | Code read |
| **F12** | ⚪ | Doc↔code drift: VAD `min_silence_duration_ms`=500 (rule says 800), window 6 s/0.8 s (rule says 3 s/1.5 s), beam 1 on CPU. Decide & make AGENTS.md match reality. | `whisper_engine.py:96`, `audio.js:33-34` | Code read |

---

## STEP 1 — Fix the pipeline and prove it on the current model (on your GPU)

**Goal:** Get the existing `tarteel-ai/whisper-base-ar-quran` (the `OdyAsh/...` CT2 build) running on
the RTX 4050, fix every correctness bug, and manually prove real-world quality — **before** spending a
single hour on a model upgrade.
**Exit criteria:** All four test surahs pass live, repeated words reveal correctly, wrong-word feedback
is meaningful, reveal latency feels instant on GPU. Only then do we consider Step 2 (turbo).

### 1.1 Stand up the GPU runtime (no code changes — just enable what's already wired)
- **1.1.1** Install the CUDA 12 runtime + cuDNN 9 libraries CTranslate2 4.x needs
  (`pip install nvidia-cublas-cu12 nvidia-cudnn-cu12`), since faster-whisper won't use the GPU without them.
- **1.1.2** Verify detection: `python -c "import ctranslate2; print(ctranslate2.get_cuda_device_count())"`
  must print `1` (the RTX 4050; the Intel iGPU is ignored).
- **1.1.3** Confirm `detect_best_device()` returns `cuda` and the engine logs `device=cuda (float16)` on startup.
- **1.1.4** Smoke-test: backend boots, model loads on GPU, `/health` returns `ready`, VRAM usage sane (~1 GB for base).
- **1.1.5** Capture a **baseline latency number** (ms per 6 s window) on GPU **before any fixes** — this is
  your "is the model even the problem?" reference.

### 1.2 Build the safety net — make the test suite trustworthy first
- **1.2.1** Fix the hanging reconnect test (**F4**): rewrite it to match the actual "3 chunks → wrong"
  contract, or feed 3 chunks.
- **1.2.2** Add `pytest-timeout` so no test can ever hang CI again (a hang masquerades as "still running").
- **1.2.3** Establish a green baseline: all unit tests pass in one run.
- **1.2.4** Add a **live-path golden harness** — chunk the test clips into 6 s windows and feed only the
  8-word prompt (mirroring production), because the current `test_asr_golden` uses a single full-ayah
  clip + full prompt and therefore can't catch the real bugs.

### 1.3 Fix correctness bug F1 — repeated words (highest user impact)
- **1.3.1** Write **failing regression tests first**: Al-Ikhlas (`ٱللَّهُ` repeats at idx 6 & 8),
  Al-Falaq, and an Ar-Rahman refrain slice. Assert the second occurrence reveals **correct**, not skipped.
- **1.3.2** Replace the global `_confirmed_word_forms` dedup with **windowed dedup** — only suppress
  echoes of the last 1–2 just-confirmed words, not every word ever confirmed.
- **1.3.3** Re-run: repeated words must now reveal **correct**, not skipped.
- **1.3.4** Confirm `test_overlap_echo_ignored` still passes (don't reintroduce the echo it guarded against).

### 1.4 Fix correctness bug F2/F3/F5/F6 — error classification + mistake UI (partially done)
> **Status:** `classify_error` is wired (1.4.1 ✅) but the feature is broken/misleading. Honest scope:
> **word-level errors = reliable; diacritic-level = best-effort** (see §0.7 — this is an architecture
> limit, not a model limit).
- **1.4.1 ✅ done** — `classify_error` imported & called from `_flag_current_wrong`; `audioUrl` fetched
  and cached in `loader.py`.
- **1.4.2 🔴 fix F2** — plumb `audioUrl` through `HifzSession.js` `wordResults.map(...)`
  (`audioUrl: word.audioUrl`) so the Play button renders. *(Blocks the entire audio feature.)*
- **1.4.3 🔴 fix F3** — in `_flag_current_wrong`, choose the spoken token by **relevance** (most-recent
  non-confirmed token, or the token with highest similarity to the current word), **not `tokens[0]`**.
  Add a regression test asserting the echo case reports the real attempt, and that `classify_error`
  receives the real token.
- **1.4.4 🟠 the real tashkeel fix (decision required)** — diacritic error types can only fire if you
  add a **Stage-2-on-match pass**: when a word matches at Stage 1 (right letters), compare *with*
  tashkeel and emit a **soft, non-blocking tajweed hint** while still revealing the word correct.
  Until that exists, set the badge **dynamically** (`wrong_word` → "Wrong word", not `خطأ تجويد`).
  **MVP recommendation: ship word-level only (option b); gate the Stage-2 pass behind a flag** and do
  not claim diacritic accuracy in the UI yet.
- **1.4.5 🟠 fix F6** — decide skipped-word presentation: either include `status==="skipped"` in the
  Detailed Mistakes section (distinct color/label) or update the test instructions; don't leave the
  documented test flow producing zero cards.
- **1.4.6 ⚪ polish F11** — single `Audio` ref + `.catch()` + playing state (no overlapping playback);
  de-duplicate the expected-word box; relabel "Actual word" → "Correct word / Listen."
- **1.4.7** — add a live-path test that drives a wrong word end-to-end and asserts the card's `spoken`,
  `errorType`, and `audioUrl` are all correct, and that the **saved session** payload carries them too.

### 1.5 Fix false "wrong" timing + short-word intolerance (F8)
- **1.5.1** Convert stuck-detection from **chunk count to wall-clock** (e.g. "stuck > 2.5 s"), so
  back-to-back GPU inferences don't flag a word wrong in <1 s.
- **1.5.2** Make the match threshold **length-aware**: allow ≥1 edit on 2–3 letter words
  (`هُوَ`, `قُلْ`, `مَا`) instead of requiring an exact match.
- **1.5.3** Re-tune both against the golden harness; target **zero false-wrongs** on clean reciter clips.

### 1.6 Hallucination guards on the ASR (F9)
- **1.6.1** Add `no_speech_threshold`, `log_prob_threshold`, and `compression_ratio_threshold` to the
  transcribe call to suppress invented words.
- **1.6.2** Re-validate the 8-word `initial_prompt` cap (prevents the model "completing" ahead).
- **1.6.3** Test against pure silence + background-noise clips: **false reveals must be 0.**

### 1.7 Performance & real-time feel (F10, F7)
- **1.7.1** Move mic capture from the deprecated `ScriptProcessorNode` to an **AudioWorklet**
  (off-main-thread → no audio glitches/jank).
- **1.7.2** Replace the per-sample `Array.push` + `splice` with a preallocated `Float32Array` ring buffer.
- **1.7.3** Add a single-flight lock or small queue around the shared model + a **max-concurrent-session
  cap** (prevents the multi-user CPU/VRAM blowup); treat Origin as CSWSH hardening only, not auth.
- **1.7.4** Re-measure end-to-end reveal latency on GPU after the AudioWorklet change.

### 1.8 Manual end-to-end test protocol (the real proof — do this yourself with the mic)
- **1.8.1** Follow AGENTS.md phase order: **Al-Kawthar → Al-Ikhlas → Al-Falaq → Al-Nas**, only advancing
  when each is clean.
- **1.8.2** Run scripted scenarios per surah: perfect recitation, one wrong word, skip button, mid-ayah
  pause, **repeated word**, fast pace, slow pace, noisy room.
- **1.8.3** Log metrics each run: reveal latency (felt), false reveals, missed reveals, repeated-word
  handling, wrong-feedback usefulness.
- **1.8.4** Explicitly test a **repetition-heavy passage** (Ar-Rahman refrain) — that's the **F1** acid test.
- **1.8.5** Test across mics: laptop built-in, a headset, and phone-on-web (mobile mic behaves differently).

### 1.9 Decision gate (this answers the upgrade question)
- **1.9.1** Define numeric success: e.g. **≥95% words reveal correctly** on the 4 short surahs,
  **<300 ms felt latency** on GPU, **0 false reveals** on silence.
- **1.9.2** **If met → ship the current model; shelve turbo.** You're running Tarteel's own brain (§0.6) —
  don't add risk for nothing.
- **1.9.3** **Only if word accuracy is the wall** (the *transcriptions themselves* are wrong on
  accents/noise, not the alignment) → proceed to a separate **Step 2** to evaluate turbo. The alignment
  fixes above must be done first regardless, because turbo feeds the same logic.

---

## 3. How to run & verify

```bash
# Backend (from backend/, use the committed venv on Windows)
venv/Scripts/python.exe -m uvicorn main:app --reload --port 8000
venv/Scripts/python.exe -m pytest -q                 # full suite (add pytest-timeout per 1.2.2)
PYTHONIOENCODING=utf-8 ...                            # required on Windows for Arabic in stdout

# Frontend (from frontend/)
npm install
npm run dev                                           # http://localhost:3000
```
Env: backend `backend/.env` (`MODEL_NAME`, `ASR_DEVICE`, `ASR_COMPUTE_TYPE`, `ALLOWED_ORIGINS`,
`DEBUG_ASR`); frontend `frontend/.env.local` (`NEXT_PUBLIC_PYTHON_BACKEND_URL`,
`NEXT_PUBLIC_PYTHON_BACKEND_WS`). **Never commit secrets.** To force a GPU run regardless of
auto-detect: `ASR_DEVICE=cuda ASR_COMPUTE_TYPE=int8_float16`.

## 4. Definition of done for Step 1
1. GPU path verified (§1.1); baseline + post-fix latency recorded.
2. Test suite green and **cannot hang** (§1.2); live-path golden harness exists.
3. F1, F2, F3, F4 fixed with regression tests; F5/F6 resolved per the §1.4 decision; F7–F9 addressed.
4. AudioWorklet capture live (§1.7); no main-thread audio jank.
5. Manual protocol (§1.8) passed on all four short surahs incl. a repetition surah.
6. §1.9 decision recorded in this file: **ship base** or **open Step 2 (turbo)** — with the numbers that justify it.

## 5. Out of scope for Step 1 (do NOT build yet)
User accounts/auth, history/dashboards, streaks/gamification, translations/tafsir, multiple reciters,
multilingual UI, mobile app, and **the turbo model migration** (that's Step 2, gated by §1.9.3).
