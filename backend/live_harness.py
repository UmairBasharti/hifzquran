"""Manual live test: stream a recorded recitation to a running backend and print what comes back.

Start the backend first (see the README), then from the backend folder, with the virtual
environment switched on:

    python live_harness.py

It sends Al-Ikhlas, ayah 1 (tests/data/112001.mp3) the way the browser would. You should see
one wordResult per word and then a sessionComplete summary.
"""
import asyncio
import json
import os

import numpy as np
import websockets
from faster_whisper.audio import decode_audio

URI = "ws://127.0.0.1:8000/ws"
AUDIO_PATH = os.path.join(os.path.dirname(__file__), "tests", "data", "112001.mp3")
# The backend only accepts connections from its allowed origins (http://localhost:3000 by default).
ORIGIN = "http://localhost:3000"


async def run_harness():
    print(f"Loading {AUDIO_PATH}...")
    try:
        audio_array = decode_audio(AUDIO_PATH, sampling_rate=16000)
    except Exception as error:
        print(f"Error loading audio: {error}")
        return

    print(f"Connecting to {URI}...")
    try:
        async with websockets.connect(URI, additional_headers={"Origin": ORIGIN}) as websocket:
            # 1. Start a session. includeBismillah is off because the recording is only ayah 1.
            await websocket.send(json.dumps({
                "type": "sessionStart",
                "surahNumber": 112,
                "startAyah": 1,
                "endAyah": 1,
                "includeBismillah": False,
            }))
            print("Sent sessionStart.")

            finished = asyncio.Event()

            async def receive_responses():
                try:
                    async for message in websocket:
                        print(f"Received: {message}")
                        if json.loads(message).get("type") == "sessionComplete":
                            finished.set()
                except websockets.exceptions.ConnectionClosed:
                    print("Connection closed.")

            receive_task = asyncio.create_task(receive_responses())

            # 2. Stream the audio in 1.5 s chunks, one per second, like a live microphone.
            chunk_size = int(16000 * 1.5)
            for start in range(0, len(audio_array), chunk_size):
                chunk = audio_array[start:start + chunk_size].astype(np.float32)
                await websocket.send(chunk.tobytes())
                print(f"Sent chunk {start // chunk_size + 1} ({chunk.nbytes} bytes)")
                await asyncio.sleep(1.0)

            # 3. Give the model time to finish the last chunk (slower on a CPU).
            print("Finished sending. Waiting for the result...")
            try:
                await asyncio.wait_for(finished.wait(), timeout=30)
            except asyncio.TimeoutError:
                print("No sessionComplete within 30 seconds.")
            receive_task.cancel()
    except ConnectionRefusedError:
        print("Could not connect. Start the backend first: python -m uvicorn main:app --host 127.0.0.1 --port 8000")


if __name__ == "__main__":
    asyncio.run(run_harness())
