/**
 * visualizer.js
 * Handles audio visualization using Web Audio API
 */

class AudioVisualizer {
    constructor() {
        this.audioContext = null;
        this.analyser = null;
        this.audioSourceNode = null;
        this.dataArray = null;
        this.waveformBars = null;
        this.audioSourceConnected = false;
        this.animationFrame = null;
    }
    
    /**
     * Clean up audio context and connections
     */
    cleanup() {
        // Cancel any ongoing animation
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
        
        // Disconnect the audio source if it exists
        if (this.audioSourceNode) {
            try {
                this.audioSourceNode.disconnect();
            } catch (err) {
                console.error('Error disconnecting audio source:', err);
            }
            this.audioSourceNode = null;
        }
        
        // Close the audio context if it exists
        if (this.audioContext) {
            this.audioContext.close().catch(err => {
                console.error('Error closing audio context:', err);
            });
            this.audioContext = null;
            this.analyser = null;
        }
        
        // Reset flag
        this.audioSourceConnected = false;
    }
    
    /**
     * Set up audio visualization for a stream
     * @param {MediaStream} stream - Media stream to visualize
     * @param {string} waveformSelector - CSS selector for waveform bars container
     */
    setupStreamVisualization(stream, waveformSelector) {
        try {
            // Clean up previous audio context
            this.cleanup();
            
            // Create new audio context
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Create an analyser
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            
            // Create a source from the stream
            const source = this.audioContext.createMediaStreamSource(stream);
            source.connect(this.analyser);
            this.audioSourceNode = source;
            
            // Set up data array for frequency data
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            
            // Get waveform bars
            setTimeout(() => {
                this.waveformBars = document.querySelectorAll(`${waveformSelector} .waveform-bar`);
                // Start visualization
                this.visualize();
            }, 50);
        } catch (err) {
            console.error('Error setting up audio visualization:', err);
        }
    }
    
    /**
     * Set up visualization for audio element
     * @param {HTMLAudioElement} audioElement - Audio element to visualize
     * @param {string} waveformSelector - CSS selector for waveform bars container
     */
    setupAudioElementVisualization(audioElement, waveformSelector) {
        try {
            // Clean up first
            this.cleanup();
            
            // Create a new audio context
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Create an analyser
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            
            // Create a source from the audio element
            this.audioSourceNode = this.audioContext.createMediaElementSource(audioElement);
            this.audioSourceNode.connect(this.analyser);
            this.analyser.connect(this.audioContext.destination);
            this.audioSourceConnected = true;
            
            // Set up data array for frequency data
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            
            // Get waveform bars
            this.waveformBars = document.querySelectorAll(`${waveformSelector} .waveform-bar`);
            
        } catch (err) {
            console.error('Error setting up playback visualization:', err);
            this.cleanup();
        }
    }
    
    /**
     * Update visualization for recording or playback
     * @param {boolean} isPlayback - If this is playback (true) or recording (false)
     * @param {HTMLAudioElement} [audioElement] - Audio element for playback checking
     */
    visualize(isPlayback = false, audioElement = null) {
        if (!this.analyser || !this.waveformBars || this.waveformBars.length === 0) return;
        
        // For playback, only continue if audio is playing
        if (isPlayback && audioElement && audioElement.paused) {
            return;
        }
        
        // Get frequency data
        this.analyser.getByteFrequencyData(this.dataArray);
        
        // Use frequency data to adjust bar heights
        for (let i = 0; i < this.waveformBars.length; i++) {
            const index = Math.floor(i * this.analyser.frequencyBinCount / this.waveformBars.length);
            const value = this.dataArray[index];
            const percent = value / 255;
            const height = 5 + (percent * 25); // Scale between 5px and 30px
            this.waveformBars[i].style.height = height + 'px';
        }
        
        // Continue visualization loop based on mode
        if (isPlayback) {
            if (audioElement && !audioElement.paused) {
                this.animationFrame = requestAnimationFrame(() => this.visualize(true, audioElement));
            }
        } else {
            this.animationFrame = requestAnimationFrame(() => this.visualize(false));
        }
    }
    
    /**
     * Start playback visualization
     * @param {HTMLAudioElement} audioElement - Audio element for playback
     */
    visualizePlayback(audioElement) {
        this.visualize(true, audioElement);
    }
    
    /**
     * Reset waveform bars to silent state
     * @param {string} waveformSelector - CSS selector for waveform container
     * @param {number} [height=2] - Height in pixels for silent state
     */
    resetWaveform(waveformSelector, height = 2) {
        const bars = document.querySelectorAll(`${waveformSelector} .waveform-bar`);
        bars.forEach(bar => {
            bar.style.height = `${height}px`;
        });
    }
}

// Make visualizer available globally
window.AudioVisualizer = new AudioVisualizer();