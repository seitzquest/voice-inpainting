/**
 * audio-recorder.js
 * Handles audio recording functionality
 */

class AudioRecorder {
    constructor() {
        // Recording state
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.recordingSeconds = 0;
        this.recordingInterval = null;
        this.audioStream = null;
        this.isPaused = false;
        
        // Audio blobs
        this.tempAudioBlob = null;
        this.audioBlob = null;
        
        // DOM elements
        this.previewPlayer = document.getElementById('previewPlayer');
        this.recordingTime = document.getElementById('recordingTime');
    }
    
    /**
     * Start recording from audio stream
     * @param {MediaStream} stream - Audio stream to record from
     */
    startRecording(stream) {
        this.audioChunks = [];
        this.recordingSeconds = 0;
        this.isPaused = false;
        this.audioStream = stream;
        
        // Immediately reset and display timer
        this.recordingTime.textContent = "0:00";
        
        // Set up audio visualization
        window.AudioVisualizer.setupStreamVisualization(stream, '#recordingWaveform');
        
        // Use higher quality audio encoding where available
        const options = { mimeType: 'audio/webm;codecs=opus' };
        try {
            this.mediaRecorder = new MediaRecorder(stream, options);
        } catch (e) {
            console.log('MediaRecorder with specified options not supported, using default');
            this.mediaRecorder = new MediaRecorder(stream);
        }
        
        // Capture data more frequently for better quality
        this.mediaRecorder.addEventListener('dataavailable', event => {
            if (event.data.size > 0) {
                this.audioChunks.push(event.data);
            }
        });
        
        // Request data chunks every 250ms for smoother recording
        this.mediaRecorder.start(250);
        
        this.mediaRecorder.addEventListener('stop', async () => {
            // Create blob with proper MIME type
            this.tempAudioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
            
            // Convert webm to wav 
            if (this.tempAudioBlob.type === 'audio/webm') {
                try {
                    // Use Web Audio API to convert to WAV
                    const wavBlob = await AudioProcessor.convertToWav(this.tempAudioBlob);
                    this.tempAudioBlob = wavBlob;
                } catch (err) {
                    console.error('Error converting audio format:', err);
                    // Continue with original blob if conversion fails
                }
            }
            
            // Set up preview player
            if (this.previewPlayer.src) {
                URL.revokeObjectURL(this.previewPlayer.src);
            }
            this.previewPlayer.src = URL.createObjectURL(this.tempAudioBlob);
            
            clearInterval(this.recordingInterval);
        });
        
        this.recordingInterval = setInterval(() => {
            if (!this.isPaused) {
                this.recordingSeconds++;
                const minutes = Math.floor(this.recordingSeconds / 60);
                const seconds = this.recordingSeconds % 60;
                this.recordingTime.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            }
        }, 1000);
    }
    
    /**
     * Pause the current recording
     */
    pauseRecording() {
        if (this.mediaRecorder) {
            this.mediaRecorder.pause();
            this.isPaused = true;
        }
    }
    
    /**
     * Resume a paused recording
     */
    resumeRecording() {
        if (this.mediaRecorder) {
            this.mediaRecorder.resume();
            this.isPaused = false;
            
            // Resume visualization
            window.AudioVisualizer.visualize();
        }
    }
    
    /**
     * Finish and save the recording
     */
    finishRecording() {
        if (this.mediaRecorder) {
            this.mediaRecorder.stop();
            
            // Stop all tracks in the stream
            if (this.audioStream) {
                this.audioStream.getTracks().forEach(track => track.stop());
            }
            
            // Clean up audio context
            window.AudioVisualizer.cleanup();
        }
    }
    
    /**
     * Get the current recording as an audio blob
     * @returns {Blob|null} - The recording as a Blob, or null if none exists
     */
    getRecordingBlob() {
        return this.tempAudioBlob;
    }
    
    /**
     * Finalize the current recording, making it the main audio blob
     * @returns {Blob|null} - The finalized audio blob
     */
    finalizeRecording() {
        if (this.tempAudioBlob) {
            this.audioBlob = this.tempAudioBlob;
            return this.audioBlob;
        }
        return null;
    }
    
    /**
     * Clean up resources used by the recorder
     */
    cleanup() {
        // Stop any ongoing recording
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        
        // Stop the timer
        if (this.recordingInterval) {
            clearInterval(this.recordingInterval);
            this.recordingInterval = null;
        }
        
        // Release media stream
        if (this.audioStream) {
            this.audioStream.getTracks().forEach(track => track.stop());
            this.audioStream = null;
        }
        
        // Clean up audio context from visualizer
        window.AudioVisualizer.cleanup();
        
        // Reset state
        this.recordingSeconds = 0;
        this.isPaused = false;
        this.audioChunks = [];
        this.mediaRecorder = null;
        
        // Clear audio preview
        if (this.previewPlayer && this.previewPlayer.src) {
            this.previewPlayer.pause();
            URL.revokeObjectURL(this.previewPlayer.src);
            this.previewPlayer.src = '';
        }
    }
}

// Initialize recorder when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.audioRecorder = new AudioRecorder();
});