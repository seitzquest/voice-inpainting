/**
 * Improved token-text-editor.js with robust token tracking
 */

class TokenTextEditor {
    constructor(container, options = {}) {
        this.container = container;
        this.options = Object.assign({
            fontSize: '16px',
            lineHeight: 1.5,
            padding: '12px',
            minHeight: '100px',
            selectedTokenClass: 'token-selected',
            modifiedTokenClass: 'token-modified',
        }, options);
        
        // Editor elements
        this.editorContainer = null;
        this.textArea = null;
        this.overlay = null;
        
        // Token data
        this.tokens = [];
        this.originalText = '';
        this.originalTokens = [];  // Will store {tokenIdx, text, start, end} of initial tokens
        this.activeTokens = [];    // Will store currently active tokens {tokenIdx, start, end}
        this.selectedTokens = [];
        this.modifiedTokens = [];
        
        // Waveform editor reference
        this.waveformEditor = null;
        
        // Change tracking
        this.lastText = '';
        this.isProcessingChange = false;
        this.isInitializing = true;
        
        // Event callbacks
        this.onSelectionChange = null;
        this.onTextChange = null;
    }
    
    /**
     * Initialize the text editor
     */
    initialize() {
        // Create container
        this.editorContainer = document.createElement('div');
        this.editorContainer.className = 'token-editor-container';
        this.container.appendChild(this.editorContainer);
        
        // Create textarea for input
        this.textArea = document.createElement('textarea');
        this.textArea.className = 'token-editor-input';
        this.textArea.style.width = '100%';
        this.textArea.style.minHeight = this.options.minHeight;
        this.textArea.style.padding = this.options.padding;
        this.textArea.style.fontSize = this.options.fontSize;
        this.textArea.style.lineHeight = this.options.lineHeight;
        this.textArea.style.border = '1px solid var(--color-gray)';
        this.textArea.style.borderRadius = 'var(--radius-md)';
        this.textArea.style.resize = 'vertical';
        this.textArea.style.fontFamily = 'inherit';
        this.textArea.style.overflowY = 'auto';
        this.textArea.style.maxHeight = '300px';
        this.editorContainer.appendChild(this.textArea);
        
        // Create overlay for token highlighting
        this.overlay = document.createElement('div');
        this.overlay.className = 'token-editor-overlay';
        this.overlay.style.position = 'absolute';
        this.overlay.style.top = '0';
        this.overlay.style.left = '0';
        this.overlay.style.right = '0';
        this.overlay.style.bottom = '0';
        this.overlay.style.padding = this.options.padding;
        this.overlay.style.fontSize = this.options.fontSize;
        this.overlay.style.lineHeight = this.options.lineHeight;
        this.overlay.style.pointerEvents = 'none';
        this.overlay.style.whiteSpace = 'pre-wrap';
        this.overlay.style.wordBreak = 'break-word';
        this.overlay.style.overflow = 'hidden';
        this.overlay.style.color = 'transparent';
        this.editorContainer.appendChild(this.overlay);
        
        // Add CSS for token highlighting
        this.addStyles();
        
        // Add event listeners
        this.textArea.addEventListener('input', () => this.handleInput());
        this.textArea.addEventListener('keyup', () => this.handleSelectionChange());
        this.textArea.addEventListener('click', () => this.handleSelectionChange());
        this.textArea.addEventListener('select', () => this.handleSelectionChange());
        this.textArea.addEventListener('mouseup', () => this.handleSelectionChange());
        
        // Handle initial dark mode
        this.updateDarkModeStyles();
        
        // Listen for theme changes
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.attributeName === 'class') {
                    this.updateDarkModeStyles();
                }
            });
        });
        
        observer.observe(document.documentElement, { attributes: true });
    }
    
    /**
     * Add CSS styles for token highlighting
     */
    addStyles() {
        const styleEl = document.createElement('style');
        styleEl.textContent = `
            .token-span {
                position: relative;
                border-radius: 2px;
                cursor: pointer;
                transition: background-color 0.2s ease;
            }
            
            .token-editor-overlay .token-selected {
                background-color: rgba(91, 101, 41, 0.2);
            }
            
            .dark .token-editor-overlay .token-selected {
                background-color: rgba(157, 184, 89, 0.3);
            }
            
            .token-editor-overlay {
                overflow-y: auto;
                max-height: 300px;
            }
        `;
        document.head.appendChild(styleEl);
    }
    
    /**
     * Update styles for dark mode
     */
    updateDarkModeStyles() {
        const isDarkMode = document.documentElement.classList.contains('dark');
        
        if (isDarkMode) {
            this.textArea.style.backgroundColor = '#2A2A2A';
            this.textArea.style.color = '#F0F0F0';
            this.textArea.style.borderColor = '#444';
        } else {
            this.textArea.style.backgroundColor = '#FFFFFF';
            this.textArea.style.color = '#111111';
            this.textArea.style.borderColor = '#E5E7EB';
        }
    }
    
    /**
     * Set token data and initialize the editor content
     * @param {Array} tokens - Array of token metadata
     * @param {string} fullText - Full transcribed text
     */
    setTokenData(tokens, fullText) {
        this.isInitializing = true;
        this.tokens = tokens || [];
        this.originalText = fullText || '';
        
        // Set textarea value
        this.textArea.value = this.originalText;
        this.lastText = this.originalText;
        
        // Initialize token tracking
        this.initializeTokenTracking();
        
        // Update overlay
        this.updateOverlay();
        
        // Reset modifications
        this.modifiedTokens = [];
        
        // Notify waveform editor
        if (this.waveformEditor) {
            this.waveformEditor.markModifiedTokens([]);
            this.waveformEditor.draw();
        }
        
        // Clear initialization flag after rendering
        setTimeout(() => {
            this.isInitializing = false;
        }, 100);
    }
    
    /**
     * Initialize token tracking by identifying all original tokens
     */
    initializeTokenTracking() {
        this.originalTokens = [];
        this.activeTokens = [];
        
        if (!this.tokens || this.tokens.length === 0) {
            return;
        }
        
        // Sort tokens by start time to ensure proper order
        const sortedTokens = [...this.tokens].sort((a, b) => a.start_time - b.start_time);
        
        // Find initial positions of all tokens in the original text
        for (const token of sortedTokens) {
            const tokenIdx = token.token_idx;
            const tokenText = token.text;
            
            // Skip empty tokens
            if (!tokenText || tokenText.trim() === '') continue;
            
            // Find positions of this token text in the original text
            const positions = this.findTokenPositions(this.originalText, tokenText);
            
            if (positions.length > 0) {
                // For initialization, just take the first match (in a real scenario, 
                // we'd use a more sophisticated approach to determine which match is correct)
                const initialPosition = positions[0];
                
                // Store original token information
                this.originalTokens.push({
                    tokenIdx: tokenIdx,
                    text: tokenText,
                    start: initialPosition.start,
                    end: initialPosition.end
                });
                
                // Initially, all tokens are active
                this.activeTokens.push({
                    tokenIdx: tokenIdx,
                    start: initialPosition.start,
                    end: initialPosition.end
                });
            }
        }
        
        // Sort tokens by position for consistent processing
        this.originalTokens.sort((a, b) => a.start - b.start);
        this.activeTokens.sort((a, b) => a.start - b.start);
    }
    
    /**
     * Find all positions of a token in text
     * @param {string} text - Text to search in
     * @param {string} tokenText - Token text to find
     * @returns {Array} - Array of {start, end} positions
     */
    findTokenPositions(text, tokenText) {
        const positions = [];
        
        // Use regex with word boundaries for precise matching
        const regex = new RegExp(`\\b${this.escapeRegExp(tokenText)}\\b`, 'g');
        let match;
        
        while ((match = regex.exec(text)) !== null) {
            positions.push({
                start: match.index,
                end: match.index + tokenText.length
            });
        }
        
        return positions;
    }
    
    /**
     * Escape regular expression special characters
     * @param {string} string - String to escape
     * @returns {string} - Escaped string for regex
     */
    escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    
    /**
     * Set a reference to the waveform editor for integration
     * @param {WaveformEditor} waveformEditor - Waveform editor instance
     */
    setWaveformEditor(waveformEditor) {
        this.waveformEditor = waveformEditor;
    }
    
    /**
     * Update the overlay with token spans
     */
    updateOverlay() {
        // Create a new overlay with marked spans
        let html = '';
        let currentPosition = 0;
        const text = this.textArea.value;
        
        // Sort active tokens by position for consistent rendering
        this.activeTokens.sort((a, b) => a.start - b.start);
        
        // Process each active token
        for (const token of this.activeTokens) {
            // Add any text before this token as plain text
            if (token.start > currentPosition) {
                html += this.escapeHtml(text.substring(currentPosition, token.start));
            }
            
            // Determine token classes
            const isSelected = this.selectedTokens.includes(token.tokenIdx);
            
            const tokenClasses = ['token-span'];
            if (isSelected) tokenClasses.push(this.options.selectedTokenClass);
            
            // Find the original token data
            const originalToken = this.tokens.find(t => t.token_idx === token.tokenIdx);
            
            // Create a span for this token
            const spanId = `token-${token.tokenIdx}`;
            
            // Get the token text from the current document position
            const tokenText = text.substring(token.start, token.end);
            
            html += `<span id="${spanId}" class="${tokenClasses.join(' ')}" 
                data-token-idx="${token.tokenIdx}" 
                data-start-time="${originalToken?.start_time.toFixed(3) || 0}" 
                data-end-time="${originalToken?.end_time.toFixed(3) || 0}"
                data-original-text="${this.escapeHtml(tokenText)}"
                onclick="(function(e) { e.stopPropagation(); })(event)">${this.escapeHtml(tokenText)}</span>`;
            
            // Update current position
            currentPosition = token.end;
        }
        
        // Add any remaining text
        if (currentPosition < text.length) {
            html += this.escapeHtml(text.substring(currentPosition));
        }
        
        // Update the overlay
        this.overlay.innerHTML = html;
        
        // Add click events to token spans
        document.querySelectorAll('.token-span').forEach(span => {
            span.addEventListener('click', (event) => {
                event.stopPropagation();
                const tokenIdx = parseInt(span.getAttribute('data-token-idx'));
                this.toggleTokenSelection(tokenIdx);
            });
        });
    }
    
    /**
     * Toggle selection for a token
     * @param {number} tokenIdx - Token index to toggle selection
     */
    toggleTokenSelection(tokenIdx) {
        const index = this.selectedTokens.indexOf(tokenIdx);
        
        if (index === -1) {
            // Add to selection
            this.selectedTokens.push(tokenIdx);
        } else {
            // Remove from selection
            this.selectedTokens.splice(index, 1);
        }
        
        // Update overlay
        this.updateOverlay();
        
        // Update waveform
        if (this.waveformEditor) {
            this.waveformEditor.selectTokens(this.selectedTokens);
        }
    }

    /**
     * Escape HTML special characters
     * @param {string} text - Text to escape
     * @returns {string} - Escaped text
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    /**
     * Handle input events
     */
    handleInput() {
        if (this.isProcessingChange || this.isInitializing) return;
        this.isProcessingChange = true;
        
        // Update token tracking after text change
        this.updateTokenTracking();
        
        // Update overlay
        this.updateOverlay();
        
        // Update waveform
        if (this.waveformEditor) {
            this.waveformEditor.markModifiedTokens(this.modifiedTokens);
            this.waveformEditor.draw();
        }
        
        // Call change callback if provided
        if (this.onTextChange) {
            this.onTextChange(this.textArea.value, this.modifiedTokens);
        }
        
        // Update last text
        this.lastText = this.textArea.value;
        
        this.isProcessingChange = false;
    }
    
    /**
     * Update token tracking after text edit
     * This is the core algorithm that finds and updates token positions
     */
    updateTokenTracking() {
        const currentText = this.textArea.value;
        
        // Start fresh with active tokens
        this.activeTokens = [];
        
        // For each original token, try to find it in the current text
        for (const originalToken of this.originalTokens) {
            const tokenIdx = originalToken.tokenIdx;
            const tokenText = originalToken.text;
            
            // Find all occurrences of this token in the current text
            const positions = this.findTokenPositions(currentText, tokenText);
            
            if (positions.length > 0) {
                // If token found, activate it
                
                // If multiple matches, find the one closest to its last known position
                let bestPosition = null;
                let minDistance = Infinity;
                
                // Last known position is from the original
                const lastKnownPosition = originalToken.start;
                
                for (const position of positions) {
                    const distance = Math.abs(position.start - lastKnownPosition);
                    if (distance < minDistance) {
                        minDistance = distance;
                        bestPosition = position;
                    }
                }
                
                // Add as active token
                this.activeTokens.push({
                    tokenIdx: tokenIdx,
                    start: bestPosition.start,
                    end: bestPosition.end
                });
            }
        }
        
        // Update modified tokens list - any token not active is considered modified
        const activeTokenIndices = this.activeTokens.map(token => token.tokenIdx);
        
        this.modifiedTokens = this.originalTokens
            .filter(token => !activeTokenIndices.includes(token.tokenIdx))
            .map(token => token.tokenIdx);
    }

    /**
     * Handle selection change events
     */
    handleSelectionChange() {
        if (this.isProcessingChange) return;
        this.isProcessingChange = true;
        
        const selectionStart = this.textArea.selectionStart;
        const selectionEnd = this.textArea.selectionEnd;
        
        // Reset selected tokens
        this.selectedTokens = [];
        
        // If there's a selection
        if (selectionStart !== selectionEnd) {
            // Find all active tokens that overlap with the selection
            for (const token of this.activeTokens) {
                if (token.start < selectionEnd && token.end > selectionStart) {
                    this.selectedTokens.push(token.tokenIdx);
                }
            }
        } else {
            // If there's a cursor (no selection), check if it's within a token
            for (const token of this.activeTokens) {
                if (selectionStart >= token.start && selectionStart <= token.end) {
                    this.selectedTokens.push(token.tokenIdx);
                    break;
                }
            }
        }
        
        // Update overlay
        this.updateOverlay();
        
        // Update waveform
        if (this.waveformEditor) {
            this.waveformEditor.selectTokens(this.selectedTokens);
        }
        
        // Call selection callback if provided
        if (this.onSelectionChange) {
            this.onSelectionChange(this.selectedTokens);
        }
        
        this.isProcessingChange = false;
    }
    
    /**
     * Get the current text
     * @returns {string} - Current text
     */
    getText() {
        return this.textArea.value;
    }
    
    /**
     * Get modifications as edit operations for the API
     * @returns {Array} - Array of edit operations
     */
    getEditOperations() {
        const editOperations = [];
        
        // If no modified tokens, return empty array
        if (this.modifiedTokens.length === 0) {
            return editOperations;
        }
        
        // Group adjacent modified tokens
        const groups = this.groupAdjacentModifiedTokens();
        
        // Process each group
        for (const group of groups) {
            const tokenIndices = group.tokenIndices;
            
            // Get token metadata from the original tokens
            const tokenData = tokenIndices
                .map(idx => {
                    const originalToken = this.originalTokens.find(t => t.tokenIdx === idx);
                    
                    // Look up the actual token for time data
                    const token = this.tokens.find(t => t.token_idx === idx);
                    
                    return {
                        tokenIdx: idx,
                        originalText: originalToken?.text || '',
                        start_time: token?.start_time || 0,
                        end_time: token?.end_time || 0
                    };
                })
                .sort((a, b) => a.start_time - b.start_time);
            
            if (tokenData.length === 0) continue;
            
            // Build original text
            let originalText = '';
            for (const data of tokenData) {
                originalText += data.originalText;
            }
            
            // Find current text in the document based on context
            // For simplicity, we're returning an empty string for edited text
            // For a more accurate solution, we'd need to analyze the document
            // to find what replaced these tokens
            const editedText = '';
            
            // Create edit operation
            editOperations.push({
                original_text: originalText,
                edited_text: editedText,
                start_token_idx: tokenData[0].tokenIdx,
                end_token_idx: tokenData[tokenData.length - 1].tokenIdx + 1
            });
        }
        
        return editOperations;
    }

    /**
     * Group adjacent modified tokens
     * @returns {Array} - Array of token groups
     */
    groupAdjacentModifiedTokens() {
        const groups = [];
        
        if (this.modifiedTokens.length === 0) return groups;
        
        // Sort tokens by their audio time
        const sortedTokens = [...this.modifiedTokens].sort((a, b) => {
            const tokenA = this.tokens.find(t => t.token_idx === a);
            const tokenB = this.tokens.find(t => t.token_idx === b);
            return tokenA && tokenB ? tokenA.start_time - tokenB.start_time : 0;
        });
        
        let currentGroup = {
            tokenIndices: [sortedTokens[0]]
        };
        
        // Group adjacent tokens
        for (let i = 1; i < sortedTokens.length; i++) {
            const tokenIdx = sortedTokens[i];
            const previousTokenIdx = sortedTokens[i - 1];
            
            // Find the actual token objects
            const token = this.tokens.find(t => t.token_idx === tokenIdx);
            const previousToken = this.tokens.find(t => t.token_idx === previousTokenIdx);
            
            if (!token || !previousToken) continue;
            
            // Check if tokens are adjacent (within a small time threshold)
            const timeThreshold = 0.3; // 300ms threshold
            const isAdjacent = Math.abs(token.start_time - previousToken.end_time) < timeThreshold;
            
            if (isAdjacent) {
                // Add to current group
                currentGroup.tokenIndices.push(tokenIdx);
            } else {
                // Start a new group
                groups.push(currentGroup);
                currentGroup = {
                    tokenIndices: [tokenIdx]
                };
            }
        }
        
        // Add the last group
        groups.push(currentGroup);
        
        return groups;
    }
    
    /**
     * Clean up resources
     */
    cleanup() {
        // Remove DOM elements
        if (this.editorContainer && this.editorContainer.parentNode) {
            this.editorContainer.parentNode.removeChild(this.editorContainer);
        }
        
        // Clear data
        this.tokens = [];
        this.selectedTokens = [];
        this.modifiedTokens = [];
        this.originalTokens = [];
        this.activeTokens = [];
    }
}

// Make available globally
window.TokenTextEditor = TokenTextEditor;