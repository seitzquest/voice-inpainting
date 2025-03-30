/**
 * Improved token-text-editor.js with fixes for space handling, duplicate words,
 * and accurate token modification tracking
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
        this.previousActiveTokens = []; // Remember previous active state for tracking stability
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
        this.previousActiveTokens = [...this.activeTokens];
        
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
            
            // Store all position candidates for this token
            const candidatePositions = [];
            
            for (const position of positions) {
                // Check if this position overlaps with already assigned tokens
                const hasOverlap = this.originalTokens.some(existingToken => 
                    existingToken.start < position.end && existingToken.end > position.start
                );
                
                if (!hasOverlap) {
                    candidatePositions.push(position);
                }
            }
            
            if (candidatePositions.length > 0) {
                // For initialization, try to find the best match by checking timing
                // If we have multiple candidate positions, try to keep tokens in time order
                let bestPosition = candidatePositions[0];
                
                if (candidatePositions.length > 1 && this.originalTokens.length > 0) {
                    // Find the last assigned token
                    const lastToken = this.originalTokens[this.originalTokens.length - 1];
                    
                    // Find a position that follows the last token
                    for (const position of candidatePositions) {
                        if (position.start >= lastToken.end) {
                            bestPosition = position;
                            break;
                        }
                    }
                }
                
                // Store original token information
                this.originalTokens.push({
                    tokenIdx: tokenIdx,
                    text: tokenText,
                    start: bestPosition.start,
                    end: bestPosition.end
                });
                
                // Initially, all tokens are active
                this.activeTokens.push({
                    tokenIdx: tokenIdx,
                    start: bestPosition.start,
                    end: bestPosition.end
                });
            }
        }
        
        // Sort tokens by position for consistent processing
        this.originalTokens.sort((a, b) => a.start - b.start);
        this.activeTokens.sort((a, b) => a.start - b.start);
    }
    
    /**
     * Find all positions of a token in text
     * FIX 1: Improved to handle spaces correctly and work with duplicate words
     * @param {string} text - Text to search in
     * @param {string} tokenText - Token text to find
     * @returns {Array} - Array of {start, end} positions
     */
    findTokenPositions(text, tokenText) {
        const positions = [];
        
        // Escape regex special characters but preserve spaces exactly
        const escapedTokenText = this.escapeRegExp(tokenText);
        
        // Create a pattern that preserves spaces exactly and handles word boundaries
        // Better than \b which has issues with spaces and punctuation
        let pattern = escapedTokenText;
        
        // For word-like tokens, create custom boundaries that respect space sequences
        // but only if the token starts/ends with a word character
        if (/^\w/.test(tokenText)) {
            // Pattern for token starting with word char: preceded by start or non-word char or spaces
            pattern = `(?:^|[^\\w]|\\s+)${pattern}`;
        }
        if (/\w$/.test(tokenText)) {
            // Pattern for token ending with word char: followed by end or non-word char or spaces
            pattern = `${pattern}(?:$|[^\\w]|\\s+)`;
        }
        
        // Need to use a global search to find all occurrences
        const regex = new RegExp(pattern, 'g');
        let match;
        
        while ((match = regex.exec(text)) !== null) {
            // Adjust the match index and end position to exclude the boundary matchers themselves
            let startOffset = 0;
            let endOffset = 0;
            
            if (/^\w/.test(tokenText) && match[0] !== tokenText) {
                // If there's a boundary prefix, calculate its length
                startOffset = match[0].indexOf(tokenText);
                // Adjust the regex index for future matches
                regex.lastIndex = match.index + startOffset + tokenText.length;
            }
            
            positions.push({
                start: match.index + startOffset,
                end: match.index + startOffset + tokenText.length
            });
        }
        
        return positions;
    }
    
    /**
     * Get context around a token position
     * Used to better identify duplicate words/phrases
     * @param {string} text - Full text
     * @param {number} start - Token start position
     * @param {number} end - Token end position
     * @param {number} contextSize - Number of characters to include as context
     * @returns {Object} - Context object with before/after text
     */
    getTokenContext(text, start, end, contextSize = 20) {
        const beforeStart = Math.max(0, start - contextSize);
        const afterEnd = Math.min(text.length, end + contextSize);
        
        return {
            before: text.substring(beforeStart, start),
            after: text.substring(end, afterEnd)
        };
    }
    
    /**
     * Calculate similarity between two contexts
     * @param {Object} context1 - First context {before, after}
     * @param {Object} context2 - Second context {before, after}
     * @returns {number} - Similarity score
     */
    calculateContextSimilarity(context1, context2) {
        // Calculate similarity scores for before and after contexts
        let beforeSimilarity = 0;
        let afterSimilarity = 0;
        
        // Compare characters from right to left for "before" context
        const minBeforeLength = Math.min(context1.before.length, context2.before.length);
        for (let i = 1; i <= minBeforeLength; i++) {
            if (context1.before[context1.before.length - i] === 
                context2.before[context2.before.length - i]) {
                beforeSimilarity++;
            } else {
                // Minor penalty for first mismatch, severe for subsequent ones
                break;
            }
        }
        
        // Compare characters from left to right for "after" context
        const minAfterLength = Math.min(context1.after.length, context2.after.length);
        for (let i = 0; i < minAfterLength; i++) {
            if (context1.after[i] === context2.after[i]) {
                afterSimilarity++;
            } else {
                // Minor penalty for first mismatch, severe for subsequent ones
                break;
            }
        }
        
        // Combined score with equal weighting
        return beforeSimilarity + afterSimilarity;
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
     * Escape regular expression special characters
     * @param {string} string - String to escape
     * @returns {string} - Escaped string for regex
     */
    escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    
    /**
     * Handle input events
     */
    handleInput() {
        if (this.isProcessingChange || this.isInitializing) return;
        this.isProcessingChange = true;
        
        // Store previous active tokens before updating
        this.previousActiveTokens = [...this.activeTokens];
        
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
     * FIX 2: Improved to correctly handle duplicate words using position history and change detection
     */
    updateTokenTracking() {
        const currentText = this.textArea.value;
        
        // Start fresh with active tokens
        this.activeTokens = [];
        
        // Track which positions have been claimed by tokens
        const claimedRanges = [];
        
        // Detect the regions that changed between the last text and current text
        const changedRegions = this.detectTextChanges(this.lastText, currentText);
        
        // Track which tokens were potentially modified based on change regions
        // This is crucial for correctly identifying which duplicate token was modified
        const tokensInChangedRegions = this.previousActiveTokens.filter(token => {
            return changedRegions.some(region => 
                (token.start < region.end && token.end > region.start)
            );
        }).map(token => token.tokenIdx);
        
        // Process tokens in two passes:
        // 1. First process tokens that weren't in changed regions (stable tokens)
        // 2. Then process tokens that were in changed regions (potentially modified)
        
        // Sort tokens by their original position
        const sortedOriginalTokens = [...this.originalTokens].sort((a, b) => a.start - b.start);
        
        // FIRST PASS: Process tokens that weren't in changed regions
        const stableTokens = sortedOriginalTokens.filter(token => 
            !tokensInChangedRegions.includes(token.tokenIdx)
        );
        
        for (const originalToken of stableTokens) {
            const tokenIdx = originalToken.tokenIdx;
            const tokenText = originalToken.text;
            
            // Find previous position for this token
            const prevPosition = this.previousActiveTokens.find(t => t.tokenIdx === tokenIdx);
            
            // Find all occurrences of this token text in the current text
            const positions = this.findTokenPositions(currentText, tokenText);
            
            if (positions.length > 0) {
                // Filter out positions that overlap with already claimed ranges
                const availablePositions = positions.filter(pos => 
                    !claimedRanges.some(range => 
                        (pos.start < range.end && pos.end > range.start)
                    )
                );
                
                if (availablePositions.length > 0) {
                    // For stable tokens, try to keep them at the same position if possible
                    let bestPosition = null;
                    
                    if (prevPosition) {
                        // Try to find exact position match first
                        const exactMatch = availablePositions.find(pos => 
                            pos.start === prevPosition.start && pos.end === prevPosition.end
                        );
                        
                        if (exactMatch) {
                            bestPosition = exactMatch;
                        } else {
                            // Find closest match by position
                            let minDistance = Infinity;
                            for (const pos of availablePositions) {
                                const distance = Math.abs(pos.start - prevPosition.start);
                                if (distance < minDistance) {
                                    minDistance = distance;
                                    bestPosition = pos;
                                }
                            }
                        }
                    }
                    
                    // If no match with history, use first available
                    if (!bestPosition) {
                        bestPosition = availablePositions[0];
                    }
                    
                    // Add token at this position
                    this.activeTokens.push({
                        tokenIdx: tokenIdx,
                        start: bestPosition.start,
                        end: bestPosition.end
                    });
                    
                    // Mark this range as claimed
                    claimedRanges.push({
                        start: bestPosition.start,
                        end: bestPosition.end
                    });
                }
            }
        }
        
        // SECOND PASS: Process tokens that were in changed regions
        const changedTokens = sortedOriginalTokens.filter(token => 
            tokensInChangedRegions.includes(token.tokenIdx)
        );
        
        for (const originalToken of changedTokens) {
            const tokenIdx = originalToken.tokenIdx;
            const tokenText = originalToken.text;
            
            // Find previous position for this token
            const prevPosition = this.previousActiveTokens.find(t => t.tokenIdx === tokenIdx);
            
            // Find all occurrences of this token in the current text
            const positions = this.findTokenPositions(currentText, tokenText);
            
            if (positions.length > 0) {
                // Filter out positions that overlap with already claimed ranges
                const availablePositions = positions.filter(pos => 
                    !claimedRanges.some(range => 
                        (pos.start < range.end && pos.end > range.start)
                    )
                );
                
                if (availablePositions.length > 0) {
                    // For potentially modified tokens, we need more sophisticated matching
                    let bestPosition = null;
                    let bestScore = -Infinity;
                    
                    // Get original context
                    const originalContext = this.getTokenContext(
                        this.originalText, 
                        originalToken.start, 
                        originalToken.end
                    );
                    
                    // Also get previous context if available
                    const prevContext = prevPosition ? 
                        this.getTokenContext(this.lastText, prevPosition.start, prevPosition.end) : null;
                    
                    for (const position of availablePositions) {
                        // Get current context
                        const currentContext = this.getTokenContext(
                            currentText, 
                            position.start, 
                            position.end
                        );
                        
                        // SCORING SYSTEM - combining multiple factors:
                        
                        // 1. Context similarity with original text
                        const originalContextScore = this.calculateContextSimilarity(
                            originalContext, 
                            currentContext
                        ) * 2; // Weight factor
                        
                        // 2. Context similarity with previous position (stronger weight)
                        const prevContextScore = prevContext ? 
                            this.calculateContextSimilarity(prevContext, currentContext) * 4 : 0;
                        
                        // 3. Position similarity to previous position
                        let positionScore = 0;
                        if (prevPosition) {
                            // Use exponential decay for position differences
                            const posDiff = Math.abs(position.start - prevPosition.start);
                            positionScore = 1000 * Math.exp(-posDiff / 50);
                        }
                        
                        // 4. Special handling for changed regions - KEY TO FIXING DUPLICATES
                        let changeRegionScore = 0;
                        const isInChangedRegion = changedRegions.some(region => 
                            (position.start <= region.end && position.end >= region.start)
                        );
                        
                        // If previous position was in a changed region, we want to analyze differently
                        if (prevPosition) {
                            const wasPrevInChangedRegion = changedRegions.some(region => 
                                (prevPosition.start <= region.end && prevPosition.end >= region.start)
                            );
                            
                            if (wasPrevInChangedRegion) {
                                if (isInChangedRegion) {
                                    // If both old and new positions are in changed regions,
                                    // this might be the same token that moved slightly due to edits
                                    if (Math.abs(position.start - prevPosition.start) < 20) {
                                        changeRegionScore = 500; // Strong bonus for likely the same token
                                    } else {
                                        changeRegionScore = -200; // Penalty for distant positions
                                    }
                                } else {
                                    // Previous was in changed region but current isn't - 
                                    // this might indicate this token was copied/duplicated
                                    changeRegionScore = -400;
                                }
                            } else {
                                if (isInChangedRegion) {
                                    // Previous wasn't in changed region but current is -
                                    // likely not the right match for this token
                                    changeRegionScore = -700; // Strong penalty
                                } else {
                                    // Neither in changed region - stable match
                                    changeRegionScore = 300;
                                }
                            }
                        }
                        
                        // Combined score
                        const combinedScore = 
                            originalContextScore + 
                            prevContextScore + 
                            positionScore + 
                            changeRegionScore;
                        
                        if (combinedScore > bestScore) {
                            bestScore = combinedScore;
                            bestPosition = position;
                        }
                    }
                    
                    // If we found a match, add it as an active token
                    if (bestPosition) {
                        this.activeTokens.push({
                            tokenIdx: tokenIdx,
                            start: bestPosition.start,
                            end: bestPosition.end
                        });
                        
                        // Mark this range as claimed
                        claimedRanges.push({
                            start: bestPosition.start,
                            end: bestPosition.end
                        });
                    }
                }
            }
        }
        
        // Sort active tokens by position
        this.activeTokens.sort((a, b) => a.start - b.start);
        
        // Update modified tokens list - any token not active is considered modified
        const activeTokenIndices = this.activeTokens.map(token => token.tokenIdx);
        
        this.modifiedTokens = this.originalTokens
            .filter(token => !activeTokenIndices.includes(token.tokenIdx))
            .map(token => token.tokenIdx);
    }
    
    /**
     * Detect regions of text that changed between old and new text
     * Improved to detect multiple changed regions
     * @param {string} oldText - Previous text
     * @param {string} newText - Current text
     * @returns {Array} - Array of {start, end} ranges that changed
     */
    detectTextChanges(oldText, newText) {
        const changes = [];
        
        // If either text is empty, the entire text is different
        if (!oldText || !newText) {
            return [{start: 0, end: Math.max(oldText?.length || 0, newText?.length || 0)}];
        }
        
        // Find common prefix length
        let prefixLength = 0;
        const minLength = Math.min(oldText.length, newText.length);
        
        while (prefixLength < minLength && oldText[prefixLength] === newText[prefixLength]) {
            prefixLength++;
        }
        
        // Find common suffix length (starting from the end of strings)
        let suffixLength = 0;
        while (
            suffixLength < minLength - prefixLength && 
            oldText[oldText.length - 1 - suffixLength] === newText[newText.length - 1 - suffixLength]
        ) {
            suffixLength++;
        }
        
        // If there's a change, record the changed region
        const oldChangeLength = oldText.length - prefixLength - suffixLength;
        const newChangeLength = newText.length - prefixLength - suffixLength;
        
        if (oldChangeLength > 0 || newChangeLength > 0) {
            changes.push({
                start: prefixLength,
                end: newText.length - suffixLength
            });
        }
        
        return changes;
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
     * Build original text from transcript text, preserving exact spacing
     * @param {Array} tokenData - Array of token data {tokenIdx, text, etc.}
     * @param {string} transcript - Full transcript text
     * @returns {string} - Original text extracted from transcript
     */
    buildOriginalTextFromTranscript(tokenData, transcript) {
        if (!tokenData || tokenData.length === 0 || !transcript) {
            return '';
        }
        
        // Get the start and end times from tokens
        const startTime = Math.min(...tokenData.map(t => {
            const token = this.tokens.find(tk => tk.token_idx === t);
            return token ? token.start_time : Infinity;
        }));
        
        const endTime = Math.max(...tokenData.map(t => {
            const token = this.tokens.find(tk => tk.token_idx === t);
            return token ? token.end_time : 0;
        }));
        
        // Look for the corresponding tokens in the original token list
        const relevantTokens = this.tokens.filter(t => 
            t.start_time >= startTime && t.end_time <= endTime
        );
        
        // If we found tokens in the right time range
        if (relevantTokens.length > 0) {
            // Find the text positions of the first and last token
            let firstPosition = -1;
            let lastPosition = -1;
            
            for (const token of relevantTokens) {
                const positions = this.findTokenPositions(transcript, token.text);
                
                for (const pos of positions) {
                    if (firstPosition === -1 || pos.start < firstPosition) {
                        firstPosition = pos.start;
                    }
                    
                    if (lastPosition === -1 || pos.end > lastPosition) {
                        lastPosition = pos.end;
                    }
                }
            }
            
            // If we found valid positions
            if (firstPosition !== -1 && lastPosition !== -1) {
                // Extract the exact substring from the transcript
                return transcript.substring(firstPosition, lastPosition);
            }
        }
        
        // Fallback to token concatenation preserving spaces
        let originalText = '';
        let prevTokenEnd = -1;
        
        // Sort token data by time to ensure correct order
        const timeOrderedTokens = [...tokenData].sort((a, b) => {
            const tokenA = this.tokens.find(t => t.token_idx === a);
            const tokenB = this.tokens.find(t => t.token_idx === b);
            return tokenA && tokenB ? tokenA.start_time - tokenB.start_time : 0;
        });
        
        for (const tokenIdx of timeOrderedTokens) {
            const token = this.tokens.find(t => t.token_idx === tokenIdx);
            if (!token) continue;
            
            const tokenText = token.text;
            
            // Check if we need to add space between tokens
            if (prevTokenEnd !== -1) {
                // Find both tokens in the transcript and check if there's space between them
                const positions = this.findTokenPositions(transcript, tokenText);
                
                if (positions.length > 0) {
                    // Try to find a position that comes after the previous token
                    const validPositions = positions.filter(pos => pos.start > prevTokenEnd);
                    
                    if (validPositions.length > 0) {
                        // Get the first valid position
                        const pos = validPositions[0];
                        
                        // Check if there are spaces between the previous token and this one
                        const gap = transcript.substring(prevTokenEnd, pos.start);
                        originalText += gap; // This preserves exact spacing
                        prevTokenEnd = pos.end;
                        originalText += tokenText;
                        continue;
                    }
                }
                
                // If we can't find the exact position, add a space if needed
                if (!originalText.endsWith(' ') && !tokenText.startsWith(' ') &&
                    !originalText.endsWith('.') && !originalText.endsWith(',') &&
                    !originalText.endsWith('!') && !originalText.endsWith('?')) {
                    originalText += ' ';
                }
            }
            
            originalText += tokenText;
            
            // Update prevTokenEnd using the token's position in the transcript
            const positions = this.findTokenPositions(transcript, tokenText);
            if (positions.length > 0) {
                // Use the first occurrence for simplicity
                prevTokenEnd = positions[0].end;
            } else {
                // If position not found, just update based on current string length
                prevTokenEnd = originalText.length;
            }
        }
        
        return originalText;
    }
    
    /**
     * Get modifications as edit operations for the API
     * IMPROVED: Uses buildOriginalTextFromTranscript for more accurate text extraction
     * @returns {Array} - Array of edit operations
     */
    getEditOperations() {
        const editOperations = [];
        const currentText = this.textArea.value;
        
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
                .filter(t => t !== null)
                .sort((a, b) => a.start_time - b.start_time);
            
            if (tokenData.length === 0) continue;
            
            // Build original text using the transcript-based method
            // This preserves exact spacing from the original transcript
            const originalText = this.buildOriginalTextFromTranscript(
                tokenIndices, 
                this.originalText
            );
            
            // Find what text has replaced these tokens
            const editedText = this.inferEditedTextForTokens(tokenIndices, currentText);
            
            // Create edit operation with accurate original text (preserving spaces)
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
     * Infer edited text for a group of modified tokens
     * @param {Array} modifiedTokenIndices - Array of modified token indices
     * @param {string} currentText - Current text in the text area
     * @returns {string} - Edited text inferred from the current text
     */
    inferEditedTextForTokens(modifiedTokenIndices, currentText) {
        // Sort original tokens by their position
        const sortedOriginalTokens = [...this.originalTokens].sort((a, b) => a.start - b.start);
        
        // Find the positions of the modified tokens in the original sequence
        const positions = sortedOriginalTokens
            .map((token, index) => ({ index, tokenIdx: token.tokenIdx }))
            .filter(item => modifiedTokenIndices.includes(item.tokenIdx))
            .map(item => item.index);
        
        if (positions.length === 0) return '';
        
        // Find the range of positions
        const firstModifiedPos = Math.min(...positions);
        const lastModifiedPos = Math.max(...positions);
        
        // Find anchor tokens before and after the modified group
        let beforeAnchor = null;
        for (let i = firstModifiedPos - 1; i >= 0; i--) {
            const token = sortedOriginalTokens[i];
            // Check if this token is still active in the current text
            const activeToken = this.activeTokens.find(t => t.tokenIdx === token.tokenIdx);
            if (activeToken) {
                beforeAnchor = activeToken;
                break;
            }
        }
        
        let afterAnchor = null;
        for (let i = lastModifiedPos + 1; i < sortedOriginalTokens.length; i++) {
            const token = sortedOriginalTokens[i];
            // Check if this token is still active in the current text
            const activeToken = this.activeTokens.find(t => t.tokenIdx === token.tokenIdx);
            if (activeToken) {
                afterAnchor = activeToken;
                break;
            }
        }
        
        // Extract the text between the anchors in the current text
        let editedText = '';
        
        if (beforeAnchor && afterAnchor) {
            // We have anchors on both sides
            let startPos = beforeAnchor.end;
            let endPos = afterAnchor.start;
            
            // Trim ALL whitespace from boundaries
            // This approach handles cases with multiple spaces or different types of whitespace
            const textBetweenAnchors = currentText.substring(startPos, endPos);
            const trimmedText = textBetweenAnchors.trim();
            
            if (trimmedText.length > 0) {
                // Find the position of the trimmed text within the original text between anchors
                const startOffset = textBetweenAnchors.indexOf(trimmedText);
                editedText = trimmedText;
            } else {
                // If there's only whitespace between the anchors, return empty string
                editedText = '';
            }
        } else if (beforeAnchor) {
            // Only have an anchor before
            let startPos = beforeAnchor.end;
            const maxLength = 100; // Reasonable maximum length
            
            // Get text after the anchor
            const textAfterAnchor = currentText.substring(startPos, Math.min(startPos + maxLength, currentText.length));
            // Trim leading whitespace
            const trimmedStart = textAfterAnchor.replace(/^\s+/, '');
            
            if (trimmedStart.length > 0) {
                // Calculate the real starting position after whitespace
                startPos += textAfterAnchor.length - trimmedStart.length;
                
                // Find a natural end point
                let endPos = startPos + trimmedStart.length;
                const naturalEndPoints = ['. ', '? ', '! ', '\n'];
                for (const endPoint of naturalEndPoints) {
                    const index = trimmedStart.indexOf(endPoint);
                    if (index !== -1) {
                        endPos = startPos + index + endPoint.length;
                        break;
                    }
                }
                
                editedText = currentText.substring(startPos, endPos);
            }
        } else if (afterAnchor) {
            // Only have an anchor after
            let endPos = afterAnchor.start;
            const maxLength = 100; // Reasonable maximum length
            
            // Get text before the anchor, limited to maxLength
            const textBeforeAnchor = currentText.substring(Math.max(0, endPos - maxLength), endPos);
            // Trim trailing whitespace
            const trimmedEnd = textBeforeAnchor.replace(/\s+$/, '');
            
            if (trimmedEnd.length > 0) {
                // Calculate the real ending position before whitespace
                endPos = endPos - (textBeforeAnchor.length - trimmedEnd.length);
                
                // Find a natural start point
                let startPos = endPos - trimmedEnd.length;
                const naturalStartPoints = ['. ', '? ', '! ', '\n'];
                for (const startPoint of naturalStartPoints) {
                    const index = trimmedEnd.lastIndexOf(startPoint);
                    if (index !== -1) {
                        startPos = endPos - trimmedEnd.length + index + startPoint.length;
                        break;
                    }
                }
                
                editedText = currentText.substring(startPos, endPos);
            }
        } else {
            // No anchors on either side - entire text might have been modified
            // Still trim to match the behavior in other cases
            editedText = currentText.trim();
        }
        
        return editedText;
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
        this.previousActiveTokens = [];
    }
}

// Make available globally
window.TokenTextEditor = TokenTextEditor;