/**
 * ui-controller.js
 * Enhanced UI controller with integrated audio handling
 */

class UIController {
    constructor() {
        // DOM Elements
        this.elements = {
            // Main containers
            audioInputContainer: document.getElementById('audioInputContainer'),
            editContainer: document.getElementById('editContainer'),
            
            // Input method selection
            inputMethodRadios: document.querySelectorAll('input[name="audioChoice"]'),
            recordSection: document.getElementById('recordSection'),
            uploadSection: document.getElementById('uploadSection'),
            
            // Recording states
            preRecordingState: document.getElementById('preRecordingState'),
            activeRecordingState: document.getElementById('activeRecordingState'),
            pausedRecordingState: document.getElementById('pausedRecordingState'),
            
            // Recording controls
            recordButton: document.getElementById('recordButton'),
            pauseRecordingBtn: document.getElementById('pauseRecordingBtn'),
            submitRecordingBtn: document.getElementById('submitRecordingBtn'),
            playRecordingBtn: document.getElementById('playRecordingBtn'),
            trashRecordingBtn: document.getElementById('trashRecordingBtn'),
            finalizeRecordingBtn: document.getElementById('finalizeRecordingBtn'),
            recordingTime: document.getElementById('recordingTime'),
            
            // Drop zone
            dropZoneContainer: document.getElementById('dropZoneContainer'),
            fileUpload: document.getElementById('fileUpload'),
            fileName: document.getElementById('fileName'),
            uploadButton: document.getElementById('uploadButton'),
            
            // Edit mode selection
            editModeDropdown: document.querySelector('.edit-mode-dropdown'),
            editModeSelected: document.querySelector('.edit-mode-selected'),
            editModeOptions: document.querySelector('.edit-mode-options'),
            currentEditMode: document.getElementById('currentEditMode'),
            
            // Editors
            manualEditorContainer: document.getElementById('manualEditorContainer'),
            promptEditorContainer: document.getElementById('promptEditorContainer'),
            tokenTextArea: document.getElementById('tokenTextArea'),
            editPrompt: document.getElementById('editPrompt'),
            
            // Waveform
            waveformContainer: document.getElementById('waveformContainer'),
            waveformDownloadBtn: document.getElementById('waveformDownloadBtn'),
            
            // Action buttons
            processManualEditBtn: document.getElementById('processManualEditBtn'),
            processPromptBtn: document.getElementById('processPromptBtn'),
            
            // Navigation and version control
            backButtonContainer: document.getElementById('backButtonContainer'),
            resetAudioButton: document.getElementById('resetAudioButton'),
            versionControlContainer: document.getElementById('versionControlContainer'),
            previousVersionButton: document.getElementById('previousVersionButton'),
            nextVersionButton: document.getElementById('nextVersionButton'),
            versionDisplay: document.getElementById('versionDisplay'),
            
            // Status elements
            loadingIndicator: document.getElementById('loadingIndicator'),
            errorMessage: document.getElementById('errorMessage'),
            errorText: document.getElementById('errorText'),
            
            // Audio elements
            previewPlayer: document.getElementById('previewPlayer'),
            audioPlayer: document.getElementById('audioPlayer'),
            
            // Waveform containers
            recordingWaveform: document.getElementById('recordingWaveform'),
            playbackWaveform: document.getElementById('playbackWaveform')
        };
        
        // Application state
        this.state = {
            currentStep: 1,
            editMode: 'manual',
            audioBlob: null,
            tokenData: null,
            transcribedText: null,
            waveformEditor: null,
            tokenTextEditor: null,
            versionHistory: [],
            currentVersionIndex: -1,
            processingState: {
                tokenizationInProgress: false,
                processingInProgress: false,
                cancelled: false
            }
        };

        // Recording state tracking
        this.isRecordingPaused = false;
    }
    
    /**
     * Initialize UI and bind event handlers
     */
    init() {
        // Set up input method selection
        this.elements.inputMethodRadios.forEach(radio => {
            radio.addEventListener('change', () => this.handleInputMethodChange(radio.value));
        });
        
        // Set up recording controls
        if (this.elements.recordButton) {
            this.elements.recordButton.addEventListener('click', () => this.startRecording());
        }
        
        if (this.elements.pauseRecordingBtn) {
            this.elements.pauseRecordingBtn.addEventListener('click', () => this.togglePauseRecording());
        }
        
        if (this.elements.submitRecordingBtn) {
            this.elements.submitRecordingBtn.addEventListener('click', () => this.submitRecording());
        }
        
        if (this.elements.playRecordingBtn) {
            this.elements.playRecordingBtn.addEventListener('click', () => this.togglePlayRecording());
        }
        
        if (this.elements.trashRecordingBtn) {
            this.elements.trashRecordingBtn.addEventListener('click', () => this.trashRecording());
        }
        
        if (this.elements.finalizeRecordingBtn) {
            this.elements.finalizeRecordingBtn.addEventListener('click', () => this.finalizeRecording());
        }
        
        // Set up upload controls
        if (this.elements.uploadButton) {
            this.elements.uploadButton.addEventListener('click', () => this.elements.fileUpload.click());
        }
        
        if (this.elements.fileUpload) {
            this.elements.fileUpload.addEventListener('change', (e) => this.handleFileSelected(e));
        }
        
        // Set up edit mode selection
        if (this.elements.editModeSelected) {
            this.elements.editModeSelected.addEventListener('click', () => this.toggleEditModeDropdown());
        }
        
        document.querySelectorAll('.mode-option').forEach(option => {
            option.addEventListener('click', () => this.selectEditMode(option.dataset.mode));
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (this.elements.editModeDropdown && !this.elements.editModeDropdown.contains(e.target)) {
                const modeOptions = this.elements.editModeOptions;
                if (modeOptions) modeOptions.classList.add('hidden');
                
                const selectedMode = this.elements.editModeSelected;
                if (selectedMode) selectedMode.classList.remove('active');
            }
        });
        
        // Set up action buttons
        if (this.elements.processManualEditBtn) {
            this.elements.processManualEditBtn.addEventListener('click', () => this.processManualEdits());
        }
        
        if (this.elements.processPromptBtn) {
            this.elements.processPromptBtn.addEventListener('click', () => this.processPrompt());
        }
        
        // Set up back button
        if (this.elements.resetAudioButton) {
            this.elements.resetAudioButton.addEventListener('click', () => this.resetToStep1());
        }
        
        // Set up version control
        if (this.elements.previousVersionButton) {
            this.elements.previousVersionButton.addEventListener('click', () => this.navigateToPreviousVersion());
        }
        
        if (this.elements.nextVersionButton) {
            this.elements.nextVersionButton.addEventListener('click', () => this.navigateToNextVersion());
        }
        
        // Set up waveform download button
        if (this.elements.waveformDownloadBtn) {
            this.elements.waveformDownloadBtn.addEventListener('click', () => this.downloadCurrentAudio());
        }
        
        // Set up drag and drop for WAV files
        this.setupDragAndDrop();
        
        // Make sure the initial state is correct based on radio button
        const initialInputMethod = Array.from(this.elements.inputMethodRadios)
            .find(radio => radio.checked)?.value || 'record';
        this.handleInputMethodChange(initialInputMethod);
        
        // Audio player ended event
        if (this.elements.previewPlayer) {
            this.elements.previewPlayer.addEventListener('ended', () => this.resetPlayButton());
        }
        
        console.log('UI Controller initialized');
    }
    
    /**
     * Set up drag and drop for WAV files
     */
    setupDragAndDrop() {
        if (!this.elements.dropZoneContainer) return;
        
        const dropZone = this.elements.dropZoneContainer;
        
        // Prevent default behavior for drag events
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            }, false);
        });
        
        // Handle drag enter/over
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => {
                dropZone.classList.add('dragover');
            }, false);
        });
        
        // Handle drag leave/drop
        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => {
                dropZone.classList.remove('dragover');
            }, false);
        });
        
        // Handle file drop
        dropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files.length) {
                this.validateAndProcessFile(files[0]);
            }
        }, false);
    }
    
    /**
     * Handle file selected from input
     */
    handleFileSelected(event) {
        const file = event.target.files[0];
        if (file) {
            this.validateAndProcessFile(file);
        }
    }
    
    /**
     * Validate and process uploaded file
     */
    validateAndProcessFile(file) {
        if (!file) return;
        
        // Check if file is a WAV
        if (file.type !== 'audio/wav' && !file.name.toLowerCase().endsWith('.wav')) {
            this.showError('Please upload a WAV file.');
            return;
        }
        
        // Update file name display
        if (this.elements.fileName) {
            this.elements.fileName.textContent = file.name;
            this.elements.fileName.classList.remove('hidden');
        }
        
        // Store blob and proceed to edit step
        this.state.audioBlob = file;
        this.goToEditStepWithAudio(file);
    }
    
    /**
     * Handle input method change (record vs upload)
     * @param {string} method - The selected input method ('record' or 'upload')
     */
    handleInputMethodChange(method) {
        // Only applicable in step 1
        if (this.state.currentStep !== 1) return;
        
        if (method === 'record') {
            this.elements.recordSection.classList.remove('hidden');
            this.elements.uploadSection.classList.add('hidden');
        } else {
            this.elements.recordSection.classList.add('hidden');
            this.elements.uploadSection.classList.remove('hidden');
        }
    }
    
    /**
     * Toggle edit mode dropdown visibility
     */
    toggleEditModeDropdown() {
        if (this.elements.editModeOptions) {
            this.elements.editModeOptions.classList.toggle('hidden');
        }
        if (this.elements.editModeSelected) {
            this.elements.editModeSelected.classList.toggle('active');
        }
    }
    
    /**
     * Select edit mode and update UI
     * @param {string} mode - Edit mode ('manual' or 'prompt')
     */
    selectEditMode(mode) {
        // Update state
        const previousMode = this.state.editMode;
        this.state.editMode = mode;
        
        // Only proceed if in edit step
        if (this.state.currentStep !== 2) return;
        
        // Check if we should cancel ongoing processes
        if (previousMode === 'manual' && mode === 'prompt' && this.state.processingState.tokenizationInProgress) {
            this.state.processingState.cancelled = true;
            this.showLoading(false);
        }
        
        if (previousMode === 'prompt' && mode === 'manual' && this.state.processingState.processingInProgress) {
            this.state.processingState.cancelled = true;
            this.showLoading(false);
        }
        
        // Hide both editors initially
        this.elements.manualEditorContainer.classList.add('hidden');
        this.elements.promptEditorContainer.classList.add('hidden');
        
        // Show appropriate editor
        if (mode === 'manual') {
            this.elements.manualEditorContainer.classList.remove('hidden');
            
            // Initialize manual editor if we have audio but no token data
            if (this.state.audioBlob && !this.state.tokenData) {
                this.tokenizeAudio();
            } else if (this.state.tokenData && this.state.transcribedText) {
                this.buildManualEditor(true); // Preserve highlights when switching modes
            }
        } else {
            this.elements.promptEditorContainer.classList.remove('hidden');
        }
        
        // Always keep waveform visible
        this.updateWaveformVisibility(true);
        
        // Update dropdown text
        const currentModeText = document.getElementById('currentEditMode');
        if (currentModeText) {
            currentModeText.textContent = mode === 'manual' ? 'Manual Editing' : 'Prompt-Based';
        }
    }
    
    /**
     * Update waveform visibility
     * @param {boolean} show - Whether to show or hide the waveform
     */
    updateWaveformVisibility(show) {
        const container = this.elements.waveformContainer?.parentNode;
        if (container) {
            if (show) {
                container.classList.remove('hidden');
            } else {
                container.classList.add('hidden');
            }
        }
    }
    
    /**
     * Navigate to a specific step
     * @param {number} step - The step to navigate to (1 or 2)
     */
    goToStep(step) {
        this.state.currentStep = step;
        
        // Hide all sections first
        this.elements.audioInputContainer.classList.add('hidden');
        this.elements.editContainer.classList.add('hidden');
        this.elements.backButtonContainer.classList.add('hidden');
        this.elements.versionControlContainer.classList.add('hidden');
        this.elements.loadingIndicator.classList.add('hidden');
        this.elements.errorMessage.classList.add('hidden');
        
        // Show appropriate sections based on step
        if (step === 1) {
            this.setupStep1();
        } else if (step === 2) {
            this.setupStep2();
        }
    }
    
    /**
     * Set up Step 1: Record/Upload
     */
    setupStep1() {
        // Show input container
        this.elements.audioInputContainer.classList.remove('hidden');
        
        // Clean up resources
        this.cleanupEditors();
        
        // Reset state data
        this.state.tokenData = null;
        this.state.transcribedText = null;
        this.state.audioBlob = null;
        
        // Reset version history
        this.state.versionHistory = [];
        this.state.currentVersionIndex = -1;
        
        // Reset file upload
        if (this.elements.fileUpload) {
            this.elements.fileUpload.value = '';
        }
        if (this.elements.fileName) {
            this.elements.fileName.textContent = '';
            this.elements.fileName.classList.add('hidden');
        }
        
        // Reset audio elements
        if (this.elements.audioPlayer && this.elements.audioPlayer.src) {
            URL.revokeObjectURL(this.elements.audioPlayer.src);
            this.elements.audioPlayer.src = '';
        }
        if (this.elements.previewPlayer && this.elements.previewPlayer.src) {
            URL.revokeObjectURL(this.elements.previewPlayer.src);
            this.elements.previewPlayer.src = '';
        }
        
        // Reset recording UI
        this.elements.preRecordingState.classList.remove('hidden');
        this.elements.activeRecordingState.classList.add('hidden');
        this.elements.pausedRecordingState.classList.add('hidden');
    }
    
    /**
     * Set up Step 2: Combined Edit & Result
     */
    setupStep2() {
        // Show back button
        this.elements.backButtonContainer.classList.remove('hidden');
        
        // Show edit container
        this.elements.editContainer.classList.remove('hidden');
        
        // Show version control if we have history
        if (this.state.versionHistory.length > 0) {
            this.elements.versionControlContainer.classList.remove('hidden');
            this.updateVersionDisplay();
        }
        
        // Set up editor based on mode
        this.selectEditMode(this.state.editMode);
    }
    
    /**
     * Clean up editor resources
     */
    cleanupEditors() {
        if (this.state.waveformEditor) {
            this.state.waveformEditor.cleanup();
            this.state.waveformEditor = null;
        }
        
        if (this.state.tokenTextEditor) {
            this.state.tokenTextEditor.cleanup();
            this.state.tokenTextEditor = null;
        }
    }
    
    /**
     * Tokenize audio to get transcription data
     */
    async tokenizeAudio() {
        if (!this.state.audioBlob) return;
        
        // Show loading
        this.showLoading(true);
        
        // Set processing state
        this.state.processingState.tokenizationInProgress = true;
        this.state.processingState.cancelled = false;
        
        try {
            // Tokenize audio
            const tokenizationResult = await AudioProcessor.tokenizeAudio(this.state.audioBlob);
            
            if (this.state.processingState.cancelled) return;
            
            // Store token data
            this.state.tokenData = tokenizationResult.tokens;
            this.state.transcribedText = tokenizationResult.text;
            
            // Build manual editor if still in manual mode
            if (this.state.editMode === 'manual' && !this.state.processingState.cancelled) {
                this.buildManualEditor();
            }
        } catch (error) {
            if (!this.state.processingState.cancelled) {
                console.error('Error tokenizing audio:', error);
                this.showError('Failed to tokenize audio: ' + error.message);
                
                // Fall back to prompt-based editing
                this.selectEditMode('prompt');
            }
        } finally {
            this.state.processingState.tokenizationInProgress = false;
            
            if (!this.state.processingState.cancelled) {
                this.showLoading(false);
            }
        }
    }
    
    /**
     * Build the manual editor UI with option to preserve highlights
     * @param {boolean} preserveHighlights - Whether to preserve highlighted regions
     */
    buildManualEditor(preserveHighlights = false) {
        // Skip if not in manual mode
        if (this.state.editMode !== 'manual') return;
        
        // Store editor state if needed
        let selectedTokens = [];
        let modifiedTokens = [];
        let generatedRegions = [];
        
        if (preserveHighlights && this.state.waveformEditor) {
            selectedTokens = [...this.state.waveformEditor.selectedTokens];
            modifiedTokens = [...this.state.waveformEditor.modifiedTokens];
            if (this.state.waveformEditor.generatedRegions) {
                generatedRegions = [...this.state.waveformEditor.generatedRegions];
            }
        } else if (this.state.currentVersionIndex >= 0 && this.state.versionHistory[this.state.currentVersionIndex]) {
            // Get generated regions from version history
            generatedRegions = this.state.versionHistory[this.state.currentVersionIndex].generatedRegions || [];
        }
        
        // Initialize waveform if needed
        if (!this.state.waveformEditor) {
            this.initializeWaveform();
        }
        
        // Initialize token editor if needed
        if (!this.state.tokenTextEditor) {
            // Get the text-editor div inside manualEditorContainer
            const textEditorContainer = this.elements.manualEditorContainer.querySelector('.text-editor');
            
            if (textEditorContainer) {
                this.state.tokenTextEditor = new TokenTextEditor(textEditorContainer);
                this.state.tokenTextEditor.initialize();
                
                // Set up send callback
                this.state.tokenTextEditor.setSendCallback(() => {
                    this.processManualEdits();
                });
            }
        }
        
        // Set token data and link editors
        if (this.state.tokenTextEditor) {
            this.state.tokenTextEditor.setWaveformEditor(this.state.waveformEditor);
            this.state.tokenTextEditor.setTokenData(this.state.tokenData, this.state.transcribedText);
        }
        
        if (this.state.waveformEditor) {
            this.state.waveformEditor.setTokenData(this.state.tokenData);
            
            // Restore selections and generated regions
            if (preserveHighlights || generatedRegions.length > 0) {
                this.state.waveformEditor.selectTokens(selectedTokens);
                this.state.waveformEditor.markModifiedTokens(modifiedTokens);
                this.state.waveformEditor.markGeneratedRegions(generatedRegions);
            }
        }
        
        // Show the manual editor
        this.elements.manualEditorContainer.classList.remove('hidden');
    }
    
    /**
     * Initialize waveform visualization
     */
    initializeWaveform() {
        if (!this.elements.waveformContainer) return;
        
        // Create waveform editor
        this.state.waveformEditor = new WaveformEditor(this.elements.waveformContainer, {
            height: 120,
            selectedRangeColor: 'rgba(157, 184, 89, 0.1)',
            selectedRangeDarkColor: 'rgba(157, 184, 89, 0.2)',
            generatedColor: '#5DA831',
            generatedDarkColor: '#9DB859'
        });
        this.state.waveformEditor.initialize();
        
        // Load audio
        if (this.elements.audioPlayer && this.elements.audioPlayer.src) {
            this.state.waveformEditor.loadAudioElement(this.elements.audioPlayer);
        }
        
        // Set up download callback
        this.state.waveformEditor.setDownloadCallback(() => this.downloadCurrentAudio());
    }
    
    /**
     * Go to edit step with audio blob
     * @param {Blob} audioBlob - Audio blob to use
     */
    goToEditStepWithAudio(audioBlob) {
        // Store audio blob
        this.state.audioBlob = audioBlob;
        
        // Create URL for audio player
        if (this.elements.audioPlayer.src) {
            URL.revokeObjectURL(this.elements.audioPlayer.src);
        }
        this.elements.audioPlayer.src = URL.createObjectURL(audioBlob);
        
        // Add to version history (first entry is original audio)
        this.addToVersionHistory(audioBlob, 'Original');
        
        // Go to edit step
        this.goToStep(2);
    }
    
    /**
     * Add current audio to version history
     * @param {Blob} audioBlob - Audio blob to add to history
     * @param {string} label - Label to describe this version
     * @param {Array} generatedRegions - Regions of generated audio
     */
    addToVersionHistory(audioBlob, label = 'Edit', generatedRegions = []) {
        // Create a copy of the blob
        const blobCopy = audioBlob.slice(0, audioBlob.size, audioBlob.type);
        
        // If we've navigated back in history and then made a change,
        // remove all versions after the current one
        if (this.state.currentVersionIndex < this.state.versionHistory.length - 1) {
            this.state.versionHistory = this.state.versionHistory.slice(0, this.state.currentVersionIndex + 1);
        }
        
        // Add to history
        this.state.versionHistory.push({
            audioBlob: blobCopy,
            label: label,
            timestamp: new Date(),
            editMode: this.state.editMode,
            tokenData: this.state.tokenData ? JSON.parse(JSON.stringify(this.state.tokenData)) : null,
            transcribedText: this.state.transcribedText,
            generatedRegions: generatedRegions
        });
        
        // Update current index
        this.state.currentVersionIndex = this.state.versionHistory.length - 1;
        
        // Update state audio blob
        this.state.audioBlob = blobCopy;
        
        // Update audio player
        if (this.elements.audioPlayer.src) {
            URL.revokeObjectURL(this.elements.audioPlayer.src);
        }
        this.elements.audioPlayer.src = URL.createObjectURL(blobCopy);
        
        // Show version control
        this.elements.versionControlContainer.classList.remove('hidden');
        this.updateVersionDisplay();
        
        // Update waveform with generated regions
        if (this.state.waveformEditor && generatedRegions.length > 0) {
            this.state.waveformEditor.markGeneratedRegions(generatedRegions);
        }
        
        // If in manual mode, retokenize audio
        if (this.state.editMode === 'manual') {
            // Reset token data to force re-tokenization
            this.state.tokenData = null;
            this.state.transcribedText = null;
            this.tokenizeAudio();
        }
    }
    
    /**
     * Update version display
     */
    updateVersionDisplay() {
        if (this.state.versionHistory.length === 0) {
            this.elements.versionDisplay.textContent = 'Original';
            this.elements.previousVersionButton.disabled = true;
            this.elements.nextVersionButton.disabled = true;
            return;
        }
        
        // Update version counter
        this.elements.versionDisplay.textContent = 
            `Version ${this.state.currentVersionIndex + 1}/${this.state.versionHistory.length}`;
        
        // Update button states
        this.elements.previousVersionButton.disabled = (this.state.currentVersionIndex <= 0);
        this.elements.nextVersionButton.disabled = (this.state.currentVersionIndex >= this.state.versionHistory.length - 1);
    }
    
    /**
     * Navigate to previous version
     */
    navigateToPreviousVersion() {
        if (this.state.currentVersionIndex <= 0) return;
        
        this.state.currentVersionIndex--;
        this.loadVersionAtIndex(this.state.currentVersionIndex);
    }
    
    /**
     * Navigate to next version
     */
    navigateToNextVersion() {
        if (this.state.currentVersionIndex >= this.state.versionHistory.length - 1) return;
        
        this.state.currentVersionIndex++;
        this.loadVersionAtIndex(this.state.currentVersionIndex);
    }
    
    /**
     * Load version at specific index
     * @param {number} index - Index in version history
     */
    loadVersionAtIndex(index) {
        if (index < 0 || index >= this.state.versionHistory.length) return;
        
        const version = this.state.versionHistory[index];
        
        // Update current audio blob
        this.state.audioBlob = version.audioBlob;
        
        // Update audio player
        if (this.elements.audioPlayer.src) {
            URL.revokeObjectURL(this.elements.audioPlayer.src);
        }
        this.elements.audioPlayer.src = URL.createObjectURL(version.audioBlob);
        
        // Update token data if available
        this.state.tokenData = version.tokenData;
        this.state.transcribedText = version.transcribedText;
        
        // Switch to the edit mode used for this version
        if (version.editMode) {
            this.selectEditMode(version.editMode);
        }
        
        // Update version display
        this.updateVersionDisplay();
        
        // Rebuild editor if in manual mode
        if (this.state.editMode === 'manual' && this.state.tokenData) {
            this.buildManualEditor(true); // true = preserveHighlights
            
            // Apply generated regions from version history
            if (this.state.waveformEditor && version.generatedRegions) {
                this.state.waveformEditor.markGeneratedRegions(version.generatedRegions);
            }
        }
    }
    
    /**
     * Process manual edits
     */
    async processManualEdits() {
        if (!this.state.tokenTextEditor || !this.state.audioBlob) {
            this.showError('Text editor not initialized or no audio available.');
            return;
        }
        
        // Get edit operations
        const editOperations = this.state.tokenTextEditor.getEditOperations();
        
        // Check if we have edits
        if (!editOperations || editOperations.length === 0) {
            this.showError('No edits detected. Please modify the text.');
            return;
        }
        
        // Show loading
        this.showLoading(true);
        
        try {
            // Process edits
            const result = await AudioProcessor.processAudioMulti(this.state.audioBlob, editOperations);
            
            // Create summary for display
            const editSummary = editOperations.map(op => 
                `${op.original_text} → ${op.edited_text}`
            ).join(', ');
            
            // Calculate generated regions
            const generatedRegions = editOperations.map(op => {
                const startToken = this.state.tokenData.find(t => t.token_idx === op.start_token_idx);
                const endToken = this.state.tokenData.find(t => t.token_idx === op.end_token_idx - 1);
                if (startToken && endToken) {
                    return {
                        start: startToken.start_time,
                        end: endToken.end_time,
                        original: op.original_text,
                        edited: op.edited_text
                    };
                }
                return null;
            }).filter(r => r !== null);
            
            // Add to version history
            this.addToVersionHistory(result.processedBlob, editSummary, generatedRegions);
            
            // Show success message
            this.showSuccessMessage(`Edit processed: ${editSummary}`);
        } catch (error) {
            console.error('Error processing edits:', error);
            this.showError('Failed to process edits: ' + error.message);
        } finally {
            // Hide loading
            this.showLoading(false);
        }
    }
    
    /**
     * Process prompt-based edit
     */
    async processPrompt() {
        const prompt = this.elements.editPrompt.value.trim();
        
        if (!prompt) {
            this.showError('Please enter an edit prompt.');
            return;
        }
        
        if (!this.state.audioBlob) {
            this.showError('No audio file available for processing.');
            return;
        }
        
        // Show loading
        this.showLoading(true);
        this.state.processingState.processingInProgress = true;
        this.state.processingState.cancelled = false;
        
        try {
            if (this.state.processingState.cancelled) return;
            
            // Process with prompt
            const result = await AudioProcessor.processAudio(this.state.audioBlob, prompt);
            
            if (this.state.processingState.cancelled) return;
            
            // Add to version history
            this.addToVersionHistory(result.processedBlob, `Prompt: ${prompt}`);
            
            // Show success message
            this.showSuccessMessage(`Edit processed: ${prompt}`);
            
            // Clear prompt
            this.elements.editPrompt.value = '';
        } catch (error) {
            if (!this.state.processingState.cancelled) {
                console.error('Error processing prompt:', error);
                this.showError('Failed to process edit: ' + error.message);
            }
        } finally {
            this.state.processingState.processingInProgress = false;
            
            if (!this.state.processingState.cancelled) {
                this.showLoading(false);
            }
        }
    }
    
    /**
     * Download the current audio
     */
    downloadCurrentAudio() {
        if (!this.state.audioBlob) return;
        
        const a = document.createElement('a');
        a.href = URL.createObjectURL(this.state.audioBlob);
        a.download = 'voice_inpainting_' + new Date().toISOString().replace(/[:.]/g, '-') + '.wav';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    }
    
    /**
     * Reset to step 1
     */
    resetToStep1() {
        // Cancel any ongoing processes
        if (this.state.processingState.tokenizationInProgress || this.state.processingState.processingInProgress) {
            this.state.processingState.cancelled = true;
        }
        
        // Clean up audio recorder
        if (window.audioRecorder) {
            window.audioRecorder.cleanup();
        }
        
        // Hide loading
        this.showLoading(false);
        
        // Go to step 1
        this.goToStep(1);
    }
    
    /**
     * Show loading indicator
     * @param {boolean} show - Whether to show the loading indicator
     */
    showLoading(show) {
        if (show) {
            this.elements.loadingIndicator.classList.remove('hidden');
        } else {
            this.elements.loadingIndicator.classList.add('hidden');
        }
    }
    
    /**
     * Show success message
     * @param {string} message - Success message to display
     */
    showSuccessMessage(message) {
        // Create success message element
        const successMessage = document.createElement('div');
        successMessage.className = 'success-message fade-in';
        successMessage.innerHTML = `
            <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
            </svg>
            <p>${message}</p>
        `;
        
        // Get appropriate container
        const container = this.state.editMode === 'manual' 
            ? this.elements.manualEditorContainer
            : this.elements.promptEditorContainer;
        
        if (container) {
            // Add to container
            container.insertBefore(successMessage, container.firstChild);
            
            // Remove after 5 seconds
            setTimeout(() => {
                if (successMessage.parentNode) {
                    successMessage.parentNode.removeChild(successMessage);
                }
            }, 5000);
        }
    }
    
    /**
     * Show error message
     * @param {string} message - Error message to display
     */
    showError(message) {
        if (!this.elements.errorMessage || !this.elements.errorText) return;
        
        this.elements.errorText.textContent = message;
        this.elements.errorMessage.classList.remove('hidden');
        
        console.error('UI Error:', message);
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            this.elements.errorMessage.classList.add('hidden');
        }, 5000);
    }
    
    /**
     * Show the recording UI in active state
     */
    showRecordingUI() {
        this.elements.preRecordingState.classList.add('hidden');
        this.elements.activeRecordingState.classList.remove('hidden');
        this.elements.pausedRecordingState.classList.add('hidden');
    }
    
    /**
     * Show the recording UI in paused state
     */
    showPausedRecordingUI() {
        this.elements.preRecordingState.classList.add('hidden');
        this.elements.activeRecordingState.classList.add('hidden');
        this.elements.pausedRecordingState.classList.remove('hidden');
    }

    /**
     * Start recording audio
     */
    async startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            window.audioRecorder.startRecording(stream);
            this.showRecordingUI();
            this.isRecordingPaused = false;
            this.setPauseButtonState(false);
            
            // Ensure waveform animation is active
            if (this.elements.recordingWaveform) {
                this.elements.recordingWaveform.classList.add('recording-active');
            }
        } catch (err) {
            this.showError('Microphone access denied or not available.');
            console.error('Error accessing microphone:', err);
        }
    }
    
    /**
     * Set pause button state
     * @param {boolean} isPaused - Whether recording is paused
     */
    setPauseButtonState(isPaused) {
        if (!this.elements.pauseRecordingBtn) return;
        
        if (isPaused) {
            // Show resume button (play icon)
            this.elements.pauseRecordingBtn.innerHTML = `
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
            `;
            this.elements.pauseRecordingBtn.classList.remove('pause-btn');
            this.elements.pauseRecordingBtn.classList.add('play-btn');
        } else {
            // Show pause button (pause icon)
            this.elements.pauseRecordingBtn.innerHTML = `
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
            `;
            this.elements.pauseRecordingBtn.classList.remove('play-btn');
            this.elements.pauseRecordingBtn.classList.add('pause-btn');
        }
    }
    
    /**
     * Toggle pause/resume recording
     */
    togglePauseRecording() {
        const recorder = window.audioRecorder;
        if (!recorder.mediaRecorder) return;
        
        // Toggle paused state
        this.isRecordingPaused = !this.isRecordingPaused;
        
        if (this.isRecordingPaused) {
            // Pause recording
            recorder.pauseRecording();
            this.setPauseButtonState(true);
            
            // Stop waveform animation and visualization
            if (this.elements.recordingWaveform) {
                this.elements.recordingWaveform.classList.remove('recording-active');
            }
            
            if (window.AudioVisualizer) {
                window.AudioVisualizer.pauseVisualization();
            }
        } else {
            // Resume recording
            recorder.resumeRecording();
            this.setPauseButtonState(false);
            
            // Resume waveform animation and visualization
            if (this.elements.recordingWaveform) {
                this.elements.recordingWaveform.classList.add('recording-active');
            }
            
            if (window.AudioVisualizer) {
                window.AudioVisualizer.resumeVisualization();
            }
        }
    }
    
    /**
     * Finish recording and show playback controls
     */
    submitRecording() {
        const recorder = window.audioRecorder;
        if (recorder.mediaRecorder && (recorder.mediaRecorder.state === 'recording' || recorder.mediaRecorder.state === 'paused')) {
            recorder.finishRecording();
            this.showPausedRecordingUI();
            this.isRecordingPaused = false;
            this.resetPlayButton();
        }
    }
    
    /**
     * Toggle playback of recorded audio
     */
    togglePlayRecording() {
        const tempBlob = window.audioRecorder.getRecordingBlob();
        if (!tempBlob) return;
        
        if (this.elements.previewPlayer.paused) {
            // Clean up previous audio
            if (window.AudioVisualizer) {
                window.AudioVisualizer.cleanup();
            }
            this.createFreshAudioElement();
            
            // Set up audio for playback
            this.elements.previewPlayer.src = URL.createObjectURL(tempBlob);
            
            if (window.AudioVisualizer) {
                window.AudioVisualizer.setupAudioElementVisualization(this.elements.previewPlayer, '#playbackWaveform');
            }
            
            // Change button to pause icon
            this.elements.playRecordingBtn.innerHTML = `
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
            `;
            this.elements.playRecordingBtn.classList.remove('play-btn');
            this.elements.playRecordingBtn.classList.add('pause-btn');
            
            // Add animation during playback
            if (document.getElementById('playbackWaveform')) {
                document.getElementById('playbackWaveform').classList.add('recording-active');
            }
            
            // Start visualization
            if (window.AudioVisualizer) {
                this.elements.previewPlayer.addEventListener('play', () => {
                    window.AudioVisualizer.visualizePlayback(this.elements.previewPlayer);
                }, { once: true });
            }
            
            // Start playback
            setTimeout(() => {
                this.elements.previewPlayer.play().catch(err => {
                    console.error('Error playing audio:', err);
                    this.resetPlayButton();
                });
            }, 100);
        } else {
            // Pause playback
            this.resetPlayButton();
            this.elements.previewPlayer.pause();
            
            if (window.AudioVisualizer) {
                window.AudioVisualizer.pauseVisualization();
            }
        }
    }
    
    /**
     * Creates a fresh audio element for the preview player
     */
    createFreshAudioElement() {
        // Clean up old element
        if (this.elements.previewPlayer && this.elements.previewPlayer.src) {
            URL.revokeObjectURL(this.elements.previewPlayer.src);
        }
        
        // Create new element
        const newPlayer = document.createElement('audio');
        newPlayer.id = 'previewPlayer';
        newPlayer.className = 'hidden';
        newPlayer.addEventListener('ended', () => this.resetPlayButton());
        
        // Find container and replace
        const existingPlayer = document.getElementById('previewPlayer');
        if (existingPlayer && existingPlayer.parentNode) {
            existingPlayer.parentNode.replaceChild(newPlayer, existingPlayer);
        } else {
            const container = document.querySelector('#pausedRecordingState')?.closest('.drop-zone');
            if (container) container.appendChild(newPlayer);
        }
        
        // Update reference
        this.elements.previewPlayer = newPlayer;
    }
    
    /**
     * Reset play button to initial state
     */
    resetPlayButton() {
        if (!this.elements.playRecordingBtn) return;
        
        this.elements.playRecordingBtn.innerHTML = `
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        `;
        this.elements.playRecordingBtn.classList.remove('pause-btn');
        this.elements.playRecordingBtn.classList.add('play-btn');
        
        // Reset waveform
        if (document.getElementById('playbackWaveform')) {
            document.getElementById('playbackWaveform').classList.remove('recording-active');
        }
        
        if (window.AudioVisualizer) {
            window.AudioVisualizer.resetWaveform('#playbackWaveform', 2);
        }
    }
    
    /**
     * Delete the current recording and reset UI
     */
    trashRecording() {
        if (window.audioRecorder) {
            window.audioRecorder.cleanup();
        }
        this.resetToStep1();
        this.isRecordingPaused = false;
    }
    
    /**
     * Finalize recording and proceed to editing step
     */
    finalizeRecording() {
        const recorder = window.audioRecorder;
        if (!recorder) return;
        
        const blob = recorder.finalizeRecording();
        if (blob) {
            this.state.audioBlob = blob;
            this.goToEditStepWithAudio(blob);
        }
    }
}

// Initialize UI controller when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.uiController = new UIController();
    window.uiController.init();
    
    // For backwards compatibility with the old app.js
    window.voiceInpaintingApp = {
        uiController: window.uiController
    };
});