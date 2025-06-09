/**
 * Integration tests for voice inpainting application
 */

describe('Integration Tests', function() {
    let uiController;
    let mvcController;
    let audioProcessor;
    let waveformEditor;
    let tokenEditor;
    
    // Set longer timeout for integration tests
    this.timeout(10000);
    
    beforeEach(function() {
        // Initialize all components
        uiController = new UIController();
        mvcController = new MVCVoiceController();
        audioProcessor = new AudioProcessor();
        
        // Create additional DOM elements for integration testing
        const waveformCanvas = document.createElement('canvas');
        waveformCanvas.id = 'integrationWaveformCanvas';
        waveformCanvas.width = 800;
        waveformCanvas.height = 100;
        document.body.appendChild(waveformCanvas);
        
        const tokenOverlay = document.createElement('div');
        tokenOverlay.id = 'integrationTokenOverlay';
        document.body.appendChild(tokenOverlay);
        
        const tokenEditorContainer = document.createElement('div');
        tokenEditorContainer.id = 'integrationTokenEditor';
        tokenEditorContainer.innerHTML = `
            <div id="tokenText">hello world test</div>
            <button id="applyEditBtn">Apply Edit</button>
            <button id="cancelEditBtn">Cancel</button>
        `;
        document.body.appendChild(tokenEditorContainer);
        
        waveformEditor = new WaveformEditor('integrationWaveformCanvas', 'integrationTokenOverlay');
        tokenEditor = new TokenTextEditor('integrationTokenEditor');
    });
    
    afterEach(function() {
        // Clean up DOM elements
        const elements = [
            'integrationWaveformCanvas',
            'integrationTokenOverlay', 
            'integrationTokenEditor'
        ];
        
        elements.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.remove();
            }
        });
        
        if (audioProcessor) {
            audioProcessor.stop();
        }
    });
    
    describe('Complete Upload and Edit Workflow', function() {
        it('should handle complete file upload to edit workflow', async function() {
            // Step 1: Create session with audio file
            const mockBlob = new Blob(['mock audio data'], { type: 'audio/wav' });
            const sessionResult = await mvcController.createSession(mockBlob, 'test.wav', 'cpu');
            
            expect(sessionResult.session_id).to.be.a('string');
            expect(mvcController.sessionId).to.equal(sessionResult.session_id);
            
            // Step 2: Get initial session state
            const initialState = await mvcController.getSessionState();
            
            expect(initialState.text).to.equal('hello world test');
            expect(initialState.tokens).to.have.length(3);
            expect(initialState.can_undo).to.be.false;
            expect(initialState.can_redo).to.be.false;
            
            // Step 3: Update UI with session data
            uiController.setSessionId(sessionResult.session_id);
            uiController.updateUndoRedoButtons(initialState.can_undo, initialState.can_redo);
            
            expect(uiController.state.sessionId).to.equal(sessionResult.session_id);
            expect(uiController.state.canUndo).to.be.false;
            expect(uiController.state.canRedo).to.be.false;
            
            // Step 4: Set up waveform with tokens
            const mockBuffer = {
                length: 48000,
                sampleRate: 24000,
                getChannelData: () => new Float32Array(48000)
            };
            waveformEditor.setAudioBuffer(mockBuffer);
            waveformEditor.setTokens(initialState.tokens);
            
            expect(waveformEditor.tokens).to.have.length(3);
            expect(waveformEditor.overlay.children).to.have.length(3);
            
            // Step 5: Select token and edit
            const selectedToken = waveformEditor.selectToken(1);
            expect(selectedToken.text).to.equal('world');
            
            // Step 6: Start text editing
            tokenEditor.startEdit([selectedToken]);
            expect(tokenEditor.isEditing).to.be.true;
            expect(tokenEditor.originalText).to.equal('world');
            
            // Step 7: Modify text and apply edit
            tokenEditor.textElement.textContent = 'universe';
            const editData = await tokenEditor.applyEdit();
            
            expect(editData.newText).to.equal('universe');
            expect(editData.startTokenIdx).to.equal(1);
            
            // Step 8: Apply edit through MVC controller
            const updatedState = await mvcController.applyEdit(
                editData.startTokenIdx,
                editData.endTokenIdx,
                editData.newText
            );
            
            expect(updatedState.text).to.equal('hello universe test');
            expect(updatedState.can_undo).to.be.true;
            
            // Step 9: Update UI state
            uiController.updateUndoRedoButtons(updatedState.can_undo, updatedState.can_redo);
            expect(uiController.state.canUndo).to.be.true;
        });
        
        it('should handle undo/redo workflow', async function() {
            // Set up session with edit
            const mockBlob = new Blob(['mock audio data'], { type: 'audio/wav' });
            await mvcController.createSession(mockBlob, 'test.wav', 'cpu');
            
            // Mock an edit by setting up the MVC controller state
            mvcController.currentState = {
                session_id: mvcController.sessionId,
                text: 'hello universe test',
                can_undo: true,
                can_redo: false,
                current_version_index: 1
            };
            
            // Test undo
            const undoResult = await mvcController.undo();
            expect(undoResult.can_undo).to.be.false;
            expect(undoResult.can_redo).to.be.true;
            
            // Update UI
            uiController.updateUndoRedoButtons(undoResult.can_undo, undoResult.can_redo);
            expect(uiController.elements.undoBtn.disabled).to.be.true;
            expect(uiController.elements.redoBtn.disabled).to.be.false;
            
            // Test redo
            const redoResult = await mvcController.redo();
            expect(redoResult.can_undo).to.be.true;
            expect(redoResult.can_redo).to.be.false;
            
            // Update UI again
            uiController.updateUndoRedoButtons(redoResult.can_undo, redoResult.can_redo);
            expect(uiController.elements.undoBtn.disabled).to.be.false;
            expect(uiController.elements.redoBtn.disabled).to.be.true;
        });
    });
    
    describe('Audio Playback Integration', function() {
        it('should integrate audio loading and playback controls', async function() {
            // Load audio
            const mockBlob = new Blob(['mock audio data'], { type: 'audio/wav' });
            const buffer = await audioProcessor.loadAudioFromBlob(mockBlob);
            
            expect(buffer).to.not.be.null;
            expect(audioProcessor.currentBuffer).to.equal(buffer);
            
            // Set up waveform
            waveformEditor.setAudioBuffer(buffer);
            expect(waveformEditor.audioBuffer).to.equal(buffer);
            
            // Test playback controls through UI
            const playResult = uiController.togglePlayPause();
            expect(playResult).to.be.true;
            expect(uiController.state.isPlaying).to.be.true;
            
            // Test audio processor playback
            const audioPlayResult = audioProcessor.play();
            expect(audioPlayResult).to.be.true;
            expect(audioProcessor.isPlaying).to.be.true;
            
            // Test volume control integration
            const volumeResult = uiController.setVolume(0.8);
            expect(volumeResult).to.equal(0.8);
            
            const audioVolumeResult = audioProcessor.setVolume(0.8);
            expect(audioVolumeResult).to.equal(0.8);
            
            // Test stop
            uiController.stop();
            audioProcessor.stop();
            
            expect(uiController.state.isPlaying).to.be.false;
            expect(audioProcessor.isPlaying).to.be.false;
        });
    });
    
    describe('Token Selection and Editing Integration', function() {
        it('should handle token selection and editing workflow', function() {
            const mockTokens = [
                { text: 'hello', start_time: 0.0, end_time: 0.5, token_idx: 0 },
                { text: 'world', start_time: 0.5, end_time: 1.0, token_idx: 1 },
                { text: 'test', start_time: 1.0, end_time: 1.5, token_idx: 2 }
            ];
            
            // Set up waveform with tokens
            waveformEditor.setTokens(mockTokens);
            expect(waveformEditor.overlay.children).to.have.length(3);
            
            // Select range of tokens
            const selectedTokens = waveformEditor.selectTokenRange(0, 1);
            expect(selectedTokens).to.have.length(2);
            expect(waveformEditor.selectedTokens).to.deep.equal([0, 1]);
            
            // Start editing with selected tokens
            tokenEditor.startEdit(selectedTokens);
            expect(tokenEditor.isEditing).to.be.true;
            expect(tokenEditor.originalText).to.equal('hello world');
            
            // Verify visual selection in waveform
            const tokenElements = waveformEditor.overlay.querySelectorAll('.token');
            expect(tokenElements[0].classList.contains('selected')).to.be.true;
            expect(tokenElements[1].classList.contains('selected')).to.be.true;
            expect(tokenElements[2].classList.contains('selected')).to.be.false;
        });
        
        it('should handle single token click-to-edit workflow', function() {
            const mockTokens = [
                { text: 'hello', start_time: 0.0, end_time: 0.5, token_idx: 0 },
                { text: 'world', start_time: 0.5, end_time: 1.0, token_idx: 1 }
            ];
            
            waveformEditor.setTokens(mockTokens);
            
            // Simulate click on second token
            const tokenElements = waveformEditor.overlay.querySelectorAll('.token');
            tokenElements[1].click();
            
            expect(waveformEditor.selectedTokens).to.deep.equal([1]);
            
            // Get selected tokens and start edit
            const selectedTokens = waveformEditor.getSelectedTokens();
            tokenEditor.startEdit(selectedTokens);
            
            expect(tokenEditor.originalText).to.equal('world');
            expect(tokenEditor.textElement.textContent).to.equal('world');
        });
    });
    
    describe('Error Handling Integration', function() {
        it('should handle API errors gracefully across components', async function() {
            // Mock failed API call
            const originalFetch = window.fetch;
            window.fetch = sinon.stub().rejects(new Error('Network error'));
            
            try {
                const mockBlob = new Blob(['mock audio data'], { type: 'audio/wav' });
                await mvcController.createSession(mockBlob);
                expect.fail('Should have thrown error');
            } catch (error) {
                expect(error.message).to.equal('Network error');
                
                // Verify UI state remains consistent
                expect(uiController.state.sessionId).to.be.null;
                expect(mvcController.sessionId).to.be.null;
            } finally {
                window.fetch = originalFetch;
            }
        });
        
        it('should handle audio loading failures', async function() {
            // Mock failed audio decoding
            const originalDecodeAudioData = audioProcessor.audioContext.decodeAudioData;
            audioProcessor.audioContext.decodeAudioData = sinon.stub().rejects(new Error('Invalid audio'));
            
            try {
                const mockBlob = new Blob(['invalid audio'], { type: 'audio/wav' });
                await audioProcessor.loadAudioFromBlob(mockBlob);
                expect.fail('Should have thrown error');
            } catch (error) {
                expect(error.message).to.equal('Invalid audio');
                expect(audioProcessor.currentBuffer).to.be.null;
            } finally {
                audioProcessor.audioContext.decodeAudioData = originalDecodeAudioData;
            }
        });
    });
    
    describe('State Synchronization', function() {
        it('should maintain consistent state across all components', async function() {
            // Initialize session
            const mockBlob = new Blob(['mock audio data'], { type: 'audio/wav' });
            const sessionResult = await mvcController.createSession(mockBlob, 'test.wav', 'cpu');
            const sessionState = await mvcController.getSessionState();
            
            // Synchronize all components
            uiController.setSessionId(sessionResult.session_id);
            uiController.updateUndoRedoButtons(sessionState.can_undo, sessionState.can_redo);
            
            const mockBuffer = {
                length: 48000,
                sampleRate: 24000,
                getChannelData: () => new Float32Array(48000)
            };
            await audioProcessor.loadAudioFromBlob(mockBlob);
            waveformEditor.setAudioBuffer(mockBuffer);
            waveformEditor.setTokens(sessionState.tokens);
            
            // Verify synchronized state
            expect(uiController.state.sessionId).to.equal(mvcController.sessionId);
            expect(waveformEditor.tokens).to.have.length(sessionState.tokens.length);
            expect(audioProcessor.currentBuffer).to.not.be.null;
            
            // Verify UI reflects backend state
            expect(uiController.elements.undoBtn.disabled).to.equal(!sessionState.can_undo);
            expect(uiController.elements.redoBtn.disabled).to.equal(!sessionState.can_redo);
            expect(uiController.elements.sessionId.textContent).to.equal(sessionResult.session_id);
        });
        
        it('should update all components when session state changes', async function() {
            // Set up initial session
            const mockBlob = new Blob(['mock audio data'], { type: 'audio/wav' });
            await mvcController.createSession(mockBlob, 'test.wav', 'cpu');
            let sessionState = await mvcController.getSessionState();
            
            // Initial synchronization
            uiController.updateUndoRedoButtons(sessionState.can_undo, sessionState.can_redo);
            waveformEditor.setTokens(sessionState.tokens);
            
            // Simulate edit operation
            sessionState = await mvcController.applyEdit(1, 2, 'universe');
            
            // Update all components with new state
            uiController.updateUndoRedoButtons(sessionState.can_undo, sessionState.can_redo);
            tokenEditor.setText(sessionState.text);
            
            // Mock updated tokens (in real app, these would come from backend)
            const updatedTokens = [
                { text: 'hello', start_time: 0.0, end_time: 0.5, token_idx: 0 },
                { text: 'universe', start_time: 0.5, end_time: 1.0, token_idx: 1 },
                { text: 'test', start_time: 1.0, end_time: 1.5, token_idx: 2 }
            ];
            waveformEditor.setTokens(updatedTokens);
            
            // Verify all components reflect new state
            expect(uiController.state.canUndo).to.be.true;
            expect(uiController.elements.undoBtn.disabled).to.be.false;
            expect(tokenEditor.getText()).to.equal(sessionState.text);
            expect(waveformEditor.tokens[1].text).to.equal('universe');
        });
    });
    
    describe('Performance and Memory', function() {
        it('should handle multiple rapid operations without memory leaks', async function() {
            // Simulate rapid session creation and cleanup
            for (let i = 0; i < 5; i++) {
                const mockBlob = new Blob([`mock audio data ${i}`], { type: 'audio/wav' });
                
                // Create session
                await mvcController.createSession(mockBlob, `test${i}.wav`, 'cpu');
                
                // Load audio
                await audioProcessor.loadAudioFromBlob(mockBlob);
                
                // Set up UI
                const sessionState = await mvcController.getSessionState();
                waveformEditor.setTokens(sessionState.tokens);
                
                // Clean up (simulate user starting new session)
                audioProcessor.stop();
                waveformEditor.setTokens([]);
                
                // Verify clean state
                expect(audioProcessor.isPlaying).to.be.false;
                expect(waveformEditor.tokens).to.have.length(0);
            }
        });
        
        it('should handle large token arrays efficiently', function() {
            // Create large token array
            const largeTokenArray = [];
            for (let i = 0; i < 1000; i++) {
                largeTokenArray.push({
                    text: `token${i}`,
                    start_time: i * 0.1,
                    end_time: (i + 1) * 0.1,
                    token_idx: i
                });
            }
            
            // Test setting large token array
            const startTime = performance.now();
            waveformEditor.setTokens(largeTokenArray);
            const endTime = performance.now();
            
            // Should complete in reasonable time (< 1000ms)
            expect(endTime - startTime).to.be.lessThan(1000);
            expect(waveformEditor.tokens).to.have.length(1000);
            expect(waveformEditor.overlay.children).to.have.length(1000);
        });
    });
});