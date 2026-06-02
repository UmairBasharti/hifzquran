import pytest
import os
import json
import asyncio
from faster_whisper.audio import decode_audio
from quran import loader
from alignment.engine import create_session, process_transcription
from asr import whisper_engine

@pytest.fixture(scope="session", autouse=True)
def setup_pipeline():
    # 1. Load Quran Data
    data_path = os.path.join(os.path.dirname(__file__), "quran", "quran_data.json")
    if os.path.exists(data_path):
        with open(data_path, "r", encoding="utf-8") as f:
            loader.QURAN_DATA = json.load(f)
        loader.QURAN_LOADED = True
    else:
        raise FileNotFoundError("quran_data.json missing")
    
    # 2. Load Whisper Model
    asyncio.run(whisper_engine.load_model())

# Test Data: (Surah, Ayah, filename)
TEST_CLIPS = [
    (1, 2, "001002.mp3"),
    (108, 1, "108001.mp3"),
    (112, 1, "112001.mp3"),
    (113, 1, "113001.mp3"),
    (114, 1, "114001.mp3")
]

@pytest.mark.parametrize("surah, ayah, filename", TEST_CLIPS)
def test_golden_pipeline(surah, ayah, filename):
    filepath = os.path.join(os.path.dirname(__file__), "tests", "data", filename)
    assert os.path.exists(filepath), f"Audio file {filepath} not found"
    
    # 1. Decode MP3 to 16kHz float32 numpy array
    audio_array = decode_audio(filepath, sampling_rate=16000)
    
    # 2. Initialize Alignment Engine
    session = create_session(surah, ayah, ayah, include_bismillah=False)
    expected_text = " ".join([w["text"] for w in session.words])
    
    # 3. Run through Whisper ASR
    transcribed_text, has_speech = whisper_engine.transcribe_audio_chunk(audio_array, expected_text)
    assert has_speech, f"Expected speech to be detected in {filename}"
    assert len(transcribed_text) > 0, f"Transcription is empty for {filename}"
    
    # 4. Feed transcription to alignment engine
    results = process_transcription(session, transcribed_text)
    
    correct_count = sum(1 for r in results if r["status"] == "correct")
    total_words = len(session.words)
    
    print(f"\n--- {filename} ---")
    print(f"Expected: {expected_text}")
    print(f"Transcribed: {transcribed_text}")
    print(f"Score: {correct_count}/{total_words} words aligned correctly.")
    
    # Assert at least a majority of words aligned (ASR isn't always 100% on small chunks,
    # but for golden reciter clips with initial_prompt it should be very high)
    assert correct_count >= total_words // 2, f"Failed to align majority of words in {filename}"
