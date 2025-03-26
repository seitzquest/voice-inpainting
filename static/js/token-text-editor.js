/**
 * Complete update to token-text-editor.js to fix all subword token issues
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
        
        // Initialize subword token handling
        this.wordBoundaryTokens = new Set();  // Initialize the set of word boundary tokens
        this.subwordTokenMap = {};  // Initialize the map of subword tokens to their parent tokens
        
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
        // Add scrollbar for overflow
        this.textArea.style.overflowY = 'auto';
        this.textArea.style.maxHeight = '300px'; // Add max height to ensure scrollbar appears
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
        this.overlay.style.color = 'transparent'; // Make overlay text transparent
        this.overlay.innerHTML = ''; // Ensure it's empty initially
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
            
            /* Make sure overlay scrolls with textarea */
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
        // Set initializing flag to prevent modification detection during setup
        this.isInitializing = true;
        
        this.tokens = tokens;
        this.originalText = fullText;
        
        // Log token data to help with debugging
        console.log('Token data received in text editor:', tokens.slice(0, 3), '... total:', tokens.length);
        
        // Clear any existing content and set textarea value
        this.textArea.value = fullText;
        this.lastText = fullText;
        
        // Make sure the overlay is empty first
        this.overlay.innerHTML = '';
        
        // Store original text for each token and identify word boundaries
        this.storeOriginalTokenText();
        
        // Create token to character position map
        this.createTokenMap();
        
        // Build initial overlay
        this.updateOverlay();
        
        // Reset any erroneously detected modifications on initialization
        this.modifiedTokens = [];
        
        // Notify waveform editor of clean slate (no modifications)
        if (this.waveformEditor) {
            this.waveformEditor.markModifiedTokens([]);
            this.waveformEditor.draw();
        }
        
        // Clear initialization flag after a short delay
        // This ensures all rendering is complete before we start detecting modifications
        setTimeout(() => {
            this.isInitializing = false;
            console.log('Token editor initialization complete');
        }, 100);
    }
    
    /**
     * Set a reference to the waveform editor for integration
     * @param {WaveformEditor} waveformEditor - Waveform editor instance
     */
    setWaveformEditor(waveformEditor) {
        this.waveformEditor = waveformEditor;
    }
    
    /**
     * Store original text for each token and identify which tokens to display
     * Only the first occurrence of each token text will be displayed
     */
    storeOriginalTokenText() {
        this.originalTokenText = {};
        this.displayTokens = new Set(); // Tokens to actually display (first occurrence only)
        this.duplicateTokenMap = {}; // Maps token IDs to their first occurrence
        
        if (!this.tokens || this.tokens.length === 0) {
            console.log('No tokens to process in storeOriginalTokenText');
            return;
        }
        
        // Sort tokens by index to ensure correct order
        const sortedTokens = [...this.tokens].sort((a, b) => a.token_idx - b.token_idx);
        
        // Store original text for each token
        for (const token of sortedTokens) {
            const tokenIdx = token.token_idx;
            const text = token.text || '';
            this.originalTokenText[tokenIdx] = text;
        }
        
        // Track which token texts we've seen
        const seenTokenTexts = new Map(); // Map of token text to first token index
        
        // Process tokens in order
        for (let i = 0; i < sortedTokens.length; i++) {
            const token = sortedTokens[i];
            const tokenIdx = token.token_idx;
            const text = token.text || '';
            
            // Skip empty tokens
            if (!text.trim()) continue;
            
            // Check if we've seen this token text before
            if (!seenTokenTexts.has(text)) {
                // First occurrence of this text - mark it for display
                seenTokenTexts.set(text, tokenIdx);
                this.displayTokens.add(tokenIdx);
                this.duplicateTokenMap[tokenIdx] = tokenIdx; // Map to itself
            } else {
                // Duplicate text - map to the first occurrence
                const firstOccurrenceIdx = seenTokenTexts.get(text);
                this.duplicateTokenMap[tokenIdx] = firstOccurrenceIdx;
            }
        }
        
        console.log('Display tokens (first occurrences):', [...this.displayTokens]);
        console.log('Tokens count:', this.tokens.length, 'Display tokens count:', this.displayTokens.size);
    }

    
    /**
     * Create a mapping between tokens and character positions
     */
    createTokenMap() {
        // First, check if the tokens are already sorted by text position
        if (!this.tokens || this.tokens.length === 0) return;
        
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
        
        // Create a mapping of token indices to spans
        this.tokenToSpanMap = {};
        
        // Ensure displayTokens exists
        if (!this.displayTokens) {
            this.displayTokens = new Set();
            this.storeOriginalTokenText();
        }
        
        // Get only the tokens we want to display (first occurrences)
        const tokensToDisplay = this.tokens.filter(token => 
            token && this.displayTokens.has(token.token_idx)
        );
        
        // Sort by start time to ensure proper order
        tokensToDisplay.sort((a, b) => a.start_time - b.start_time);
        
        console.log(`Rendering ${tokensToDisplay.length} unique tokens`);
        
        // Create a completely new overlay with marked spans
        let html = '';
        let position = 0;
        
        // Use a copy of the text that we'll process
        let remainingText = currentText;
        
        // Process each token in order
        for (const token of tokensToDisplay) {
            const tokenIdx = token.token_idx;
            const tokenText = token.text;
            
            // Skip empty tokens
            if (!tokenText || tokenText.trim() === '') continue;
            
            // Find this token in the remaining text
            const tokenPos = remainingText.indexOf(tokenText);
            
            if (tokenPos >= 0) {
                // Add any text before this token
                if (tokenPos > 0) {
                    html += this.escapeHtml(remainingText.substring(0, tokenPos));
                }
                
                // Get all duplicate tokens that map to this one
                const duplicateIndices = [];
                for (const [dupIdx, firstIdx] of Object.entries(this.duplicateTokenMap)) {
                    if (parseInt(firstIdx) === tokenIdx) {
                        duplicateIndices.push(parseInt(dupIdx));
                    }
                }
                
                // Check if this token or any of its duplicates are selected/modified
                const isSelected = this.selectedTokens.includes(tokenIdx) || 
                    duplicateIndices.some(idx => this.selectedTokens.includes(idx));
                
                const isModified = this.modifiedTokens.includes(tokenIdx) || 
                    duplicateIndices.some(idx => this.modifiedTokens.includes(idx));
                
                // Add token with appropriate classes
                const tokenClasses = ['token-span'];
                if (isSelected) {
                    tokenClasses.push(this.options.selectedTokenClass);
                }
                if (isModified) {
                    tokenClasses.push(this.options.modifiedTokenClass);
                }
                
                // Create a unique ID for this token span
                const spanId = `token-${tokenIdx}`;
                
                // Store duplicate indices as data attribute
                const duplicateIndicesAttr = duplicateIndices.join(',');
                
                // Add token with data attributes
                html += `<span id="${spanId}" class="${tokenClasses.join(' ')}" 
                    data-token-idx="${tokenIdx}" 
                    data-duplicate-indices="${duplicateIndicesAttr}"
                    data-start-time="${token.start_time.toFixed(3)}" 
                    data-end-time="${token.end_time.toFixed(3)}"
                    data-original-text="${this.escapeHtml(tokenText)}"
                    onclick="(function(e) { e.stopPropagation(); })(event)">${this.escapeHtml(tokenText)}</span>`;
                
                // Map this token to this span
                this.tokenToSpanMap[tokenIdx] = spanId;
                for (const dupIdx of duplicateIndices) {
                    this.tokenToSpanMap[dupIdx] = spanId;
                }
                
                // Update remaining text for next iteration
                remainingText = remainingText.substring(tokenPos + tokenText.length);
            }
        }
        
        // Add any remaining text
        if (remainingText.length > 0) {
            html += this.escapeHtml(remainingText);
        }
        
        // Update the overlay
        this.overlay.innerHTML = html;
        
        // Add click events to token spans
        document.querySelectorAll('.token-span').forEach(span => {
            span.addEventListener('click', (event) => {
                event.stopPropagation();
                const tokenIdx = parseInt(span.getAttribute('data-token-idx'));
                
                // Get all duplicate indices for this token
                const duplicateIndices = span.getAttribute('data-duplicate-indices')
                    ? span.getAttribute('data-duplicate-indices').split(',').map(Number)
                    : [tokenIdx];
                    
                console.log(`Token clicked: ${tokenIdx}, duplicates: ${duplicateIndices}`);
                
                // Select this token and all its duplicates
                this.selectTokensByIndices(duplicateIndices);
            });
        });
    }
    
    /**
     * Select multiple tokens by their indices
     * @param {Array} tokenIndices - Token indices to select
     */
    selectTokensByIndices(tokenIndices) {
        // Reset the selection if there are no valid indices
        if (!tokenIndices || tokenIndices.length === 0) {
            this.selectedTokens = [];
        } else {
            // Toggle selection state based on the first token
            const firstIdx = tokenIndices[0];
            const isAlreadySelected = this.selectedTokens.includes(firstIdx);
            
            if (isAlreadySelected) {
                // Remove all the token indices from the selection
                this.selectedTokens = this.selectedTokens.filter(idx => 
                    !tokenIndices.includes(idx)
                );
            } else {
                // Add all the token indices to the selection
                this.selectedTokens = [
                    ...this.selectedTokens,
                    ...tokenIndices.filter(idx => !this.selectedTokens.includes(idx))
                ];
            }
        }
        
        console.log('Selected tokens updated:', this.selectedTokens);
        
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
     * Handle input events with clean separation of concerns
     */
    handleInput() {
        // Skip if we're already processing a change or still initializing
        if (this.isProcessingChange || this.isInitializing) return;
        this.isProcessingChange = true;
        
        const currentText = this.textArea.value;
        
        // Update overlay without detecting modifications yet
        this.updateOverlay();
        
        // Now detect modified tokens after overlay has been updated
        this.detectModifiedTokens(currentText);
        
        // Update waveform using detected modified tokens
        if (this.waveformEditor) {
            // Pass modified tokens to the waveform editor without affecting selection
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
     * Enhanced to better handle adjacent token modifications
     * @param {string} currentText - Current text in the editor
     */
    detectModifiedTokens(currentText) {
        // Skip if initializing
        if (this.isInitializing) return;
        
        // Reset the modification list
        const modifiedTokens = [];
        
        // Get all rendered token spans from the DOM
        const tokenSpans = document.querySelectorAll('.token-span');
        
        // Check each span's current text against the original token text
        for (const span of tokenSpans) {
            const tokenIdx = parseInt(span.getAttribute('data-token-idx'));
            const originalText = span.getAttribute('data-original-text');
            const currentSpanText = span.textContent;
            
            // If text has changed, mark as modified
            if (originalText && currentSpanText !== originalText) {
                console.log(`Token ${tokenIdx} modified: "${originalText}" → "${currentSpanText}"`);
                
                // Get all duplicate indices for this token
                const duplicateIndices = span.getAttribute('data-duplicate-indices')
                    ? span.getAttribute('data-duplicate-indices').split(',').map(Number)
                    : [tokenIdx];
                
                // Add all duplicate tokens to modified list
                for (const dupIdx of duplicateIndices) {
                    if (!modifiedTokens.includes(dupIdx)) {
                        modifiedTokens.push(dupIdx);
                    }
                }
            }
        }
        
        // Create a set of rendered token IDs for faster lookups
        const renderedTokenIds = new Set(Array.from(tokenSpans).map(span => 
            parseInt(span.getAttribute('data-token-idx'))
        ));
        
        // Check which display tokens are missing
        for (const tokenIdx of this.displayTokens) {
            if (!renderedTokenIds.has(tokenIdx)) {
                // The token was in the original text but isn't rendered now - must be deleted
                const token = this.tokens.find(t => t.token_idx === tokenIdx);
                if (token) {
                    console.log(`Token ${tokenIdx} deleted: "${token.text}"`);
                    
                    // Get all duplicate tokens
                    const duplicateIndices = [];
                    for (const [dupIdx, firstIdx] of Object.entries(this.duplicateTokenMap)) {
                        if (parseInt(firstIdx) === tokenIdx) {
                            duplicateIndices.push(parseInt(dupIdx));
                        }
                    }
                    
                    // Mark this token and all duplicates as modified
                    // But only if it's not adjacent to a previously modified token
                    const isAdjacentToModified = this.checkIfAdjacentToModified(tokenIdx, modifiedTokens);
                    
                    // If it's not adjacent to a modified token, add it to the list
                    if (!isAdjacentToModified) {
                        modifiedTokens.push(tokenIdx);
                        for (const dupIdx of duplicateIndices) {
                            if (!modifiedTokens.includes(dupIdx)) {
                                modifiedTokens.push(dupIdx);
                            }
                        }
                    }
                }
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
     * Check if a token is adjacent to any modified tokens
     * This helps prevent marking multiple consecutive tokens when only one was edited
     * @param {number} tokenIdx - Token index to check
     * @param {Array} modifiedTokens - List of already detected modified token indices
     * @returns {boolean} - True if the token is adjacent to a modified token
     */
    checkIfAdjacentToModified(tokenIdx, modifiedTokens) {
        if (!this.tokens || this.tokens.length === 0) return false;
        
        // Find the token object
        const token = this.tokens.find(t => t.token_idx === tokenIdx);
        if (!token) return false;
        
        // Check each modified token to see if it's adjacent to this one
        for (const modifiedIdx of modifiedTokens) {
            const modifiedToken = this.tokens.find(t => t.token_idx === modifiedIdx);
            if (!modifiedToken) continue;
            
            // Get time boundaries
            const thisStart = token.start_time;
            const thisEnd = token.end_time;
            const modStart = modifiedToken.start_time;
            const modEnd = modifiedToken.end_time;
            
            // Check if tokens are adjacent - time boundaries are very close
            const timeThreshold = 0.1; // 100ms threshold
            
            // Check for adjacent tokens
            if (Math.abs(thisStart - modEnd) < timeThreshold || 
                Math.abs(thisEnd - modStart) < timeThreshold) {
                return true;
            }
            
            // Check for overlapping tokens
            if ((thisStart <= modEnd && thisEnd >= modStart) ||
                (modStart <= thisEnd && modEnd >= thisStart)) {
                return true;
            }
        }
        
        return false;
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
        
        // Update waveform - use selectTokens with full selection array
        if (this.waveformEditor) {
            // Only pass selection information to waveform, don't mix with modification
            this.waveformEditor.selectTokens(this.selectedTokens);
        }
        
        // Call selection callback if provided
        if (this.onSelectionChange) {
            this.onSelectionChange(this.selectedTokens);
        }
        
        this.isProcessingChange = false;
    }
    
    /**
     * Find token that contains a specific character position with improved boundary handling
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
                // Add a small buffer (1 character) to avoid accidental selection at boundaries
                if (position >= tokenStart && position <= tokenEnd) {
                    return token.token_idx;
                }
                
                // Move to next occurrence
                start = tokenStart + 1;
            }
        }
        
        return null;
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
     * Fixed to handle adjacent token edits properly
     * @returns {Array} - Array of edit operations
     */
    getEditOperations() {
        const editOperations = [];
        
        // Get all rendered token spans from the DOM
        const tokenSpans = document.querySelectorAll('.token-span');
        
        // Group adjacent modified tokens together for more efficient editing
        const modificationGroups = this.groupAdjacentModifiedTokens();
        
        // Process each group of modifications
        for (const group of modificationGroups) {
            const { tokenIndices, startIdx, endIdx } = group;
            
            // Find the actual edited text from the rendered spans
            let originalText = '';
            let editedText = '';
            let foundAnySpans = false;
            
            // Collect the text from all spans in this group
            for (const tokenIdx of tokenIndices) {
                // Find the original token
                const token = this.tokens.find(t => t.token_idx === tokenIdx);
                if (token) {
                    originalText += token.text;
                }
                
                // Find the span for this token
                const span = document.querySelector(`[data-token-idx="${tokenIdx}"]`);
                if (span) {
                    editedText += span.textContent;
                    foundAnySpans = true;
                }
            }
            
            // If no spans were found, this is a deletion
            if (!foundAnySpans) {
                editedText = '';
            }
            
            // Only create an edit operation if the text actually changed
            if (originalText !== editedText) {
                console.log(`Creating edit operation for tokens ${startIdx}-${endIdx}: "${originalText}" → "${editedText}"`);
                
                editOperations.push({
                    original_text: originalText,
                    edited_text: editedText,
                    start_token_idx: startIdx,
                    end_token_idx: endIdx + 1 // Still need +1 because API expects exclusive end index
                });
            }
        }
        
        // Handle isolated deleted tokens that weren't included in any group
        for (const tokenIdx of this.modifiedTokens) {
            // Check if this token was already included in a group
            const isInGroup = modificationGroups.some(group => 
                group.tokenIndices.includes(tokenIdx)
            );
            
            if (!isInGroup) {
                // Find the token
                const token = this.tokens.find(t => t.token_idx === tokenIdx);
                if (token) {
                    const originalText = token.text || '';
                    
                    // Check if there's a rendered span for this token
                    const span = document.querySelector(`[data-token-idx="${tokenIdx}"]`);
                    const editedText = span ? span.textContent : '';
                    
                    // Only create an edit operation if the text actually changed
                    if (originalText !== editedText) {
                        console.log(`Creating isolated edit operation for token ${tokenIdx}: "${originalText}" → "${editedText}"`);
                        
                        editOperations.push({
                            original_text: originalText,
                            edited_text: editedText,
                            start_token_idx: tokenIdx,
                            end_token_idx: tokenIdx + 1 // API expects exclusive end index
                        });
                    }
                }
            }
        }
        
        return editOperations;
    }

    /**
     * Group adjacent modified tokens to create more efficient edit operations
     * @returns {Array} - Array of modification groups
     */
    groupAdjacentModifiedTokens() {
        const groups = [];
        
        if (this.modifiedTokens.length === 0) return groups;
        
        // Sort modified tokens by their position in the text (by start time)
        const sortedTokens = [...this.modifiedTokens].sort((a, b) => {
            const tokenA = this.tokens.find(t => t.token_idx === a);
            const tokenB = this.tokens.find(t => t.token_idx === b);
            
            if (!tokenA || !tokenB) return 0;
            
            return tokenA.start_time - tokenB.start_time;
        });
        
        let currentGroup = {
            tokenIndices: [sortedTokens[0]],
            startIdx: sortedTokens[0],
            endIdx: sortedTokens[0]
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
                currentGroup.endIdx = tokenIdx;
            } else {
                // Start a new group
                groups.push(currentGroup);
                currentGroup = {
                    tokenIndices: [tokenIdx],
                    startIdx: tokenIdx,
                    endIdx: tokenIdx
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
        this.tokenToSpanMap = {};
        this.wordBoundaryTokens = new Set();
        this.subwordTokenMap = {};
    }
}

// Make available globally
window.TokenTextEditor = TokenTextEditor;