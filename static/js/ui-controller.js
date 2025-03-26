/**
 * ui-controller.js
 * Manages UI states and transitions between application steps
 */

class UIController {
    constructor() {
        // Store references to all UI sections
        this.sections = {
            // Step 1: Record/Upload
            recordSection: document.getElementById('recordSection'),
            uploadSection: document.getElementById('uploadSection'),
            inputMethodSelection: document.getElementById('inputMethodSelection'),
        
            // Step 2: Edit
            audioPreview: document.getElementById('audioPreview'),
            editModeSelection: document.getElementById('editModeSelection'), // Now using the pre-defined div
            manualEditor: document.getElementById('manualEditorContainer'),
            promptEditor: document.getElementById('editSection'),
            
            // Step 3: Result
            resultSection: document.getElementById('resultSection'),
            
            // Common elements
            backButtonContainer: document.getElementById('backButtonContainer'),
            loadingIndicator: document.getElementById('loadingIndicator'),
            errorMessage: document.getElementById('errorMessage'),
            errorText: document.getElementById('errorText')
        };
        
        // Recording state UI elements
        this.recordingStates = {
            preRecording: document.getElementById('preRecordingState'),
            activeRecording: document.getElementById('activeRecordingState'),
            pausedRecording: document.getElementById('pausedRecordingState')
        };
        
        // Audio elements
        this.audioElements = {
            audioPlayer: document.getElementById('audioPlayer'),
            processedAudio: document.getElementById('processedAudio'),
            previewPlayer: document.getElementById('previewPlayer')
        };
        
        // Text and status display elements
        this.textElements = {
            fileName: document.getElementById('fileName'),
            editPrompt: document.getElementById('editPrompt'),
            editPromptDisplay: document.getElementById('editPromptDisplay'),
            processingDetails: document.getElementById('processingDetails')
        };
        
        // Progress steps
        this.progressSteps = document.querySelectorAll('.progress-step');
        
        // Tokenization state tracking (existing state for manual editing)
        this.tokenizationState = {
            inProgress: false,
            cancelled: false
        };        

        // Processing state tracking (new state for prompt-based editing)
        this.processingState = {
            inProgress: false,
            cancelled: false
        };

        // Application state
        this.state = {
            currentStep: 1,
            editMode: 'manual', // 'manual' or 'prompt'
            isEditingProcessedAudio: false,
            processedAudioBlob: null,
            audioBlob: null,
            tokenData: null,
            transcribedText: null,
            
            // Editors
            waveformEditor: null,
            tokenTextEditor: null
        };
    }
    
    /**
     * Initialize UI and bind event handlers
     */
    init() {
        // Set initial state
        this.goToStep(1);
        
        // Bind radio button change events for input method selection
        document.querySelectorAll('input[name="audioChoice"]').forEach(radio => {
            radio.addEventListener('change', () => this.handleInputMethodChange(radio.value));
        });
        
        // Bind radio button change events for edit mode selection
        document.querySelectorAll('input[name="editMode"]').forEach(radio => {
            radio.addEventListener('change', () => {
                if (radio.checked) {
                    this.setEditMode(radio.value);
                }
            });
        });
        
        // Show the appropriate section based on default selection
        this.handleInputMethodChange(
            document.querySelector('input[name="audioChoice"]:checked').value
        );
        
        console.log('UI Controller initialized');
    }
    
    /**
     * Navigate to a specific step
     * @param {number} step - The step to navigate to (1, 2, or 3)
     */
    goToStep(step) {
        this.state.currentStep = step;
        
        // Hide all sections first
        this.hideAllSections();
        
        // Update progress indicator
        this.updateProgress(step);
        
        // Show appropriate sections based on step
        switch (step) {
            case 1:
                this.setupStep1();
                break;
            case 2:
                this.setupStep2();
                break;
            case 3:
                this.setupStep3();
                break;
        }
    }
    
    /**
     * Set up Step 1: Record/Upload
     */
    setupStep1() {
        // Clean up any resources from previous steps
        this.cleanupEditors();
        
        // Clear state data for editing
        this.state.tokenData = null;
        this.state.transcribedText = null;
        
        // Show input radio group
        if (this.sections.inputMethodSelection) {
            this.sections.inputMethodSelection.classList.remove('hidden');
            this.sections.inputMethodSelection.style.display = ''; // Clear any inline display style
        }
        
        // Show the appropriate section based on selected input method
        if (document.getElementById('record').checked) {
            this.sections.recordSection.classList.remove('hidden');
        } else {
            this.sections.uploadSection.classList.remove('hidden');
        }
        
        // Reset recording UI state
        this.recordingStates.preRecording.classList.remove('hidden');
        this.recordingStates.activeRecording.classList.add('hidden');
        this.recordingStates.pausedRecording.classList.add('hidden');
        
        // Reset form elements
        this.textElements.editPrompt.value = '';
        this.textElements.fileName.textContent = '';
        this.textElements.fileName.classList.add('hidden');
        
        // Reset file input
        document.getElementById('fileUpload').value = '';
    }
    
    /**
     * Set up Step 2: Edit
     */
    setupStep2() {
        // Show back button
        this.sections.backButtonContainer.classList.remove('hidden');
        
        // Make sure input method selection is hidden to fix the bug
        if (this.sections.inputMethodSelection) {
            this.sections.inputMethodSelection.classList.add('hidden');
            this.sections.inputMethodSelection.style.display = 'none'; // Force hide with inline style
        }
        
        // Show edit mode selection
        if (this.sections.editModeSelection) {
            this.sections.editModeSelection.classList.remove('hidden');
            
            // Set the correct radio button based on current state
            const manualRadio = document.getElementById('manual-edit');
            const promptRadio = document.getElementById('prompt-edit');
            
            if (this.state.editMode === 'manual') {
                manualRadio.checked = true;
                promptRadio.checked = false;
            } else {
                manualRadio.checked = false;
                promptRadio.checked = true;
            }
        }

        // Show audio preview if we have audio
        if (this.state.audioBlob) {
            this.sections.audioPreview.classList.remove('hidden');
            
            // Set audio player source if needed
            if (!this.audioElements.audioPlayer.src && this.state.audioBlob) {
                this.audioElements.audioPlayer.src = URL.createObjectURL(this.state.audioBlob);
            }
        }
        
        // Set up based on edit mode
        this.setEditMode(this.state.editMode);
    }
    
    /**
     * Set up Step 3: Result
     */
    setupStep3() {
        // Show result section
        this.sections.resultSection.classList.remove('hidden');
    }
    
    /**
     * Hide all UI sections
     */
    hideAllSections() {
        // Hide all main sections
        this.sections.recordSection.classList.add('hidden');
        this.sections.uploadSection.classList.add('hidden');
        this.sections.audioPreview.classList.add('hidden');
        this.sections.resultSection.classList.add('hidden');
        this.sections.backButtonContainer.classList.add('hidden');
        
        // Hide input selection radio group - use both class and inline style
        if (this.sections.inputMethodSelection) {
            this.sections.inputMethodSelection.classList.add('hidden');
            this.sections.inputMethodSelection.style.display = 'none'; // Force hide with inline style
        }
        
        // Hide error message
        this.sections.errorMessage.classList.add('hidden');
        
        // Hide edit mode selection
        if (this.sections.editModeSelection) {
            this.sections.editModeSelection.classList.add('hidden');
        }
        
        // Hide editors
        if (this.sections.manualEditor) {
            this.sections.manualEditor.classList.add('hidden');
        }
        this.sections.promptEditor.classList.add('hidden');
    }
    
    // Remove the createEditModeSelection method since we're now using the pre-defined element in HTML
    
    /**
     * Create or get the manual editor container
     * @returns {HTMLElement} The manual editor container
     */
    getManualEditorContainer() {
        if (!this.sections.manualEditor) {
            const container = document.createElement('div');
            container.id = 'manualEditorContainer';
            container.className = 'manual-editor-container mb-6 slide-in';
            this.sections.manualEditor = container;
        }
        
        return this.sections.manualEditor;
    }
    
    /**
     * Handle change in input method (record vs upload)
     * @param {string} method - The selected input method ('record' or 'upload')
     */
    handleInputMethodChange(method) {
        // Only applicable in step 1
        if (this.state.currentStep !== 1) return;
        
        if (method === 'record') {
            this.sections.recordSection.classList.remove('hidden');
            this.sections.uploadSection.classList.add('hidden');
        } else {
            this.sections.recordSection.classList.add('hidden');
            this.sections.uploadSection.classList.remove('hidden');
        }
    }
    
    /**
     * Update progress indicator
     * @param {number} step - Current step (1, 2, or 3)
     */
    updateProgress(step) {
        // Clear all line-active classes first
        this.progressSteps.forEach(step => {
            step.classList.remove('line-active');
        });
        
        // Update each step status
        this.progressSteps.forEach((progressStep, index) => {
            const stepNumber = index + 1;
            
            // Reset classes first
            progressStep.classList.remove('active', 'complete', 'line-active');
            
            if (stepNumber < step) {
                // Previous steps are complete
                progressStep.classList.add('complete');
            } else if (stepNumber === step) {
                // Current step is active
                progressStep.classList.add('active');
            } 
            
            // Special handling for the lines
            // 1. Line between Step 1 and 2 should be active if we're in step 2 or higher
            if (stepNumber === 2 && step >= 2) {
                progressStep.classList.add('line-active');
            }
            
            // 2. Line between Step 2 and 3 should be active if we're in step 3
            if (stepNumber === 3 && step === 3) {
                progressStep.classList.add('line-active');
            }
        });
    }
    
    /**
     * Set the editing mode and update UI
     * @param {string} mode - Edit mode ('manual' or 'prompt')
     */
    setEditMode(mode) {
        const previousMode = this.state.editMode;
        this.state.editMode = mode;
        
        // Update radio buttons if they exist
        const manualRadio = document.getElementById('manual-edit');
        const promptRadio = document.getElementById('prompt-edit');
        
        if (manualRadio && promptRadio) {
            if (mode === 'manual') {
                manualRadio.checked = true;
                promptRadio.checked = false;
            } else {
                manualRadio.checked = false;
                promptRadio.checked = true;
            }
        }
        
        // Only proceed if on step 2
        if (this.state.currentStep !== 2) return;
        
        // Check if we should cancel tokenization
        if (previousMode === 'manual' && mode === 'prompt' && this.tokenizationState.inProgress) {
            console.log('Cancelling tokenization due to edit mode change from manual to prompt');
            this.tokenizationState.cancelled = true;
            this.showLoading(false);  // Hide loading indicator immediately
        }

        // Check if we should cancel processing
        if (previousMode === 'prompt' && mode === 'manual' && this.processingState.inProgress) {
            console.log('Cancelling processing due to edit mode change from prompt to manual');
            this.processingState.cancelled = true;
            this.showLoading(false);  // Hide loading indicator immediately
        }
        
        // Make sure input method selection is hidden to fix the bug
        if (this.sections.inputMethodSelection) {
            this.sections.inputMethodSelection.classList.add('hidden');
            this.sections.inputMethodSelection.style.display = 'none'; // Force hide with inline style
        }
        
        if (mode === 'manual') {
            // Show manual editor, hide prompt editor
            const manualEditor = this.getManualEditorContainer();
            manualEditor.classList.remove('hidden');
            this.sections.promptEditor.classList.add('hidden');
            
            // Hide audio preview (we'll show waveform instead)
            this.sections.audioPreview.classList.add('hidden');
            
            // If we already have tokenized data, build the editor
            if (this.state.tokenData && this.state.transcribedText) {
                this.buildManualEditor();
            } else if (this.audioElements.audioPlayer.src && !this.tokenizationState.inProgress) {
                // If we have audio but no token data, fetch it
                // Only start new tokenization if there isn't one already in progress
                this.tokenizeAudio();
            }
        } else {
            // Show prompt editor and audio preview, hide manual editor
            if (this.sections.manualEditor) {
                this.sections.manualEditor.classList.add('hidden');
            }
            this.sections.promptEditor.classList.remove('hidden');
            this.sections.audioPreview.classList.remove('hidden');
            
            // Clean up manual editor resources
            this.cleanupEditors();
        }
    }
    
    /**
     * Tokenize the audio and get transcription data
     */
    async tokenizeAudio() {
        // Show loading indicator
        this.showLoading(true);
        
        // Set tokenization state
        this.tokenizationState.inProgress = true;
        this.tokenizationState.cancelled = false;
        
        try {
            // Get the current audio blob
            const audioUrl = this.audioElements.audioPlayer.src;
            const response = await fetch(audioUrl);
            const audioBlob = await response.blob();
            
            // Check if tokenization was cancelled before proceeding
            if (this.tokenizationState.cancelled) {
                console.log('Tokenization cancelled');
                return;
            }
            
            // Tokenize the audio
            const tokenizationResult = await AudioProcessor.tokenizeAudio(audioBlob);
            
            // Check again if tokenization was cancelled
            if (this.tokenizationState.cancelled) {
                console.log('Tokenization cancelled after API call');
                return;
            }
            
            // Store token data
            this.state.tokenData = tokenizationResult.tokens;
            this.state.transcribedText = tokenizationResult.text;
            
            // Check for both conditions: edit mode still 'manual' and not cancelled
            if (this.state.editMode === 'manual' && !this.tokenizationState.cancelled) {
                console.log('Building manual editor after successful tokenization');
                // Build the manual editor
                this.buildManualEditor();
            } else if (!this.tokenizationState.cancelled) {
                // If not cancelled but edit mode changed
                console.log('Edit mode changed during tokenization, skipping manual editor build');
                // Make sure manual editor container is hidden
                if (this.sections.manualEditor) {
                    this.sections.manualEditor.classList.add('hidden');
                }
                // Make sure prompt editor is visible since we're now in prompt mode
                this.sections.promptEditor.classList.remove('hidden');
                this.sections.audioPreview.classList.remove('hidden');
            } else {
                // If cancelled, we don't need to update UI
                console.log('Tokenization cancelled, skipping UI updates');
            }
        } catch (error) {
            // Only show error if tokenization wasn't cancelled
            if (!this.tokenizationState.cancelled) {
                console.error('Error tokenizing audio:', error);
                this.showError('Failed to tokenize audio: ' + error.message);
                
                // Fall back to prompt-based editing
                this.setEditMode('prompt');
            }
        } finally {
            // Reset tokenization in-progress flag
            this.tokenizationState.inProgress = false;
            
            // Hide loading indicator only if not cancelled (to avoid UI flicker)
            if (!this.tokenizationState.cancelled) {
                this.showLoading(false);
            }
        }
    }
    
    /**
     * Build the manual editor UI
     */
    buildManualEditor() {
        // First check if we're still in manual mode - if not, don't build the editor
        if (this.state.editMode !== 'manual') {
            console.log('Skipping manual editor build because mode has changed to:', this.state.editMode);
            return;
        }
        
        // Get or create the manual editor container
        const manualEditor = this.getManualEditorContainer();
        
        // Clear any existing content
        manualEditor.innerHTML = '';
        
        // Add header
        const header = document.createElement('h3');
        header.className = 'section-heading';
        header.textContent = 'Manual Editing';
        manualEditor.appendChild(header);
        
        // Add instructions
        const instructions = document.createElement('p');
        instructions.className = 'text-sm text-gray-600 mb-4';
        instructions.textContent = 'Edit the text below to modify the audio. Select text to highlight the corresponding sections in the waveform.';
        manualEditor.appendChild(instructions);
        
        // Create waveform editor
        this.state.waveformEditor = new WaveformEditor(manualEditor);
        this.state.waveformEditor.initialize();
        
        // Load audio into waveform editor
        this.state.waveformEditor.loadAudioElement(this.audioElements.audioPlayer);
        
        // Create token text editor
        this.state.tokenTextEditor = new TokenTextEditor(manualEditor);
        this.state.tokenTextEditor.initialize();
        
        // Set token data and link editors
        this.state.tokenTextEditor.setWaveformEditor(this.state.waveformEditor);
        this.state.tokenTextEditor.setTokenData(this.state.tokenData, this.state.transcribedText);
        this.state.waveformEditor.setTokenData(this.state.tokenData);
        
        // Add process button
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'flex justify-center mt-6';
        
        const processButton = document.createElement('button');
        processButton.id = 'manualProcessButton';
        processButton.className = 'btn btn-primary';
        processButton.textContent = 'Process Edits';
        processButton.addEventListener('click', () => this.processManualEdits());
        
        buttonContainer.appendChild(processButton);
        manualEditor.appendChild(buttonContainer);
        
        // Show the manual editor
        manualEditor.classList.remove('hidden');
    }
    
    /**
     * Clean up editor resources
     */
    cleanupEditors() {
        // Clean up waveform editor
        if (this.state.waveformEditor) {
            this.state.waveformEditor.cleanup();
            this.state.waveformEditor = null;
        }
        
        // Clean up token text editor
        if (this.state.tokenTextEditor) {
            this.state.tokenTextEditor.cleanup();
            this.state.tokenTextEditor = null;
        }
        
        // Clear the manual editor container
        if (this.sections.manualEditor) {
            this.sections.manualEditor.innerHTML = '';
        }
    }
    
    /**
     * Clean up audio elements (revoke object URLs)
     */
    cleanupAudioElements() {
        if (this.audioElements.audioPlayer.src) {
            URL.revokeObjectURL(this.audioElements.audioPlayer.src);
            this.audioElements.audioPlayer.src = '';
        }
        
        if (this.audioElements.previewPlayer.src) {
            URL.revokeObjectURL(this.audioElements.previewPlayer.src);
            this.audioElements.previewPlayer.src = '';
        }
        
        if (this.audioElements.processedAudio.src) {
            URL.revokeObjectURL(this.audioElements.processedAudio.src);
            this.audioElements.processedAudio.src = '';
        }
    }
    
    /**
     * Show recording UI in the active state
     */
    showRecordingUI() {
        this.recordingStates.preRecording.classList.add('hidden');
        this.recordingStates.activeRecording.classList.remove('hidden');
        this.recordingStates.pausedRecording.classList.add('hidden');
    }
    
    /**
     * Show recording UI in the paused state
     */
    showPausedRecordingUI() {
        this.recordingStates.activeRecording.classList.add('hidden');
        this.recordingStates.pausedRecording.classList.remove('hidden');
    }
    
    /**
     * Go to edit step with the provided audio blob
     * @param {Blob} audioBlob - Audio blob to use
     */
    goToEditStepWithAudio(audioBlob) {
        // Store the audio blob
        this.state.audioBlob = audioBlob;
        
        // Create URL for audio preview
        if (this.audioElements.audioPlayer.src) {
            URL.revokeObjectURL(this.audioElements.audioPlayer.src);
        }
        this.audioElements.audioPlayer.src = URL.createObjectURL(audioBlob);
        
        // Go to step 2
        this.goToStep(2);
    }
    
    /**
     * Go to result step with processed audio
     * @param {Blob} processedBlob - Processed audio blob
     * @param {string} prompt - Edit prompt used
     * @param {Object} metadata - Additional processing metadata
     */
    goToResultStep(processedBlob, prompt, metadata = {}) {
        this.state.processedAudioBlob = processedBlob;
        
        // Display just the processed audio
        if (this.audioElements.processedAudio.src) {
            URL.revokeObjectURL(this.audioElements.processedAudio.src);
        }
        this.audioElements.processedAudio.src = URL.createObjectURL(processedBlob);
        
        // Update text fields
        this.textElements.editPromptDisplay.textContent = `Edit prompt: "${prompt}"`;
        this.textElements.processingDetails.textContent = metadata.processing_time ? 
            `Processing time: ${metadata.processing_time.toFixed(2)}s` : '';
        
        // Go to step 3
        this.goToStep(3);
    }
    
    /**
     * Process manual edits
     */
    async processManualEdits() {
        // Get edit operations from the token text editor
        const editOperations = this.state.tokenTextEditor.getEditOperations();
        
        console.log('Edit operations:', editOperations);
        
        // If no edits, show error
        if (editOperations.length === 0) {
            this.showError('No edits detected. Please modify the text to create edits.');
            return;
        }
        
        // Show loading indicator
        this.showLoading(true);
        
        try {
            // Get the current audio blob
            const audioUrl = this.audioElements.audioPlayer.src;
            const response = await fetch(audioUrl);
            const audioBlob = await response.blob();
            
            // Process the audio with multi-edit API
            const result = await AudioProcessor.processAudioMulti(audioBlob, editOperations);
            
            // Create summary of edits for display
            const editSummary = editOperations.map(op => 
                `"${op.original_text}" → "${op.edited_text}"`
            ).join(', ');
            
            // Update UI with results
            this.goToResultStep(result.processedBlob, editSummary, result.metadata);
            
            // Setup download button
            document.getElementById('downloadButton').onclick = () => {
                const a = document.createElement('a');
                a.href = document.getElementById('processedAudio').src;
                a.download = 'processed_audio.wav';
                a.click();
            };
        } catch (error) {
            console.error('Error processing edits:', error);
            this.showError('Failed to process edits: ' + error.message);
        } finally {
            // Hide loading indicator
            this.showLoading(false);
        }
    }
    
    /**
     * Process audio with the edit prompt
     */
    async processAudio() {
        if (!this.state.audioBlob) {
            this.showError('No audio file available for processing.');
            return;
        }
        
        const prompt = this.textElements.editPrompt.value.trim();
        if (!prompt) {
            this.showError('Please enter an edit prompt.');
            return;
        }
        
        // Set processing state
        this.processingState.inProgress = true;
        this.processingState.cancelled = false;
        
        this.showLoading(true);
        
        try {
            // Check if processing was cancelled before starting
            if (this.processingState.cancelled) {
                console.log('Processing cancelled before starting');
                return;
            }
            
            // Get the current audio blob
            const audioUrl = this.audioElements.audioPlayer.src;
            const response = await fetch(audioUrl);
            const audioBlob = await response.blob();
            
            // Process the audio
            const result = await AudioProcessor.processAudio(audioBlob, prompt);
            
            // Check if processing was cancelled after API call
            if (this.processingState.cancelled) {
                console.log('Processing cancelled after API call');
                return;
            }
            
            // Update UI with results (only if not cancelled)
            this.goToResultStep(result.processedBlob, prompt, result.metadata);
            
            // Setup download button
            document.getElementById('downloadButton').onclick = () => {
                const a = document.createElement('a');
                a.href = document.getElementById('processedAudio').src;
                a.download = 'processed_audio.wav';
                a.click();
            };
            
        } catch (err) {
            // Only show error if processing wasn't cancelled
            if (!this.processingState.cancelled) {
                this.showError(`Error processing audio: ${err.message}`);
                console.error('Processing error:', err);
            }
        } finally {
            // Reset processing state
            this.processingState.inProgress = false;
            
            // Hide loading indicator only if not cancelled
            if (!this.processingState.cancelled) {
                this.showLoading(false);
            }
        }
    }
    
    /**
     * Go back to step 1
     */
    resetToStep1() {
        // Cancel any ongoing tokenization
        if (this.tokenizationState.inProgress) {
            console.log('Cancelling ongoing tokenization');
            this.tokenizationState.cancelled = true;
        }
        
        // Cancel any ongoing processing
        if (this.processingState.inProgress) {
            console.log('Cancelling ongoing processing');
            this.processingState.cancelled = true;
        }
        
        // Hide loading indicator immediately
        this.showLoading(false);
        
        // Clean up audio resources
        window.audioRecorder.cleanup();
        this.cleanupAudioElements();
        
        // Reset state
        this.state.audioBlob = null;
        this.state.processedAudioBlob = null;
        this.state.tokenData = null;
        this.state.transcribedText = null;
        
        // Go to step 1
        this.goToStep(1);
    }
    
    /**
     * Go back to edit step to change the prompt
     */
    changePrompt() {
        // Go back to step 2 with current mode
        this.goToStep(2);
    }
    
    /**
     * Use the processed result as the new input audio
     */
    useProcessedResult() {
        // Use the processed audio as the new input
        if (this.state.processedAudioBlob) {
            this.state.audioBlob = this.state.processedAudioBlob;
            this.audioElements.audioPlayer.src = URL.createObjectURL(this.state.processedAudioBlob);
        }
        
        // Clear the prompt
        this.textElements.editPrompt.value = '';
        
        // Reset token data since the audio has changed
        this.state.tokenData = null;
        this.state.transcribedText = null;
        
        // Go to step 2
        this.goToStep(2);
    }
    
    /**
     * Show loading indicator
     * @param {boolean} show - Whether to show or hide the loading indicator
     */
    showLoading(show) {
        if (show) {
            this.sections.loadingIndicator.classList.remove('hidden');
            this.sections.loadingIndicator.style.cursor = 'not-allowed'; // Set cursor
            document.getElementById('processButton').disabled = true;
            document.getElementById('processButton').classList.add('opacity-50');
        } else {
            this.sections.loadingIndicator.classList.add('hidden');
            document.getElementById('processButton').disabled = false;
            document.getElementById('processButton').classList.remove('opacity-50');
        }
    }
    
    /**
     * Show error message
     * @param {string} message - Error message to display
     */
    showError(message) {
        this.sections.errorText.textContent = message;
        this.sections.errorMessage.classList.remove('hidden');
        
        // Auto-hide error after 5 seconds
        setTimeout(() => {
            this.hideError();
        }, 5000);
    }
    
    /**
     * Hide error message
     */
    hideError() {
        this.sections.errorMessage.classList.add('hidden');
    }
    
    /**
     * Set the processed audio blob
     * @param {Blob} blob - The processed audio blob
     */
    setProcessedAudio(blob) {
        this.state.processedAudioBlob = blob;
    }
    
    /**
     * Get the current processed audio blob
     * @returns {Blob|null} - The processed audio blob or null
     */
    getProcessedAudio() {
        return this.state.processedAudioBlob;
    }
}

// Initialize UI controller when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.uiController = new UIController();
    window.uiController.init();
});