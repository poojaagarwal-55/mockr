/**
 * AudioWorkletProcessor for ultra-low-latency microphone capture.
 * Sends PCM chunks every ~32ms (512 samples at 16kHz).
 * Runs on the audio rendering thread — zero main-thread jank.
 */
class PCMCaptureProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._buffer = new Float32Array(512); // ~32ms at 16kHz
        this._writeIndex = 0;
        this._packetCount = 0;
    }

    process(inputs) {
        const input = inputs[0];
        if (!input || !input[0]) return true;

        const channelData = input[0]; // mono

        for (let i = 0; i < channelData.length; i++) {
            this._buffer[this._writeIndex++] = channelData[i];

            if (this._writeIndex >= this._buffer.length) {
                // Calculate audio level for debugging
                let sum = 0;
                for (let j = 0; j < this._buffer.length; j++) {
                    sum += Math.abs(this._buffer[j]);
                }
                const avgLevel = sum / this._buffer.length;
                
                // Log every 50th packet to avoid spam
                this._packetCount++;
                if (this._packetCount % 50 === 0) {
                    console.log(`[AudioWorklet] Packet #${this._packetCount}, avg level: ${avgLevel.toFixed(4)}`);
                }

                // Convert float32 → int16 PCM LE and send
                const int16 = new Int16Array(this._buffer.length);
                for (let j = 0; j < this._buffer.length; j++) {
                    const s = Math.max(-1, Math.min(1, this._buffer[j]));
                    int16[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }
                // Transfer the underlying ArrayBuffer for zero-copy
                this.port.postMessage(int16.buffer, [int16.buffer]);
                // Re-allocate after transfer
                this._buffer = new Float32Array(512);
                this._writeIndex = 0;
            }
        }

        return true; // keep processor alive
    }
}

registerProcessor("pcm-capture-processor", PCMCaptureProcessor);
