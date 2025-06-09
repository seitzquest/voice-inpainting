/**
 * MVC Frontend Controller for Voice Inpainting Editor
 * Implements stateless frontend that treats backend as single source of truth
 */

class MVCVoiceController {
    constructor() {
        this.currentSessionId = null;
        this.currentState = null;
        this.isLoading = false;
        
        // API endpoints
        this.API_BASE = '/api/v2';
        
        // DOM elements will be set during initialization
        this.elements = {};
        
        // Bind methods to preserve context
        this.handleEdit = this.handleEdit.bind(this);
        this.handleUndo = this.handleUndo.bind(this);
        this.handleRedo = this.handleRedo.bind(this);
        this.refreshState = this.refreshState.bind(this);
    }

    /**
     * Initialize the MVC controller
     */
    async init() {
        console.log('Initializing MVC Voice Controller');
        
        // Get DOM element references
        this.elements = {
            // File upload
            fileUpload: document.getElementById('fileUpload'),
            uploadButton: document.getElementById('uploadButton'),
            fileName: document.getElementById('fileName'),
            
            // Text editor
            textEditor: document.getElementById('textEditor'),
            
            // Edit controls
            editButton: document.getElementById('editButton'),
            undoButton: document.getElementById('undoButton'),
            redoButton: document.getElementById('redoButton'),
            
            // Version control
            versionSelect: document.getElementById('versionSelect'),
            versionInfo: document.getElementById('versionInfo'),
            
            // Audio player
            audioPlayer: document.getElementById('audioPlayer'),
            
            // Status/loading
            statusIndicator: document.getElementById('statusIndicator'),
            loadingSpinner: document.getElementById('loadingSpinner'),
            
            // Session info
            sessionInfo: document.getElementById('sessionInfo')
        };
        
        // Set up event listeners
        this.setupEventListeners();
        
        // Initialize UI state
        this.updateUI();
        
        console.log('MVC Voice Controller initialized');
    }

    /**
     * Set up event listeners for UI interactions
     */
    setupEventListeners() {
        // File upload
        if (this.elements.fileUpload) {
            this.elements.fileUpload.addEventListener('change', (e) => this.handleFileUpload(e));
        }
        
        if (this.elements.uploadButton) {
            this.elements.uploadButton.addEventListener('click', () => this.elements.fileUpload?.click());
        }
        
        // Edit controls
        if (this.elements.editButton) {
            this.elements.editButton.addEventListener('click', this.handleEdit);
        }
        
        if (this.elements.undoButton) {
            this.elements.undoButton.addEventListener('click', this.handleUndo);
        }
        
        if (this.elements.redoButton) {
            this.elements.redoButton.addEventListener('click', this.handleRedo);
        }
        
        // Version control
        if (this.elements.versionSelect) {
            this.elements.versionSelect.addEventListener('change', (e) => this.handleVersionChange(e));
        }
        
        // Text editor changes (debounced)
        if (this.elements.textEditor) {
            let editTimeout;
            this.elements.textEditor.addEventListener('input', () => {
                clearTimeout(editTimeout);
                editTimeout = setTimeout(() => this.handleTextChange(), 500);
            });
        }
    }

    /**
     * Handle file upload - create new session
     */
    async handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        console.log('Uploading file:', file.name);
        this.setLoading(true);
        
        try {
            // Create new session with uploaded file
            const formData = new FormData();
            formData.append('audio', file);
            formData.append('device', 'cuda');
            
            const response = await fetch(`${this.API_BASE}/sessions`, {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const result = await response.json();
            this.currentSessionId = result.session_id;
            
            // Update filename display
            if (this.elements.fileName) {
                this.elements.fileName.textContent = file.name;
            }
            
            // Refresh state from backend (single source of truth)
            await this.refreshState();
            
            console.log('Session created:', this.currentSessionId);
            
        } catch (error) {
            console.error('Error uploading file:', error);
            this.showError('Failed to upload file: ' + error.message);
        } finally {
            this.setLoading(false);
        }
    }

    /**
     * Handle text editing - apply changes to backend
     */
    async handleEdit() {
        if (!this.currentSessionId || !this.elements.textEditor) return;
        
        // For now, this is a placeholder - we'd need to implement
        // text diff detection to determine what changed
        console.log('Edit functionality would be implemented here');
        
        // In a full implementation, we would:
        // 1. Detect what changed in the text editor
        // 2. Map changes back to token indices
        // 3. Send edit operations to backend
        // 4. Refresh state from backend
    }

    /**
     * Handle undo operation
     */
    async handleUndo() {
        if (!this.currentSessionId) return;
        
        console.log('Undoing last edit');
        this.setLoading(true);
        
        try {
            const response = await fetch(`${this.API_BASE}/sessions/${this.currentSessionId}/undo`, {
                method: 'POST'
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Undo failed');
            }
            
            // Get updated state from backend (single source of truth)
            const updatedState = await response.json();
            this.currentState = updatedState;
            
            // Update entire UI with new state
            this.updateUI();
            
            console.log('Undo completed');
            
        } catch (error) {
            console.error('Error during undo:', error);
            this.showError('Undo failed: ' + error.message);
        } finally {
            this.setLoading(false);
        }
    }

    /**
     * Handle redo operation
     */
    async handleRedo() {
        if (!this.currentSessionId) return;
        
        console.log('Redoing next edit');
        this.setLoading(true);
        
        try {
            const response = await fetch(`${this.API_BASE}/sessions/${this.currentSessionId}/redo`, {
                method: 'POST'
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Redo failed');
            }
            
            // Get updated state from backend (single source of truth)
            const updatedState = await response.json();
            this.currentState = updatedState;
            
            // Update entire UI with new state
            this.updateUI();
            
            console.log('Redo completed');
            
        } catch (error) {
            console.error('Error during redo:', error);
            this.showError('Redo failed: ' + error.message);
        } finally {
            this.setLoading(false);
        }
    }

    /**
     * Handle version selection change
     */
    async handleVersionChange(event) {
        if (!this.currentSessionId) return;
        
        const versionIndex = parseInt(event.target.value);
        if (isNaN(versionIndex)) return;
        
        console.log('Restoring to version:', versionIndex);
        this.setLoading(true);
        
        try {
            const response = await fetch(`${this.API_BASE}/sessions/${this.currentSessionId}/restore/${versionIndex}`, {
                method: 'POST'
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Version restore failed');
            }
            
            // Get updated state from backend (single source of truth)
            const updatedState = await response.json();
            this.currentState = updatedState;
            
            // Update entire UI with new state
            this.updateUI();
            
            console.log('Version restored');
            
        } catch (error) {
            console.error('Error restoring version:', error);
            this.showError('Version restore failed: ' + error.message);
        } finally {
            this.setLoading(false);
        }
    }

    /**
     * Refresh complete state from backend (single source of truth)
     */
    async refreshState() {
        if (!this.currentSessionId) return;
        
        console.log('Refreshing state from backend');
        
        try {
            const response = await fetch(`${this.API_BASE}/sessions/${this.currentSessionId}/state`);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            this.currentState = await response.json();
            
            // Update entire UI with fresh state from backend
            this.updateUI();
            
            console.log('State refreshed from backend');
            
        } catch (error) {
            console.error('Error refreshing state:', error);
            this.showError('Failed to refresh state: ' + error.message);
        }
    }

    /**
     * Update entire UI based on current state from backend
     * This is the key to stateless frontend - always display what backend says
     */
    updateUI() {
        console.log('Updating UI with current state');
        
        // Update text editor with current text from backend
        if (this.elements.textEditor && this.currentState) {
            this.elements.textEditor.value = this.currentState.text;
        }
        
        // Update undo/redo buttons based on backend capabilities
        if (this.elements.undoButton) {
            this.elements.undoButton.disabled = !this.currentState?.can_undo;
        }
        
        if (this.elements.redoButton) {
            this.elements.redoButton.disabled = !this.currentState?.can_redo;
        }
        
        // Update version selector
        this.updateVersionSelector();
        
        // Update session info
        this.updateSessionInfo();
        
        // Update audio player
        this.updateAudioPlayer();
        
        // Update status
        this.updateStatus();
    }

    /**
     * Update version selector dropdown
     */
    updateVersionSelector() {
        if (!this.elements.versionSelect || !this.currentState?.versions) return;
        
        // Clear existing options
        this.elements.versionSelect.innerHTML = '';
        
        // Add versions from backend state
        this.currentState.versions.forEach((version, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = `${version.label}: ${version.edit_description || 'No description'}`;
            option.selected = index === this.currentState.current_version_index;
            this.elements.versionSelect.appendChild(option);
        });
    }

    /**
     * Update session information display
     */
    updateSessionInfo() {
        if (!this.elements.sessionInfo || !this.currentState) return;
        
        const info = this.currentState.session_info;
        const html = `
            <div class="session-details">
                <p><strong>Session:</strong> ${this.currentSessionId}</p>
                <p><strong>Duration:</strong> ${this.currentState.audio_duration?.toFixed(2)}s</p>
                <p><strong>Versions:</strong> ${this.currentState.versions?.length || 0}</p>
                <p><strong>Current Version:</strong> ${this.currentState.current_version_index + 1}</p>
            </div>
        `;
        this.elements.sessionInfo.innerHTML = html;
    }

    /**
     * Update audio player with current audio
     */
    updateAudioPlayer() {
        if (!this.elements.audioPlayer || !this.currentSessionId) return;
        
        // Set audio source to current session audio
        this.elements.audioPlayer.src = `${this.API_BASE}/sessions/${this.currentSessionId}/audio`;
    }

    /**
     * Update status indicator
     */
    updateStatus() {
        if (!this.elements.statusIndicator) return;
        
        if (this.currentState) {
            this.elements.statusIndicator.textContent = 'Connected';
            this.elements.statusIndicator.className = 'status-connected';
        } else {
            this.elements.statusIndicator.textContent = 'No Session';
            this.elements.statusIndicator.className = 'status-disconnected';
        }
    }

    /**
     * Set loading state
     */
    setLoading(loading) {
        this.isLoading = loading;
        
        if (this.elements.loadingSpinner) {
            this.elements.loadingSpinner.style.display = loading ? 'block' : 'none';
        }
        
        // Disable controls during loading
        const controls = [
            this.elements.editButton,
            this.elements.undoButton,
            this.elements.redoButton,
            this.elements.versionSelect
        ];
        
        controls.forEach(control => {
            if (control) {
                control.disabled = loading;
            }
        });
    }

    /**
     * Show error message
     */
    showError(message) {
        console.error('Error:', message);
        
        // You could implement a toast notification system here
        alert('Error: ' + message);
    }

    /**
     * Apply a single edit operation
     */
    async applyEdit(startTokenIdx, endTokenIdx, newText) {
        if (!this.currentSessionId) return;
        
        console.log('Applying edit:', { startTokenIdx, endTokenIdx, newText });
        this.setLoading(true);
        
        try {
            const response = await fetch(`${this.API_BASE}/sessions/${this.currentSessionId}/edit`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    start_token_idx: startTokenIdx,
                    end_token_idx: endTokenIdx,
                    new_text: newText
                })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Edit failed');
            }
            
            // Get updated state from backend (single source of truth)
            const updatedState = await response.json();
            this.currentState = updatedState;
            
            // Update entire UI with new state
            this.updateUI();
            
            console.log('Edit applied successfully');
            
        } catch (error) {
            console.error('Error applying edit:', error);
            this.showError('Edit failed: ' + error.message);
        } finally {
            this.setLoading(false);
        }
    }
}

// Initialize the MVC controller when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.mvcController = new MVCVoiceController();
    window.mvcController.init();
});

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MVCVoiceController;
}