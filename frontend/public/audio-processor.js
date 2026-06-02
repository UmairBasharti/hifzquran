class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.TARGET_SAMPLE_RATE = 16000;
    this.bufferLimitSamples = this.TARGET_SAMPLE_RATE * 6; // 6s rolling window
    this.stepSamples = this.TARGET_SAMPLE_RATE * 0.8; // send every 0.8s
    
    // Preallocated Float32Array ring buffer to avoid array push GC pauses
    this.ringBuffer = new Float32Array(this.bufferLimitSamples);
    this.writeIndex = 0;
    this.isBufferFull = false;
    
    this.samplesSinceLastSend = 0;
    this.sumSquares = 0; // for volume calculation
    this.volSamplesCount = 0;
  }

  // Fast linear downsampling within the worklet thread to avoid main-thread jank
  _downsample(inputBuffer, inputSampleRate) {
    if (inputSampleRate === this.TARGET_SAMPLE_RATE) {
      return inputBuffer;
    }
    const ratio = inputSampleRate / this.TARGET_SAMPLE_RATE;
    const newLength = Math.round(inputBuffer.length / ratio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
      let accum = 0, count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < inputBuffer.length; i++) {
        accum += inputBuffer[i];
        count++;
      }
      result[offsetResult] = accum / count;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true; // Keep processor alive if no input

    const channelData = input[0];
    // sampleRate is a global variable in AudioWorkletGlobalScope
    const inputSampleRate = sampleRate; 

    const processedData = this._downsample(channelData, inputSampleRate);

    // Write to ring buffer
    for (let i = 0; i < processedData.length; i++) {
      const sample = processedData[i];
      
      this.ringBuffer[this.writeIndex] = sample;
      this.writeIndex++;
      
      if (this.writeIndex >= this.bufferLimitSamples) {
        this.writeIndex = 0;
        this.isBufferFull = true;
      }
      
      this.sumSquares += sample * sample;
      this.volSamplesCount++;
      this.samplesSinceLastSend++;
    }

    // Send chunk to main thread when step size is reached
    if (this.samplesSinceLastSend >= this.stepSamples) {
      let chunk;
      // Read the chronologically ordered window out of the ring buffer
      if (this.isBufferFull) {
        chunk = new Float32Array(this.bufferLimitSamples);
        // read from writeIndex to end
        const part1Length = this.bufferLimitSamples - this.writeIndex;
        chunk.set(this.ringBuffer.subarray(this.writeIndex, this.bufferLimitSamples), 0);
        // read from 0 to writeIndex
        chunk.set(this.ringBuffer.subarray(0, this.writeIndex), part1Length);
      } else {
        chunk = new Float32Array(this.writeIndex);
        chunk.set(this.ringBuffer.subarray(0, this.writeIndex), 0);
      }
      
      const rms = Math.sqrt(this.sumSquares / this.volSamplesCount);
      
      this.port.postMessage({
        type: 'audio_chunk',
        chunk: chunk,
        volume: rms
      }, [chunk.buffer]); // Transfer buffer ownership for zero-copy messaging where possible
      
      this.samplesSinceLastSend = 0;
      this.sumSquares = 0;
      this.volSamplesCount = 0;
    }

    return true; // Keep processor alive
  }
}

registerProcessor('mic-processor', MicProcessor);
