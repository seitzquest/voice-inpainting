/**
 * app.js
 * Main application script that coordinates all modules
 */

class VoiceInpaintingApp {
    constructor() {
        // Store references to DOM elements
        this.recordButton = document.getElementById('recordButton');
        this.pauseRecordingBtn = document.getElementById('pauseRecordingBtn');
        this.submitRecordingBtn = document.getElementById('submitRecordingBtn');
        this.playRecordingBtn = document.getElementById('playRecordingBtn');
        this.trashRecordingBtn = document.getElementById('trashRecordingBtn');
        this.finalizeRecordingBtn = document.getElementById('finalizeRecordingBtn');
        this.uploadButton = document.getElementById('uploadButton');
        this.fileUpload = document.getElementById('fileUpload');
        this.processButton = document.getElementById('processButton');
        this.resetAudioButton = document.getElementById('resetAudioButton');
        this.changePromptButton = document.getElementById('changePromptButton');
        this.useResultButton = document.getElementById('useResultButton');
        this.startOverButton = document.getElementById('startOverButton');
        this.downloadButton = document.getElementById('downloadButton');
        this.previewPlayer = document.getElementById('previewPlayer');
        
        // Working data
        this.currentAudioBlob = null;
        this.isRecordingPaused = false;
    }
    
    /**
     * Initialize application event listeners
     */
    init() {
        // Recording buttons
        this.recordButton.addEventListener('click', () => this.startRecording());
        this.pauseRecordingBtn.addEventListener('click', () => this.togglePauseRecording());
        this.submitRecordingBtn.addEventListener('click', () => this.submitRecording());
        this.playRecordingBtn.addEventListener('click', () => this.togglePlayRecording());
        this.trashRecordingBtn.addEventListener('click', () => this.trashRecording());
        this.finalizeRecordingBtn.addEventListener('click', () => this.finalizeRecording());
        
        // Upload buttons
        this.uploadButton.addEventListener('click', () => this.fileUpload.click());
        this.fileUpload.addEventListener('change', () => this.handleFileUpload());
        
        // Processing
        this.processButton.addEventListener('click', () => window.uiController.processAudio());
        
        // Navigation and control buttons
        this.resetAudioButton.addEventListener('click', () => window.uiController.resetToStep1());
        this.changePromptButton.addEventListener('click', () => window.uiController.changePrompt());
        this.useResultButton.addEventListener('click', () => window.uiController.useProcessedResult());
        this.startOverButton.addEventListener('click', () => {
            if (confirm('Are you sure you want to start over? Your current audio and edits will be lost.')) {
                window.uiController.resetToStep1();
            }
        });
        
        // Audio ended events
        this.previewPlayer.addEventListener('ended', () => this.resetPlayButton());
        
        console.log('Voice Inpainting App initialized');
    }
    
    /**
     * Start recording audio from the user's microphone
     */
    async startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            window.audioRecorder.startRecording(stream);
            window.uiController.showRecordingUI();
            this.isRecordingPaused = false;
            
            // Set button state for recording
            this.setPauseButtonState(false);
            
            // Ensure waveform animation is active
            document.querySelector('.recording-waveform').classList.add('recording-active');
            
        } catch (err) {
            window.uiController.showError('Microphone access denied or not available.');
            console.error('Error accessing microphone:', err);
        }
    }
    
    /**
     * Set pause button state (pause or resume)
     * @param {boolean} isPaused - Whether recording is paused
     */
    setPauseButtonState(isPaused) {
        if (isPaused) {
            // Show resume button (play icon)
            this.pauseRecordingBtn.innerHTML = `
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
            `;
            // Use standard play button style
            this.pauseRecordingBtn.classList.remove('pause-btn');
            this.pauseRecordingBtn.classList.add('play-btn');
        } else {
            // Show pause button (pause icon)
            this.pauseRecordingBtn.innerHTML = `
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
            `;
            // Use standard pause button style
            this.pauseRecordingBtn.classList.remove('play-btn');
            this.pauseRecordingBtn.classList.add('pause-btn');
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
            
            // Update button state
            this.setPauseButtonState(true);
            
            // Stop waveform animation and visualization
            document.querySelector('#recordingWaveform').classList.remove('recording-active');
            window.AudioVisualizer.pauseVisualization();
            
        } else {
            // Resume recording
            recorder.resumeRecording();
            
            // Update button state
            this.setPauseButtonState(false);
            
            // Resume waveform animation and visualization
            document.querySelector('#recordingWaveform').classList.add('recording-active');
            window.AudioVisualizer.resumeVisualization();
        }
    }
    
    /**
     * Finish recording and show playback controls
     */
    submitRecording() {
        const recorder = window.audioRecorder;
        if (recorder.mediaRecorder && (recorder.mediaRecorder.state === 'recording' || recorder.mediaRecorder.state === 'paused')) {
            recorder.finishRecording();
            window.uiController.showPausedRecordingUI();
            
            // Reset recording state
            this.isRecordingPaused = false;
            
            // Ensure play button is in the correct state (green play icon)
            this.resetPlayButton();
        }
    }
    
    /**
     * Toggle playback of recorded audio
     */
    togglePlayRecording() {
        const tempBlob = window.audioRecorder.getRecordingBlob();
        if (!tempBlob) return;
        
        if (this.previewPlayer.paused) {
            // Clean up previous audio processing
            window.AudioVisualizer.cleanup();
            
            // Create a fresh audio element to avoid connection errors
            this.createFreshAudioElement();
            
            // Create a new blob URL and set it as the source
            this.previewPlayer.src = URL.createObjectURL(tempBlob);
            
            // Set up audio visualization for the new player
            window.AudioVisualizer.setupAudioElementVisualization(this.previewPlayer, '#playbackWaveform');
            
            // Change button to pause icon
            this.playRecordingBtn.innerHTML = `
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
            `;
            // Use standard pause button style
            this.playRecordingBtn.classList.remove('play-btn');
            this.playRecordingBtn.classList.add('pause-btn');
            
            // Add class to enable animation during playback
            document.getElementById('playbackWaveform').classList.add('recording-active');
            
            // Start playback and visualization
            this.previewPlayer.addEventListener('play', () => {
                window.AudioVisualizer.visualizePlayback(this.previewPlayer);
            }, { once: true });
            
            // Start playback with small delay to ensure context is ready
            setTimeout(() => {
                this.previewPlayer.play().catch(err => {
                    console.error('Error playing audio:', err);
                    // Reset UI to play state if playback fails
                    this.resetPlayButton();
                });
            }, 100);
        } else {
            // Toggle the button to play
            this.resetPlayButton();
            
            // Pause the audio
            this.previewPlayer.pause();
            
            // Pause visualization
            window.AudioVisualizer.pauseVisualization();
        }
    }
    
    /**
     * Creates a fresh audio element for the preview player
     * Helps avoid "already connected" errors with Web Audio API
     */
    createFreshAudioElement() {
        // First, check if the element is in the DOM
        const existingPlayer = document.getElementById('previewPlayer');
        
        // Clean up old element src if it exists
        if (this.previewPlayer && this.previewPlayer.src) {
            URL.revokeObjectURL(this.previewPlayer.src);
        }
        
        // Create new element
        const newPlayer = document.createElement('audio');
        newPlayer.id = 'previewPlayer';
        newPlayer.className = 'hidden';
        newPlayer.addEventListener('ended', () => this.resetPlayButton());
        
        // Find the container
        const container = document.querySelector('#pausedRecordingState').closest('.drop-zone');
        
        // Replace or append
        if (existingPlayer && existingPlayer.parentNode) {
            existingPlayer.parentNode.replaceChild(newPlayer, existingPlayer);
        } else if (container) {
            container.appendChild(newPlayer);
        }
        
        // Update reference
        this.previewPlayer = newPlayer;
    }
    
    /**
     * Reset play button to initial state
     */
    resetPlayButton() {
        this.playRecordingBtn.innerHTML = `
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        `;
        // Use standard play button style
        this.playRecordingBtn.classList.remove('pause-btn');
        this.playRecordingBtn.classList.add('play-btn');
        
        // Remove animation class
        document.getElementById('playbackWaveform').classList.remove('recording-active');
        
        // Reset waveform bars to silent state
        window.AudioVisualizer.resetWaveform('#playbackWaveform', 2);
    }
    
    /**
     * Delete the current recording and reset UI
     */
    trashRecording() {
        // Reset recording
        window.audioRecorder.cleanup();
        
        // Reset UI using the UI controller - go back to step 1
        window.uiController.resetToStep1();
        
        // Reset recording state
        this.isRecordingPaused = false;
    }
    
    /**
     * Finalize recording and proceed to editing step
     */
    finalizeRecording() {
        const blob = window.audioRecorder.finalizeRecording();
        if (blob) {
            this.currentAudioBlob = blob;
            window.uiController.goToEditStepWithAudio(blob);
        }
    }
    
    /**
     * Handle file upload from input element
     */
    handleFileUpload() {
        if (this.fileUpload.files && this.fileUpload.files[0]) {
            const file = this.fileUpload.files[0];
            if (file.type !== 'audio/wav' && !file.name.endsWith('.wav')) {
                window.uiController.showError('Please upload a WAV file.');
                return;
            }
            
            this.currentAudioBlob = file;
            document.getElementById('fileName').textContent = file.name;
            document.getElementById('fileName').classList.remove('hidden');
            
            window.uiController.goToEditStepWithAudio(file);
        }
    }
}

// Initialize the app when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    const app = new VoiceInpaintingApp();
    app.init();
    
    // Store app instance globally for debugging
    window.voiceInpaintingApp = app;
});