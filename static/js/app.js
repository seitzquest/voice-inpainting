/**
 * app.js
 * Main application initialization and coordination
 */

class VoiceInpaintingApp {
    constructor() {
        // We'll use this flag to determine if we should attach handlers
        // or if ui-controller.js is handling everything
        this.uiControllerHandlesEvents = false;
    }
    
    /**
     * Initialize application
     */
    init() {
        // First check if UI controller exists and has already attached event handlers
        if (window.uiController) {
            console.log('UI Controller detected - deferring event handling to UI Controller');
            this.uiControllerHandlesEvents = true;
            
            // Make ourselves available globally but don't attach duplicate handlers
            window.voiceInpaintingApp = this;
            return;
        }
        
        console.log('No UI Controller detected - initializing standalone app');
        
        // Store references to DOM elements - only if we need to handle events ourselves
        this.elements = {
            // Recording controls
            recordButton: document.getElementById('recordButton'),
            pauseRecordingBtn: document.getElementById('pauseRecordingBtn'),
            submitRecordingBtn: document.getElementById('submitRecordingBtn'),
            playRecordingBtn: document.getElementById('playRecordingBtn'),
            trashRecordingBtn: document.getElementById('trashRecordingBtn'),
            finalizeRecordingBtn: document.getElementById('finalizeRecordingBtn'),
            recordingTime: document.getElementById('recordingTime'),
            
            // Upload controls
            uploadButton: document.getElementById('uploadButton'),
            fileUpload: document.getElementById('fileUpload'),
            fileName: document.getElementById('fileName'),
            
            // Edit controls
            processManualEditBtn: document.getElementById('processManualEditBtn'),
            processPromptBtn: document.getElementById('processPromptBtn'),
            
            // Navigation
            resetAudioButton: document.getElementById('resetAudioButton'),
            
            // Audio elements
            previewPlayer: document.getElementById('previewPlayer'),
            audioPlayer: document.getElementById('audioPlayer'),
            
            // Waveform elements
            recordingWaveform: document.getElementById('recordingWaveform'),
            playbackWaveform: document.getElementById('playbackWaveform'),
            waveformDownloadBtn: document.getElementById('waveformDownloadBtn')
        };
        
        // Initialize event listeners
        this.attachEventListeners();
        
        // Recording state
        this.isRecordingPaused = false;
        
        // Make available globally
        window.voiceInpaintingApp = this;
        
        console.log('Voice Inpainting App initialized');
    }
    
    /**
     * Attach event listeners to UI elements 
     */
    attachEventListeners() {
        // Only attach if we're not deferring to UI Controller
        if (this.uiControllerHandlesEvents) {
            return;
        }
    
        // Recording buttons
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
        
        // Upload controls
        if (this.elements.uploadButton && this.elements.fileUpload) {
            this.elements.uploadButton.addEventListener('click', () => this.elements.fileUpload.click());
            this.elements.fileUpload.addEventListener('change', (e) => this.handleFileUpload(e));
        }
        
        // Edit controls
        if (this.elements.processManualEditBtn) {
            this.elements.processManualEditBtn.addEventListener('click', () => this.processManualEdits());
        }
        
        if (this.elements.processPromptBtn) {
            this.elements.processPromptBtn.addEventListener('click', () => this.processPrompt());
        }
        
        // Navigation buttons
        if (this.elements.resetAudioButton) {
            this.elements.resetAudioButton.addEventListener('click', () => this.resetToStep1());
        }
        
        // Waveform download button
        if (this.elements.waveformDownloadBtn) {
            this.elements.waveformDownloadBtn.addEventListener('click', () => this.downloadCurrentAudio());
        }
        
        // Audio ended event
        if (this.elements.previewPlayer) {
            this.elements.previewPlayer.addEventListener('ended', () => this.resetPlayButton());
        }
    }
    
    /**
     * Start recording audio
     */
    async startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            if (window.audioRecorder) {
                window.audioRecorder.startRecording(stream);
            }
            
            if (window.uiController) {
                window.uiController.showRecordingUI();
            } else {
                // Fallback if uiController not available
                document.getElementById('preRecordingState').classList.add('hidden');
                document.getElementById('activeRecordingState').classList.remove('hidden');
                document.getElementById('pausedRecordingState').classList.add('hidden');
            }
            
            this.isRecordingPaused = false;
            this.setPauseButtonState(false);
            
            // Ensure waveform animation is active
            const waveform = document.getElementById('recordingWaveform');
            if (waveform) {
                waveform.classList.add('recording-active');
            }
            
        } catch (err) {
            if (window.uiController) {
                window.uiController.showError('Microphone access denied or not available.');
            }
            console.error('Error accessing microphone:', err);
        }
    }
    
    /**
     * Set pause button state
     * @param {boolean} isPaused - Whether recording is paused
     */
    setPauseButtonState(isPaused) {
        const pauseButton = document.getElementById('pauseRecordingBtn');
        if (!pauseButton) return;
        
        if (isPaused) {
            // Show resume button (play icon)
            pauseButton.innerHTML = `
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
            `;
            pauseButton.classList.remove('pause-btn');
            pauseButton.classList.add('play-btn');
        } else {
            // Show pause button (pause icon)
            pauseButton.innerHTML = `
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
            `;
            pauseButton.classList.remove('play-btn');
            pauseButton.classList.add('pause-btn');
        }
    }
    
    /**
     * Toggle pause/resume recording
     */
    togglePauseRecording() {
        if (!window.audioRecorder || !window.audioRecorder.mediaRecorder) return;
        
        // Toggle paused state
        this.isRecordingPaused = !this.isRecordingPaused;
        
        if (this.isRecordingPaused) {
            // Pause recording
            window.audioRecorder.pauseRecording();
            this.setPauseButtonState(true);
            
            // Stop waveform animation and visualization
            const waveform = document.getElementById('recordingWaveform');
            if (waveform) {
                waveform.classList.remove('recording-active');
            }
            
            if (window.AudioVisualizer) {
                window.AudioVisualizer.pauseVisualization();
            }
        } else {
            // Resume recording
            window.audioRecorder.resumeRecording();
            this.setPauseButtonState(false);
            
            // Resume waveform animation and visualization
            const waveform = document.getElementById('recordingWaveform');
            if (waveform) {
                waveform.classList.add('recording-active');
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
        if (!window.audioRecorder) return;
        
        const recorder = window.audioRecorder;
        if (recorder.mediaRecorder && (recorder.mediaRecorder.state === 'recording' || recorder.mediaRecorder.state === 'paused')) {
            recorder.finishRecording();
            
            if (window.uiController) {
                window.uiController.showPausedRecordingUI();
            } else {
                // Fallback UI update
                document.getElementById('activeRecordingState').classList.add('hidden');
                document.getElementById('pausedRecordingState').classList.remove('hidden');
            }
            
            this.isRecordingPaused = false;
            this.resetPlayButton();
        }
    }
    
    /**
     * Toggle playback of recorded audio
     */
    togglePlayRecording() {
        if (!window.audioRecorder) return;
        
        const tempBlob = window.audioRecorder.getRecordingBlob();
        const previewPlayer = document.getElementById('previewPlayer');
        if (!tempBlob || !previewPlayer) return;
        
        if (previewPlayer.paused) {
            // Clean up previous audio
            if (window.AudioVisualizer) {
                window.AudioVisualizer.cleanup();
            }
            
            this.createFreshAudioElement();
            
            // Set up audio for playback
            previewPlayer.src = URL.createObjectURL(tempBlob);
            
            if (window.AudioVisualizer) {
                const playbackWaveform = document.getElementById('playbackWaveform');
                if (playbackWaveform) {
                    window.AudioVisualizer.setupAudioElementVisualization(
                        previewPlayer, 
                        '#playbackWaveform'
                    );
                }
            }
            
            // Change button to pause icon
            const playButton = document.getElementById('playRecordingBtn');
            if (playButton) {
                playButton.innerHTML = `
                    <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                `;
                playButton.classList.remove('play-btn');
                playButton.classList.add('pause-btn');
            }
            
            // Add animation during playback
            const playbackWaveform = document.getElementById('playbackWaveform');
            if (playbackWaveform) {
                playbackWaveform.classList.add('recording-active');
            }
            
            // Start visualization
            if (window.AudioVisualizer) {
                previewPlayer.addEventListener('play', () => {
                    window.AudioVisualizer.visualizePlayback(previewPlayer);
                }, { once: true });
            }
            
            // Start playback
            setTimeout(() => {
                previewPlayer.play().catch(err => {
                    console.error('Error playing audio:', err);
                    this.resetPlayButton();
                });
            }, 100);
        } else {
            // Pause playback
            this.resetPlayButton();
            previewPlayer.pause();
            
            if (window.AudioVisualizer) {
                window.AudioVisualizer.pauseVisualization();
            }
        }
    }
    
    /**
     * Creates a fresh audio element for the preview player
     */
    createFreshAudioElement() {
        const previewPlayer = document.getElementById('previewPlayer');
        if (!previewPlayer) return;
        
        // Clean up old element
        if (previewPlayer.src) {
            URL.revokeObjectURL(previewPlayer.src);
        }
        
        // Create new element
        const newPlayer = document.createElement('audio');
        newPlayer.id = 'previewPlayer';
        newPlayer.className = 'hidden';
        newPlayer.addEventListener('ended', () => this.resetPlayButton());
        
        // Find container and replace
        if (previewPlayer.parentNode) {
            previewPlayer.parentNode.replaceChild(newPlayer, previewPlayer);
        } else {
            // If no parent, append to body
            document.body.appendChild(newPlayer);
        }
    }
    
    /**
     * Reset play button to initial state
     */
    resetPlayButton() {
        const playButton = document.getElementById('playRecordingBtn');
        if (!playButton) return;
        
        playButton.innerHTML = `
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        `;
        playButton.classList.remove('pause-btn');
        playButton.classList.add('play-btn');
        
        // Reset waveform
        const playbackWaveform = document.getElementById('playbackWaveform');
        if (playbackWaveform) {
            playbackWaveform.classList.remove('recording-active');
        }
        
        if (window.AudioVisualizer && playbackWaveform) {
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
        
        if (window.uiController) {
            window.uiController.resetToStep1();
        } else {
            // Basic UI reset
            document.getElementById('preRecordingState').classList.remove('hidden');
            document.getElementById('activeRecordingState').classList.add('hidden');
            document.getElementById('pausedRecordingState').classList.add('hidden');
        }
        
        this.isRecordingPaused = false;
    }
    
    /**
     * Finalize recording and proceed to editing step
     */
    finalizeRecording() {
        if (!window.audioRecorder) return;
        
        const blob = window.audioRecorder.finalizeRecording();
        if (blob && window.uiController) {
            window.uiController.goToEditStepWithAudio(blob);
        }
    }
    
    /**
     * Handle file upload from input element
     */
    handleFileUpload(event) {
        if (!event || !event.target || !event.target.files || !event.target.files[0]) return;
        
        const file = event.target.files[0];
        
        if (window.uiController) {
            window.uiController.validateAndProcessFile(file);
        } else {
            // Fallback handling if uiController is not available
            if (file.type !== 'audio/wav' && !file.name.endsWith('.wav')) {
                console.error('Please upload a WAV file.');
                return;
            }
            
            const fileName = document.getElementById('fileName');
            if (fileName) {
                fileName.textContent = file.name;
                fileName.classList.remove('hidden');
            }
        }
    }
    
    // Delegated methods that simply forward to UI controller if it exists
    
    processManualEdits() {
        if (window.uiController) {
            window.uiController.processManualEdits();
        }
    }
    
    processPrompt() {
        if (window.uiController) {
            window.uiController.processPrompt();
        }
    }
    
    resetToStep1() {
        if (window.uiController) {
            window.uiController.resetToStep1();
        }
    }
    
    downloadCurrentAudio() {
        if (window.uiController) {
            window.uiController.downloadCurrentAudio();
        }
    }
}

// Initialize the app when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    // Allow the UI controller to load first
    setTimeout(() => {
        // Create and initialize app instance
        const app = new VoiceInpaintingApp();
        app.init();
    }, 100);
});