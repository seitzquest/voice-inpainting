/**
 * Simplified visualizer.js
 * Handles audio visualization using Web Audio API
 */

class AudioVisualizer {
    constructor() {
        this.audioContext = null;
        this.analyser = null;
        this.audioSourceNode = null;
        this.dataArray = null;
        this.waveformBars = null;
        this.animationFrame = null;
        this.isActive = false;
        this.currentSelector = null;
    }
    
    /**
     * Clean up audio context and connections
     */
    cleanup() {
        // Cancel animation
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
        
        // Disconnect audio source
        if (this.audioSourceNode) {
            try {
                this.audioSourceNode.disconnect();
            } catch (err) {
                console.error('Error disconnecting audio source:', err);
            }
            this.audioSourceNode = null;
        }
        
        // Close audio context
        if (this.audioContext) {
            try {
                this.audioContext.close().catch(err => {
                    console.error('Error closing audio context:', err);
                });
            } catch (err) {
                console.error('Error closing audio context:', err);
            }
            this.audioContext = null;
            this.analyser = null;
        }
        
        // Reset flags
        this.isActive = false;
        this.currentSelector = null;
    }
    
    /**
     * Set up audio visualization for a stream
     * @param {MediaStream} stream - Media stream to visualize
     * @param {string} waveformSelector - CSS selector for waveform bars container
     */
    setupStreamVisualization(stream, waveformSelector) {
        // Clean up previous context
        this.cleanup();
        
        try {
            // Create audio context
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Create analyser
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.analyser.smoothingTimeConstant = 0.7;
            
            // Create source from stream
            const source = this.audioContext.createMediaStreamSource(stream);
            source.connect(this.analyser);
            this.audioSourceNode = source;
            
            // Set up data array
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            
            // Store selector
            this.currentSelector = waveformSelector;
            
            // Get waveform bars after a short delay to ensure DOM is ready
            setTimeout(() => {
                this.waveformBars = document.querySelectorAll(`${waveformSelector} .waveform-bar`);
                this.startVisualization();
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
        // Clean up first
        this.cleanup();
        
        try {
            // Create audio context
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Create analyser
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.analyser.smoothingTimeConstant = 0.5;
            this.analyser.minDecibels = -90;
            this.analyser.maxDecibels = -10;
            
            // Create source from audio element
            this.audioSourceNode = this.audioContext.createMediaElementSource(audioElement);
            this.audioSourceNode.connect(this.analyser);
            this.analyser.connect(this.audioContext.destination);
            
            // Set up data array
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            
            // Store selector
            this.currentSelector = waveformSelector;
            
            // Get waveform bars
            this.waveformBars = document.querySelectorAll(`${waveformSelector} .waveform-bar`);
        } catch (err) {
            console.error('Error setting up playback visualization:', err);
            this.cleanup();
        }
    }
    
    /**
     * Start visualization
     */
    startVisualization() {
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
        
        // Reset waveform
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
        // If visualization is not active or missing components, don't continue
        if (!this.isActive || !this.analyser || !this.waveformBars || this.waveformBars.length === 0) {
            return;
        }
        
        // Get frequency data
        this.analyser.getByteFrequencyData(this.dataArray);
        
        // Update bar heights based on frequency data
        for (let i = 0; i < this.waveformBars.length; i++) {
            // Use different frequency bands for each bar
            const index = Math.floor((i / this.waveformBars.length) * (this.dataArray.length * 0.75));
            const value = this.dataArray[index];
            
            // Scale value to height (5px to 30px)
            const percent = value / 255;
            const height = 5 + (percent * 25);
            
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
        
        // Wait for audio to be ready if needed
        if (audioElement.readyState < 2) {
            audioElement.addEventListener('canplay', () => {
                if (this.isActive) {
                    this.visualize();
                }
            }, { once: true });
            return;
        }
        
        // Start visualization
        this.visualize();
        
        // Stop visualization when playback ends or pauses
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