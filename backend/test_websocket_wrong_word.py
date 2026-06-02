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

def test_websocket_wrong_word_payload():
    client = TestClient(app)
    
    with patch("websocket_handler.transcribe_audio_chunk") as mock_transcribe:
        with client.websocket_connect("/ws", headers={"origin": "http://localhost:3000"}) as ws:
            ws.send_json({
                "type": "sessionStart",
                "surahNumber": 112,
                "startAyah": 1,
                "endAyah": 1,
                "includeBismillah": False,
                "resumeFromWordIndex": 4  # Start of Ayah 1: "قل"
            })
            
            # Send wrong word "الارض" for "قل"
            mock_transcribe.return_value = ("الارض", True) 
            with patch("alignment.engine.time.time", side_effect=[0.0, 1.0, 3.0]):
                for _ in range(3):
                    ws.send_bytes(b"1234")
                    time.sleep(0.1) 
            
            res = ws.receive_json()
            assert res["type"] == "wordResult"
            assert res["status"] == "wrong"
            assert res["wordIndex"] == 4
            assert res["spoken"] == "الارض"
            assert "errorType" in res
