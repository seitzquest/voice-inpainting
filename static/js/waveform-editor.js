/**
 * Simplified waveform-editor.js
 * Waveform visualization with token highlighting
 */

class WaveformEditor {
    constructor(container, options = {}) {
        this.container = container;
        this.options = Object.assign({
            height: 100,
            barWidth: 3,
            barGap: 1,
            selectedColor: 'var(--color-primary-light)',
            selectedRangeColor: 'rgba(157, 184, 89, 0.15)',
            selectedRangeDarkColor: 'rgba(157, 184, 89, 0.25)',
            modifiedColor: '#FF5252',
            defaultColor: '#333333',
            darkModeDefaultColor: '#B0B0B0',
        }, options);
        
        // Canvas elements
        this.canvasContainer = null;
        this.waveformCanvas = null;
        this.selectionCanvas = null;
        this.playheadCanvas = null;
        this.ctx = null;
        this.selectionCtx = null;
        this.playheadCtx = null;
        
        // Audio data
        this.audioBuffer = null;
        this.audioElement = null;
        this.audioContext = null;
        this.audioData = null;
        
        // Token data
        this.tokens = [];
        this.selectedTokens = [];
        this.modifiedTokens = [];
        this.highlightedRegions = [];

        // Playback state
        this.isPlaying = false;
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
        this.container.appendChild(this.canvasContainer);
        
        // Get theme colors
        this.readThemeColors();
        
        // Create selection canvas (bottom layer)
        this.selectionCanvas = document.createElement('canvas');
        this.selectionCanvas.className = 'selection-canvas';
        this.selectionCanvas.style.position = 'absolute';
        this.selectionCanvas.style.top = '0';
        this.selectionCanvas.style.left = '0';
        this.selectionCanvas.style.width = '100%';
        this.selectionCanvas.style.height = '100%';
        this.selectionCanvas.style.zIndex = '1';
        this.canvasContainer.appendChild(this.selectionCanvas);
        
        // Create waveform canvas (middle layer)
        this.waveformCanvas = document.createElement('canvas');
        this.waveformCanvas.className = 'waveform-canvas';
        this.waveformCanvas.style.position = 'absolute';
        this.waveformCanvas.style.top = '0';
        this.waveformCanvas.style.left = '0';
        this.waveformCanvas.style.width = '100%';
        this.waveformCanvas.style.height = '100%';
        this.waveformCanvas.style.zIndex = '2';
        this.canvasContainer.appendChild(this.waveformCanvas);
        
        // Create playhead canvas (top layer)
        this.playheadCanvas = document.createElement('canvas');
        this.playheadCanvas.className = 'playhead-canvas';
        this.playheadCanvas.style.position = 'absolute';
        this.playheadCanvas.style.top = '0';
        this.playheadCanvas.style.left = '0';
        this.playheadCanvas.style.width = '100%';
        this.playheadCanvas.style.height = '100%';
        this.playheadCanvas.style.pointerEvents = 'none';
        this.playheadCanvas.style.zIndex = '3';
        this.canvasContainer.appendChild(this.playheadCanvas);
        
        // Get contexts
        this.selectionCtx = this.selectionCanvas.getContext('2d');
        this.ctx = this.waveformCanvas.getContext('2d');
        this.playheadCtx = this.playheadCanvas.getContext('2d');
        
        // Set up canvas dimensions
        this.resizeCanvas();
        
        // Add event listeners
        window.addEventListener('resize', () => this.resizeCanvas());
        
        // Listen for theme changes
        const observer = new MutationObserver(() => {
            this.readThemeColors();
            this.draw();
            this.drawSelectionRanges();
        });
        
        observer.observe(document.documentElement, { 
            attributes: true,
            attributeFilter: ['class'] 
        });
        
        // Add interaction event listeners
        this.waveformCanvas.addEventListener('click', (e) => this.handleCanvasClick(e));
        this.waveformCanvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.waveformCanvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.waveformCanvas.addEventListener('mouseup', () => this.handleMouseUp());
        this.waveformCanvas.addEventListener('mouseout', () => this.handleMouseUp());
        
        // Create play/pause button
        this.createPlayButton();
    }

    /**
     * Read theme colors
     */
    readThemeColors() {
        const isDarkMode = document.documentElement.classList.contains('dark');
        const tempEl = document.createElement('div');
        tempEl.style.display = 'none';
        document.body.appendChild(tempEl);
        
        if (isDarkMode) {
            tempEl.className = 'text-gray-bars dark';
            this.options.darkModeDefaultColor = window.getComputedStyle(tempEl).color || '#B0B0B0';
            
            tempEl.className = 'text-green-bar dark';
            this.options.selectedColor = window.getComputedStyle(tempEl).color || '#9DB859';
            
            this.options.currentRangeColor = this.options.selectedRangeDarkColor;
        } else {
            tempEl.className = 'text-gray-bars';
            this.options.defaultColor = window.getComputedStyle(tempEl).color || '#333333';
            
            tempEl.className = 'text-green-bar';
            this.options.selectedColor = window.getComputedStyle(tempEl).color || '#5DA831';
            
            this.options.currentRangeColor = this.options.selectedRangeColor;
        }
        
        tempEl.className = 'text-red-bar';
        this.options.modifiedColor = window.getComputedStyle(tempEl).color || '#FF5252';
        
        document.body.removeChild(tempEl);
    }
    
    /**
     * Create play/pause button
     */
    createPlayButton() {
        const playButton = document.createElement('button');
        playButton.id = 'waveformPlayButton';
        playButton.className = 'control-btn play-btn absolute bottom-2 left-2';
        playButton.style.zIndex = '4';
        playButton.innerHTML = `
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        `;
        this.canvasContainer.appendChild(playButton);
        
        playButton.addEventListener('click', () => this.togglePlayback());
    }
    
    /**
     * Resize canvas to fit container
     */
    resizeCanvas() {
        const width = this.canvasContainer.clientWidth;
        const pixelRatio = window.devicePixelRatio || 1;
        
        // Update all canvases
        for (const canvas of [this.selectionCanvas, this.waveformCanvas, this.playheadCanvas]) {
            if (!canvas) continue;
            canvas.width = width * pixelRatio;
            canvas.height = this.options.height * pixelRatio;
            canvas.style.width = `${width}px`;
            canvas.style.height = `${this.options.height}px`;
        }
        
        // Scale the contexts
        for (const ctx of [this.selectionCtx, this.ctx, this.playheadCtx]) {
            if (ctx) ctx.scale(pixelRatio, pixelRatio);
        }
        
        // Redraw if we have data
        if (this.audioData) {
            this.draw();
            this.drawSelectionRanges();
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
        
        // Add playback event listeners
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
            playButton.innerHTML = `
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
            `;
            playButton.classList.remove('play-btn');
            playButton.classList.add('pause-btn');
        } else {
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
        
        try {
            const response = await fetch(this.audioElement.src);
            const arrayBuffer = await response.arrayBuffer();
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
            const end = Math.min(start + samplesPerBar, channelData.length);
            
            let min = 1.0;
            let max = -1.0;
            
            for (let i = start; i < end; i++) {
                min = Math.min(min, channelData[i]);
                max = Math.max(max, channelData[i]);
            }
            
            // Store normalized values
            this.audioData.peaks.push({
                min: (min + 1) / 2,
                max: (max + 1) / 2
            });
        }
        
        // Draw the initial waveform
        this.draw();
    }
    
    /**
     * Set token data
     * @param {Array} tokens - Array of token metadata objects
     */
    setTokenData(tokens) {
        this.tokens = tokens || [];
        this.draw();
    }
    
    /**
     * Select tokens to highlight
     * @param {Array} tokenIndices - Array of token indices to highlight
     */
    selectTokens(tokenIndices) {
        this.selectedTokens = tokenIndices || [];
        this.calculateHighlightedRegions();
        this.drawSelectionRanges();
        this.draw();
    }
        
    /**
     * Calculate time regions to highlight
     */
    calculateHighlightedRegions() {
        this.highlightedRegions = [];
        
        if (!this.tokens || !this.selectedTokens.length) return;
        
        for (const token of this.tokens) {
            if (this.selectedTokens.includes(token.token_idx)) {
                if (token.start_time !== undefined && token.end_time !== undefined) {
                    this.highlightedRegions.push({
                        start: token.start_time,
                        end: token.end_time,
                        tokenIdx: token.token_idx
                    });
                }
            }
        }
    }
    
    /**
     * Draw selection ranges
     */
    drawSelectionRanges() {
        if (!this.audioData || !this.selectionCtx) return;
        
        // Clear selection canvas
        const width = this.selectionCanvas.clientWidth;
        const height = this.options.height;
        this.selectionCtx.clearRect(0, 0, width, height);
        
        if (!this.highlightedRegions || !this.highlightedRegions.length) return;
        
        // Draw highlighted regions
        for (const region of this.highlightedRegions) {
            const startX = this.timeToPosition(region.start);
            const endX = this.timeToPosition(region.end);
            
            this.selectionCtx.fillStyle = this.options.currentRangeColor;
            this.selectionCtx.fillRect(startX, 0, endX - startX, height);
        }
    }
    
    /**
     * Mark tokens as modified
     * @param {Array} tokenIndices - Array of token indices to mark as modified
     */
    markModifiedTokens(tokenIndices) {
        this.modifiedTokens = tokenIndices || [];
        this.draw();
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
     * Draw the waveform
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
        
        // Create a map of token times for efficient lookup
        const tokenTimeMap = new Map();
        
        if (this.tokens && this.tokens.length > 0) {
            for (const token of this.tokens) {
                if (token.start_time !== undefined && token.end_time !== undefined) {
                    tokenTimeMap.set(token.token_idx, {
                        start: token.start_time,
                        end: token.end_time
                    });
                }
            }
        }
        
        // Draw all bars
        for (let i = 0; i < this.audioData.totalBars; i++) {
            const peak = this.audioData.peaks[i];
            const x = i * (this.options.barWidth + this.options.barGap);
            
            // Calculate bar dimensions
            const minHeight = peak.min * height;
            const maxHeight = peak.max * height;
            const centerY = height / 2;
            
            // Default color
            let barColor = defaultColor;
            
            // Determine the time range for this bar
            const startTime = this.positionToTime(x);
            const endTime = this.positionToTime(x + this.options.barWidth);
            
            // Check if this bar is in a modified region
            for (const tokenIdx of this.modifiedTokens) {
                const timeInfo = tokenTimeMap.get(tokenIdx);
                if (timeInfo && endTime >= timeInfo.start && startTime <= timeInfo.end) {
                    barColor = this.options.modifiedColor;
                    break;
                }
            }
            
            // If not modified, check if it's selected
            if (barColor === defaultColor) {
                for (const tokenIdx of this.selectedTokens) {
                    const timeInfo = tokenTimeMap.get(tokenIdx);
                    if (timeInfo && endTime >= timeInfo.start && startTime <= timeInfo.end) {
                        barColor = this.options.selectedColor;
                        break;
                    }
                }
            }
            
            // Draw the bar
            this.ctx.fillStyle = barColor;
            
            // Draw top part
            this.ctx.fillRect(
                x, 
                centerY - (maxHeight - centerY), 
                this.options.barWidth, 
                (maxHeight - centerY)
            );
            
            // Draw bottom part
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
        this.playheadCtx.strokeStyle = this.options.modifiedColor;
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
        
        this.stopPlayheadAnimation();
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
        
        const rect = this.waveformCanvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const newTime = this.positionToTime(x);
        
        this.audioElement.currentTime = newTime;
        
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
        
        const rect = this.waveformCanvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const newTime = this.positionToTime(x);
        
        this.audioElement.currentTime = newTime;
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
        
        // Remove DOM elements
        if (this.canvasContainer && this.canvasContainer.parentNode) {
            this.canvasContainer.parentNode.removeChild(this.canvasContainer);
        }
        
        // Close audio context
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
        this.tokens = [];
        this.selectedTokens = [];
        this.modifiedTokens = [];
        this.highlightedRegions = [];
    }
}

// Make available globally
window.WaveformEditor = WaveformEditor;