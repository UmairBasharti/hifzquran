import pytest
import numpy as np
import asyncio
from asr import whisper_engine

@pytest.fixture(scope="session", autouse=True)
def setup_pipeline():
    asyncio.run(whisper_engine.load_model())

def test_pure_silence_returns_empty():
    # Bug F9: Verify that hallucination guards prevent the model from inventing words out of silence.
    # 3 seconds of pure zeros.
    audio_array = np.zeros(16000 * 3, dtype=np.float32)
    
    # We pass a highly tempting expected text. Without guards, the model would confidently output this.
    transcribed_text, has_speech = whisper_engine.transcribe_audio_chunk(audio_array, "قل هو الله احد")
    
    assert not has_speech
    assert transcribed_text == ""

def test_low_noise_returns_empty():
    # 3 seconds of low Gaussian noise, simulating a quiet room microphone.
    # Amplitude must be below SILENCE_PEAK_THRESHOLD (0.05) to trigger the raw peak drop,
    # but even if it passed, the VAD and hallucination guards should catch it.
    np.random.seed(42)
    audio_array = np.random.normal(0, 0.01, 16000 * 3).astype(np.float32)
    
    transcribed_text, has_speech = whisper_engine.transcribe_audio_chunk(audio_array, "قل هو الله احد")
    
    assert not has_speech
    assert transcribed_text == ""
