import asyncio
import os
import json
import numpy as np
from fastapi import WebSocket, WebSocketDisconnect

from alignment.engine import create_session, process_transcription, skip_word
from asr.whisper_engine import transcribe_audio_chunk

# Security: Origin validation to prevent unauthorized connections (Security.md §5)
# Replaced LAN IP and hardcoded list with an environment variable.
DEFAULT_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000,https://hifzai.com,https://quran.com,https://www.quran.com"
allowed_origins_env = os.getenv("ALLOWED_ORIGINS", DEFAULT_ORIGINS)
ALLOWED_ORIGINS = [origin.strip() for origin in allowed_origins_env.split(",") if origin.strip()]

# Temporary, privacy-safe pipeline diagnostics — logs chunk SIZES, signal PEAK, and the
# transcribed TEXT only (never raw audio). Set DEBUG_ASR=0 to silence. Remove once the
# live browser→reveal path is confirmed.
DEBUG_ASR = os.getenv("DEBUG_ASR", "1") == "1"

# Limit concurrent WebSocket sessions to prevent GPU/CPU Out-Of-Memory (OOM) if 
# users spam the Start button or traffic spikes.
MAX_CONCURRENT_SESSIONS = int(os.getenv("MAX_CONCURRENT_SESSIONS", "10"))
active_sessions_count = 0


# One WebSocket = one Hifz session. A receiver task keeps only the FRESHEST audio
# chunk while a processor task transcribes as fast as the CPU allows. This decoupling
# means a slow transcription never snowballs latency — stale chunks are dropped, so
# the reveal always reflects what the reciter just said.
async def websocket_endpoint(websocket: WebSocket):
    global active_sessions_count

    origin = websocket.headers.get("origin", "")
    if origin not in ALLOWED_ORIGINS:
        print(f"WebSocket rejected: invalid origin '{origin}'")
        await websocket.close(code=1008)
        return

    # Connection cap lock (1.7.3)
    if active_sessions_count >= MAX_CONCURRENT_SESSIONS:
        print(f"WebSocket rejected: server at capacity ({active_sessions_count}/{MAX_CONCURRENT_SESSIONS})")
        await websocket.accept()
        await try_send_json(websocket, {
            "type": "error",
            "code": "CAPACITY_ERROR",
            "message": "The server is currently at maximum capacity. Please try again in a few moments."
        })
        await websocket.close(code=1013) # 1013 Try Again Later
        return

    await websocket.accept()
    active_sessions_count += 1
    
    if DEBUG_ASR:
        print(f"[ws] connection accepted (origin='{origin}', active={active_sessions_count})")

    # Shared state between the receiver and processor tasks.
    state = {
        "session": None,
        "latest_audio": None,        # most recent raw bytes, overwritten as they arrive
        "running": True,
        "last_speech_time": asyncio.get_event_loop().time(),
        "silence_alert_sent": False,
    }

    try:
        await asyncio.gather(
            receive_messages(websocket, state),
            process_audio(websocket, state),
        )
    except WebSocketDisconnect:
        print("WebSocket client disconnected.")
    except Exception as fatal_error:
        print(f"WebSocket fatal error: {fatal_error}")
        await try_send_json(websocket, {
            "type": "error",
            "code": "SERVER_ERROR",
            "message": "Internal server error",
        })
    finally:
        active_sessions_count -= 1
        state["running"] = False


# Receiver task: reads every message and stores only the latest audio chunk.
# Session control messages (sessionStart, skipWord) are handled immediately.
async def receive_messages(websocket: WebSocket, state):
    while state["running"]:
        message = await websocket.receive()

        if message.get("type") == "websocket.disconnect":
            state["running"] = False
            raise WebSocketDisconnect(message.get("code", 1000))

        if "text" in message:
            await handle_control_message(websocket, state, message["text"])
        elif "bytes" in message:
            # Overwrite — we only ever care about the most recent audio.
            state["latest_audio"] = message["bytes"]


# Processor task: transcribes the freshest audio chunk whenever one is available.
async def process_audio(websocket: WebSocket, state):
    while state["running"]:
        session = state["session"]
        audio_bytes = state["latest_audio"]

        if session is None or session.is_complete or audio_bytes is None:
            await asyncio.sleep(0.02)
            continue

        # Claim this chunk so the next loop waits for a newer one.
        state["latest_audio"] = None

        try:
            audio_array = np.frombuffer(audio_bytes, dtype=np.float32)
            if DEBUG_ASR:
                seconds = len(audio_array) / 16000.0
                peak = float(np.max(np.abs(audio_array))) if audio_array.size else 0.0
                print(f"[audio] chunk {len(audio_bytes)}B / {len(audio_array)} samples (~{seconds:.2f}s) peak={peak:.4f}")

            # Constrain decoding toward the immediate next words only. A short prompt biases the
            # model to Quranic vocabulary WITHOUT tempting it to "fill in" far-ahead words the
            # reciter has not said yet (which would falsely advance the cursor).
            upcoming_words = session.words[session.current_word_index : session.current_word_index + 8]
            expected_prompt = " ".join(word["text"] for word in upcoming_words)

            # Run ASR off the event loop so the receiver keeps accepting fresh audio.
            transcription, speech_detected = await asyncio.to_thread(
                transcribe_audio_chunk, audio_array, expected_prompt
            )
            audio_array = None  # privacy: never retain audio (Security.md §2)
            if DEBUG_ASR:
                print(f"[asr]   speech={speech_detected} text='{transcription}'")

            update_silence_state(state, speech_detected)
            if not speech_detected:
                await maybe_send_silence_alert(websocket, state)

            if transcription:
                word_results = process_transcription(session, transcription)
                if DEBUG_ASR:
                    emitted = [(result["wordIndex"], result["status"]) for result in word_results]
                    print(f"[align] emitted {len(word_results)} {emitted} cursor={session.current_word_index}/{len(session.words)}")
                for word_result in word_results:
                    await websocket.send_json(word_result)
                if session.is_complete:
                    await send_completion_summary(websocket, session)

        except Exception as processing_error:
            print(f"Audio processing error: {processing_error}")


# Handle a JSON control message (sessionStart or skipWord).
async def handle_control_message(websocket: WebSocket, state, raw_text):
    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError:
        return

    message_type = data.get("type")

    if message_type == "sessionStart":
        try:
            state["session"] = create_session(
                data.get("surahNumber"),
                data.get("startAyah"),
                data.get("endAyah"),
                data.get("includeBismillah", True),
                data.get("resumeFromWordIndex", 0),
            )
            state["last_speech_time"] = asyncio.get_event_loop().time()
            state["silence_alert_sent"] = False
            if DEBUG_ASR:
                active_session = state["session"]
                first_word = active_session.words[0]["text"] if active_session.words else None
                print(f"[session] surah={data.get('surahNumber')} ayahs={data.get('startAyah')}-{data.get('endAyah')} "
                      f"bismillah={data.get('includeBismillah', True)} words={len(active_session.words)} "
                      f"firstExpected='{first_word}' resume={data.get('resumeFromWordIndex', 0)}")
        except Exception as session_error:
            await websocket.send_json({
                "type": "error",
                "code": "SESSION_ERROR",
                "message": str(session_error),
            })

    elif message_type == "skipWord":
        session = state["session"]
        if session is None:
            return
        skip_result = skip_word(session, data.get("wordIndex"))
        if skip_result:
            await websocket.send_json(skip_result)
            if session.is_complete:
                await send_completion_summary(websocket, session)


# Track how long we have gone without detecting speech.
def update_silence_state(state, speech_detected):
    if speech_detected:
        state["last_speech_time"] = asyncio.get_event_loop().time()
        state["silence_alert_sent"] = False


# Send the "speak closer to the mic" nudge after 4s of silence, at most once per cycle.
async def maybe_send_silence_alert(websocket: WebSocket, state):
    seconds_silent = asyncio.get_event_loop().time() - state["last_speech_time"]
    if seconds_silent >= 4.0 and not state["silence_alert_sent"]:
        await websocket.send_json({"type": "silenceAlert", "silenceDurationSeconds": 4})
        state["silence_alert_sent"] = True


# Compute final stats and tell the browser the session is finished.
async def send_completion_summary(websocket: WebSocket, session):
    total = len(session.words)
    correct = sum(1 for result in session.results.values() if result["status"] == "correct")
    skipped = sum(1 for result in session.results.values() if result["status"] == "skipped")
    wrong = len(session.results) - correct - skipped
    completion_rate = (correct / total * 100.0) if total > 0 else 0.0

    await websocket.send_json({
        "type": "sessionComplete",
        "summary": {
            "totalWords": total,
            "correctCount": correct,
            "wrongCount": wrong,
            "skippedCount": skipped,
            "completionRate": round(completion_rate, 1),
        },
    })


# Best-effort JSON send that never raises (used on the fatal error path).
async def try_send_json(websocket: WebSocket, payload):
    try:
        await websocket.send_json(payload)
    except Exception:
        pass
