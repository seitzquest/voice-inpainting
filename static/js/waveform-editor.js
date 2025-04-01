/**
 * Enhanced waveform-editor.js
 * Waveform visualization with improved token highlighting, integrated download button,
 * and fixed token alignment issues
 */

class WaveformEditor {
    constructor(container, options = {}) {
        this.container = container;
        this.options = Object.assign({
            height: 120,
            barWidth: 3,
            barGap: 1,
            // More subtle colors for selection
            selectedColor: 'var(--color-primary-light)',
            selectedRangeColor: 'rgba(157, 184, 89, 0.1)',
            selectedRangeDarkColor: 'rgba(157, 184, 89, 0.15)',
            // Distinct color for generated audio
            generatedColor: '#5DA831',  // Bright green for light mode
            generatedDarkColor: '#9DB859', // Lighter green for dark mode
            modifiedColor: '#FF5252',
            defaultColor: '#333333',
            darkModeDefaultColor: '#B0B0B0',
            // Debug mode
            debugMode: false
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
        this.generatedRegions = []; // Track regions of generated audio

        // Playback state
        this.isPlaying = false;
        this.animationFrame = null;
        
        // Interaction
        this.isDragging = false;
        
        // Events
        this.onPlayPause = null;
        this.onDownload = null;
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
            this.options.currentGeneratedColor = this.options.generatedDarkColor;
        } else {
            tempEl.className = 'text-gray-bars';
            this.options.defaultColor = window.getComputedStyle(tempEl).color || '#333333';
            
            tempEl.className = 'text-green-bar';
            this.options.selectedColor = window.getComputedStyle(tempEl).color || '#5DA831';
            
            this.options.currentRangeColor = this.options.selectedRangeColor;
            this.options.currentGeneratedColor = this.options.generatedColor;
        }
        
        tempEl.className = 'text-red-bar';
        this.options.modifiedColor = window.getComputedStyle(tempEl).color || '#FF5252';
        
        document.body.removeChild(tempEl);
    }
    
    /**
     * Create play/pause button
     */
    createPlayButton() {
        const waveformControls = document.createElement('div');
        waveformControls.className = 'waveform-controls';
        
        const playButton = document.createElement('button');
        playButton.id = 'waveformPlayButton';
        playButton.className = 'control-btn play-btn';
        playButton.setAttribute('aria-label', 'Play audio');
        playButton.innerHTML = `
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        `;
        
        waveformControls.appendChild(playButton);
        this.canvasContainer.appendChild(waveformControls);
        
        // Play/pause functionality
        playButton.addEventListener('click', () => {
            this.togglePlayback();
            
            // Trigger callback if defined
            if (typeof this.onPlayPause === 'function') {
                this.onPlayPause(this.isPlaying);
            }
        });
        
        // Find existing download button in the container
        const downloadBtn = this.container.querySelector('.waveform-download-btn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // Trigger callback if defined
                if (typeof this.onDownload === 'function') {
                    this.onDownload();
                }
            });
        }
    }
    
    /**
     * Set play/pause button callback
     * @param {Function} callback - Callback function
     */
    setPlayPauseCallback(callback) {
        this.onPlayPause = callback;
    }
    
    /**
     * Set download button callback
     * @param {Function} callback - Callback function
     */
    setDownloadCallback(callback) {
        this.onDownload = callback;
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
     * Reload audio data from the current audio element
     * This is used when the audio source has changed (e.g., when switching versions)
     */
    reloadAudioData() {
        if (!this.audioElement) return;
        
        // Reset current data
        this.audioBuffer = null;
        this.audioData = null;
        
        // Show a visual indication that we're loading
        if (this.waveformCanvas) {
            const width = this.waveformCanvas.clientWidth;
            const height = this.options.height;
            
            // Clear existing visualization
            if (this.ctx) {
                this.ctx.clearRect(0, 0, width, height);
                
                // Draw a loading indicator (subtle pulsing line)
                this.ctx.fillStyle = 'rgba(200, 200, 200, 0.3)';
                this.ctx.fillRect(0, height/2 - 1, width, 2);
            }
        }
        
        // Load the new audio data
        this.loadAudioData().then(() => {
            console.debug('Waveform: Audio data reloaded successfully');
        }).catch(err => {
            console.error('Error reloading audio data:', err);
        });
    }
    
    /**
     * Load and process audio data
     */
    async loadAudioData() {
        if (!this.audioElement) return Promise.reject(new Error('No audio element available'));
        
        try {
            const response = await fetch(this.audioElement.src);
            const arrayBuffer = await response.arrayBuffer();
            this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            this.processAudioData();
            return Promise.resolve(); // Success
        } catch (error) {
            console.error('Error decoding audio data:', error);
            return Promise.reject(error);
        }
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
            playButton.setAttribute('aria-label', 'Pause audio');
            playButton.classList.remove('play-btn');
            playButton.classList.add('pause-btn');
        } else {
            playButton.innerHTML = `
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
            `;
            playButton.setAttribute('aria-label', 'Play audio');
            playButton.classList.remove('pause-btn');
            playButton.classList.add('play-btn');
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
     * Validate token data when set with improved error handling
     * @param {Array} tokens - Array of token metadata objects
     */
    setTokenData(tokens) {
        // Handle null/undefined case properly
        if (!tokens) {
            console.warn('No token data provided to waveform editor');
            this.tokens = [];
            this.draw();
            return;
        }
        
        // Ensure tokens is an array
        if (!Array.isArray(tokens)) {
            console.warn('Invalid token data format provided to waveform editor (not an array)');
            this.tokens = [];
            this.draw();
            return;
        }

        // Skip if tokens array is empty
        if (tokens.length === 0) {
            console.warn('Empty token array provided to waveform editor');
            this.tokens = [];
            this.draw();
            return;
        }
        
        // Perform validation and cleanup
        this.tokens = tokens.filter(token => {
            // Check for null/undefined tokens
            if (!token) {
                console.warn('Null or undefined token in array');
                return false;
            }
            
            // Check for required fields
            if (typeof token.token_idx !== 'number') {
                console.warn('Token missing required token_idx field or not a number:', token);
                return false;
            }
            
            // Validate timing data
            if (token.start_time === undefined || token.end_time === undefined ||
                isNaN(token.start_time) || isNaN(token.end_time) ||
                token.start_time < 0 || token.end_time < token.start_time) {
                console.warn(`Token ${token.token_idx} has invalid timing: [${token.start_time}, ${token.end_time}]`);
                // We'll still include the token but with fixed timing
                token.start_time = Math.max(0, Number(token.start_time) || 0);
                token.end_time = Math.max(token.start_time + 0.1, Number(token.end_time) || token.start_time + 0.1);
            }
            
            return true;
        });
        
        // Log success
        console.debug(`Waveform: Set ${this.tokens.length} valid tokens`);
        
        // If there was a previous selection, reapply it
        if (this.selectedTokens && this.selectedTokens.length > 0) {
            this.calculateHighlightedRegions();
        }
        
        this.draw();
        this.drawSelectionRanges();
    }
    
    /**
     * Select tokens to highlight with improved validation
     * @param {Array} tokenIndices - Array of token indices to highlight
     */
    selectTokens(tokenIndices) {
        // Validate input
        this.selectedTokens = Array.isArray(tokenIndices) ? tokenIndices : [];
        
        // Log selection for debugging
        console.debug(`Waveform: Selected tokens: ${this.selectedTokens.join(', ')}`);
        
        this.calculateHighlightedRegions();
        this.drawSelectionRanges();
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
     * Mark regions as generated
     * @param {Array} regions - Array of {start, end} time ranges that were generated
     */
    markGeneratedRegions(regions) {
        // Make a deep copy to avoid reference issues
        this.generatedRegions = regions ? 
            regions.map(region => ({...region})) : [];
        
        // DEBUG: Log for troubleshooting
        console.debug(`Marked ${this.generatedRegions.length} generated regions`);
        if (this.generatedRegions.length > 0) {
            console.debug("First region:", this.generatedRegions[0]);
        }
        
        this.draw();
        this.drawSelectionRanges();
    }
        
    /**
     * Calculate time regions to highlight with improved validation
     */
    calculateHighlightedRegions() {
        this.highlightedRegions = [];
        
        if (!this.tokens || !this.selectedTokens.length) return;
        
        console.debug(`Calculating regions for ${this.selectedTokens.length} selected tokens`);
        
        // Sort tokens by start time to ensure consistent rendering
        const selectedTokens = this.tokens
            .filter(token => this.selectedTokens.includes(token.token_idx))
            .sort((a, b) => a.start_time - b.start_time);
        
        // Group adjacent tokens into combined regions for smoother highlighting
        let currentRegion = null;
        
        for (const token of selectedTokens) {
            // Skip tokens with invalid timing data
            if (token.start_time === undefined || token.end_time === undefined ||
                isNaN(token.start_time) || isNaN(token.end_time)) {
                console.warn(`Token ${token.token_idx} has invalid timing: [${token.start_time}, ${token.end_time}]`);
                continue;
            }
            
            // Log token timing for debugging
            console.debug(`Token ${token.token_idx}: [${token.start_time.toFixed(3)}s - ${token.end_time.toFixed(3)}s] "${token.text}"`);
            
            if (!currentRegion) {
                // Start new region
                currentRegion = {
                    start: token.start_time,
                    end: token.end_time,
                    tokenIndices: [token.token_idx]
                };
            } else if (token.start_time <= currentRegion.end + 0.05) {
                // Extend current region (with small gap tolerance)
                currentRegion.end = Math.max(currentRegion.end, token.end_time);
                currentRegion.tokenIndices.push(token.token_idx);
            } else {
                // Add completed region and start new one
                this.highlightedRegions.push(currentRegion);
                currentRegion = {
                    start: token.start_time,
                    end: token.end_time,
                    tokenIndices: [token.token_idx]
                };
            }
        }
        
        // Add the last region if exists
        if (currentRegion) {
            this.highlightedRegions.push(currentRegion);
        }
        
        console.debug(`Created ${this.highlightedRegions.length} highlighted regions`);
    }
    
    /**
     * Convert time to x-position on canvas with improved accuracy
     * @param {number} time - Time in seconds
     * @returns {number} - X position on canvas
     */
    timeToPosition(time) {
        if (!this.audioData || !this.audioBuffer) return 0;
        
        // Ensure time is valid and within range
        const safeTime = Math.max(0, Math.min(time, this.audioBuffer.duration));
        const width = this.waveformCanvas.clientWidth;
        
        // Calculate position
        return (safeTime / this.audioBuffer.duration) * width;
    }
    
    /**
     * Convert x-position to time with improved accuracy
     * @param {number} x - X position on canvas
     * @returns {number} - Time in seconds
     */
    positionToTime(x) {
        if (!this.audioData || !this.audioBuffer) return 0;
        
        const width = this.waveformCanvas.clientWidth;
        // Clamp x position to valid range
        const safeX = Math.max(0, Math.min(x, width));
        
        return (safeX / width) * this.audioBuffer.duration;
    }
    
    /**
     * Draw the waveform with enhanced generated region highlighting
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
        const generatedColor = isDarkMode ? this.options.generatedDarkColor : this.options.generatedColor;
        
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
        
        // Create a map of generated regions for efficient lookup
        const generatedTimeMap = new Map();
        
        if (this.generatedRegions && this.generatedRegions.length > 0) {
            for (const region of this.generatedRegions) {
                if (region.start !== undefined && region.end !== undefined) {
                    // Store each region with a unique key based on time range
                    const key = `${region.start}-${region.end}`;
                    generatedTimeMap.set(key, {
                        start: region.start,
                        end: region.end,
                        edited: region.edited || '',
                        original: region.original || ''
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
            
            // Check if this bar is in a generated region - highest priority
            let isGenerated = false;
            // Iterate through the generated regions
            for (const [key, region] of generatedTimeMap.entries()) {
                if (endTime >= region.start && startTime <= region.end) {
                    barColor = generatedColor;
                    isGenerated = true;
                    break;
                }
            }
            
            // If not generated, check if it's modified
            if (!isGenerated && this.modifiedTokens && this.modifiedTokens.length > 0) {
                for (const tokenIdx of this.modifiedTokens) {
                    const timeInfo = tokenTimeMap.get(tokenIdx);
                    if (timeInfo && endTime >= timeInfo.start && startTime <= timeInfo.end) {
                        barColor = this.options.modifiedColor;
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
        
        // Now draw labels for generated regions
        if (this.generatedRegions && this.generatedRegions.length > 0) {
            const isDarkMode = document.documentElement.classList.contains('dark');
            const labelColor = isDarkMode ? 'rgba(157, 184, 89, 0.9)' : 'rgba(93, 168, 49, 0.8)';
            const labelBgColor = isDarkMode ? 'rgba(50, 50, 50, 0.7)' : 'rgba(255, 255, 255, 0.7)';
            
            for (const region of this.generatedRegions) {
                const startX = this.timeToPosition(region.start);
                const endX = this.timeToPosition(region.end);
                const width = endX - startX;
                
                // Only add labels for regions wide enough to display them
                if (width > 60) {
                    this.ctx.font = '10px Arial, sans-serif';
                    this.ctx.fillStyle = labelBgColor;
                    this.ctx.fillRect(startX + 4, 10, 65, 14);
                    this.ctx.fillStyle = labelColor;
                    this.ctx.fillText('Generated', startX + 8, 20);
                }
            }
        }
    }
    
    /**
     * Draw selection ranges with improved rendering
     * Modified to avoid duplicate highlighting of generated regions
     */
    drawSelectionRanges() {
        if (!this.audioData || !this.selectionCtx) return;
        
        // Clear selection canvas
        const width = this.selectionCanvas.clientWidth;
        const height = this.options.height;
        this.selectionCtx.clearRect(0, 0, width, height);
        
        // Draw highlighted regions for selection
        if (this.highlightedRegions && this.highlightedRegions.length) {
            for (const region of this.highlightedRegions) {
                // Calculate position with increased precision
                const startX = this.timeToPosition(region.start);
                const endX = this.timeToPosition(region.end);
                
                // Draw region with slightly increased width for visibility
                const adjustedStartX = Math.max(0, startX - 1);
                const adjustedWidth = Math.min(width - adjustedStartX, endX - startX + 2);
                
                // Use current theme color
                this.selectionCtx.fillStyle = this.options.currentRangeColor;
                this.selectionCtx.fillRect(adjustedStartX, 0, adjustedWidth, height);
                
                // Draw small indicator at start and end for debugging
                if (this.options.debugMode) {
                    this.selectionCtx.fillStyle = 'rgba(255, 0, 0, 0.5)';
                    this.selectionCtx.fillRect(startX, 0, 2, height);
                    this.selectionCtx.fillStyle = 'rgba(0, 0, 255, 0.5)';
                    this.selectionCtx.fillRect(endX - 2, 0, 2, height);
                }
            }
        }
    }

    /**
     * Draw playhead at current audio position with error protection
     */
    drawPlayhead() {
        if (!this.audioElement || !this.audioData || !this.playheadCtx) return;
        
        const currentTime = this.audioElement.currentTime;
        const duration = this.audioElement.duration || this.audioData.duration;
        
        if (isNaN(currentTime) || isNaN(duration) || duration === 0) return;
        
        const progress = currentTime / duration;
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
     * Start playhead animation with improved error handling
     */
    startPlayheadAnimation() {
        const animatePlayhead = () => {
            if (!this.audioElement || !this.playheadCtx) {
                this.stopPlayheadAnimation();
                return;
            }
            
            this.drawPlayhead();
            if (this.isPlaying) {
                this.animationFrame = requestAnimationFrame(animatePlayhead);
            }
        };
        
        this.stopPlayheadAnimation();
        this.animationFrame = requestAnimationFrame(animatePlayhead);
    }
    
    /**
     * Stop playhead animation and ensure clean state
     */
    stopPlayheadAnimation() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
    }
    
    /**
     * Toggle audio playback with improved state handling
     */
    togglePlayback() {
        if (!this.audioElement) return;
        
        if (this.isPlaying) {
            this.audioElement.pause();
        } else {
            this.audioElement.play().catch(err => {
                console.error('Error playing audio:', err);
                this.isPlaying = false;
                this.updatePlayButtonState(false);
            });
        }
    }
    
    /**
     * Reset the waveform player state
     * Used when switching versions or when audio state needs to be cleanly reset
     */
    resetPlayback() {
        // Stop any ongoing playback
        if (this.audioElement) {
            // First update our state flag
            this.isPlaying = false;
            
            try {
                // Then pause the audio element
                if (!this.audioElement.paused) {
                    this.audioElement.pause();
                }
                
                // Reset playhead position, if needed
                if (!isNaN(this.audioElement.duration)) {
                    this.audioElement.currentTime = 0;
                }
            } catch (e) {
                console.warn("Error resetting audio element:", e);
            }
        }
        
        // Update UI
        this.updatePlayButtonState(false);
        
        // Stop animations
        this.stopPlayheadAnimation();
        
        // Reset playhead position
        if (this.playheadCtx && this.playheadCanvas) {
            const width = this.playheadCanvas.clientWidth;
            const height = this.options.height;
            this.playheadCtx.clearRect(0, 0, width, height);
        }
        
        // Remove any event listeners for the current audio play session
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
        
        // Redraw the waveform to ensure clean state
        this.draw();
        this.drawSelectionRanges();
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
     * Enable or disable debug mode
     * @param {boolean} enable - Whether to enable debug mode
     */
    setDebugMode(enable) {
        this.options.debugMode = !!enable;
        this.drawSelectionRanges();
    }
    
    /**
     * Debug function to display token boundaries on the waveform
     * Enable with: waveformEditor.showAllTokenBoundaries()
     */
    showAllTokenBoundaries() {
        if (!this.tokens || !this.tokens.length || !this.selectionCtx) return;
        
        const height = this.options.height;
        
        // Draw vertical lines at token boundaries
        this.tokens.forEach((token, index) => {
            if (token.start_time !== undefined && token.end_time !== undefined) {
                const startX = this.timeToPosition(token.start_time);
                const endX = this.timeToPosition(token.end_time);
                
                // Alternate colors for better visibility
                const color = index % 2 === 0 ? 'rgba(0, 128, 255, 0.3)' : 'rgba(255, 0, 128, 0.3)';
                
                this.selectionCtx.strokeStyle = color;
                this.selectionCtx.lineWidth = 1;
                
                // Start boundary
                this.selectionCtx.beginPath();
                this.selectionCtx.moveTo(startX, 0);
                this.selectionCtx.lineTo(startX, height);
                this.selectionCtx.stroke();
                
                // End boundary
                this.selectionCtx.beginPath();
                this.selectionCtx.moveTo(endX, 0);
                this.selectionCtx.lineTo(endX, height);
                this.selectionCtx.stroke();
                
                // Token index
                if (endX - startX > 20) {
                    this.selectionCtx.font = '9px monospace';
                    this.selectionCtx.fillStyle = color;
                    this.selectionCtx.fillText(`${token.token_idx}`, startX + 2, height - 5);
                }
            }
        });
    }
    
    /**
     * Clean up resources with improved state handling
     */
    cleanup() {
        this.stopPlayheadAnimation();
        
        // Reset playback state
        this.isPlaying = false;
        
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
        this.audioElement = null;
        this.tokens = [];
        this.selectedTokens = [];
        this.modifiedTokens = [];
        this.highlightedRegions = [];
        this.generatedRegions = [];
    }
}

// Make available globally
window.WaveformEditor = WaveformEditor;