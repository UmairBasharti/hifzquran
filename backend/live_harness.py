import asyncio
import json
import os
import websockets
import numpy as np
from faster_whisper.audio import decode_audio

async def run_harness():
    uri = "ws://localhost:8000/ws"
    filepath = os.path.join(os.path.dirname(__file__), "tests", "data", "112001.mp3")
    print(f"Loading {filepath}...")
    
    try:
        audio_array = decode_audio(filepath, sampling_rate=16000)
    except Exception as e:
        print(f"Error loading audio: {e}")
        return
        
    print(f"Connecting to {uri}...")
    try:
        async with websockets.connect(uri, additional_headers={"Origin": "http://localhost:3000"}) as websocket:
            # 1. Send session init
            init_msg = {
                "surahNumber": 112,
                "startAyah": 1,
                "endAyah": 1
            }
            await websocket.send(json.dumps(init_msg))
            print("Sent init message.")
            
            # Start a task to read responses
            async def receive_responses():
                try:
                    async for message in websocket:
                        print(f"Received: {message}")
                except websockets.exceptions.ConnectionClosed:
                    print("Connection closed.")
            
            receive_task = asyncio.create_task(receive_responses())
            
            # 2. Stream audio in 1.5s chunks (24000 samples)
            chunk_size = int(16000 * 1.5)
            for i in range(0, len(audio_array), chunk_size):
                chunk = audio_array[i:i+chunk_size]
                chunk_bytes = chunk.tobytes()
                await websocket.send(chunk_bytes)
                print(f"Sent chunk {i // chunk_size + 1} ({len(chunk_bytes)} bytes)")
                await asyncio.sleep(1.0) # Simulate real-time streaming delay
            
            # Wait for final processing
            print("Finished sending chunks. Waiting for final results...")
            await asyncio.sleep(4)
            receive_task.cancel()
    except ConnectionRefusedError:
        print("Could not connect to server. Make sure 'uvicorn main:app --port 8000' is running.")

if __name__ == "__main__":
    asyncio.run(run_harness())
