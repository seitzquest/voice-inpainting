/**
 * token-text-editor.js
 * Token-aware text editor that integrates with the waveform editor
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
        this.tokenToSpanMap = {};
        this.selectedTokens = [];
        this.modifiedTokens = [];
        this.originalTokenText = {};   // Map token indexes to original text
        
        // Waveform editor reference
        this.waveformEditor = null;
        
        // Change tracking
        this.lastText = '';
        this.isProcessingChange = false;
        
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
        this.editorContainer.style.position = 'relative';
        this.editorContainer.style.width = '100%';
        this.editorContainer.style.minHeight = this.options.minHeight;
        this.editorContainer.style.marginBottom = '1.5rem';
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
            }
            
            .token-editor-overlay .token-selected {
                background-color: rgba(91, 101, 41, 0.2);
            }
            
            /* Note: We don't color modified text in red in the text box anymore */
            .token-modified {
                /* No visible styling in text editor */
            }
            
            .dark .token-editor-overlay .token-selected {
                background-color: rgba(157, 184, 89, 0.3);
            }
            
            .dark .token-modified {
                /* No visible styling in text editor */
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
        this.tokens = tokens;
        this.originalText = fullText;
        
        // Set textarea value
        this.textArea.value = fullText;
        this.lastText = fullText;
        
        // Create token to character position map
        this.createTokenMap();
        
        // Store original text for each token
        this.storeOriginalTokenText();
        
        // Build initial overlay
        this.updateOverlay();
    }
    
    /**
     * Set a reference to the waveform editor for integration
     * @param {WaveformEditor} waveformEditor - Waveform editor instance
     */
    setWaveformEditor(waveformEditor) {
        this.waveformEditor = waveformEditor;
    }
    
    /**
     * Store original text for each token
     */
    storeOriginalTokenText() {
        this.originalTokenText = {};
        
        // Store original text for each token
        for (const token of this.tokens) {
            const tokenIdx = token.token_idx;
            const text = token.text;
            this.originalTokenText[tokenIdx] = text;
        }
    }
    
    /**
     * Create a mapping between tokens and character positions
     */
    createTokenMap() {
        // First, check if the tokens are already sorted by text position
        if (!this.tokens || this.tokens.length === 0) return;
        
        // Sort tokens by time to ensure proper ordering
        this.tokens.sort((a, b) => a.start_time - b.start_time);
        
        // Reset the token map
        this.tokenToSpanMap = {};
        
        // Rebuild the overlay with spans for each token
        this.updateOverlay();
    }
    
    /**
     * Update the overlay with token spans
     */
    updateOverlay() {
        if (!this.tokens || this.tokens.length === 0) {
            this.overlay.innerHTML = '';
            return;
        }
        
        const currentText = this.textArea.value;
        let html = '';
        let currentPosition = 0;
        let remainingText = currentText;
        
        // Create a mapping of token indices to spans
        this.tokenToSpanMap = {};
        
        // Sort tokens by start time to ensure proper order
        const sortedTokens = [...this.tokens].sort((a, b) => a.start_time - b.start_time);
        
        // Find token occurrences in the current text
        for (const token of sortedTokens) {
            const tokenIdx = token.token_idx;
            const tokenText = token.text;
            
            // If token text is empty, skip
            if (!tokenText || tokenText.trim() === '') continue;
            
            // Try to find the token text in the remaining text
            const tokenStart = remainingText.indexOf(tokenText);
            
            if (tokenStart >= 0) {
                // Add any text before this token
                if (tokenStart > 0) {
                    const beforeText = remainingText.substring(0, tokenStart);
                    html += this.escapeHtml(beforeText);
                    currentPosition += tokenStart;
                }
                
                // Add token with appropriate classes
                const tokenClasses = ['token-span'];
                if (this.selectedTokens.includes(tokenIdx)) {
                    tokenClasses.push(this.options.selectedTokenClass);
                }
                if (this.modifiedTokens.includes(tokenIdx)) {
                    tokenClasses.push(this.options.modifiedTokenClass);
                }
                
                // Create a unique ID for this token span
                const spanId = `token-${tokenIdx}`;
                
                // Add the token span
                html += `<span id="${spanId}" class="${tokenClasses.join(' ')}" data-token-idx="${tokenIdx}">${this.escapeHtml(tokenText)}</span>`;
                
                // Store the span ID for this token
                this.tokenToSpanMap[tokenIdx] = spanId;
                
                // Update current position
                currentPosition += tokenText.length;
                
                // Update remaining text
                remainingText = remainingText.substring(tokenStart + tokenText.length);
            }
        }
        
        // Add any remaining text
        if (remainingText.length > 0) {
            html += this.escapeHtml(remainingText);
        }
        
        // Update the overlay
        this.overlay.innerHTML = html;
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
     * Handle textarea input events
     */
    handleInput() {
        // Skip if we're already processing a change
        if (this.isProcessingChange) return;
        this.isProcessingChange = true;
        
        const currentText = this.textArea.value;
        
        // Update overlay without detecting modifications yet
        this.updateOverlay();
        
        // Now detect modified tokens after overlay has been updated
        this.detectModifiedTokens(currentText);
        
        // Update waveform using detected modified tokens
        if (this.waveformEditor) {
            this.waveformEditor.markModifiedTokens(this.modifiedTokens);
            // Force a redraw to update highlighting
            this.waveformEditor.draw();
        }
        
        // Call change callback if provided
        if (this.onTextChange) {
            this.onTextChange(currentText, this.modifiedTokens);
        }
        
        // Update last text
        this.lastText = currentText;
        
        this.isProcessingChange = false;
    }
    
    /**
     * Detect which tokens have been modified
     * @param {string} currentText - Current text in the editor
     */
    detectModifiedTokens(currentText) {
        // Get the modified tokens list without updating the waveform yet
        const modifiedTokens = [];
        
        // Compare each token's original text with its current text in the span
        for (const token of this.tokens) {
            const tokenIdx = token.token_idx;
            const originalText = token.text;
            
            if (!originalText) continue;
            
            // Find the token span
            const spanId = this.tokenToSpanMap[tokenIdx];
            if (!spanId) continue;
            
            const span = document.getElementById(spanId);
            if (!span) continue;
            
            // Get current text
            const currentTokenText = span.textContent;
            
            // If text has changed, mark as modified
            if (currentTokenText !== originalText) {
                modifiedTokens.push(tokenIdx);
            }
        }
        
        // Update the modified tokens list
        this.modifiedTokens = modifiedTokens;
        
        // Diagnostics
        if (modifiedTokens.length > 0) {
            console.log('Modified tokens:', modifiedTokens);
        }
    }
    
    /**
     * Find text differences between two strings
     * @param {string} oldText - Previous text
     * @param {string} newText - Current text
     * @returns {Array} - Array of positions where text differs
     */
    findTextDifferences(oldText, newText) {
        const diffPositions = [];
        const minLength = Math.min(oldText.length, newText.length);
        
        // Find positions where characters differ
        for (let i = 0; i < minLength; i++) {
            if (oldText[i] !== newText[i]) {
                diffPositions.push(i);
            }
        }
        
        // If lengths differ, add all positions after the common part
        if (oldText.length !== newText.length) {
            for (let i = minLength; i < Math.max(oldText.length, newText.length); i++) {
                diffPositions.push(i);
            }
        }
        
        return diffPositions;
    }
    
    /**
     * Find token that contains a specific character position
     * @param {number} position - Character position
     * @returns {number|null} - Token index or null if not found
     */
    findTokenAtPosition(position) {
        if (!this.tokens || this.tokens.length === 0) return null;
        
        const currentText = this.textArea.value;
        
        // Find a token that matches the position
        for (const token of this.tokens) {
            const tokenText = token.text;
            
            // Skip empty tokens
            if (!tokenText) continue;
            
            // Find all occurrences of this token in the text
            let start = 0;
            let tokenStart;
            
            while ((tokenStart = currentText.indexOf(tokenText, start)) !== -1) {
                const tokenEnd = tokenStart + tokenText.length;
                
                // Check if position is within this token
                if (position >= tokenStart && position < tokenEnd) {
                    return token.token_idx;
                }
                
                // Move to next occurrence
                start = tokenStart + 1;
            }
        }
        
        return null;
    }
    
    /**
     * Handle selection change events
     */
    handleSelectionChange() {
        // Skip if we're already processing a change
        if (this.isProcessingChange) return;
        this.isProcessingChange = true;
        
        const selectionStart = this.textArea.selectionStart;
        const selectionEnd = this.textArea.selectionEnd;
        
        // Reset selected tokens
        this.selectedTokens = [];
        
        // If there's a selection
        if (selectionStart !== selectionEnd) {
            // Find all tokens that overlap with the selection
            for (let pos = selectionStart; pos < selectionEnd; pos++) {
                const tokenIdx = this.findTokenAtPosition(pos);
                if (tokenIdx !== null && !this.selectedTokens.includes(tokenIdx)) {
                    this.selectedTokens.push(tokenIdx);
                }
            }
        } else {
            // If there's a cursor (no selection), still check if it's within a token
            const tokenIdx = this.findTokenAtPosition(selectionStart);
            if (tokenIdx !== null) {
                this.selectedTokens.push(tokenIdx);
            }
        }
        
        // Update overlay
        this.updateOverlay();
        
        // Update waveform
        if (this.waveformEditor) {
            this.waveformEditor.selectTokens(this.selectedTokens);
            
            // Force the waveform to redraw
            this.waveformEditor.draw();
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
     * Get modifications as edit operations
     * @returns {Array} - Array of edit operations
     */
    getEditOperations() {
        const editOperations = [];
        const currentText = this.textArea.value;
        
        // Compare the current text with original text to identify changes
        for (const token of this.tokens) {
            const tokenIdx = token.token_idx;
            const originalText = token.text;
            
            if (!originalText) continue;
            
            // Find this token in the current text
            const currentSpanId = this.tokenToSpanMap[tokenIdx];
            if (!currentSpanId) continue;
            
            const span = document.getElementById(currentSpanId);
            if (!span) continue;
            
            // Get the current text of this token
            const newText = span.textContent;
            
            // Only add if the text has actually changed
            if (newText && newText !== originalText) {
                console.log(`Token ${tokenIdx} changed: "${originalText}" → "${newText}"`);
                
                editOperations.push({
                    original_text: originalText,
                    edited_text: newText,
                    start_token_idx: tokenIdx,
                    end_token_idx: tokenIdx + 1
                });
            }
        }
        
        return editOperations;
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
        this.tokenToSpanMap = {};
    }
}

// Make available globally
window.TokenTextEditor = TokenTextEditor;