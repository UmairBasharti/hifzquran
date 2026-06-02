/**
 * Audio capture and processing utility for HifzAI.
 * 
 * Responsibilities:
 * 1. Request microphone permissions.
 * 2. Capture raw audio using Web Audio API (AudioContext).
 * 3. Downsample to exactly 16kHz (Whisper AI requirement).
 * 4. Convert to Float32 PCM arrays.
 * 5. Stream chunks via a callback.
 */

export class AudioRecorder {
  constructor(onDataAvailable, onVolumeChange) {
    this.onDataAvailable = onDataAvailable; // Callback for when a chunk is ready
    this.onVolumeChange = onVolumeChange; // Callback for live volume data
    this.audioContext = null;
    this.mediaStream = null;
    this.workletNode = null;
    this.source = null;
    this.isRecording = false;
    
    // Whisper expects exactly 16,000 Hz
    this.TARGET_SAMPLE_RATE = 16000;
  }

  async start() {
    if (this.isRecording) return;

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Microphone access is blocked! Browsers require 'localhost' or HTTPS to use the mic. To test on this device, use Chrome and go to chrome://flags/#unsafely-treat-insecure-origin-as-secure and add this IP.");
      }

      // Request mic permission — ask the browser for 16kHz mono directly.
      // Whisper is trained on 16kHz mono; capturing at the device default (44.1/48kHz)
      // silently degrades accuracy (AGENTS.md rule 3).
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: this.TARGET_SAMPLE_RATE,
          channelCount: 1, // Mono
          // The browser's telephony DSP (echo cancellation, noise suppression, auto gain)
          // distorts sustained Quran recitation and wrecks ASR accuracy — capture the raw
          // voice instead. This is why "بِسْمِ" was transcribed as garbage with these on.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        },
        video: false
      });

      // Prefer a 16kHz context (Whisper's native rate); fall back to the device
      // default if the browser rejects a forced rate — _downsampleBuffer covers that.
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      try {
        this.audioContext = new AudioContextClass({ sampleRate: this.TARGET_SAMPLE_RATE });
      } catch (forcedRateError) {
        console.warn("16kHz AudioContext rejected, using device default rate:", forcedRateError);
        this.audioContext = new AudioContextClass();
      }

      // Connect the mic to the context
      this.source = this.audioContext.createMediaStreamSource(this.mediaStream);

      // Create an AudioWorkletNode to intercept the raw audio data off the main thread (1.7.1)
      await this.audioContext.audioWorklet.addModule('/audio-processor.js');
      this.workletNode = new AudioWorkletNode(this.audioContext, 'mic-processor');

      this.workletNode.port.onmessage = (e) => {
        if (!this.isRecording) return;
        const msg = e.data;
        if (msg.type === 'audio_chunk') {
          if (this.onDataAvailable) {
            this.onDataAvailable(msg.chunk);
          }
          if (this.onVolumeChange) {
            this.onVolumeChange(msg.volume);
          }
        }
      };

      // Connect the graph: Mic -> Worklet
      // We do NOT connect the worklet to audioContext.destination because it would cause 
      // mic feedback (echo) and AudioWorklets run perfectly fine without a destination connection.
      this.source.connect(this.workletNode);

      // Browsers create an AudioContext in a "suspended" state. Without resume()
      // the onaudioprocess callback never fires and no audio is ever captured —
      // the mic appears live but nothing is sent to the backend.
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }

      this.isRecording = true;
    } catch (error) {
      console.error("Failed to start audio recording:", error);
      if (error?.name === "NotAllowedError") {
        throw new Error("Microphone access is needed for Hifz Mode. Please allow microphone access in your browser settings and refresh the page.");
      }
      throw error;
    }
  }

  stop() {
    this.isRecording = false;

    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode.port.onmessage = null;
      this.workletNode = null;
    }

    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext && this.audioContext.state !== "closed") {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  // (Downsampling logic has been moved to the AudioWorklet to prevent UI jank)
}
