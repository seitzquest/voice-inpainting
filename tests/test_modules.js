/**
 * Simplified application modules for testing
 * These are lightweight versions of the actual modules for test purposes
 */

// Mock UI Controller
class UIController {
    constructor() {
        this.elements = {
            playPauseBtn: document.getElementById('playPauseBtn'),
            stopBtn: document.getElementById('stopBtn'),
            volumeSlider: document.getElementById('volumeSlider'),
            currentTime: document.getElementById('currentTime'),
            totalTime: document.getElementById('totalTime'),
            waveformContainer: document.getElementById('waveformContainer'),
            tokenOverlay: document.getElementById('tokenOverlay'),
            undoBtn: document.getElementById('undoBtn'),
            redoBtn: document.getElementById('redoBtn'),
            versionSelect: document.getElementById('versionSelect'),
            audioFileInput: document.getElementById('audioFileInput'),
            uploadBtn: document.getElementById('uploadBtn'),
            sessionId: document.getElementById('sessionId'),
            downloadBtn: document.getElementById('downloadBtn')
        };
        
        this.state = {
            isPlaying: false,
            currentTime: 0,
            totalTime: 0,
            volume: 0.5,
            sessionId: null,
            canUndo: false,
            canRedo: false
        };
        
        this.initializeEventListeners();
    }
    
    initializeEventListeners() {
        if (this.elements.playPauseBtn) {
            this.elements.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        }
        if (this.elements.stopBtn) {
            this.elements.stopBtn.addEventListener('click', () => this.stop());
        }
        if (this.elements.volumeSlider) {
            this.elements.volumeSlider.addEventListener('input', (e) => this.setVolume(e.target.value / 100));
        }
        if (this.elements.undoBtn) {
            this.elements.undoBtn.addEventListener('click', () => this.undo());
        }
        if (this.elements.redoBtn) {
            this.elements.redoBtn.addEventListener('click', () => this.redo());
        }
        if (this.elements.uploadBtn) {
            this.elements.uploadBtn.addEventListener('click', () => this.uploadFile());
        }
    }
    
    togglePlayPause() {
        this.state.isPlaying = !this.state.isPlaying;
        this.updatePlayPauseButton();
        return this.state.isPlaying;
    }
    
    stop() {
        this.state.isPlaying = false;
        this.state.currentTime = 0;
        this.updatePlayPauseButton();
        this.updateTimeDisplay();
        return true;
    }
    
    setVolume(volume) {
        this.state.volume = Math.max(0, Math.min(1, volume));
        return this.state.volume;
    }
    
    updatePlayPauseButton() {
        if (this.elements.playPauseBtn) {
            this.elements.playPauseBtn.textContent = this.state.isPlaying ? 'Pause' : 'Play';
        }
    }
    
    updateTimeDisplay() {
        if (this.elements.currentTime) {
            this.elements.currentTime.textContent = this.formatTime(this.state.currentTime);
        }
        if (this.elements.totalTime) {
            this.elements.totalTime.textContent = this.formatTime(this.state.totalTime);
        }
    }
    
    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    updateUndoRedoButtons(canUndo, canRedo) {
        this.state.canUndo = canUndo;
        this.state.canRedo = canRedo;
        if (this.elements.undoBtn) {
            this.elements.undoBtn.disabled = !canUndo;
        }
        if (this.elements.redoBtn) {
            this.elements.redoBtn.disabled = !canRedo;
        }
    }
    
    undo() {
        // Mock undo functionality
        return Promise.resolve({ success: true });
    }
    
    redo() {
        // Mock redo functionality  
        return Promise.resolve({ success: true });
    }
    
    uploadFile() {
        const fileInput = this.elements.audioFileInput;
        if (fileInput && fileInput.files.length > 0) {
            return this.processFile(fileInput.files[0]);
        }
        return Promise.reject(new Error('No file selected'));
    }
    
    processFile(file) {
        // Mock file processing
        return Promise.resolve({
            sessionId: 'test-session-123',
            filename: file.name,
            duration: 2.0
        });
    }
    
    setSessionId(sessionId) {
        this.state.sessionId = sessionId;
        if (this.elements.sessionId) {
            this.elements.sessionId.textContent = sessionId;
        }
    }
}

// Mock MVC Controller
class MVCVoiceController {
    constructor() {
        this.sessionId = null;
        this.currentState = null;
        this.apiBaseUrl = '/api/v2';
    }
    
    async createSession(audioBlob, filename = 'audio.wav', device = 'cpu') {
        const formData = new FormData();
        formData.append('audio', audioBlob, filename);
        formData.append('device', device);
        
        const response = await fetch(`${this.apiBaseUrl}/sessions`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error(`Failed to create session: ${response.status}`);
        }
        
        const result = await response.json();
        this.sessionId = result.session_id;
        return result;
    }
    
    async getSessionState() {
        if (!this.sessionId) {
            throw new Error('No active session');
        }
        
        const response = await fetch(`${this.apiBaseUrl}/sessions/${this.sessionId}/state`);
        
        if (!response.ok) {
            throw new Error(`Failed to get session state: ${response.status}`);
        }
        
        this.currentState = await response.json();
        return this.currentState;
    }
    
    async applyEdit(startTokenIdx, endTokenIdx, newText) {
        if (!this.sessionId) {
            throw new Error('No active session');
        }
        
        const response = await fetch(`${this.apiBaseUrl}/sessions/${this.sessionId}/edit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                start_token_idx: startTokenIdx,
                end_token_idx: endTokenIdx,
                new_text: newText
            })
        });
        
        if (!response.ok) {
            throw new Error(`Failed to apply edit: ${response.status}`);
        }
        
        this.currentState = await response.json();
        return this.currentState;
    }
    
    async undo() {
        if (!this.sessionId) {
            throw new Error('No active session');
        }
        
        const response = await fetch(`${this.apiBaseUrl}/sessions/${this.sessionId}/undo`, {
            method: 'POST'
        });
        
        if (!response.ok) {
            throw new Error(`Failed to undo: ${response.status}`);
        }
        
        this.currentState = await response.json();
        return this.currentState;
    }
    
    async redo() {
        if (!this.sessionId) {
            throw new Error('No active session');
        }
        
        const response = await fetch(`${this.apiBaseUrl}/sessions/${this.sessionId}/redo`, {
            method: 'POST'
        });
        
        if (!response.ok) {
            throw new Error(`Failed to redo: ${response.status}`);
        }
        
        this.currentState = await response.json();
        return this.currentState;
    }
}

// Mock Audio Processor
class AudioProcessor {
    constructor() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.currentBuffer = null;
        this.currentSource = null;
        this.gainNode = this.audioContext.createGain();
        this.gainNode.connect(this.audioContext.destination);
        this.isPlaying = false;
        this.startTime = 0;
        this.pauseTime = 0;
    }
    
    async loadAudioFromBlob(blob) {
        const arrayBuffer = await blob.arrayBuffer();
        this.currentBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
        return this.currentBuffer;
    }
    
    async loadAudioFromUrl(url) {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        this.currentBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
        return this.currentBuffer;
    }
    
    play(startTime = 0) {
        if (!this.currentBuffer) {
            throw new Error('No audio buffer loaded');
        }
        
        if (this.currentSource) {
            this.currentSource.stop();
        }
        
        this.currentSource = this.audioContext.createBufferSource();
        this.currentSource.buffer = this.currentBuffer;
        this.currentSource.connect(this.gainNode);
        
        this.currentSource.start(0, startTime);
        this.isPlaying = true;
        this.startTime = this.audioContext.currentTime - startTime;
        
        return true;
    }
    
    pause() {
        if (this.currentSource && this.isPlaying) {
            this.currentSource.stop();
            this.pauseTime = this.audioContext.currentTime - this.startTime;
            this.isPlaying = false;
        }
        return true;
    }
    
    stop() {
        if (this.currentSource) {
            this.currentSource.stop();
            this.currentSource = null;
        }
        this.isPlaying = false;
        this.startTime = 0;
        this.pauseTime = 0;
        return true;
    }
    
    setVolume(volume) {
        this.gainNode.gain.value = Math.max(0, Math.min(1, volume));
        return this.gainNode.gain.value;
    }
    
    getCurrentTime() {
        if (this.isPlaying) {
            return this.audioContext.currentTime - this.startTime;
        }
        return this.pauseTime;
    }
    
    getDuration() {
        return this.currentBuffer ? this.currentBuffer.length / this.currentBuffer.sampleRate : 0;
    }
}

// Mock Waveform Editor
class WaveformEditor {
    constructor(canvasId, overlayId) {
        this.canvas = document.getElementById(canvasId);
        this.overlay = document.getElementById(overlayId);
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        this.tokens = [];
        this.selectedTokens = [];
        this.audioBuffer = null;
        this.pixelsPerSecond = 400;
    }
    
    setAudioBuffer(buffer) {
        this.audioBuffer = buffer;
        this.draw();
    }
    
    setTokens(tokens) {
        this.tokens = tokens;
        this.renderTokens();
    }
    
    draw() {
        if (!this.ctx || !this.audioBuffer) return;
        
        const width = this.canvas.width;
        const height = this.canvas.height;
        
        // Clear canvas
        this.ctx.clearRect(0, 0, width, height);
        
        // Draw waveform (mock)
        this.ctx.strokeStyle = '#007bff';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        
        const channelData = this.audioBuffer.getChannelData(0);
        const step = Math.floor(channelData.length / width);
        
        for (let i = 0; i < width; i++) {
            const sample = channelData[i * step] || 0;
            const y = ((sample + 1) / 2) * height;
            if (i === 0) {
                this.ctx.moveTo(i, y);
            } else {
                this.ctx.lineTo(i, y);
            }
        }
        
        this.ctx.stroke();
    }
    
    renderTokens() {
        if (!this.overlay) return;
        
        // Clear existing tokens
        this.overlay.innerHTML = '';
        
        // Render each token
        this.tokens.forEach((token, index) => {
            const tokenEl = document.createElement('div');
            tokenEl.className = 'token';
            tokenEl.dataset.tokenIndex = index;
            tokenEl.textContent = token.text;
            
            const startX = token.start_time * this.pixelsPerSecond;
            const width = (token.end_time - token.start_time) * this.pixelsPerSecond;
            
            tokenEl.style.left = `${startX}px`;
            tokenEl.style.width = `${width}px`;
            
            tokenEl.addEventListener('click', () => this.selectToken(index));
            
            this.overlay.appendChild(tokenEl);
        });
    }
    
    selectToken(index) {
        // Clear previous selections
        this.selectedTokens = [index];
        
        // Update visual selection
        const tokenElements = this.overlay.querySelectorAll('.token');
        tokenElements.forEach((el, i) => {
            el.classList.toggle('selected', i === index);
        });
        
        return this.tokens[index];
    }
    
    selectTokenRange(startIndex, endIndex) {
        this.selectedTokens = [];
        for (let i = startIndex; i <= endIndex; i++) {
            this.selectedTokens.push(i);
        }
        
        // Update visual selection
        const tokenElements = this.overlay.querySelectorAll('.token');
        tokenElements.forEach((el, i) => {
            el.classList.toggle('selected', i >= startIndex && i <= endIndex);
        });
        
        return this.selectedTokens.map(i => this.tokens[i]);
    }
    
    getSelectedTokens() {
        return this.selectedTokens.map(i => this.tokens[i]);
    }
}

// Mock Token Text Editor
class TokenTextEditor {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.textElement = this.container?.querySelector('#tokenText');
        this.applyBtn = this.container?.querySelector('#applyEditBtn');
        this.cancelBtn = this.container?.querySelector('#cancelEditBtn');
        this.isEditing = false;
        this.originalText = '';
        this.selectedTokens = [];
        
        this.initializeEventListeners();
    }
    
    initializeEventListeners() {
        if (this.applyBtn) {
            this.applyBtn.addEventListener('click', () => this.applyEdit());
        }
        if (this.cancelBtn) {
            this.cancelBtn.addEventListener('click', () => this.cancelEdit());
        }
    }
    
    startEdit(tokens) {
        this.selectedTokens = tokens;
        this.originalText = tokens.map(t => t.text).join(' ');
        this.isEditing = true;
        
        if (this.textElement) {
            this.textElement.contentEditable = true;
            this.textElement.textContent = this.originalText;
            this.textElement.focus();
        }
        
        return true;
    }
    
    applyEdit() {
        if (!this.isEditing || !this.textElement) {
            return Promise.reject(new Error('Not in edit mode'));
        }
        
        const newText = this.textElement.textContent.trim();
        this.isEditing = false;
        this.textElement.contentEditable = false;
        
        // Mock apply edit
        return Promise.resolve({
            originalText: this.originalText,
            newText: newText,
            startTokenIdx: this.selectedTokens[0]?.token_idx || 0,
            endTokenIdx: this.selectedTokens[this.selectedTokens.length - 1]?.token_idx || 0
        });
    }
    
    cancelEdit() {
        this.isEditing = false;
        if (this.textElement) {
            this.textElement.contentEditable = false;
            this.textElement.textContent = this.originalText;
        }
        return true;
    }
    
    setText(text) {
        if (this.textElement) {
            this.textElement.textContent = text;
        }
    }
    
    getText() {
        return this.textElement ? this.textElement.textContent : '';
    }
}

// Make modules available globally for tests
window.UIController = UIController;
window.MVCVoiceController = MVCVoiceController;
window.AudioProcessor = AudioProcessor;
window.WaveformEditor = WaveformEditor;
window.TokenTextEditor = TokenTextEditor;