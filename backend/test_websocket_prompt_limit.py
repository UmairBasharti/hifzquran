import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch
import json
import os
import time

from main import app
from quran import loader

@pytest.fixture(scope="module", autouse=True)
def load_quran():
    data_path = os.path.join(os.path.dirname(__file__), "quran", "quran_data.json")
    with open(data_path, "r", encoding="utf-8") as f:
        loader.QURAN_DATA = json.load(f)
    loader.QURAN_LOADED = True
    app.state.quran_loaded = True
    app.state.model_loaded = True

def test_initial_prompt_is_capped_at_8_words():
    # Bug F9: Verify the initial_prompt is capped at 8 upcoming words to prevent extreme hallucination.
    client = TestClient(app)
    
    with patch("websocket_handler.transcribe_audio_chunk") as mock_transcribe:
        with client.websocket_connect("/ws", headers={"origin": "http://localhost:3000"}) as ws:
            # Surah 2 has extremely long Ayahs, ensuring we test the truncation
            ws.send_json({
                "type": "sessionStart",
                "surahNumber": 2, 
                "startAyah": 6,
                "endAyah": 6,
                "includeBismillah": False,
                "resumeFromWordIndex": 0
            })
            
            mock_transcribe.return_value = ("ان", True)
            ws.send_bytes(b"1234")
            
            res = ws.receive_json()
            assert res["type"] == "wordResult"
            
            # transcribe_audio_chunk(audio_array, expected_prompt)
            args, _ = mock_transcribe.call_args
            prompt = args[1]
            
            # Fetch the actual words from loader to reconstruct what exactly 8 words should look like
            words = loader.get_word_list(2, 6, 6, False)
            expected_prompt = " ".join(w["text"] for w in words[:8])
            
            # Ensure the constraint is strictly enforced (exactly 8 word objects, ignoring internal spaces)
            assert len(words) > 8
            assert prompt == expected_prompt
