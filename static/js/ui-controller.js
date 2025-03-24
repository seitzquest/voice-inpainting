/**
 * ui-controller.js
 * Manages UI states and transitions between application steps
 */

class UIController {
    constructor() {
        // DOM sections
        this.recordSection = document.getElementById('recordSection');
        this.uploadSection = document.getElementById('uploadSection');
        this.audioPreview = document.getElementById('audioPreview');
        this.editSection = document.getElementById('editSection');
        this.resultSection = document.getElementById('resultSection');
        this.loadingIndicator = document.getElementById('loadingIndicator');
        this.errorMessage = document.getElementById('errorMessage');
        this.errorText = document.getElementById('errorText');
        this.backButtonContainer = document.getElementById('backButtonContainer');
        
        // Recording state UI elements
        this.preRecordingState = document.getElementById('preRecordingState');
        this.activeRecordingState = document.getElementById('activeRecordingState');
        this.pausedRecordingState = document.getElementById('pausedRecordingState');
        
        // Audio elements
        this.audioPlayer = document.getElementById('audioPlayer');
        this.processedAudio = document.getElementById('processedAudio');
        this.previewPlayer = document.getElementById('previewPlayer');
        
        // Text and status display elements
        this.fileName = document.getElementById('fileName');
        this.editPrompt = document.getElementById('editPrompt');
        this.editPromptDisplay = document.getElementById('editPromptDisplay');
        this.processingDetails = document.getElementById('processingDetails');
        
        // Progress steps
        this.progressSteps = document.querySelectorAll('.progress-step');
        
        // State tracking
        this.currentStep = 1;
        this.isEditingProcessedAudio = false;
        this.processedAudioBlob = null;
    }
    
    /**
     * Initialize UI and bind event handlers
     */
    init() {
        // Set initial state
        this.updateProgress(1);
        
        // Bind radio button change events for input method selection
        document.querySelectorAll('input[name="audioChoice"]').forEach(radio => {
            radio.addEventListener('change', () => this.handleInputMethodChange(radio.value));
        });
        
        // Show the appropriate section based on default selection
        this.handleInputMethodChange(
            document.querySelector('input[name="audioChoice"]:checked').value
        );
    }
    
    /**
     * Handle change in input method (record vs upload)
     * @param {string} method - The selected input method ('record' or 'upload')
     */
    handleInputMethodChange(method) {
        if (method === 'record') {
            this.recordSection.classList.remove('hidden');
            this.uploadSection.classList.add('hidden');
        } else {
            this.recordSection.classList.add('hidden');
            this.uploadSection.classList.remove('hidden');
        }
        this.resetUI();
    }
    
    /**
     * Update progress indicator
     * @param {number} step - Current step (1, 2, or 3)
     */
    updateProgress(step) {
        this.currentStep = step;
        
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
        
        // Handle visibility based on current step
        this.updateUIForCurrentStep(step);
    }
    
    /**
     * Update UI elements based on current step
     * @param {number} step - Current step (1, 2, or 3)
     */
    updateUIForCurrentStep(step) {
        const radioGroup = document.querySelector('.radio-group');
        
        if (step === 1) {
            // In step 1, show the radio group and ensure it's visible
            radioGroup.classList.remove('hidden');
            radioGroup.style.display = ''; // Clear any inline display:none
        } else {
            // In any other step, hide the radio group
            radioGroup.classList.add('hidden');
            radioGroup.style.display = 'none'; // Force hide with inline style
        }
    }
    
    /**
     * Display loading indicator
     * @param {boolean} show - Whether to show or hide the loading indicator
     */
    showLoading(show) {
        if (show) {
            this.loadingIndicator.classList.remove('hidden');
            document.getElementById('processButton').disabled = true;
            document.getElementById('processButton').classList.add('opacity-50');
        } else {
            this.loadingIndicator.classList.add('hidden');
            document.getElementById('processButton').disabled = false;
            document.getElementById('processButton').classList.remove('opacity-50');
        }
    }
    
    /**
     * Show error message
     * @param {string} message - Error message to display
     */
    showError(message) {
        this.errorText.textContent = message;
        this.errorMessage.classList.remove('hidden');
        
        // Auto-hide error after 5 seconds
        setTimeout(() => {
            this.hideError();
        }, 5000);
    }
    
    /**
     * Hide error message
     */
    hideError() {
        this.errorMessage.classList.add('hidden');
    }
    
    /**
     * Reset UI to initial state
     */
    resetUI() {
        // Hide all sections except the first step
        this.audioPreview.classList.add('hidden');
        this.editSection.classList.add('hidden');
        this.resultSection.classList.add('hidden');
        this.backButtonContainer.classList.add('hidden');
        this.hideError();
        
        // Reset recording UI
        this.preRecordingState.classList.remove('hidden');
        this.activeRecordingState.classList.add('hidden');
        this.pausedRecordingState.classList.add('hidden');
        
        // Reset form elements
        this.editPrompt.value = '';
        this.fileName.textContent = '';
        this.fileName.classList.add('hidden');
        
        // Reset audio elements
        this.cleanupAudioElements();
        
        // Reset file input to allow the same file to be selected again
        document.getElementById('fileUpload').value = '';
        
        // Reset state tracking
        this.isEditingProcessedAudio = false;
        this.processedAudioBlob = null;
        
        this.updateProgress(1);
    }
    
    /**
     * Clean up audio elements (revoke object URLs)
     */
    cleanupAudioElements() {
        if (this.audioPlayer.src) {
            URL.revokeObjectURL(this.audioPlayer.src);
            this.audioPlayer.src = '';
        }
        
        if (this.previewPlayer.src) {
            URL.revokeObjectURL(this.previewPlayer.src);
            this.previewPlayer.src = '';
        }
        
        if (this.processedAudio.src) {
            URL.revokeObjectURL(this.processedAudio.src);
            this.processedAudio.src = '';
        }
    }
    
    /**
     * Advance to step 2 (edit) with the provided audio blob
     * @param {Blob} audioBlob - Audio blob to use
     */
    goToEditStep(audioBlob) {
        // Create URL for audio preview
        if (this.audioPlayer.src) {
            URL.revokeObjectURL(this.audioPlayer.src);
        }
        this.audioPlayer.src = URL.createObjectURL(audioBlob);
        
        // Show edit sections and back button
        this.audioPreview.classList.remove('hidden');
        this.editSection.classList.remove('hidden');
        this.backButtonContainer.classList.remove('hidden');
        
        // Hide step 1 sections
        this.recordSection.classList.add('hidden');
        this.uploadSection.classList.add('hidden');
        
        // Update progress
        this.updateProgress(2);
    }
    
    /**
     * Advance to step 3 (results) with processed audio
     * @param {Blob} processedBlob - Processed audio blob
     * @param {string} prompt - Edit prompt used
     * @param {Object} metadata - Additional processing metadata
     */
    goToResultStep(processedBlob, prompt, metadata = {}) {
        this.processedAudioBlob = processedBlob;
        
        // Display just the processed audio
        if (this.processedAudio.src) {
            URL.revokeObjectURL(this.processedAudio.src);
        }
        this.processedAudio.src = URL.createObjectURL(processedBlob);
        
        // Update text fields
        this.editPromptDisplay.textContent = `Edit prompt: "${prompt}"`;
        this.processingDetails.textContent = metadata.processing_time ? 
            `Processing time: ${metadata.processing_time.toFixed(2)}s` : '';
        
        // Hide sections
        this.audioPreview.classList.add('hidden');
        this.editSection.classList.add('hidden');
        this.backButtonContainer.classList.add('hidden');
        
        // Show result section
        this.resultSection.classList.remove('hidden');
        this.updateProgress(3);
    }
    
    /**
     * Go back to step 1
     */
    resetToStep1() {
        this.resetUI();
        
        // Ensure we clean up recording resources
        window.audioRecorder.cleanup();
        
        // Show appropriate section based on selected input method
        if (document.getElementById('record').checked) {
            this.recordSection.classList.remove('hidden');
            this.uploadSection.classList.add('hidden');
        } else {
            this.recordSection.classList.add('hidden');
            this.uploadSection.classList.remove('hidden');
        }
    }
    
    /**
     * Update recording UI to show recording in progress
     */
    showRecordingUI() {
        this.preRecordingState.classList.add('hidden');
        this.activeRecordingState.classList.remove('hidden');
        this.pausedRecordingState.classList.add('hidden');
    }
    
    /**
     * Update recording UI to show paused state
     */
    showPausedRecordingUI() {
        this.activeRecordingState.classList.add('hidden');
        this.pausedRecordingState.classList.remove('hidden');
    }
    
    /**
     * Set the processed audio blob
     * @param {Blob} blob - The processed audio blob
     */
    setProcessedAudio(blob) {
        this.processedAudioBlob = blob;
    }
    
    /**
     * Get the current processed audio blob
     * @returns {Blob|null} - The processed audio blob or null
     */
    getProcessedAudio() {
        return this.processedAudioBlob;
    }
    
    /**
     * Set whether we're editing processed audio
     * @param {boolean} isEditing - Whether we're editing processed audio
     */
    setEditingProcessedAudio(isEditing) {
        this.isEditingProcessedAudio = isEditing;
    }
    
    /**
     * Check if we're editing processed audio
     * @returns {boolean} - Whether we're editing processed audio
     */
    isEditingProcessed() {
        return this.isEditingProcessedAudio;
    }
}

// Initialize UI controller when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.uiController = new UIController();
    window.uiController.init();
});