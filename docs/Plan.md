# HifzAI — Step 1 Plan: Production Hardening (fix the audited issues)

> **This file is the single source of truth for the current work.** It is written to be handed to a
> coding agent (Antigravity IDE, **Gemini 3.1 Pro**) that has the repo + `docs/` but **no other chat
> history**. Read it top-to-bottom before touching code. Every finding was verified against the actual
> source on **2026-06-02**; all `file:line` references are real. Fix the issues in **STEP 1** in order.
>
> **Where we are:** the ASR pipeline, the UX shell, and a new **Listen / Read / Memorize** feature set
> already exist and mostly work (see §0.8). STEP 1 is the punch-list of bugs and production gaps found
> in a deep code audit (B1–B21). Do them one at a time; after each, re-run the checks in §2.

---

## 0. Read-first context (do not skip)

### 0.1 What HifzAI is
A free, open-source Quran-memorization (Hifz) web app that replicates Tarteel AI's core loop: pick a
Surah + Ayah range, hit "Start," **all Arabic text hides**, the mic listens, and each correctly-recited
word is **revealed in real time**; wrong/skipped words are flagged. Audio is processed **in memory and
never stored**. Product rules live in `/AGENTS.md` (identical to `/CLAUDE.md`) — **its HARD RULES are
mandatory.**

### 0.2 Architecture (two processes — never merge them)
```
Browser (Next.js 16 App Router, plain JS)
  Mic → AudioContext(16kHz mono) → AudioWorklet → Float32 PCM → WebSocket (binary) → Python FastAPI :8000
  Light HTTP (surah metadata, session save) ─────────── Next.js API routes ──┘
  Listen mode also fetches recitation audio + word timings directly from api.quran.com (browser side).
Python backend: faster-whisper (CTranslate2) ASR + Silero VAD + alignment engine + tajweed checker.
Quran text is loaded once into memory at startup (backend/quran/quran_data.json), never fetched at runtime.
```

### 0.3 Repo map (files that matter)
| File | Role |
|---|---|
| `backend/main.py` | FastAPI app, lifespan (loads Quran + model), `/health`, `/surah/{n}`, `/session` (validated), mounts `/ws` |
| `backend/websocket_handler.py` | One WS = one session; receiver keeps freshest chunk, processor transcribes + aligns; concurrency cap |
| `backend/asr/whisper_engine.py` | Model load, device auto-detect, `transcribe_audio_chunk()` (VAD + initial_prompt + hallucination guards) |
| `backend/alignment/engine.py` | `HifzSession`, `process_transcription()`, `skip_word()` — fuzzy monotonic aligner |
| `backend/tajweed/checker.py` | `classify_error()` |
| `backend/quran/loader.py` | Quran data fetch/cache; per-word `text`, glyph fields, `audioUrl` |
| `backend/quran/normalization.py` | Stage-1/Stage-2 Arabic normalization |
| `frontend/app/hifz/[id]/page.js` | Hifz page — Server Component; fetches `/surah/{id}`; warming-up retry/state |
| `frontend/app/{error,loading,not-found}.js` | Graceful route states |
| `frontend/components/HifzSession/HifzSession.js` | Session orchestration; Listen/Read/Memorize modes; cursor; Finish button |
| `frontend/components/HifzSession/AudioPlayer.js` | Listen-mode player: virtual timeline, rAF word-sync, scrubber, 12-reciter picker |
| `frontend/components/HifzSession/WordRenderer.js` | Mushaf QCF-glyph rendering (range-limited), hide/reveal, auto-scroll, click-to-seek |
| `frontend/components/HifzSession/SessionSummary.js` | Accuracy ring, word breakdown, mistake cards + audio |
| `frontend/components/SurahSelector/SurahSelector.js` + `frontend/lib/quran.js` | Surah search + grid |
| `frontend/lib/audio.js` + `frontend/public/audio-processor.js` | Mic capture + AudioWorklet (16 kHz, ring buffer) |
| `frontend/lib/websocket.js` | WS client, reconnect (capped + backoff) + resume |

### 0.4 Mandatory conventions (from AGENTS.md — enforce in EVERY change, and fix existing violations)
- **Frontend = plain JavaScript `.js` only.** No TypeScript, App Router only.
- **`async/await` + `try/catch` only — never `.then()/.catch()`** (rule 11).
- **Full descriptive names — never `res`, `req`, `e`, `cb`, `val`, `seg`, `r`, `i`** (rule 12).
- **One plain-English comment above every function.** Max 2 levels of nesting.
- **Arabic comparison is two-stage**; never compare raw Arabic strings. **Arabic containers always `dir="rtl" lang="ar"`.**
- **Audio:** 16 kHz mono Float32 PCM; constrained decoding; tuned VAD; **never store audio.**
- **No `camel-tools`; no hardcoded secrets; RLS on every table.**

### 0.5 Hardware target
Lenovo LOQ 15IRX9 — i5-13450HX, 16 GB RAM, **RTX 4050 Laptop (6 GB VRAM)**. Base model runs <0.1 s/window
on GPU; CPU fallback uses int8 + greedy.

### 0.6 Model decision (settled — do not switch)
`OdyAsh/faster-whisper-base-ar-quran` (CT2 build of `tarteel-ai/whisper-base-ar-quran`). We already run
Tarteel's own ASR brain; the gap is UX/alignment, not the model. No model swaps in this step.

### 0.7 Tashkeel reality
Stage-1 strips tashkeel, so live diacritic-error types are mostly unreachable; word-level detection is
the reliable feature. Diacritic feedback is best-effort and would need a gated Stage-2-on-match pass.

### 0.8 ✅ Already done (do NOT redo — verify only)
- Core ASR pipeline: windowed echo-dedup (repeated words reveal correct), wall-clock stuck timer,
  length-aware threshold, hallucination guards, AudioWorklet + ring buffer, reconnect/resume.
- **Search** improved (normalizes hyphens/spaces, matches name/meaning/Arabic/number-prefix) — *but see B5*.
- **Manual Finish button** builds the summary locally without waiting for backend `sessionComplete`.
- **Graceful states**: warming-up retry page + `app/error.js` / `app/loading.js` / `app/not-found.js`.
- **Range-only rendering** (only the selected ayahs render + only their QCF fonts load) + **auto-scroll**
  to the active word (recording path only — see B2).
- **New feature set**: Listen / Read / Memorize modes; `AudioPlayer` (virtual timeline, rAF word-sync,
  scrubber, 12-reciter picker); click-a-word-to-seek in Listen mode.
- Backend: `POST /session` input validation (422), `DEBUG_ASR` defaults off, real docstring, reconnect cap.
- Tailwind entrance animations + `pb-safe` defined in `globals.css`; `viewport-fit=cover` set.
- Offline mode formally **deferred** in AGENTS.md §8 (needs on-device ASR).
- 32 backend unit tests pass.

---

## 1. Audit findings index (severity → STEP 1 task)

| # | Sev | One-liner | Task |
|---|-----|-----------|------|
| B9  | 🟠 | WSS mixed-content: `ws://` fallback breaks on HTTPS deploys | 1.1.1 |
| B10 | 🟠 | Server-render cold-start retry (~15 s) can 504 on serverless | 1.1.2 |
| B1  | 🔴 | Memorize mode has no visible active-word cursor | 1.1.3 |
| B8  | 🟠 | Listen-mode audio segment mapping is a guess (wrong shape/off-by-one) | 1.1.4 |
| B3  | 🟠 | `AudioPlayer` rebuilds `<audio>` on every play/pause | 1.2.1 |
| B4  | 🟠 | Listen autoplay blocked (no fresh user gesture) | 1.2.2 |
| B11 | 🟡 | No AbortController on listen fetch → response race | 1.2.3 |
| B6  | 🟡 | Dead listen state (`isPlaying`/`isLoadingAudio` unused) | 1.2.4 |
| B12 | 🟡 | Concurrent transcribe on one shared model (no single-flight) | 1.3.1 |
| B13 | 🟡 | Docker base `cudnn8` vs CTranslate2 needs cuDNN 9 | 1.3.2 |
| B21 | 🟡 | "Finish" with zero progress → empty 0% summary | 1.3.3 |
| B2  | 🟠 | Listen mode doesn't auto-scroll to highlighted word | 1.3.4 |
| B5  | 🟡 | Search still misses advertised "Yaseen" | 1.3.5 |
| B15 | 🟡 | Status shown by color only (colorblind/WCAG 1.4.1) | 1.4.1 |
| B16 | 🟡 | AGENTS.md rule violations in new code (`.catch()`, short names) | 1.4.2 |
| B17 | ⚪ | a11y: range inputs + click-words lack labels/keyboard support | 1.4.3 |
| B7  | ⚪ | Unused `ArrowLeft` import in hifz page | 1.4.4 |
| B18 | ⚪ | `@supabase/supabase-js: "latest"` not pinned | 1.4.5 |
| B19 | ⚪ | No Open Graph / `metadataBase` | 1.4.6 |
| B20 | ⚪ | Dead `/api/surah/[id]` route | 1.4.7 |
| B14 | 🟡 | Default mode = "listen" (product decision) | 1.5.1 |
| —   | 🟡 | Listen + 12 reciters vs AGENTS.md §8 POST-MVP (scope decision) | 1.5.2 |

---

## STEP 1 — Fix all audited issues (in order)

> After each sub-task: run `backend/venv/Scripts/python.exe -m pytest -q` and `npm run build` (frontend),
> and confirm no new lint/diagnostic errors. Keep every change inside §0.4 conventions.

### 1.1 Core-loop blockers (do first)

- **1.1.1 — B9: secure WebSocket on HTTPS.** In `frontend/lib/websocket.js:22-25`, when
  `NEXT_PUBLIC_PYTHON_BACKEND_WS` is unset, derive the scheme from the page: use `wss://` when
  `window.location.protocol === "https:"`, else `ws://`. *Acceptance:* an HTTPS-served frontend opens the
  socket without a mixed-content error.

- **1.1.2 — B10: don't block the server render on cold start.** `frontend/app/hifz/[id]/page.js:13-37`
  retries 6×2.5 s server-side (~15 s), which can exceed serverless function limits → 504. Either return the
  warming-up state after **one** quick check and let the client retry, or cap the total server wait to
  well under the platform timeout (≤ ~5 s). *Acceptance:* a cold backend shows the warming-up page, never a 504.

- **1.1.3 — B1: restore the Memorize-mode active-word cursor.** In
  `frontend/components/HifzSession/WordRenderer.js:195-235`, the active word is `invisible` in hifz mode and
  there is no cursor element, so the reciter sees a blank gap. Render a visible indicator at the active slot
  (e.g. an underline/caret bar positioned over the hidden glyph, or a faint placeholder) without revealing
  the word. *Acceptance:* during Memorize recitation the current word's position is clearly marked.

- **1.1.4 — B8: fix/verify Listen-mode word-timing mapping.** In
  `frontend/components/HifzSession/HifzSession.js:219-230`, segments are assumed to be
  `[wordPos, ?, startMs, endMs]`. Verify the real shape from a live api.quran.com response
  (`/verses/by_chapter/{n}?words=true&audio={id}`) — Quran.com word segments are commonly
  `[wordPos, startMs, endMs]` (3-tuple) and may be **1-based**. Parse defensively (branch on `segment.length`;
  map position to the correct word index, handling 1-based). *Acceptance:* the highlighted word matches the
  audio for the first/middle/last word of an ayah on a known surah (e.g. Al-Kawthar).

### 1.2 Listen-mode reliability (AudioPlayer)

- **1.2.1 — B3: stop rebuilding the audio element on play/pause.** In
  `frontend/components/HifzSession/AudioPlayer.js:127-156`, the setup effect's deps include `isPlaying`
  (and `totalDurationSeconds`), so every toggle tears down and recreates `new Audio()`. Create the audio
  element **once** (deps `[]`, or keyed only on the data identity), keep handlers in refs to avoid stale
  closures, and let play/pause act on the existing element. *Acceptance:* pause then resume continues from
  the same position; no audio glitch on toggle.

- **1.2.2 — B4: respect autoplay policy.** The `[virtualAyahs]` effect (`AudioPlayer.js:165-190`) forces
  `isPlaying=true` and calls `play()` after an async fetch, so the gesture is gone and `play()` rejects,
  desyncing the button. Do not autoplay on initial load — start paused and play on the user's first Play
  click; if you keep auto-resume on reciter change, drive `isPlaying` from the actual `play()` result.
  *Acceptance:* first Listen load shows a Play button (no console autoplay error); button state always
  matches real playback.

- **1.2.3 — B11: cancel in-flight listen fetches.** `startListenMode`
  (`HifzSession.js:197-261`) refetches on every reciter/range change with no cancellation → out-of-order
  responses can apply stale audio. Use an `AbortController` (abort the previous request before starting a
  new one; ignore aborted responses). *Acceptance:* rapidly switching reciter/range never leaves the wrong
  audio loaded.

- **1.2.4 — B6: remove dead listen state or wire it up.** `setIsPlaying` is never called and
  `isLoadingAudio` is set but never rendered (`HifzSession.js:30,53,99`). Either (a) surface
  `isLoadingAudio` as a loading indicator in the player and drive `isPlaying` from the player, or (b) delete
  the unused state and simplify the `currentWordIndex` expression. *Acceptance:* no unused state; a spinner
  shows while listen audio loads.

### 1.3 Robustness & scale

- **1.3.1 — B12: serialize model inference.** A single shared `WhisperModel` is called via `to_thread`
  from up to `MAX_CONCURRENT_SESSIONS` sessions (`whisper_engine.py:102`, `websocket_handler.py:130`).
  faster-whisper isn't reliably safe for concurrent `transcribe()` on one instance. Add a single-flight
  guard (an `asyncio.Lock`/`threading.Lock` around the transcribe call, or a small worker queue).
  *Acceptance:* two simultaneous sessions transcribe correctly with no garbled/crossed output.

- **1.3.2 — B13: fix the GPU container.** `backend/Dockerfile:1` uses `cuda:12.2.2-cudnn8`, but
  CTranslate2 4.x / faster-whisper 1.2.1 on CUDA 12 needs **cuDNN 9**. Bump the base image (or install
  cuDNN 9) and confirm the build-time model load uses the GPU. *Acceptance:* container starts with
  `device=cuda` and no cuDNN load error.

- **1.3.3 — B21: guard "Finish" with no progress.** `handleFinishLocally` (`HifzSession.js:272-295`)
  produces an empty 0% summary if pressed before any word is recited. Either disable Finish until there is
  at least one result, or show a "nothing recited yet" state. *Acceptance:* Finish at 0 progress gives a
  sensible message, not a blank summary.

- **1.3.4 — B2: auto-scroll in Listen mode too.** The `scrollIntoView` effect
  (`WordRenderer.js:197-201`) is gated on `isRecording`, so Listen highlighting scrolls off-screen. Include
  the listen path (scroll when `isActive && (isRecording || isListenActive)`). *Acceptance:* the highlighted
  word stays in view during playback.

- **1.3.5 — B5: make the advertised search work.** `frontend/lib/quran.js:37-44` still misses "Yaseen"
  (`Ya-Sin`→`yasin` ≠ `yaseen`). Either change the placeholder to a token that matches
  (`SurahSelector.js` — e.g. "Yasin"), or add a small alias/keyword map for common spellings
  (Yaseen→36, etc.). *Acceptance:* the exact strings in the search placeholder all return the right surah.

### 1.4 Polish, compliance & accessibility

- **1.4.1 — B15: don't rely on color alone for status.** `WordRenderer.js:203-212` (and the summary)
  distinguish correct/wrong/skipped only by color. Add a non-color cue (small icon, underline style, or
  text label) so colorblind users can tell them apart (WCAG 1.4.1). *Acceptance:* statuses are
  distinguishable in grayscale.

- **1.4.2 — B16: fix AGENTS.md rule violations in the new code.** In `AudioPlayer.js` (and any new code):
  replace `.catch()` with `try/catch` + `async/await` (rule 11), and rename short identifiers
  `e`/`r`/`seg`/`i` to descriptive names (rule 12). *Acceptance:* no `.then()/.catch()` and no one-letter
  names remain in changed files.

- **1.4.3 — B17: accessibility for controls.** Add `aria-label`s to the scrubber and volume `range`
  inputs and to icon-only buttons; make the click-to-seek word a real focusable/keyboard-activatable
  control (button semantics or `role`/`tabIndex`/`onKeyDown`). *Acceptance:* the player and word-seek are
  usable by keyboard and screen reader.

- **1.4.4 — B7: remove unused import.** Drop `ArrowLeft` from `frontend/app/hifz/[id]/page.js:3`.

- **1.4.5 — B18: pin the Supabase dependency.** Replace `"@supabase/supabase-js": "latest"` in
  `frontend/package.json:12` with a fixed version for reproducible builds.

- **1.4.6 — B19: basic SEO metadata.** Add Open Graph fields and `metadataBase` in
  `frontend/app/layout.js` (title/description/og:image). Low priority.

- **1.4.7 — B20: delete dead route.** `frontend/app/api/surah/[id]/route.js` is unused (the page fetches
  the backend directly). Remove it (and confirm nothing else calls `/api/surah/...`).

### 1.5 Decisions (MADE — encode them)

- **1.5.1 — B14: default mode. DECIDED → default to Memorize (Hifz); Listen is opt-in.** Change the
  initial `sessionMode` in `HifzSession.js:28` from `"listen"` to `"hifz"`, so the headline feature loads
  first and no api.quran.com call / autoplay fires on page open. *(Owner: the component-cluster agent —
  fold into the Memorize-mode work.)*

- **1.5.2 — Listen + multiple reciters: DECIDED → IN SCOPE (we ship multiple qaris). ✅ DONE in docs.**
  AGENTS.md §8 has been updated: Listen mode + reciter (qari) selection are now MVP, and "multiple
  reciters" was removed from POST-MVP. This is multiple *audio reciters* for playback only — ASR stays
  Hafs-only. No further AGENTS.md edit needed; no code change required beyond the existing player.

---

## 2. How to run & verify (run after each STEP 1 sub-task)

```bash
# Backend (from backend/, committed local venv on Windows)
venv/Scripts/python.exe -m uvicorn main:app --reload --port 8000
venv/Scripts/python.exe -m pytest -q            # 32 unit tests must stay green

# Frontend (from frontend/)
npm install
npm run dev                                      # http://localhost:3000
npm run build                                    # must succeed with no new errors
```
Env: backend `backend/.env` (`MODEL_NAME`, `ASR_DEVICE`, `ASR_COMPUTE_TYPE`, `ALLOWED_ORIGINS`,
`DEBUG_ASR`, `MAX_CONCURRENT_SESSIONS`, `SUPABASE_*`); frontend `frontend/.env.local`
(`NEXT_PUBLIC_PYTHON_BACKEND_URL`, `NEXT_PUBLIC_PYTHON_BACKEND_WS`, `PYTHON_BACKEND_URL`,
`NEXT_DEV_ORIGIN`). **Never commit secrets.**

**Manual proof (real mic + speakers), AGENTS.md phase order Al-Kawthar → Al-Ikhlas → Al-Falaq → Al-Nas:**
Memorize mode shows a clear cursor and reveals words (B1); Listen mode highlights the correct word and
keeps it in view (B8, B2); play/pause/seek/reciter-change all behave (B3, B4, B11); Finish mid-passage
shows an accurate summary (B21); searching the placeholder terms works (B5); the app runs over HTTPS with a
working socket (B9) and survives a cold backend without a 504 (B10).

## 3. Definition of done for STEP 1
1. B1, B8, B9, B10 fixed and manually verified (the core loop works on a deployed HTTPS build).
2. Listen mode is reliable: B3, B4, B11, B6, B2 fixed.
3. B12, B13, B21, B5 fixed; backend handles 2 concurrent sessions; GPU container loads.
4. B15, B16, B17, B7, B18, B19, B20 done; no AGENTS.md rule violations remain in changed files.
5. Decisions 1.5.1 and 1.5.2 made and encoded in code + AGENTS.md.
6. `pytest` green; `npm run build` clean; manual protocol (§2) passed on the four short surahs.

## 4. Out of scope for STEP 1 (do NOT build here)
User accounts/auth/history/dashboards, gamification, translations/tafsir, multilingual UI, mobile app,
on-device/offline ASR, and any swap of the **primary word-level ASR** (base Tarteel model is settled — §0.6).
NOTE: adding a *secondary phonetic model for tashkeel* is now in scope — but as **STEP 2**, below.

---

# STEP 2 — "Real listening" (no run-ahead) + Tashkeel detection (Tarteel-parity and beyond)

> Goal set by the owner: (1) the system must NEVER advance past the reciter — it must actually hear each
> word, and (2) tashkeel (diacritic) error detection, "at any cost." Decided after web research (2026-06).

### 2.0 Research reality check (verified against sources)
- **Tarteel itself is word-level only.** Its own "Introducing Mistake Detection" blog states diacritics
  (fatha/damma/kasra), pronunciation, and tajweed are **NOT supported** — only missed/incorrect/extra
  words. So "ditto Tarteel" = nail word-level; **tashkeel detection is BEYOND Tarteel.**
- Tarteel uses **text-based fuzzy matching on transcriptions** (edit distance), not waveform DTW — the
  same family as our engine. Our architecture is right.
- **Root cause of "system runs ahead of me":** `initial_prompt` = the expected ayah text makes Whisper
  *parrot it back* from silence/noise. Fix = remove the prompt and gate on word-level confidence.
- **Tashkeel is achievable with a secondary phonetic model.** Candidate:
  `TBOGamer22/wav2vec2-quran-phonetics` (Apache-2.0, ~94M params, fits the RTX 4050; outputs *vowelled*
  phoneme strings, e.g. "tālik", ~99.8% word-level). Compare its phonemes to the expected phonemes
  (derived from the Uthmani diacritics) → classify the diacritic error.

### 2.1 Track 1 — Never advance past the reciter (`whisper_engine.py`, `alignment/engine.py`)
- **2.1.1** Remove `initial_prompt` (or trim to empty) — kills prompt-parroting at the source. The model
  is already Quran-fine-tuned, so vocabulary bias is not needed.
- **2.1.2** Set `word_timestamps=True`; capture each word's `.probability` (confidence) and time span.
- **2.1.3** Confirm a word only when it fuzzy-matches the expected word **AND** confidence ≥ threshold
  (start ~0.5) — proof the reciter actually said it, not the model guessing.
- **2.1.4** Lower the per-chunk advance cap to ~2; keep the bounded forward skip.
- **2.1.5** Revert the short-word match threshold to ~0.5 (un-break `test_short_word_intolerance_fixed`);
  control false matches via confidence + prompt-removal, not by globally stiffening alignment.
- **2.1.6** Re-tune VAD/`no_speech` for the no-prompt setup. Acceptance: **0 reveals on silence**, correct
  reveals as you actually recite, wrong word flags after the stuck timer.

### 2.2 Track 2 — Tashkeel error detection (new module `backend/phonetics/`)
- **2.2.1** Load the wav2vec2 Quran-phonetic model at startup, alongside Whisper (secondary pass).
- **2.2.2** Precompute an **expected phoneme string per word** from the Uthmani diacritics into
  `quran_data.json` (one-time, in the loader).
- **2.2.3** When Stage-1 (consonant skeleton) matches, run the phonetic model on that word's **audio span**
  (from 2.1.2 timestamps), align phonemes to the expected, and classify
  `missing_shadda / wrong_harakat / missing_tanwin / madd` → emit a **soft, non-blocking tajweed hint**
  while the word still reveals *correct*.
- **2.2.4** Gate behind a flag; validate on deliberately mis-voweled recitation; tune to avoid false flags.

### 2.3 AGENTS.md rule change required (do this first in STEP 2)
Rule 23 ("ASR model locked — no substitutes") and "faster-whisper = only permitted ASR engine" must be
**relaxed to allow a SECONDARY phonetic model for tashkeel only**. Whisper remains the primary word-level
ASR. Update AGENTS.md §3 + §7 to record this exception with rationale.

### 2.4 Ownership
Both tracks are backend (`whisper_engine.py`, `alignment/engine.py`, new `phonetics/`), which is deeply
interconnected (word timestamps flow ASR → alignment → phonetic pass). **One agent owns the backend for
STEP 2** to avoid collisions; the other pauses backend edits until it lands.
