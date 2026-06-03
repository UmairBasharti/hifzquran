import asyncio
import os
import sys
from contextlib import asynccontextmanager
from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator

# Windows consoles default to cp1252, which cannot encode Arabic. Any Arabic text sent to
# stdout (a log line, an error) would raise UnicodeEncodeError — and inside the audio loop
# that exception is caught and silently swallows the word reveal. Force UTF-8 so logging can
# never break the recitation pipeline.
for output_stream in (sys.stdout, sys.stderr):
    if hasattr(output_stream, "reconfigure"):
        output_stream.reconfigure(encoding="utf-8")

# Load backend/.env so SUPABASE_*, MODEL_NAME, etc. are visible to os.getenv.
load_dotenv()

from quran.loader import load_quran_data, get_surah
from asr import whisper_engine
from supabase_db import get_supabase_client
import websocket_handler

# Lifespan context manager runs at startup and shutdown
@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Load Quran Data
    # If quran_data.json is missing, this will fetch it from the API (~60-90s)
    print("Starting Quran data load...")
    await load_quran_data()
    app.state.quran_loaded = True

    # 2. Load ASR Model
    print("Starting ASR model load...")
    await whisper_engine.load_model()
    app.state.model_loaded = True

    print("HifzAI backend ready.")
    yield
    # Cleanup on shutdown (if any)
    print("HifzAI backend shutting down.")


app = FastAPI(title="HifzAI Backend", lifespan=lifespan)

# CORS configuration for frontend
# ALLOWED_ORIGINS is shared with the websocket_handler
app.add_middleware(
    CORSMiddleware,
    allow_origins=websocket_handler.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    """
    Health endpoint used to verify backend readiness.
    Frontend should wait for both flags to be true.
    """
    quran_loaded = getattr(app.state, "quran_loaded", False)
    model_loaded = getattr(app.state, "model_loaded", False)

    status = "ready" if quran_loaded and model_loaded else "starting"

    # API.md §GET /health requires this shape
    response = {
        "status": status,
        "quranLoaded": quran_loaded,
        "modelLoaded": model_loaded
    }

    if status != "ready":
        # Return 503 Service Unavailable while still starting
        raise HTTPException(status_code=503, detail=response)

    return response


@app.get("/surah/{surah_number}")
async def get_surah_endpoint(surah_number: int):
    """
    Returns the full structured data for a surah.
    """
    if not getattr(app.state, "quran_loaded", False):
        raise HTTPException(status_code=503, detail="Quran data not loaded yet")

    surah_data = get_surah(surah_number)
    if surah_data is None:
        raise HTTPException(
            status_code=404, 
            detail={"error": "Surah not found", "surahNumber": surah_number}
        )

    return surah_data


# One word's outcome inside a session (matches API.md / Database.md word_results).
class WordResultItem(BaseModel):
    wordIndex: int = Field(ge=0)
    status: Literal["correct", "wrong", "skipped"]
    errorType: str | None = None
    expected: str | None = None
    spoken: str | None = None


# POST /session body — shape defined in API.md §POST /session.
# Field constraints mirror the hifz_sessions DB CHECKs so bad input is rejected with a clean
# 422 here instead of surfacing as an opaque 500 from the database on insert.
class SessionCreateRequest(BaseModel):
    surahNumber: int = Field(ge=1, le=114)
    startAyah: int = Field(ge=1)
    endAyah: int = Field(ge=1)
    totalWords: int = Field(ge=1)
    correctCount: int = Field(ge=0)
    wrongCount: int = Field(ge=0)
    skippedCount: int = Field(ge=0)
    wordResults: list[WordResultItem] = []

    # The DB enforces end_ayah >= start_ayah; validate it up front for a clear 422.
    @model_validator(mode="after")
    def validate_ayah_range(self):
        if self.endAyah < self.startAyah:
            raise ValueError("endAyah must be greater than or equal to startAyah")
        return self


@app.post("/session", status_code=201)
async def create_session_endpoint(session_req: SessionCreateRequest):
    """
    Saves a completed, anonymous Hifz session to Supabase (hifz_sessions).
    Returns 201 with { sessionId, saved }. Never stores audio or any PII.
    """
    supabase_client = get_supabase_client()

    # Supabase optional in local dev — report not-saved instead of breaking the client.
    if supabase_client is None:
        print("Supabase not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing).")
        return {"sessionId": None, "saved": False}

    session_row = {
        "surah_number": session_req.surahNumber,
        "start_ayah": session_req.startAyah,
        "end_ayah": session_req.endAyah,
        "total_words": session_req.totalWords,
        "correct_count": session_req.correctCount,
        "wrong_count": session_req.wrongCount,
        "skipped_count": session_req.skippedCount,
        "word_results": [result.model_dump(exclude_none=True) for result in session_req.wordResults],
    }

    try:
        # supabase-py is synchronous — run it off the event loop.
        insert_response = await asyncio.to_thread(
            lambda: supabase_client.table("hifz_sessions").insert(session_row).execute()
        )
        inserted_rows = insert_response.data or []
        session_id = inserted_rows[0].get("id") if inserted_rows else None
        return {"sessionId": session_id, "saved": True}
    except Exception as insert_error:
        print(f"Failed to save session to Supabase: {insert_error}")
        raise HTTPException(
            status_code=500,
            detail={"error": "Failed to save session", "saved": False},
        )


# Mount the WebSocket handler
app.add_api_websocket_route("/ws", websocket_handler.websocket_endpoint)

