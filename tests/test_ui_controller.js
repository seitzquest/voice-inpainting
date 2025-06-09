/**
 * Tests for UI Controller functionality
 */

describe('UIController', function() {
    let uiController;
    
    beforeEach(function() {
        uiController = new UIController();
    });
    
    afterEach(function() {
        // Reset any state changes
        if (uiController) {
            uiController.stop();
        }
    });
    
    describe('Initialization', function() {
        it('should initialize with default state', function() {
            expect(uiController.state.isPlaying).to.equal(false);
            expect(uiController.state.currentTime).to.equal(0);
            expect(uiController.state.volume).to.equal(0.5);
            expect(uiController.state.sessionId).to.be.null;
            expect(uiController.state.canUndo).to.equal(false);
            expect(uiController.state.canRedo).to.equal(false);
        });
        
        it('should find and store DOM elements', function() {
            expect(uiController.elements.playPauseBtn).to.not.be.null;
            expect(uiController.elements.stopBtn).to.not.be.null;
            expect(uiController.elements.volumeSlider).to.not.be.null;
            expect(uiController.elements.undoBtn).to.not.be.null;
            expect(uiController.elements.redoBtn).to.not.be.null;
        });
    });
    
    describe('Audio Controls', function() {
        it('should toggle play/pause state', function() {
            const initialState = uiController.state.isPlaying;
            const result = uiController.togglePlayPause();
            
            expect(uiController.state.isPlaying).to.equal(!initialState);
            expect(result).to.equal(!initialState);
        });
        
        it('should update play/pause button text', function() {
            uiController.togglePlayPause(); // Start playing
            expect(uiController.elements.playPauseBtn.textContent).to.equal('Pause');
            
            uiController.togglePlayPause(); // Stop playing
            expect(uiController.elements.playPauseBtn.textContent).to.equal('Play');
        });
        
        it('should stop playback and reset time', function() {
            uiController.state.isPlaying = true;
            uiController.state.currentTime = 10;
            
            const result = uiController.stop();
            
            expect(result).to.be.true;
            expect(uiController.state.isPlaying).to.equal(false);
            expect(uiController.state.currentTime).to.equal(0);
            expect(uiController.elements.playPauseBtn.textContent).to.equal('Play');
        });
        
        it('should set volume within valid range', function() {
            let result = uiController.setVolume(0.8);
            expect(result).to.equal(0.8);
            expect(uiController.state.volume).to.equal(0.8);
            
            // Test boundary conditions
            result = uiController.setVolume(-0.1);
            expect(result).to.equal(0);
            
            result = uiController.setVolume(1.5);
            expect(result).to.equal(1);
        });
    });
    
    describe('Time Formatting', function() {
        it('should format time correctly', function() {
            expect(uiController.formatTime(0)).to.equal('0:00');
            expect(uiController.formatTime(30)).to.equal('0:30');
            expect(uiController.formatTime(90)).to.equal('1:30');
            expect(uiController.formatTime(3661)).to.equal('61:01');
        });
        
        it('should update time display elements', function() {
            uiController.state.currentTime = 45;
            uiController.state.totalTime = 120;
            
            uiController.updateTimeDisplay();
            
            expect(uiController.elements.currentTime.textContent).to.equal('0:45');
            expect(uiController.elements.totalTime.textContent).to.equal('2:00');
        });
    });
    
    describe('Undo/Redo Controls', function() {
        it('should update undo/redo button states', function() {
            uiController.updateUndoRedoButtons(true, false);
            
            expect(uiController.state.canUndo).to.be.true;
            expect(uiController.state.canRedo).to.be.false;
            expect(uiController.elements.undoBtn.disabled).to.be.false;
            expect(uiController.elements.redoBtn.disabled).to.be.true;
        });
        
        it('should handle undo operation', async function() {
            const result = await uiController.undo();
            expect(result.success).to.be.true;
        });
        
        it('should handle redo operation', async function() {
            const result = await uiController.redo();
            expect(result.success).to.be.true;
        });
    });
    
    describe('File Upload', function() {
        it('should reject upload when no file selected', async function() {
            try {
                await uiController.uploadFile();
                expect.fail('Should have thrown error');
            } catch (error) {
                expect(error.message).to.equal('No file selected');
            }
        });
        
        it('should process file when selected', async function() {
            // Mock file selection
            const mockFile = new File(['mock audio data'], 'test.wav', { type: 'audio/wav' });
            const fileInput = uiController.elements.audioFileInput;
            
            // Create a mock FileList
            Object.defineProperty(fileInput, 'files', {
                value: [mockFile],
                writable: false
            });
            
            const result = await uiController.uploadFile();
            
            expect(result.sessionId).to.equal('test-session-123');
            expect(result.filename).to.equal('test.wav');
            expect(result.duration).to.be.a('number');
        });
    });
    
    describe('Session Management', function() {
        it('should set and display session ID', function() {
            const sessionId = 'test-session-456';
            uiController.setSessionId(sessionId);
            
            expect(uiController.state.sessionId).to.equal(sessionId);
            expect(uiController.elements.sessionId.textContent).to.equal(sessionId);
        });
    });
    
    describe('Event Listeners', function() {
        it('should trigger play/pause on button click', function() {
            const spy = sinon.spy(uiController, 'togglePlayPause');
            
            uiController.elements.playPauseBtn.click();
            
            expect(spy.calledOnce).to.be.true;
            spy.restore();
        });
        
        it('should trigger stop on button click', function() {
            const spy = sinon.spy(uiController, 'stop');
            
            uiController.elements.stopBtn.click();
            
            expect(spy.calledOnce).to.be.true;
            spy.restore();
        });
        
        it('should trigger volume change on slider input', function() {
            const spy = sinon.spy(uiController, 'setVolume');
            
            const event = new Event('input');
            uiController.elements.volumeSlider.value = 75;
            uiController.elements.volumeSlider.dispatchEvent(event);
            
            expect(spy.calledOnce).to.be.true;
            expect(spy.calledWith(0.75)).to.be.true;
            spy.restore();
        });
        
        it('should trigger undo on button click', function() {
            const spy = sinon.spy(uiController, 'undo');
            
            uiController.elements.undoBtn.click();
            
            expect(spy.calledOnce).to.be.true;
            spy.restore();
        });
        
        it('should trigger redo on button click', function() {
            const spy = sinon.spy(uiController, 'redo');
            
            uiController.elements.redoBtn.click();
            
            expect(spy.calledOnce).to.be.true;
            spy.restore();
        });
        
        it('should trigger upload on button click', function() {
            const spy = sinon.spy(uiController, 'uploadFile');
            
            uiController.elements.uploadBtn.click();
            
            expect(spy.calledOnce).to.be.true;
            spy.restore();
        });
    });
});