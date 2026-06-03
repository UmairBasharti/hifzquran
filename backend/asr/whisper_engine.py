import os
import sys
import site

if os.name == 'nt':
    for sp in site.getsitepackages():
        for lib in ["cudnn", "cublas", "cuda_nvrtc", "cuda_runtime"]:
            bin_dir = os.path.join(sp, "nvidia", lib, "bin")
            if os.path.exists(bin_dir):
                os.environ["PATH"] = bin_dir + os.pathsep + os.environ["PATH"]
                try:
                    os.add_dll_directory(bin_dir)
                except Exception:
                    pass

import numpy as np
from faster_whisper import WhisperModel

import threading

# Global singleton to hold the loaded model
whisper_model = None
MODEL_LOADED = False
model_lock = threading.Lock()
# Beam width is chosen by device: a GPU can afford accurate beam search (5) at near-zero latency,
# while on CPU greedy (1) keeps each chunk fast. Set in load_model once the device is known.
whisper_beam_size = 1

async def load_model():
    """
    Loads the specialized Arabic Quran Whisper model into memory.
    Runs once at server startup.
    """
    global whisper_model, MODEL_LOADED, whisper_beam_size

    # Model is swappable via env (e.g. a larger Quran fine-tune on a GPU host).
    model_name = os.getenv("MODEL_NAME", "OdyAsh/faster-whisper-base-ar-quran")

    # Auto-detect a GPU (no torch needed — CTranslate2 reports CUDA devices). On a GPU
    # host the accurate base model runs live (~0.2s); on CPU we use int8 + every core.
    device = os.getenv("ASR_DEVICE") or detect_best_device()
    compute_type = os.getenv("ASR_COMPUTE_TYPE") or ("float16" if device == "cuda" else "int8")
    cpu_thread_count = os.cpu_count() or 4

    # Accurate beam search on GPU (essentially free there); greedy on CPU to stay responsive.
    whisper_beam_size = 5 if device == "cuda" else 1

    print(f"Loading Whisper model '{model_name}' on {device} ({compute_type}), beam={whisper_beam_size}...")
    whisper_model = WhisperModel(
        model_name, device=device, compute_type=compute_type, cpu_threads=cpu_thread_count
    )

    MODEL_LOADED = True
    print("Whisper model loaded successfully.")


# Returns "cuda" when a GPU is available, otherwise "cpu" — used to pick the device.
def detect_best_device():
    try:
        import ctranslate2
        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda"
    except Exception:
        pass
    return "cpu"

# A chunk whose raw peak is below this is background/silence. Skipping it stops the model
# from hallucinating words out of amplified noise (Whisper invents text from loud static).
SILENCE_PEAK_THRESHOLD = 0.05

def normalize_audio_amplitude(audio_float32: np.ndarray) -> np.ndarray:
    """
    Peak-normalizes the audio so quiet recitation is boosted, but caps the gain so quiet
    background noise is never blown up to speech level (which causes hallucinated words).
    """
    max_amp = np.max(np.abs(audio_float32))
    if max_amp > 0:
        gain = min(0.95 / max_amp, 8.0)
        return audio_float32 * gain
    return audio_float32

def transcribe_audio_chunk(audio_float32: np.ndarray, expected_text: str = "") -> tuple[str, bool]:
    """
    Transcribes a 16kHz mono Float32 audio chunk.
    Returns: (transcribed_text: str, speech_detected: bool)
    """
    if not MODEL_LOADED or whisper_model is None:
        raise RuntimeError("Whisper model is not loaded yet.")

    # 0. Noise gate on the RAW signal — quiet chunks are silence/background, so skip them
    # before normalization to avoid amplifying noise into hallucinated words.
    raw_peak = float(np.max(np.abs(audio_float32))) if audio_float32.size else 0.0
    if raw_peak < SILENCE_PEAK_THRESHOLD:
        return ("", False)

    # 1. Normalize amplitude for quiet whisper support
    normalized_audio = normalize_audio_amplitude(audio_float32)

    # 2. Transcribe. CRITICAL: we deliberately do NOT pass initial_prompt anymore. Feeding the
    # expected ayah made Whisper parrot it back from silence/noise, so words turned green before
    # the user recited. The model is already Quran-fine-tuned, so it recognises the vocabulary
    # without that crutch. condition_on_previous_text=False avoids cross-chunk drift; VAD +
    # no_speech_threshold filter out silence. (expected_text is kept in the signature for the
    # caller but no longer biases decoding.)
    with model_lock:
        segments, info = whisper_model.transcribe(
            normalized_audio,
            language="ar",
            beam_size=whisper_beam_size,
            condition_on_previous_text=False,
            vad_filter=True,
            vad_parameters={
                "min_silence_duration_ms": 800,
                "speech_pad_ms": 200,
                "threshold": 0.4
            },
            no_speech_threshold=0.3,
            log_prob_threshold=-1.0,
            compression_ratio_threshold=2.4
        )

        # segments is a generator — iterate it inside the lock to actually run inference.
        transcribed_segments = list(segments)

    if not transcribed_segments:
        return ("", False)

    # 3. Drop segments Whisper itself flags as non-speech (a hallucination guard), then join the
    # rest. We rely on prompt-removal + the alignment engine (which only advances on words that
    # match the expected ayah) to ignore any stray/continuation words — so we do NOT need the
    # costly per-word timestamp pass, which was the main thing making each chunk slow.
    real_speech_segments = [
        segment for segment in transcribed_segments
        if segment.no_speech_prob < 0.6
    ]
    if not real_speech_segments:
        return ("", False)

    full_text = " ".join(segment.text for segment in real_speech_segments).strip()
    if not full_text:
        return ("", False)

    return (full_text, True)
