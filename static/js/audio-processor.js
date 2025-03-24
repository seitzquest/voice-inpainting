/**
 * audio-processor.js
 * Handles audio format conversion and processing
 */

class AudioProcessor {
    /**
     * Convert audio blob to WAV format
     * @param {Blob} blob - Audio blob to convert
     * @returns {Promise<Blob>} - Promise that resolves to WAV blob
     */
    static async convertToWav(blob) {
        return new Promise(async (resolve, reject) => {
            try {
                // Create AudioContext
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                
                // Convert blob to array buffer
                const arrayBuffer = await blob.arrayBuffer();
                
                // Decode the audio data
                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                
                // Create WAV file from audioBuffer
                const wavBuffer = this.audioBufferToWav(audioBuffer);
                
                // Create WAV blob
                const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });
                resolve(wavBlob);
            } catch (err) {
                reject(err);
            }
        });
    }
    
    /**
     * Convert AudioBuffer to WAV format
     * @param {AudioBuffer} buffer - Audio buffer to convert
     * @returns {ArrayBuffer} - WAV format array buffer
     */
    static audioBufferToWav(buffer) {
        const numChannels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const format = 1; // PCM
        const bitDepth = 16;
        
        let result;
        if (numChannels === 2) {
            result = this.interleave(buffer.getChannelData(0), buffer.getChannelData(1));
        } else {
            result = buffer.getChannelData(0);
        }
        
        return this.encodeWAV(result, format, sampleRate, numChannels, bitDepth);
    }
    
    /**
     * Interleave left and right channel data
     * @param {Float32Array} leftChannel - Left channel data
     * @param {Float32Array} rightChannel - Right channel data
     * @returns {Float32Array} - Interleaved audio data
     */
    static interleave(leftChannel, rightChannel) {
        const length = leftChannel.length + rightChannel.length;
        const result = new Float32Array(length);
        
        let inputIndex = 0;
        for (let i = 0; i < length; ) {
            result[i++] = leftChannel[inputIndex];
            result[i++] = rightChannel[inputIndex];
            inputIndex++;
        }
        return result;
    }
    
    /**
     * Encode audio data to WAV format
     * @param {Float32Array} samples - Audio samples
     * @param {number} format - Audio format (1 = PCM)
     * @param {number} sampleRate - Sample rate in Hz
     * @param {number} numChannels - Number of channels
     * @param {number} bitDepth - Bit depth (8, 16, 24, 32)
     * @returns {ArrayBuffer} - WAV format array buffer
     */
    static encodeWAV(samples, format, sampleRate, numChannels, bitDepth) {
        const bytesPerSample = bitDepth / 8;
        const blockAlign = numChannels * bytesPerSample;
        
        const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
        const view = new DataView(buffer);
        
        // RIFF identifier
        this.writeString(view, 0, 'RIFF');
        // RIFF chunk length
        view.setUint32(4, 36 + samples.length * bytesPerSample, true);
        // RIFF type
        this.writeString(view, 8, 'WAVE');
        // format chunk identifier
        this.writeString(view, 12, 'fmt ');
        // format chunk length
        view.setUint32(16, 16, true);
        // sample format (raw)
        view.setUint16(20, format, true);
        // channel count
        view.setUint16(22, numChannels, true);
        // sample rate
        view.setUint32(24, sampleRate, true);
        // byte rate (sample rate * block align)
        view.setUint32(28, sampleRate * blockAlign, true);
        // block align (channel count * bytes per sample)
        view.setUint16(32, blockAlign, true);
        // bits per sample
        view.setUint16(34, bitDepth, true);
        // data chunk identifier
        this.writeString(view, 36, 'data');
        // data chunk length
        view.setUint32(40, samples.length * bytesPerSample, true);
        
        // Write the PCM samples
        const offset = 44;
        if (bitDepth === 16) {
            this.floatTo16BitPCM(view, offset, samples);
        } else {
            this.writeFloat32(view, offset, samples);
        }
        
        return buffer;
    }
    
    /**
     * Write string to DataView
     * @param {DataView} view - DataView to write to
     * @param {number} offset - Offset in bytes
     * @param {string} string - String to write
     */
    static writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }
    
    /**
     * Convert float audio data to 16-bit PCM
     * @param {DataView} output - DataView to write to
     * @param {number} offset - Offset in bytes
     * @param {Float32Array} input - Float audio data
     */
    static floatTo16BitPCM(output, offset, input) {
        for (let i = 0; i < input.length; i++, offset += 2) {
            const s = Math.max(-1, Math.min(1, input[i]));
            output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
    }
    
    /**
     * Write 32-bit float data
     * @param {DataView} output - DataView to write to
     * @param {number} offset - Offset in bytes
     * @param {Float32Array} input - Float audio data
     */
    static writeFloat32(output, offset, input) {
        for (let i = 0; i < input.length; i++, offset += 4) {
            output.setFloat32(offset, input[i], true);
        }
    }
    
    /**
     * Process audio with the server API
     * @param {Blob} audioBlob - Audio blob to process
     * @param {string} prompt - Processing instructions
     * @returns {Promise<Object>} - Object with processedBlob and metadata
     */
    static async processAudio(audioBlob, prompt) {
        // Ensure we have a proper WAV file with correct filename extension
        const formData = new FormData();
        
        // Create a File object from Blob with proper extension
        const audioFile = new File([audioBlob], "input.wav", { 
            type: "audio/wav",
            lastModified: new Date().getTime()
        });
        
        formData.append('audio', audioFile);
        formData.append('prompt', prompt);
        formData.append('return_metadata', 'true');  // Request JSON response
        
        // Log information about the file being sent
        console.log("Sending file:", audioFile.name, audioFile.type, audioFile.size, "bytes");
        
        const response = await fetch('/api/process', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}: ${await response.text()}`);
        }
        
        // Check if response includes JSON metadata
        let processedBlob;
        let processingMetadata = {};
        
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            // Handle JSON response with metadata
            processingMetadata = await response.json();
            
            if (processingMetadata.output_url) {
                // Fetch the audio file separately
                const audioResponse = await fetch(processingMetadata.output_url);
                processedBlob = await audioResponse.blob();
            } else {
                throw new Error('No output audio URL in response');
            }
        } else {
            // Direct audio blob response
            processedBlob = await response.blob();
        }
        
        return {
            processedBlob,
            metadata: processingMetadata
        };
    }
}

// Make the processor available globally
window.AudioProcessor = AudioProcessor;