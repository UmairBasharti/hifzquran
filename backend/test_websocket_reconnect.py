import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch
import json
import os

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

def test_websocket_reconnect_hold_cursor():
    client = TestClient(app)
    
    with patch("websocket_handler.transcribe_audio_chunk") as mock_transcribe:
        # Client 1 connects
        with client.websocket_connect("/ws", headers={"origin": "http://localhost:3000"}) as ws1:
            ws1.send_json({
                "type": "sessionStart",
                "surahNumber": 112,
                "startAyah": 1,
                "endAyah": 1,
                "includeBismillah": False,
                "resumeFromWordIndex": 0
            })
            
            # Send word 1 correctly (index 4)
            mock_transcribe.return_value = ("قل", True)
            ws1.send_bytes(b"1234")
            
            res1 = ws1.receive_json()
            assert res1["type"] == "wordResult"
            assert res1["status"] == "correct"
            assert res1["wordIndex"] == 4
            
            # Disconnect
            
        # Client 2 connects (simulating reconnect)
        with client.websocket_connect("/ws", headers={"origin": "http://localhost:3000"}) as ws2:
            # Resume at index 5 (next expected word)
            ws2.send_json({
                "type": "sessionStart",
                "surahNumber": 112,
                "startAyah": 1,
                "endAyah": 1,
                "includeBismillah": False,
                "resumeFromWordIndex": 5
            })
            
            import time
            # Send wrong word for index 5 to stress "hold cursor"
            # It should emit "wrong" but wait for the correct word (needs 2.5s to trigger stuck)
            mock_transcribe.return_value = ("خخ", True) # Wrong attempt for "هو" (dist > 1)
            with patch("alignment.engine.time.time", side_effect=[0.0, 1.0, 3.0]):
                for _ in range(3):
                    ws2.send_bytes(b"1234")
                    time.sleep(0.1) # allow processor to consume latest_audio
            
            res2 = ws2.receive_json()
            assert res2["type"] == "wordResult"
            assert res2["status"] == "wrong"
            assert res2["wordIndex"] == 5
            
            # Send correct word for index 5
            mock_transcribe.return_value = ("هو", True)
            ws2.send_bytes(b"1234")
            
            res3 = ws2.receive_json()
            assert res3["type"] == "wordResult"
            assert res3["status"] == "correct"
            assert res3["wordIndex"] == 5
            
            # Send skip command for index 6
            ws2.send_json({
                "type": "skipWord",
                "wordIndex": 6
            })
            
            res4 = ws2.receive_json()
            assert res4["type"] == "wordResult"
            assert res4["status"] == "skipped"
            assert res4["wordIndex"] == 6
