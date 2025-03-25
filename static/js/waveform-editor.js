/**
 * waveform-editor.js
 * Advanced waveform visualization with token highlighting
 */

class WaveformEditor {
    constructor(container, options = {}) {
        this.container = container;
        this.options = Object.assign({
            height: 100,
            barWidth: 3,
            barGap: 1,
            selectedColor: 'var(--color-primary-light)',
            modifiedColor: 'var(--color-error)',
            defaultColor: '#CCCCCC',
            darkModeDefaultColor: '#666666',
        }, options);
        
        // Canvas elements
        this.canvasContainer = null;
        this.waveformCanvas = null;
        this.playheadCanvas = null;
        this.ctx = null;
        this.playheadCtx = null;
        
        // Audio data
        this.audioBuffer = null;
        this.audioElement = null;
        this.audioContext = null;
        this.audioData = null;  // Processed waveform data
        
        // Token data
        this.tokens = [];       // Array of token metadata
        this.selectedTokens = [];
        this.modifiedTokens = [];
        
        // Playback state
        this.isPlaying = false;
        this.playbackStartTime = 0;
        this.animationFrame = null;
        
        // Interaction
        this.isDragging = false;
    }
    
    /**
     * Initialize the waveform editor
     */
    initialize() {
        // Create container
        this.canvasContainer = document.createElement('div');
        this.canvasContainer.className = 'waveform-editor-container';
        this.canvasContainer.style.width = '100%';
        this.canvasContainer.style.height = `${this.options.height}px`;
        this.canvasContainer.style.position = 'relative';
        this.canvasContainer.style.marginBottom = '1rem';
        this.container.appendChild(this.canvasContainer);
        
        // Create waveform canvas
        this.waveformCanvas = document.createElement('canvas');
        this.waveformCanvas.className = 'waveform-canvas';
        this.waveformCanvas.style.position = 'absolute';
        this.waveformCanvas.style.top = '0';
        this.waveformCanvas.style.left = '0';
        this.waveformCanvas.style.width = '100%';
        this.waveformCanvas.style.height = '100%';
        this.canvasContainer.appendChild(this.waveformCanvas);
        
        // Create playhead canvas (overlay)
        this.playheadCanvas = document.createElement('canvas');
        this.playheadCanvas.className = 'playhead-canvas';
        this.playheadCanvas.style.position = 'absolute';
        this.playheadCanvas.style.top = '0';
        this.playheadCanvas.style.left = '0';
        this.playheadCanvas.style.width = '100%';
        this.playheadCanvas.style.height = '100%';
        this.playheadCanvas.style.pointerEvents = 'none';
        this.canvasContainer.appendChild(this.playheadCanvas);
        
        // Get contexts
        this.ctx = this.waveformCanvas.getContext('2d');
        this.playheadCtx = this.playheadCanvas.getContext('2d');
        
        // Set up canvas dimensions
        this.resizeCanvas();
        
        // Add event listeners
        window.addEventListener('resize', () => this.resizeCanvas());
        
        // Add click/touch event listeners for playback control
        this.waveformCanvas.addEventListener('click', (e) => this.handleCanvasClick(e));
        this.waveformCanvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.waveformCanvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.waveformCanvas.addEventListener('mouseup', () => this.handleMouseUp());
        this.waveformCanvas.addEventListener('mouseout', () => this.handleMouseUp());
        
        // Create play/pause button
        this.createPlayButton();
    }
    
    /**
     * Create play/pause button
     */
    createPlayButton() {
        const playButton = document.createElement('button');
        playButton.id = 'waveformPlayButton';
        playButton.className = 'control-btn play-btn absolute bottom-2 left-2';
        playButton.innerHTML = `
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        `;
        this.canvasContainer.appendChild(playButton);
        
        // Add event listener
        playButton.addEventListener('click', () => this.togglePlayback());
    }
    
    /**
     * Resize canvas to fit container
     */
    resizeCanvas() {
        const width = this.canvasContainer.clientWidth;
        
        // Set canvas dimensions (with pixel ratio adjustment for high-DPI displays)
        const pixelRatio = window.devicePixelRatio || 1;
        
        this.waveformCanvas.width = width * pixelRatio;
        this.waveformCanvas.height = this.options.height * pixelRatio;
        this.waveformCanvas.style.width = `${width}px`;
        this.waveformCanvas.style.height = `${this.options.height}px`;
        
        this.playheadCanvas.width = width * pixelRatio;
        this.playheadCanvas.height = this.options.height * pixelRatio;
        this.playheadCanvas.style.width = `${width}px`;
        this.playheadCanvas.style.height = `${this.options.height}px`;
        
        // Scale the context to account for pixel ratio
        this.ctx.scale(pixelRatio, pixelRatio);
        this.playheadCtx.scale(pixelRatio, pixelRatio);
        
        // Redraw if we have data
        if (this.audioData) {
            this.draw();
        }
    }
    
    /**
     * Load audio from an audio element
     * @param {HTMLAudioElement} audioElement - Audio element to load
     */
    loadAudioElement(audioElement) {
        this.audioElement = audioElement;
        
        // Create audio context if needed
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        // Load audio data
        this.loadAudioData();
        
        // Add event listeners to audio element
        this.audioElement.addEventListener('play', () => {
            this.isPlaying = true;
            this.updatePlayButtonState(true);
            this.startPlayheadAnimation();
        });
        
        this.audioElement.addEventListener('pause', () => {
            this.isPlaying = false;
            this.updatePlayButtonState(false);
            this.stopPlayheadAnimation();
        });
        
        this.audioElement.addEventListener('ended', () => {
            this.isPlaying = false;
            this.updatePlayButtonState(false);
            this.stopPlayheadAnimation();
        });
    }
    
    /**
     * Update play button state
     * @param {boolean} isPlaying - Whether audio is playing
     */
    updatePlayButtonState(isPlaying) {
        const playButton = document.getElementById('waveformPlayButton');
        if (!playButton) return;
        
        if (isPlaying) {
            // Use standardized pause button style
            playButton.innerHTML = `
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
            `;
            playButton.classList.remove('play-btn');
            playButton.classList.add('pause-btn');
        } else {
            // Use standardized play button style
            playButton.innerHTML = `
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
            `;
            playButton.classList.remove('pause-btn');
            playButton.classList.add('play-btn');
        }
    }
    
    /**
     * Load and process audio data
     */
    async loadAudioData() {
        if (!this.audioElement) return;
        
        // Create a buffer source from the audio element
        const response = await fetch(this.audioElement.src);
        const arrayBuffer = await response.arrayBuffer();
        
        // Decode the audio data
        try {
            this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            this.processAudioData();
        } catch (error) {
            console.error('Error decoding audio data:', error);
        }
    }
    
    /**
     * Process audio buffer into drawable waveform data
     */
    processAudioData() {
        if (!this.audioBuffer) return;
        
        const channelData = this.audioBuffer.getChannelData(0);
        const duration = this.audioBuffer.duration;
        
        // Calculate how many bars to display
        const width = this.waveformCanvas.clientWidth;
        const totalBars = Math.floor(width / (this.options.barWidth + this.options.barGap));
        const samplesPerBar = Math.ceil(channelData.length / totalBars);
        
        this.audioData = {
            duration,
            width,
            totalBars,
            peaks: []
        };
        
        // Generate peak data for each bar
        for (let bar = 0; bar < totalBars; bar++) {
            const start = bar * samplesPerBar;
            const end = start + samplesPerBar > channelData.length ? channelData.length : start + samplesPerBar;
            
            let min = 1.0;
            let max = -1.0;
            
            for (let i = start; i < end; i++) {
                if (channelData[i] < min) min = channelData[i];
                if (channelData[i] > max) max = channelData[i];
            }
            
            // Store normalized values [-1, 1] => [0, 1]
            this.audioData.peaks.push({
                min: (min + 1) / 2,
                max: (max + 1) / 2
            });
        }
        
        // Draw the initial waveform
        this.draw();
    }
    
    /**
     * Set token data and associate with the waveform
     * @param {Array} tokens - Array of token metadata objects
     */
    setTokenData(tokens) {
        this.tokens = tokens;
        this.draw();
    }
    
    /**
     * Select tokens to highlight
     * @param {Array} tokenIndices - Array of token indices to highlight
     */
    selectTokens(tokenIndices) {
        this.selectedTokens = tokenIndices || [];
        this.draw();
    }
    
    /**
     * Mark tokens as modified (to be highlighted in red)
     * @param {Array} tokenIndices - Array of token indices to mark as modified
     */
    markModifiedTokens(tokenIndices) {
        this.modifiedTokens = tokenIndices || [];
        this.draw();
    }
    
    /**
     * Get the token at a specific time position
     * @param {number} time - Time position in seconds
     * @returns {Object|null} - Token at the given time or null
     */
    getTokenAtTime(time) {
        if (!this.tokens || this.tokens.length === 0) return null;
        
        for (const token of this.tokens) {
            if (time >= token.start_time && time <= token.end_time) {
                return token;
            }
        }
        
        return null;
    }
    
    /**
     * Get token indices that fall within a time range
     * @param {number} startTime - Start time in seconds
     * @param {number} endTime - End time in seconds
     * @returns {Array} - Array of token indices
     */
    getTokensInTimeRange(startTime, endTime) {
        if (!this.tokens || this.tokens.length === 0) return [];
        
        const tokenIndices = [];
        
        for (let i = 0; i < this.tokens.length; i++) {
            const token = this.tokens[i];
            
            // Token overlaps with the time range
            if ((token.start_time <= endTime) && (token.end_time >= startTime)) {
                tokenIndices.push(token.token_idx);
            }
        }
        
        return tokenIndices;
    }
    
    /**
     * Convert time to x-position on canvas
     * @param {number} time - Time in seconds
     * @returns {number} - X position on canvas
     */
    timeToPosition(time) {
        if (!this.audioData) return 0;
        const width = this.waveformCanvas.clientWidth;
        return (time / this.audioData.duration) * width;
    }
    
    /**
     * Convert x-position to time
     * @param {number} x - X position on canvas
     * @returns {number} - Time in seconds
     */
    positionToTime(x) {
        if (!this.audioData) return 0;
        const width = this.waveformCanvas.clientWidth;
        return (x / width) * this.audioData.duration;
    }
    
    /**
     * Draw the waveform with token highlighting
     */
    draw() {
        if (!this.audioData) return;
        
        // Clear canvas
        const width = this.waveformCanvas.clientWidth;
        const height = this.options.height;
        this.ctx.clearRect(0, 0, width, height);
        
        // Determine bar color based on dark mode
        const isDarkMode = document.documentElement.classList.contains('dark');
        const defaultColor = isDarkMode ? this.options.darkModeDefaultColor : this.options.defaultColor;
        
        // Cache token time info for faster lookups
        const tokenRanges = this.tokens.map(token => ({
            tokenIdx: token.token_idx,
            startTime: token.start_time,
            endTime: token.end_time
        }));
        
        console.log("Selected tokens:", this.selectedTokens);
        console.log("Modified tokens:", this.modifiedTokens);
        
        // Draw each bar
        for (let i = 0; i < this.audioData.totalBars; i++) {
            const peak = this.audioData.peaks[i];
            const x = i * (this.options.barWidth + this.options.barGap);
            
            // Calculate height of the bar (use both min and max for more interesting waveform)
            const minHeight = peak.min * height;
            const maxHeight = peak.max * height;
            
            // Calculate vertical center
            const centerY = height / 2;
            
            // Determine the time range represented by this bar
            const startTime = this.positionToTime(x);
            const endTime = this.positionToTime(x + this.options.barWidth);
            
            // Determine bar color based on token state
            let barColor = defaultColor;
            
            // Check if this bar corresponds to a token
            let hasModifiedToken = false;
            let hasSelectedToken = false;
            
            // Check each token to see if it overlaps with this time segment
            for (const tokenRange of tokenRanges) {
                // If there's an overlap between token time and bar time
                if (tokenRange.endTime >= startTime && tokenRange.startTime <= endTime) {
                    if (this.modifiedTokens.includes(tokenRange.tokenIdx)) {
                        hasModifiedToken = true;
                    }
                    if (this.selectedTokens.includes(tokenRange.tokenIdx)) {
                        hasSelectedToken = true;
                    }
                }
            }
            
            // Set bar color based on state - prioritize modification over selection
            if (hasModifiedToken) {
                barColor = this.options.modifiedColor;
            } else if (hasSelectedToken) {
                barColor = this.options.selectedColor;
            }
            
            // Draw the bar (as a rectangle from center)
            this.ctx.fillStyle = barColor;
            
            // Draw from center to max (top part)
            this.ctx.fillRect(
                x, 
                centerY - (maxHeight - centerY), 
                this.options.barWidth, 
                (maxHeight - centerY)
            );
            
            // Draw from center to min (bottom part)
            this.ctx.fillRect(
                x, 
                centerY, 
                this.options.barWidth, 
                (minHeight - centerY) * -1
            );
        }
    }
    
    /**
     * Draw playhead at current audio position
     */
    drawPlayhead() {
        if (!this.audioElement || !this.audioData) return;
        
        const currentTime = this.audioElement.currentTime;
        const progress = currentTime / this.audioData.duration;
        const width = this.playheadCanvas.clientWidth;
        const height = this.options.height;
        
        // Clear playhead canvas
        this.playheadCtx.clearRect(0, 0, width, height);
        
        // Draw playhead line
        const x = progress * width;
        this.playheadCtx.beginPath();
        this.playheadCtx.moveTo(x, 0);
        this.playheadCtx.lineTo(x, height);
        this.playheadCtx.strokeStyle = 'red';
        this.playheadCtx.lineWidth = 2;
        this.playheadCtx.stroke();
    }
    
    /**
     * Start playhead animation
     */
    startPlayheadAnimation() {
        const animatePlayhead = () => {
            this.drawPlayhead();
            if (this.isPlaying) {
                this.animationFrame = requestAnimationFrame(animatePlayhead);
            }
        };
        
        // Cancel any existing animation
        this.stopPlayheadAnimation();
        
        // Start new animation
        this.animationFrame = requestAnimationFrame(animatePlayhead);
    }
    
    /**
     * Stop playhead animation
     */
    stopPlayheadAnimation() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
    }
    
    /**
     * Toggle audio playback
     */
    togglePlayback() {
        if (!this.audioElement) return;
        
        if (this.isPlaying) {
            this.audioElement.pause();
        } else {
            this.audioElement.play();
        }
    }
    
    /**
     * Handle canvas click events
     * @param {MouseEvent} event - Click event
     */
    handleCanvasClick(event) {
        if (!this.audioElement || !this.audioData || this.isDragging) return;
        
        // Calculate the click position relative to canvas
        const rect = this.waveformCanvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        
        // Convert position to time
        const newTime = this.positionToTime(x);
        
        // Set audio playback position
        this.audioElement.currentTime = newTime;
        
        // If not playing, draw playhead at the new position
        if (!this.isPlaying) {
            this.drawPlayhead();
        }
    }
    
    /**
     * Handle mouse down events
     * @param {MouseEvent} event - Mouse event
     */
    handleMouseDown(event) {
        this.isDragging = true;
        this.handleMouseMove(event);
    }
    
    /**
     * Handle mouse move events
     * @param {MouseEvent} event - Mouse event
     */
    handleMouseMove(event) {
        if (!this.isDragging || !this.audioElement) return;
        
        // Calculate the mouse position relative to canvas
        const rect = this.waveformCanvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        
        // Convert position to time
        const newTime = this.positionToTime(x);
        
        // Set audio playback position
        this.audioElement.currentTime = newTime;
        
        // Draw playhead at the new position
        this.drawPlayhead();
    }
    
    /**
     * Handle mouse up events
     */
    handleMouseUp() {
        this.isDragging = false;
    }
    
    /**
     * Clean up resources
     */
    cleanup() {
        this.stopPlayheadAnimation();
        
        // Remove event listeners
        window.removeEventListener('resize', this.resizeCanvas);
        
        // Remove DOM elements
        if (this.canvasContainer && this.canvasContainer.parentNode) {
            this.canvasContainer.parentNode.removeChild(this.canvasContainer);
        }
        
        // Close audio context if it exists and is not closed
        if (this.audioContext && this.audioContext.state !== 'closed') {
            try {
                this.audioContext.close().catch(err => {
                    console.error('Error closing audio context:', err);
                });
            } catch (err) {
                console.warn('Could not close audio context:', err);
            }
        }
        
        // Clear references
        this.audioContext = null;
        this.analyser = null;
        this.audioSourceNode = null;
        this.dataArray = null;
        this.waveformBars = null;
        this.audioSourceConnected = false;
        this.animationFrame = null;
        this.isActive = false;
        this.visualizationType = null;
        this.currentSelector = null;
        this.tokens = [];
        this.selectedTokens = [];
        this.modifiedTokens = [];
    }
}

// Make available globally
window.WaveformEditor = WaveformEditor;