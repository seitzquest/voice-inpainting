/**
 * Simplified ui-controller.js
 * Manages UI states and transitions between application steps
 */

class UIController {
    constructor() {
        // Store references to UI sections
        this.sections = {
            // Step 1: Record/Upload
            recordSection: document.getElementById('recordSection'),
            uploadSection: document.getElementById('uploadSection'),
            inputMethodSelection: document.getElementById('inputMethodSelection'),
        
            // Step 2: Edit
            audioPreview: document.getElementById('audioPreview'),
            editModeSelection: document.getElementById('editModeSelection'),
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
        
        // Processing states
        this.tokenizationState = {
            inProgress: false,
            cancelled: false
        };
        
        this.processingState = {
            inProgress: false,
            cancelled: false
        };

        // Application state
        this.state = {
            currentStep: 1,
            editMode: 'manual', // 'manual' or 'prompt'
            audioBlob: null,
            processedAudioBlob: null,
            tokenData: null,
            transcribedText: null,
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
        
        // Bind input method selection
        document.querySelectorAll('input[name="audioChoice"]').forEach(radio => {
            radio.addEventListener('change', () => this.handleInputMethodChange(radio.value));
        });
        
        // Bind edit mode selection
        document.querySelectorAll('input[name="editMode"]').forEach(radio => {
            radio.addEventListener('change', () => {
                if (radio.checked) this.setEditMode(radio.value);
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
        
        // Hide all sections
        this.hideAllSections();
        
        // Update progress indicator
        this.updateProgress(step);
        
        // Show appropriate sections based on step
        switch (step) {
            case 1: this.setupStep1(); break;
            case 2: this.setupStep2(); break;
            case 3: this.setupStep3(); break;
        }
    }
    
    /**
     * Set up Step 1: Record/Upload
     */
    setupStep1() {
        // Clean up resources
        this.cleanupEditors();
        
        // Clear state data
        this.state.tokenData = null;
        this.state.transcribedText = null;
        
        // Show input selection
        if (this.sections.inputMethodSelection) {
            this.sections.inputMethodSelection.classList.remove('hidden');
            this.sections.inputMethodSelection.style.display = '';
        }
        
        // Show appropriate section
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
        document.getElementById('fileUpload').value = '';
    }
    
    /**
     * Set up Step 2: Edit
     */
    setupStep2() {
        // Show back button
        this.sections.backButtonContainer.classList.remove('hidden');
        
        // Hide input method selection
        if (this.sections.inputMethodSelection) {
            this.sections.inputMethodSelection.classList.add('hidden');
            this.sections.inputMethodSelection.style.display = 'none';
        }
        
        // Show edit mode selection
        if (this.sections.editModeSelection) {
            this.sections.editModeSelection.classList.remove('hidden');
            
            // Set radio buttons
            document.getElementById('manual-edit').checked = (this.state.editMode === 'manual');
            document.getElementById('prompt-edit').checked = (this.state.editMode === 'prompt');
        }

        // Show audio preview if available
        if (this.state.audioBlob) {
            this.sections.audioPreview.classList.remove('hidden');
            
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
        
        // Hide input selection
        if (this.sections.inputMethodSelection) {
            this.sections.inputMethodSelection.classList.add('hidden');
            this.sections.inputMethodSelection.style.display = 'none';
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
    
    /**
     * Get the manual editor container
     * @returns {HTMLElement} The manual editor container
     */
    getManualEditorContainer() {
        if (!this.sections.manualEditor) {
            const container = document.createElement('div');
            container.id = 'manualEditorContainer';
            container.className = 'manual-editor-container mb-6 slide-in';
            this.sections.manualEditor = container;
            
            // Add to document if not already present
            if (!document.getElementById('manualEditorContainer')) {
                const audioPreviewElement = document.getElementById('audioPreview');
                if (audioPreviewElement && audioPreviewElement.parentNode) {
                    audioPreviewElement.parentNode.insertBefore(container, audioPreviewElement.nextSibling);
                }
            }
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
        // Reset all steps
        this.progressSteps.forEach(progressStep => {
            progressStep.classList.remove('active', 'complete', 'line-active');
        });
        
        // Update each step
        this.progressSteps.forEach((progressStep, index) => {
            const stepNumber = index + 1;
            
            if (stepNumber < step) {
                // Previous steps
                progressStep.classList.add('complete');
            } else if (stepNumber === step) {
                // Current step
                progressStep.classList.add('active');
            }
            
            // Handle lines between steps
            if (stepNumber === 2 && step >= 2) {
                progressStep.classList.add('line-active');
            }
            
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
        
        // Update radio buttons
        const manualRadio = document.getElementById('manual-edit');
        const promptRadio = document.getElementById('prompt-edit');
        
        if (manualRadio && promptRadio) {
            manualRadio.checked = (mode === 'manual');
            promptRadio.checked = (mode === 'prompt');
        }
        
        // Only proceed if on step 2
        if (this.state.currentStep !== 2) return;
        
        // Check if we should cancel ongoing processes
        if (previousMode === 'manual' && mode === 'prompt' && this.tokenizationState.inProgress) {
            this.tokenizationState.cancelled = true;
            this.showLoading(false);
        }

        if (previousMode === 'prompt' && mode === 'manual' && this.processingState.inProgress) {
            this.processingState.cancelled = true;
            this.showLoading(false);
        }
        
        // Make sure input selection is hidden
        if (this.sections.inputMethodSelection) {
            this.sections.inputMethodSelection.classList.add('hidden');
            this.sections.inputMethodSelection.style.display = 'none';
        }
        
        if (mode === 'manual') {
            // Show manual editor, hide prompt editor
            const manualEditor = this.getManualEditorContainer();
            manualEditor.classList.remove('hidden');
            this.sections.promptEditor.classList.add('hidden');
            
            // Hide audio preview (waveform will show instead)
            this.sections.audioPreview.classList.add('hidden');
            
            // Initialize editor if we have audio but no token data
            if (this.state.tokenData && this.state.transcribedText) {
                this.buildManualEditor();
            } else if (this.audioElements.audioPlayer.src && !this.tokenizationState.inProgress) {
                this.tokenizeAudio();
            }
        } else {
            // Show prompt editor and audio preview, hide manual editor
            if (this.sections.manualEditor) {
                this.sections.manualEditor.classList.add('hidden');
            }
            this.sections.promptEditor.classList.remove('hidden');
            this.sections.audioPreview.classList.remove('hidden');
            
            // Clean up manual editor
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
            
            if (this.tokenizationState.cancelled) return;
            
            // Tokenize the audio
            const tokenizationResult = await AudioProcessor.tokenizeAudio(audioBlob);
            
            if (this.tokenizationState.cancelled) return;
            
            // Store token data
            this.state.tokenData = tokenizationResult.tokens;
            this.state.transcribedText = tokenizationResult.text;
            
            // Build editor if still in manual mode
            if (this.state.editMode === 'manual' && !this.tokenizationState.cancelled) {
                this.buildManualEditor();
            }
        } catch (error) {
            if (!this.tokenizationState.cancelled) {
                console.error('Error tokenizing audio:', error);
                this.showError('Failed to tokenize audio: ' + error.message);
                
                // Fall back to prompt-based editing
                this.setEditMode('prompt');
            }
        } finally {
            this.tokenizationState.inProgress = false;
            
            if (!this.tokenizationState.cancelled) {
                this.showLoading(false);
            }
        }
    }
    
    /**
     * Build the manual editor UI
     */
    buildManualEditor() {
        // Skip if not in manual mode
        if (this.state.editMode !== 'manual') return;
        
        // Get manual editor container
        const manualEditor = this.getManualEditorContainer();
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
        
        // Load audio
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
     * Clean up audio elements
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
        
        // Display processed audio
        if (this.audioElements.processedAudio.src) {
            URL.revokeObjectURL(this.audioElements.processedAudio.src);
        }
        this.audioElements.processedAudio.src = URL.createObjectURL(processedBlob);
        
        // Update text fields
        this.textElements.editPromptDisplay.textContent = `Edit: ${prompt}`;
        
        if (metadata.processing_time) {
            this.textElements.processingDetails.textContent = 
                `Processing time: ${metadata.processing_time.toFixed(2)}s`;
        } else {
            this.textElements.processingDetails.textContent = '';
        }
        
        // Go to step 3
        this.goToStep(3);
    }
    
    /**
     * Process manual edits
     */
    async processManualEdits() {
        // Get edit operations from the token text editor
        const editOperations = this.state.tokenTextEditor.getEditOperations();
        
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
                `${op.original_text} → ${op.edited_text}`
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
            if (this.processingState.cancelled) return;
            
            // Get the current audio blob
            const audioUrl = this.audioElements.audioPlayer.src;
            const response = await fetch(audioUrl);
            const audioBlob = await response.blob();
            
            // Process the audio
            const result = await AudioProcessor.processAudio(audioBlob, prompt);
            
            if (this.processingState.cancelled) return;
            
            // Update UI with results
            this.goToResultStep(result.processedBlob, prompt, result.metadata);
            
            // Setup download button
            document.getElementById('downloadButton').onclick = () => {
                const a = document.createElement('a');
                a.href = document.getElementById('processedAudio').src;
                a.download = 'processed_audio.wav';
                a.click();
            };
            
        } catch (err) {
            if (!this.processingState.cancelled) {
                this.showError(`Error processing audio: ${err.message}`);
            }
        } finally {
            this.processingState.inProgress = false;
            
            if (!this.processingState.cancelled) {
                this.showLoading(false);
            }
        }
    }
    
    /**
     * Go back to step 1
     */
    resetToStep1() {
        // Cancel any ongoing processes
        if (this.tokenizationState.inProgress) {
            this.tokenizationState.cancelled = true;
        }
        
        if (this.processingState.inProgress) {
            this.processingState.cancelled = true;
        }
        
        // Hide loading indicator
        this.showLoading(false);
        
        // Clean up resources
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
        // Go back to step 2
        this.goToStep(2);
    }
    
    /**
     * Use the processed result as the new input audio
     */
    useProcessedResult() {
        if (this.state.processedAudioBlob) {
            this.state.audioBlob = this.state.processedAudioBlob;
            this.audioElements.audioPlayer.src = URL.createObjectURL(this.state.processedAudioBlob);
        }
        
        // Clear prompt
        this.textElements.editPrompt.value = '';
        
        // Reset token data
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
        const processButton = document.getElementById('processButton');
        
        if (show) {
            this.sections.loadingIndicator.classList.remove('hidden');
            this.sections.loadingIndicator.style.cursor = 'not-allowed';
            if (processButton) {
                processButton.disabled = true;
                processButton.classList.add('opacity-50');
            }
        } else {
            this.sections.loadingIndicator.classList.add('hidden');
            if (processButton) {
                processButton.disabled = false;
                processButton.classList.remove('opacity-50');
            }
        }
    }
    
    /**
     * Show error message
     * @param {string} message - Error message to display
     */
    showError(message) {
        this.sections.errorText.textContent = message;
        this.sections.errorMessage.classList.remove('hidden');
        
        // Auto-hide after 5 seconds
        setTimeout(() => this.hideError(), 5000);
    }
    
    /**
     * Hide error message
     */
    hideError() {
        this.sections.errorMessage.classList.add('hidden');
    }
}

// Initialize UI controller when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.uiController = new UIController();
    window.uiController.init();
});