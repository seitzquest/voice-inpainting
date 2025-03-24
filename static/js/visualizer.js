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
        this.isActive = false;        // Whether visualization is active
        this.visualizationType = null; // 'recording' or 'playback'
        this.currentSelector = null;   // Current waveform selector
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
        
        // Reset flags
        this.audioSourceConnected = false;
        this.isActive = false;
        this.visualizationType = null;
        this.currentSelector = null;
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
            this.analyser.smoothingTimeConstant = 0.7; // Better smoothing
            
            // Create a source from the stream
            const source = this.audioContext.createMediaStreamSource(stream);
            source.connect(this.analyser);
            this.audioSourceNode = source;
            
            // Set up data array for frequency data
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            
            // Set state
            this.visualizationType = 'recording';
            this.currentSelector = waveformSelector;
            
            // Get waveform bars
            setTimeout(() => {
                this.waveformBars = document.querySelectorAll(`${waveformSelector} .waveform-bar`);
                // Start visualization
                this.startRecordingVisualization();
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
            
            // Create an analyser with enhanced settings for playback
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.analyser.smoothingTimeConstant = 0.5; // Less smoothing for more responsive playback
            this.analyser.minDecibels = -90;
            this.analyser.maxDecibels = -10;
            
            // Create a source from the audio element
            this.audioSourceNode = this.audioContext.createMediaElementSource(audioElement);
            this.audioSourceNode.connect(this.analyser);
            this.analyser.connect(this.audioContext.destination);
            this.audioSourceConnected = true;
            
            // Set up data array for frequency data
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            
            // Set state
            this.visualizationType = 'playback';
            this.currentSelector = waveformSelector;
            
            // Get waveform bars
            this.waveformBars = document.querySelectorAll(`${waveformSelector} .waveform-bar`);
            
        } catch (err) {
            console.error('Error setting up playback visualization:', err);
            this.cleanup();
        }
    }
    
    /**
     * Start recording visualization
     */
    startRecordingVisualization() {
        this.isActive = true;
        this.visualize();
    }
    
    /**
     * Pause visualization and reset waveform
     */
    pauseVisualization() {
        this.isActive = false;
        
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
        
        // Reset the current waveform if we have one
        if (this.currentSelector) {
            this.resetWaveform(this.currentSelector);
        }
    }
    
    /**
     * Resume visualization
     */
    resumeVisualization() {
        if (!this.isActive) {
            this.isActive = true;
            this.visualize();
        }
    }
    
    /**
     * Update visualization based on audio data
     */
    visualize() {
        // If visualization is not active, don't continue
        if (!this.isActive || !this.analyser || !this.waveformBars || this.waveformBars.length === 0) {
            return;
        }
        
        // Get frequency data
        this.analyser.getByteFrequencyData(this.dataArray);
        
        // Determine scaling based on visualization type
        const scaleFactor = this.visualizationType === 'playback' ? 1.5 : 1.0; // Boost playback visualization
        
        // Use frequency data to adjust bar heights
        for (let i = 0; i < this.waveformBars.length; i++) {
            // Use different frequency bands based on the bar index
            // This creates a more natural waveform appearance
            const index = Math.floor((i / this.waveformBars.length) * (this.dataArray.length * 0.75));
            const value = this.dataArray[index];
            
            // Apply scaling and handle bounds
            const percent = Math.min(1.0, (value / 255) * scaleFactor);
            const height = 5 + (percent * 25); // Scale between 5px and 30px
            
            this.waveformBars[i].style.height = `${height}px`;
        }
        
        // Continue visualization if still active
        if (this.isActive) {
            this.animationFrame = requestAnimationFrame(() => this.visualize());
        }
    }
    
    /**
     * Start playback visualization
     * @param {HTMLAudioElement} audioElement - Audio element for playback
     */
    visualizePlayback(audioElement) {
        if (!audioElement) return;
        
        // Start visualization
        this.isActive = true;
        
        // If audio isn't ready, wait for it
        if (audioElement.readyState < 2) { // HAVE_CURRENT_DATA or higher
            audioElement.addEventListener('canplay', () => {
                if (this.isActive) {
                    this.visualize();
                }
            }, { once: true });
            return;
        }
        
        // Start visualization
        this.visualize();
        
        // Monitor playback state - if it ends/pauses, stop visualization
        audioElement.addEventListener('pause', () => {
            this.pauseVisualization();
        }, { once: true });
        
        audioElement.addEventListener('ended', () => {
            this.pauseVisualization();
        }, { once: true });
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