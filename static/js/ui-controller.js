/**
 * ui-controller.js
 * Enhanced UI controller with integrated audio handling and improved version management
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
        
        // Application state with simplified versioning
        this.state = {
            currentStep: 1,
            editMode: 'manual',
            audioBlob: null,
            tokenData: null,
            transcribedText: null,
            tokenToTextMap: {},
            textToTokenMap: {},
            wordTimestamps: [],
            semanticToRvqMap: {},
            waveformEditor: null,
            tokenTextEditor: null,
            processingState: {
                tokenizationInProgress: false,
                processingInProgress: false,
                cancelled: false,
                initialTokenizationDone: false  // New flag to track initial tokenization
            },
            
            // Simplified version tracking
            versionData: {
                currentVersionIndex: -1,
                versions: []  // Will store complete version data including audio, transcript, tokens, etc.
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
        
        // Add ended event to main audio player
        if (this.elements.audioPlayer) {
            this.elements.audioPlayer.addEventListener('ended', () => {
                // Reset waveform playhead when audio ends
                if (this.state.waveformEditor) {
                    this.state.waveformEditor.stopPlayheadAnimation();
                    this.state.waveformEditor.drawPlayhead();
                }
            });
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
     * Enhanced selection of edit mode with option to prevent retokenization
     * @param {string} mode - Edit mode ('manual' or 'prompt')
     * @param {boolean} silent - Whether to prevent automatic tokenization
     */
    selectEditMode(mode, silent = false) {
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
            
            // Handle manual editor initialization
            if (this.state.audioBlob && !this.state.tokenData && 
                !silent && !this.state.processingState.initialTokenizationDone) {
                // Since we're switching to manual mode and need tokens,
                // and initial tokenization hasn't been done yet,
                // start the tokenization process
                this.tokenizeAudio();
            } else if (this.state.tokenData && this.state.transcribedText) {
                // We already have token data, so build the editor
                // Use setTimeout to ensure state updates have propagated
                setTimeout(() => {
                    this.buildManualEditor(true); // Preserve highlights when switching modes
                }, 0);
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
        
        // Sync the mode dropdowns
        this.syncEditModeDropdowns();
    }

    /**
     * Keep edit mode dropdowns in sync
     */
    syncEditModeDropdowns() {
        // Update manual editor dropdown
        const manualDropdown = document.getElementById('editModeSelector');
        if (manualDropdown) {
            const manualModeText = manualDropdown.querySelector('span');
            if (manualModeText) {
                manualModeText.textContent = this.state.editMode.charAt(0).toUpperCase() + this.state.editMode.slice(1);
            }
        }
        
        // Update prompt editor dropdown
        const promptDropdown = document.getElementById('promptModeSelector');
        if (promptDropdown) {
            const promptModeText = promptDropdown.querySelector('span');
            if (promptModeText) {
                promptModeText.textContent = this.state.editMode.charAt(0).toUpperCase() + this.state.editMode.slice(1);
            }
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
        
        // Reset version data
        this.state.versionData = {
            currentVersionIndex: -1,
            versions: [],
            modifications: [],
            generations: []
        };
        
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
     * Set up Step 2: Combined Edit & Result with initial tokenization
     */
    setupStep2() {
        // Show back button
        this.elements.backButtonContainer.classList.remove('hidden');
        
        // Show edit container
        this.elements.editContainer.classList.remove('hidden');
        
        // Show version control if we have history
        if (this.state.versionData.versions.length > 0) {
            this.elements.versionControlContainer.classList.remove('hidden');
            this.updateVersionDisplay();
        }
        
        // Handle initial tokenization if not done yet
        if (this.state.audioBlob && 
            !this.state.processingState.initialTokenizationDone &&
            !this.state.processingState.tokenizationInProgress) {
            
            // For the original version, we need to do the tokenization once
            if (this.state.versionData.currentVersionIndex === 0) {
                console.debug("Initial tokenization starting for original audio");
                this.tokenizeAudio().then(() => {
                    // Set the flag to indicate initial tokenization is complete
                    this.state.processingState.initialTokenizationDone = true;
                    
                    // Set up editor based on mode after tokenization
                    this.selectEditMode(this.state.editMode);
                }).catch(error => {
                    console.error("Error in initial tokenization:", error);
                    // Fall back to prompt mode if tokenization fails
                    this.selectEditMode('prompt');
                });
            } else {
                // For other versions, tokens should already be available from the response
                this.state.processingState.initialTokenizationDone = true;
                
                // Set up editor based on mode
                this.selectEditMode(this.state.editMode);
            }
        } else {
            // Set up editor based on mode (no tokenization needed)
            this.selectEditMode(this.state.editMode);
        }
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
     * Returns a promise that resolves when tokenization is complete
     * @returns {Promise} - Promise that resolves when tokenization is complete
     */
    async tokenizeAudio() {
        if (!this.state.audioBlob) {
            return Promise.reject(new Error('No audio available for tokenization'));
        }
        
        // If tokenization is already in progress, return the existing promise
        if (this.state.processingState.tokenizationInProgress) {
            console.debug('Tokenization already in progress, waiting for completion');
            return new Promise((resolve, reject) => {
                const checkInterval = setInterval(() => {
                    if (!this.state.processingState.tokenizationInProgress) {
                        clearInterval(checkInterval);
                        if (this.state.tokenData) {
                            resolve();
                        } else {
                            reject(new Error('Tokenization failed'));
                        }
                    }
                }, 200);
            });
        }
        
        // Show loading
        this.showLoading(true, 'Processing audio...');
        
        // Set processing state
        this.state.processingState.tokenizationInProgress = true;
        this.state.processingState.cancelled = false;
        
        try {
            // Tokenize audio
            const tokenizationResult = await AudioProcessor.tokenizeAudio(this.state.audioBlob);
            
            if (this.state.processingState.cancelled) {
                return Promise.reject(new Error('Tokenization cancelled'));
            }
            
            // Store token data
            this.state.tokenData = tokenizationResult.tokens;
            this.state.transcribedText = tokenizationResult.text;
            
            // Store additional metadata if available
            if (tokenizationResult.semantic_to_rvq_map) {
                this.state.semanticToRvqMap = tokenizationResult.semantic_to_rvq_map;
            }
            
            // If this is the initial tokenization for version 0, update that version
            if (this.state.versionData.currentVersionIndex === 0) {
                const version = this.state.versionData.versions[0];
                if (version) {
                    version.tokenData = tokenizationResult.tokens;
                    version.transcribedText = tokenizationResult.text;
                    version.semanticToRvqMap = tokenizationResult.semantic_to_rvq_map || {};
                }
            }
            
            // Build manual editor if still in manual mode
            if (this.state.editMode === 'manual' && !this.state.processingState.cancelled) {
                // Using setTimeout to ensure the state update happens before we try to build the editor
                setTimeout(() => {
                    this.buildManualEditor();
                }, 0);
            }
            
            return Promise.resolve();
        } catch (error) {
            if (!this.state.processingState.cancelled) {
                console.error('Error tokenizing audio:', error);
                this.showError('Failed to tokenize audio: ' + error.message);
                
                // Fall back to prompt-based editing
                this.selectEditMode('prompt');
            }
            return Promise.reject(error);
        } finally {
            this.state.processingState.tokenizationInProgress = false;
            
            if (!this.state.processingState.cancelled) {
                this.showLoading(false);
            }
        }
    }
    
    /**
     * Build the manual editor UI with simplified highlighting approach
     * @param {boolean} preserveHighlights - Whether to preserve highlighted regions
     */
    buildManualEditor(preserveHighlights = false) {
        // Skip if not in manual mode
        if (this.state.editMode !== 'manual') return;
        
        // Skip if tokenization is in progress
        if (this.state.processingState && this.state.processingState.tokenizationInProgress) {
            console.debug('Tokenization in progress, skipping editor build');
            return;
        }
        
        // Skip if no token data is available yet
        if (!this.state.tokenData) {
            console.debug('No token data available, skipping editor build');
            return;
        }
        
        // Store editor state if needed
        let selectedTokens = [];
        let generatedRegions = [];
        
        if (preserveHighlights && this.state.waveformEditor) {
            selectedTokens = [...this.state.waveformEditor.selectedTokens];
            if (this.state.waveformEditor.generatedRegions) {
                generatedRegions = [...this.state.waveformEditor.generatedRegions];
            }
        } else if (this.state.versionData.currentVersionIndex >= 0) {
            // Get selectedTokens from current version for UI state
            const currentVersion = this.state.versionData.versions[this.state.versionData.currentVersionIndex];
            if (currentVersion && currentVersion.selectedTokens) {
                selectedTokens = [...currentVersion.selectedTokens];
            }
            
            // Get cumulative generated regions
            generatedRegions = this.getCumulativeGeneratedRegions(this.state.versionData.currentVersionIndex);
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
            // Pass all relevant tokenization metadata to the editor
            if (this.state.tokenToTextMap) {
                this.state.tokenTextEditor.tokenToTextMap = this.state.tokenToTextMap;
            }
            
            if (this.state.textToTokenMap) {
                this.state.tokenTextEditor.textToTokenMap = this.state.textToTokenMap;
            }
            
            if (this.state.semanticToRvqMap) {
                this.state.tokenTextEditor.semanticToRvqMap = this.state.semanticToRvqMap;
            }
            
            this.state.tokenTextEditor.setWaveformEditor(this.state.waveformEditor);
            this.state.tokenTextEditor.setTokenData(this.state.tokenData, this.state.transcribedText);
            
            // Restore selected tokens for UI state
            if (selectedTokens.length > 0) {
                this.state.tokenTextEditor.selectedTokens = [...selectedTokens];
                this.state.tokenTextEditor.updateOverlay();
            }
        }
        
        if (this.state.waveformEditor) {
            this.state.waveformEditor.setTokenData(this.state.tokenData);
            
            // Restore selections and generated regions
            if (selectedTokens.length > 0 || generatedRegions.length > 0) {
                this.state.waveformEditor.selectTokens(selectedTokens);
                this.state.waveformEditor.markGeneratedRegions(generatedRegions);
                this.state.waveformEditor.draw();
                this.state.waveformEditor.drawSelectionRanges();
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
     * Enhanced to handle initial audio loading and tokenization
     * @param {Blob} audioBlob - Audio blob to use
     */
    goToEditStepWithAudio(audioBlob) {
        // Store audio blob
        this.state.audioBlob = audioBlob;
        
        // Reset version data
        this.state.versionData = {
            currentVersionIndex: -1,
            versions: []
        };
        
        // Reset tokenization state
        this.state.processingState.initialTokenizationDone = false;
        
        // Create URL for audio player
        if (this.elements.audioPlayer.src) {
            URL.revokeObjectURL(this.elements.audioPlayer.src);
        }
        this.elements.audioPlayer.src = URL.createObjectURL(audioBlob);
        
        // Ensure waveform is updated if it exists
        if (this.state.waveformEditor) {
            this.state.waveformEditor.reloadAudioData();
        }
        
        // Add to version history (first entry is original audio)
        this.addToVersionHistory(audioBlob, 'Original', [], {
            changeType: 'original'
        });
        
        // Go to edit step
        this.goToStep(2);
    }
    
    /**
     * Add audio to version history with simplified approach focused on generated regions
     * @param {Blob} audioBlob - Audio blob to add to history
     * @param {string} label - Label to describe this version
     * @param {Array} generatedRegions - Regions of generated audio in this specific version
     * @param {Object} options - Additional version metadata
     */
    addToVersionHistory(audioBlob, label = 'Edit', generatedRegions = [], options = {}) {
        // Create a copy of the blob
        const blobCopy = audioBlob.slice(0, audioBlob.size, audioBlob.type);
        
        // If we've navigated back in history and then made a change,
        // remove all versions after the current one
        if (this.state.versionData.currentVersionIndex < this.state.versionData.versions.length - 1) {
            // Keep only versions up to and including the current version
            this.state.versionData.versions = this.state.versionData.versions.slice(0, this.state.versionData.currentVersionIndex + 1);
        }
        
        // Use provided token data or current state
        const tokenData = options.tokenData ? 
            JSON.parse(JSON.stringify(options.tokenData)) : 
            (this.state.tokenData ? JSON.parse(JSON.stringify(this.state.tokenData)) : null);
        
        // Use provided transcript or current state
        const transcribedText = options.transcribedText || this.state.transcribedText;
        
        // Get selected tokens if available (for UI restoration, not for version comparison)
        const selectedTokens = options.selectedTokens || 
            (this.state.tokenTextEditor ? this.state.tokenTextEditor.selectedTokens : []);
        
        // Store additional tokenization metadata with proper defaults
        const tokenToTextMap = options.tokenToTextMap || {};
        const textToTokenMap = options.textToTokenMap || {};
        const wordTimestamps = options.wordTimestamps || [];
        const semanticToRvqMap = options.semanticToRvqMap || {};
        
        // Process generated regions
        const versionIndex = this.state.versionData.versions.length;
        const versionedGeneratedRegions = generatedRegions.map(region => ({
            ...region,
            versionIndex // Tag each region with its version for filtering later
        }));
        
        // Create version entry with simplified data
        const versionEntry = {
            // Audio data
            audioBlob: blobCopy,
            
            // Metadata
            label: label,
            timestamp: new Date(),
            editMode: this.state.editMode,
            changeType: options.changeType || 'edit',
            
            // Complete transcript and token data
            tokenData: tokenData,
            transcribedText: transcribedText,
            
            // Additional tokenization metadata
            tokenToTextMap: tokenToTextMap,
            textToTokenMap: textToTokenMap,
            wordTimestamps: wordTimestamps,
            semanticToRvqMap: semanticToRvqMap,
            
            // Version-specific data
            versionIndex: versionIndex,
            generatedRegions: versionedGeneratedRegions, // Store regions specific to this version
            selectedTokens: selectedTokens, // For UI restoration only
        };
        
        // Add to version history
        this.state.versionData.versions.push(versionEntry);
        
        // Update current index
        this.state.versionData.currentVersionIndex = this.state.versionData.versions.length - 1;
        
        // Update state audio blob
        this.state.audioBlob = blobCopy;
        
        // Update audio player (always pause when changing versions)
        if (this.elements.audioPlayer.src) {
            URL.revokeObjectURL(this.elements.audioPlayer.src);
        }
        this.elements.audioPlayer.src = URL.createObjectURL(blobCopy);
        this.elements.audioPlayer.pause();
        
        // Ensure waveform is updated with the new audio blob
        if (this.state.waveformEditor) {
            this.state.waveformEditor.reloadAudioData();
        }
        
        // Show version control
        this.elements.versionControlContainer.classList.remove('hidden');
        this.updateVersionDisplay();
        
        // Update state with the current data
        this.state.tokenData = tokenData;
        this.state.transcribedText = transcribedText;
        this.state.tokenToTextMap = tokenToTextMap;
        this.state.textToTokenMap = textToTokenMap;
        this.state.wordTimestamps = wordTimestamps;
        this.state.semanticToRvqMap = semanticToRvqMap;
        
        // For manual mode, build the editor if we have token data
        if (this.state.editMode === 'manual' && tokenData) {
            // Use setTimeout to ensure state updates have completed
            setTimeout(() => {
                this.buildManualEditor(true);
            }, 0);
        }
    }
    
    /**
     * Update version display with enhanced information
     */
    updateVersionDisplay() {
        if (!this.elements.versionDisplay) return;
        
        if (this.state.versionData.versions.length === 0) {
            this.elements.versionDisplay.innerHTML = '<div class="version-info">Original</div>';
            this.elements.previousVersionButton.disabled = true;
            this.elements.nextVersionButton.disabled = true;
            return;
        }
        
        // Update button states
        this.elements.previousVersionButton.disabled = (this.state.versionData.currentVersionIndex <= 0);
        this.elements.nextVersionButton.disabled = (this.state.versionData.currentVersionIndex >= this.state.versionData.versions.length - 1);
        
        const version = this.state.versionData.versions[this.state.versionData.currentVersionIndex];
        
        // Create a more detailed version label
        let versionType = '';
        if (this.state.versionData.currentVersionIndex === 0) {
            versionType = 'Original';
        } else if (version.changeType === 'manual-edit') {
            versionType = 'Manual Edit';
        } else if (version.changeType === 'prompt-edit') {
            versionType = 'Prompt Edit';
        } else {
            versionType = 'Edit';
        }
        
        // Create time string (eg. "2m ago" or "10:45 AM")
        const timeString = this.getTimeString(version.timestamp);
        
        // Create tooltip with more details
        const tooltipContent = version.label || (versionType === 'Original' ? 'Original audio' : 'Edit');
        
        // Update the display with enhanced structure
        this.elements.versionDisplay.innerHTML = `
            <div class="version-tooltip">${tooltipContent}</div>
            <div class="version-info">
                <span class="version-number">${this.state.versionData.currentVersionIndex + 1}/${this.state.versionData.versions.length}</span>
                <span class="version-type">${versionType}</span>
                <span class="version-time">${timeString}</span>
            </div>
        `;
    }
    
    /**
     * Get cumulative generated regions up to and including the specified version
     * @param {number} versionIndex - Version index
     * @returns {Array} - Array of generated regions
     */
    getCumulativeGeneratedRegions(versionIndex) {
        if (versionIndex < 0 || versionIndex >= this.state.versionData.versions.length) {
            return [];
        }
        
        // Collect all generated regions from versions 0 through versionIndex
        const cumulativeRegions = [];
        
        for (let i = 0; i <= versionIndex; i++) {
            const version = this.state.versionData.versions[i];
            if (version && version.generatedRegions) {
                cumulativeRegions.push(...version.generatedRegions);
            }
        }
        
        return cumulativeRegions;
    }

    /**
     * Helper function to format time for version display
     * @param {Date} timestamp - Timestamp to format
     * @returns {string} - Formatted time string
     */
    getTimeString(timestamp) {
        if (!timestamp) return '';
        
        const now = new Date();
        const diff = now - timestamp;
        
        // If less than an hour, show minutes ago
        if (diff < 60 * 60 * 1000) {
            const mins = Math.floor(diff / (60 * 1000));
            return `${mins}m ago`;
        }
        
        // If today, show time
        if (timestamp.toDateString() === now.toDateString()) {
            return timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        
        // Otherwise show date
        return timestamp.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
    
    /**
     * Navigate to previous version
     */
    navigateToPreviousVersion() {
        if (this.state.versionData.currentVersionIndex <= 0) return;
        
        this.loadVersionAtIndex(this.state.versionData.currentVersionIndex - 1);
    }
    
    /**
     * Navigate to next version
     */
    navigateToNextVersion() {
        if (this.state.versionData.currentVersionIndex >= this.state.versionData.versions.length - 1) return;
        
        this.loadVersionAtIndex(this.state.versionData.currentVersionIndex + 1);
    }
    
    /**
     * Load version at specific index with simplified highlighting approach
     * @param {number} index - Index in version history
     */
    loadVersionAtIndex(index) {
        if (index < 0 || index >= this.state.versionData.versions.length) return;
        
        // Always pause audio when changing versions
        if (this.elements.audioPlayer) {
            this.elements.audioPlayer.pause();
        }
        
        // If waveform editor is initialized, reset its playback state
        if (this.state.waveformEditor) {
            this.state.waveformEditor.resetPlayback();
        }
        
        const version = this.state.versionData.versions[index];

        // Update current state from the stored version
        this.state.audioBlob = version.audioBlob;
        this.state.tokenData = version.tokenData ? JSON.parse(JSON.stringify(version.tokenData)) : null;
        this.state.transcribedText = version.transcribedText;
        this.state.editMode = version.editMode || 'manual';
        
        // Update additional tokenization metadata if available
        if (version.tokenToTextMap) {
            this.state.tokenToTextMap = JSON.parse(JSON.stringify(version.tokenToTextMap));
        }
        
        if (version.textToTokenMap) {
            this.state.textToTokenMap = JSON.parse(JSON.stringify(version.textToTokenMap));
        }
        
        if (version.wordTimestamps) {
            this.state.wordTimestamps = JSON.parse(JSON.stringify(version.wordTimestamps));
        }
        
        if (version.semanticToRvqMap) {
            this.state.semanticToRvqMap = JSON.parse(JSON.stringify(version.semanticToRvqMap));
        }
        
        // Update audio player
        if (this.elements.audioPlayer.src) {
            URL.revokeObjectURL(this.elements.audioPlayer.src);
        }
        this.elements.audioPlayer.src = URL.createObjectURL(version.audioBlob);
        
        // Reload the waveform data since the audio blob has changed
        if (this.state.waveformEditor) {
            this.state.waveformEditor.reloadAudioData();
        }
        
        // Update version display
        this.state.versionData.currentVersionIndex = index;
        this.updateVersionDisplay();
        
        // Update UI for correct edit mode
        this.selectEditMode(this.state.editMode, true); // Pass silent=true to avoid tokenization
        
        // Rebuild editor with the version's state
        if (this.state.editMode === 'manual' && this.state.tokenData) {
            this.buildManualEditor(true); // preserveHighlights = true
            
            // Apply to waveform editor
            if (this.state.waveformEditor) {
                // Get cumulative generated regions up to and including this version
                const cumulativeGeneratedRegions = this.getCumulativeGeneratedRegions(index);
                
                // Apply generated regions to waveform directly (not in drawSelectionRanges)
                this.state.waveformEditor.markGeneratedRegions(cumulativeGeneratedRegions);
                
                // Restore selected tokens for UI state (not for version comparison)
                if (version.selectedTokens && version.selectedTokens.length > 0) {
                    this.state.waveformEditor.selectTokens(version.selectedTokens);
                } else {
                    // Clear selections if none stored
                    this.state.waveformEditor.selectTokens([]);
                }
                
                // Explicitly redraw waveform to show the generated regions
                this.state.waveformEditor.draw();
            }
            
            // Apply to text editor
            if (this.state.tokenTextEditor) {
                // Update text and tokens
                if (version.transcribedText && version.tokenData) {
                    this.state.tokenTextEditor.setTokenData(version.tokenData, version.transcribedText);
                }
                
                // Apply selected tokens for UI state
                if (version.selectedTokens && version.selectedTokens.length > 0) {
                    this.state.tokenTextEditor.selectedTokens = [...version.selectedTokens];
                    this.state.tokenTextEditor.updateOverlay();
                } else {
                    // Clear selections if none stored
                    this.state.tokenTextEditor.selectedTokens = [];
                    this.state.tokenTextEditor.updateOverlay();
                }
            }
        }
    }
    
    /**
     * Get generated regions specific to a particular version
     * @param {number} versionIndex - The version index to get regions for
     * @returns {Array} - Array of generated regions for this version
     */
    getGeneratedRegionsForVersion(versionIndex) {
        if (versionIndex < 0 || versionIndex >= this.state.versionData.versions.length) {
            return [];
        }
        
        // If we're looking at the current version, return its generated regions
        const version = this.state.versionData.versions[versionIndex];
        if (version && version.versionGeneratedRegions && version.versionGeneratedRegions.length > 0) {
            return [...version.versionGeneratedRegions];
        }
        
        // Filter generations to only those from the specific version
        return this.state.versionData.generations.filter(region => {
            return region.versionIndex === versionIndex;
        });
    }
    
    /**
     * Get tokens that were modified in versions after the current one
     * This is used to show red highlighting on older versions
     * @param {number} versionIndex - The version index to get modifications for
     * @returns {Array} - Array of token indices modified in later versions
     */
    getModifiedTokensForOlderVersion(versionIndex) {
        if (versionIndex < 0 || versionIndex >= this.state.versionData.versions.length - 1) {
            return [];
        }
        
        // Get all tokens modified after this version
        const laterModifiedTokens = [];
        
        // Collect all modified tokens from later versions
        for (let i = versionIndex + 1; i < this.state.versionData.versions.length; i++) {
            const laterVersion = this.state.versionData.versions[i];
            if (laterVersion && laterVersion.modifiedTokens) {
                for (const tokenIdx of laterVersion.modifiedTokens) {
                    if (!laterModifiedTokens.includes(tokenIdx)) {
                        laterModifiedTokens.push(tokenIdx);
                    }
                }
            }
        }
        
        return laterModifiedTokens;
    }
    
    /**
     * Process manual edits with enhanced version management
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
        
        // Check if we're not on the latest version
        if (this.state.versionData.currentVersionIndex < this.state.versionData.versions.length - 1) {
            this.showConfirmationDialog(
                'You are editing a previous version. This will discard all later versions. Continue?',
                () => this.executeManualEdit(editOperations),
                () => {} // Do nothing on cancel
            );
        } else {
            await this.executeManualEdit(editOperations);
        }
    }
    
    /**
     * Execute manual edit for selected text
     * Simplified versioning approach focusing on generated regions
     * @param {Array} editOperations - Array of edit operations
     */
    async executeManualEdit(editOperations) {
        // Always pause audio when making a new version
        if (this.elements.audioPlayer) {
            this.elements.audioPlayer.pause();
        }
        
        // Show loading
        this.showLoading(true, 'Processing edits...');
        
        try {
            // Get the current transcribed text from the text editor
            const currentText = this.state.tokenTextEditor.getText();
                    
            // Process edits with enhanced response format
            const result = await AudioProcessor.processAudioMulti(this.state.audioBlob, editOperations);
            
            // Extract the needed data from the enhanced response
            const processedBlob = result.processedBlob;
            const metadata = result.metadata || {};
            
            // Create summary for display
            const editSummary = editOperations.map(op => 
                `${op.original_text} → ${op.edited_text}`
            ).join(', ');
            
            // Get the generated regions from the metadata
            const generatedRegions = metadata.generatedRegions || [];
            
            // Get currently selected tokens (just for UI state restoration)
            const selectedTokens = this.state.tokenTextEditor ?
                this.state.tokenTextEditor.selectedTokens : [];
            
            // Use the tokenization data directly from the backend if available
            if (metadata.tokenization && metadata.tokenization.tokens) {
                // Add to version history with complete metadata from backend
                this.addToVersionHistory(
                    processedBlob, 
                    editSummary, 
                    generatedRegions,
                    {
                        changeType: 'manual-edit',
                        selectedTokens: selectedTokens,
                        tokenData: metadata.tokenization.tokens,
                        transcribedText: metadata.tokenization.text,
                        // Add additional metadata for improved version management
                        tokenToTextMap: metadata.tokenization.token_to_text_map,
                        textToTokenMap: metadata.tokenization.text_to_token_map,
                        wordTimestamps: metadata.tokenization.word_timestamps,
                        semanticToRvqMap: metadata.tokenization.semantic_to_rvq_map
                    }
                );
                
                // IMPORTANT: Immediately update the waveform with cumulative generated regions
                if (this.state.waveformEditor) {
                    const cumulativeGeneratedRegions = this.getCumulativeGeneratedRegions(
                        this.state.versionData.currentVersionIndex
                    );
                    this.state.waveformEditor.markGeneratedRegions(cumulativeGeneratedRegions);
                    this.state.waveformEditor.draw();
                }
            } else {
                // Fallback to the old behavior if tokenization data is not available
                console.warn('No tokenization data in response, using current text.');
                this.addToVersionHistory(
                    processedBlob, 
                    editSummary, 
                    generatedRegions,
                    {
                        changeType: 'manual-edit',
                        selectedTokens: selectedTokens,
                        tokenData: this.state.tokenData,
                        transcribedText: currentText  // Use text editor's current content
                    }
                );
                
                // IMPORTANT: Immediately update the waveform with cumulative generated regions
                if (this.state.waveformEditor) {
                    const cumulativeGeneratedRegions = this.getCumulativeGeneratedRegions(
                        this.state.versionData.currentVersionIndex
                    );
                    this.state.waveformEditor.markGeneratedRegions(cumulativeGeneratedRegions);
                    this.state.waveformEditor.draw();
                }
            }
            
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
     * Process prompt-based edit with enhanced version management
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
        
        // Check if we're not on the latest version
        if (this.state.versionData.currentVersionIndex < this.state.versionData.versions.length - 1) {
            this.showConfirmationDialog(
                'You are editing a previous version. This will discard all later versions. Continue?',
                () => this.executePromptEdit(prompt),
                () => {} // Do nothing on cancel
            );
        } else {
            await this.executePromptEdit(prompt);
        }
    }
    
    /**
     * Execute prompt-based edit
     * Simplified versioning approach focusing on generated regions
     * @param {string} prompt - Prompt text for edit
     */
    async executePromptEdit(prompt) {
        // Always pause audio when making a new version
        if (this.elements.audioPlayer) {
            this.elements.audioPlayer.pause();
        }
        
        // Show loading
        this.showLoading(true, 'Processing audio...');
        this.state.processingState.processingInProgress = true;
        this.state.processingState.cancelled = false;
        
        try {
            if (this.state.processingState.cancelled) return;
            
            // Process with prompt using enhanced response format
            const result = await AudioProcessor.processAudio(this.state.audioBlob, prompt);
            
            if (this.state.processingState.cancelled) return;
            
            // Extract data from enhanced response
            const processedBlob = result.processedBlob;
            const metadata = result.metadata || {};
            
            // Extract generated regions and tokenization data directly from the response
            const generatedRegions = metadata.generatedRegions || [];
            const tokenization = metadata.tokenization;
            
            if (tokenization && tokenization.tokens) {
                // Use the tokenization data from the backend
                this.showLoading(true, 'Processing completed, updating UI...');
                
                // Store this information with the version using the simplified format
                this.addToVersionHistory(
                    processedBlob, 
                    `Prompt: ${prompt}`,
                    generatedRegions,
                    {
                        changeType: 'prompt-edit',
                        tokenData: tokenization.tokens,
                        transcribedText: tokenization.text,
                        // Add additional metadata for improved version management
                        tokenToTextMap: tokenization.token_to_text_map,
                        textToTokenMap: tokenization.text_to_token_map,
                        wordTimestamps: tokenization.word_timestamps,
                        semanticToRvqMap: tokenization.semantic_to_rvq_map
                    }
                );
                
                // IMPORTANT: Immediately update the waveform with cumulative generated regions
                if (this.state.waveformEditor) {
                    const cumulativeGeneratedRegions = this.getCumulativeGeneratedRegions(
                        this.state.versionData.currentVersionIndex
                    );
                    this.state.waveformEditor.markGeneratedRegions(cumulativeGeneratedRegions);
                    this.state.waveformEditor.draw();
                }
                
                // Show success message
                this.showSuccessMessage(`Edit processed: ${prompt}`);
                
                // Clear prompt
                this.elements.editPrompt.value = '';
            } else {
                // Fallback for backward compatibility with older backend versions
                console.warn('No tokenization data in response - this should not happen with updated backend');
                
                // Add the version with limited data
                this.addToVersionHistory(
                    processedBlob, 
                    `Prompt: ${prompt}`,
                    generatedRegions,
                    { 
                        changeType: 'prompt-edit',
                        // Still include any metadata we have from the response
                        editOperations: metadata.editOperations
                    }
                );
                
                // IMPORTANT: Immediately update the waveform with cumulative generated regions
                if (this.state.waveformEditor) {
                    const cumulativeGeneratedRegions = this.getCumulativeGeneratedRegions(
                        this.state.versionData.currentVersionIndex
                    );
                    this.state.waveformEditor.markGeneratedRegions(cumulativeGeneratedRegions);
                    this.state.waveformEditor.draw();
                }
                
                this.showSuccessMessage(`Edit processed: ${prompt}`);
                this.elements.editPrompt.value = '';
            }
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
     * Enhanced to properly clean up state
     */
    resetToStep1() {
        // Stop any playing audio
        if (this.elements.audioPlayer) {
            this.elements.audioPlayer.pause();
        }
        
        // Cancel any ongoing processes
        if (this.state.processingState.tokenizationInProgress || this.state.processingState.processingInProgress) {
            this.state.processingState.cancelled = true;
        }
        
        // Reset tokenization state
        this.state.processingState.initialTokenizationDone = false;
        
        // Clean up audio recorder
        if (window.audioRecorder) {
            window.audioRecorder.cleanup();
        }
        
        // Clean up editors
        this.cleanupEditors();
        
        // Hide loading
        this.showLoading(false);
        
        // Go to step 1
        this.goToStep(1);
    }
    
    /**
     * Show loading indicator with optional message
     * @param {boolean} show - Whether to show the loading indicator
     * @param {string} message - Optional loading message
     */
    showLoading(show, message = 'Processing your audio...') {
        if (!this.elements.loadingIndicator) return;
        
        if (show) {
            // Update loading message if provided
            const loadingText = this.elements.loadingIndicator.querySelector('.loading-text');
            if (loadingText) {
                loadingText.textContent = message;
            }
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
     * Show a warning message with milder styling than an error
     * @param {string} message - Warning message to display
     */
    showWarning(message) {
        // Create warning message element (similar to success but with different colors)
        const warningMessage = document.createElement('div');
        warningMessage.className = 'warning-message fade-in';
        warningMessage.innerHTML = `
            <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
            </svg>
            <p>${message}</p>
        `;
        
        // Get appropriate container
        const container = this.state.editMode === 'manual' 
            ? this.elements.manualEditorContainer
            : this.elements.promptEditorContainer;
        
        if (container) {
            // Add to container
            container.insertBefore(warningMessage, container.firstChild);
            
            // Remove after 5 seconds
            setTimeout(() => {
                if (warningMessage.parentNode) {
                    warningMessage.parentNode.removeChild(warningMessage);
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
     * Show a confirmation dialog
     * @param {string} message - Message to display
     * @param {Function} confirmCallback - Callback for confirmation
     * @param {Function} cancelCallback - Callback for cancellation
     */
    showConfirmationDialog(message, confirmCallback, cancelCallback) {
        // Create a dialog element
        const dialog = document.createElement('div');
        dialog.className = 'confirmation-dialog fade-in';
        dialog.innerHTML = `
            <div class="confirmation-content">
                <p>${message}</p>
                <div class="confirmation-buttons">
                    <button id="confirmYes" class="btn btn-primary">Yes</button>
                    <button id="confirmNo" class="btn btn-secondary">No</button>
                </div>
            </div>
        `;
        
        // Add to body
        document.body.appendChild(dialog);
        
        // Add click handlers
        document.getElementById('confirmYes').addEventListener('click', () => {
            document.body.removeChild(dialog);
            if (confirmCallback) confirmCallback();
        });
        
        document.getElementById('confirmNo').addEventListener('click', () => {
            document.body.removeChild(dialog);
            if (cancelCallback) cancelCallback();
        });
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