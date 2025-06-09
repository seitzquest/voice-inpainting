/**
 * Tests for Waveform Editor functionality
 */

describe('WaveformEditor', function() {
    let waveformEditor;
    let mockCanvas;
    let mockOverlay;
    
    beforeEach(function() {
        // Create mock canvas and overlay elements
        mockCanvas = document.createElement('canvas');
        mockCanvas.id = 'testWaveformCanvas';
        mockCanvas.width = 800;
        mockCanvas.height = 100;
        document.body.appendChild(mockCanvas);
        
        mockOverlay = document.createElement('div');
        mockOverlay.id = 'testTokenOverlay';
        mockOverlay.className = 'token-overlay';
        document.body.appendChild(mockOverlay);
        
        waveformEditor = new WaveformEditor('testWaveformCanvas', 'testTokenOverlay');
    });
    
    afterEach(function() {
        document.body.removeChild(mockCanvas);
        document.body.removeChild(mockOverlay);
    });
    
    describe('Initialization', function() {
        it('should initialize with canvas and overlay elements', function() {
            expect(waveformEditor.canvas).to.equal(mockCanvas);
            expect(waveformEditor.overlay).to.equal(mockOverlay);
            expect(waveformEditor.ctx).to.not.be.null;
        });
        
        it('should initialize with default state', function() {
            expect(waveformEditor.tokens).to.be.an('array');
            expect(waveformEditor.tokens).to.have.length(0);
            expect(waveformEditor.selectedTokens).to.be.an('array');
            expect(waveformEditor.selectedTokens).to.have.length(0);
            expect(waveformEditor.audioBuffer).to.be.null;
            expect(waveformEditor.pixelsPerSecond).to.equal(400);
        });
        
        it('should handle missing canvas element', function() {
            const editorWithoutCanvas = new WaveformEditor('nonexistent', 'testTokenOverlay');
            expect(editorWithoutCanvas.canvas).to.be.null;
            expect(editorWithoutCanvas.ctx).to.be.null;
        });
        
        it('should handle missing overlay element', function() {
            const editorWithoutOverlay = new WaveformEditor('testWaveformCanvas', 'nonexistent');
            expect(editorWithoutOverlay.overlay).to.be.null;
        });
    });
    
    describe('Audio Buffer Management', function() {
        it('should set audio buffer and trigger draw', function() {
            const mockBuffer = {
                length: 48000,
                sampleRate: 24000,
                getChannelData: (channel) => new Float32Array(48000).map((_, i) => Math.sin(i * 0.01))
            };
            
            const drawSpy = sinon.spy(waveformEditor, 'draw');
            
            waveformEditor.setAudioBuffer(mockBuffer);
            
            expect(waveformEditor.audioBuffer).to.equal(mockBuffer);
            expect(drawSpy.calledOnce).to.be.true;
            
            drawSpy.restore();
        });
        
        it('should handle null audio buffer', function() {
            waveformEditor.setAudioBuffer(null);
            expect(waveformEditor.audioBuffer).to.be.null;
        });
    });
    
    describe('Waveform Drawing', function() {
        beforeEach(function() {
            const mockBuffer = {
                length: 48000,
                sampleRate: 24000,
                getChannelData: (channel) => new Float32Array(48000).map((_, i) => Math.sin(i * 0.01))
            };
            waveformEditor.audioBuffer = mockBuffer;
        });
        
        it('should draw waveform on canvas', function() {
            const spy = sinon.spy(waveformEditor.ctx, 'clearRect');
            const strokeSpy = sinon.spy(waveformEditor.ctx, 'stroke');
            
            waveformEditor.draw();
            
            expect(spy.calledOnce).to.be.true;
            expect(strokeSpy.calledOnce).to.be.true;
            
            spy.restore();
            strokeSpy.restore();
        });
        
        it('should not draw without canvas context', function() {
            waveformEditor.ctx = null;
            
            // Should not throw error
            expect(() => waveformEditor.draw()).to.not.throw();
        });
        
        it('should not draw without audio buffer', function() {
            waveformEditor.audioBuffer = null;
            
            // Should not throw error
            expect(() => waveformEditor.draw()).to.not.throw();
        });
    });
    
    describe('Token Management', function() {
        let mockTokens;
        
        beforeEach(function() {
            mockTokens = [
                { text: 'hello', start_time: 0.0, end_time: 0.5, token_idx: 0 },
                { text: 'world', start_time: 0.5, end_time: 1.0, token_idx: 1 },
                { text: 'test', start_time: 1.0, end_time: 1.5, token_idx: 2 }
            ];
        });
        
        it('should set tokens and render them', function() {
            const renderSpy = sinon.spy(waveformEditor, 'renderTokens');
            
            waveformEditor.setTokens(mockTokens);
            
            expect(waveformEditor.tokens).to.equal(mockTokens);
            expect(renderSpy.calledOnce).to.be.true;
            
            renderSpy.restore();
        });
        
        it('should render token elements in overlay', function() {
            waveformEditor.setTokens(mockTokens);
            
            const tokenElements = waveformEditor.overlay.querySelectorAll('.token');
            expect(tokenElements).to.have.length(3);
            
            tokenElements.forEach((el, index) => {
                expect(el.textContent).to.equal(mockTokens[index].text);
                expect(el.dataset.tokenIndex).to.equal(index.toString());
            });
        });
        
        it('should position token elements correctly', function() {
            waveformEditor.setTokens(mockTokens);
            
            const tokenElements = waveformEditor.overlay.querySelectorAll('.token');
            
            // Check first token positioning
            const firstToken = tokenElements[0];
            const expectedLeft = mockTokens[0].start_time * waveformEditor.pixelsPerSecond;
            const expectedWidth = (mockTokens[0].end_time - mockTokens[0].start_time) * waveformEditor.pixelsPerSecond;
            
            expect(firstToken.style.left).to.equal(`${expectedLeft}px`);
            expect(firstToken.style.width).to.equal(`${expectedWidth}px`);
        });
        
        it('should clear existing tokens before rendering new ones', function() {
            // Add some initial tokens
            waveformEditor.setTokens(mockTokens);
            expect(waveformEditor.overlay.children).to.have.length(3);
            
            // Set new tokens
            const newTokens = [
                { text: 'new', start_time: 0.0, end_time: 0.3, token_idx: 0 },
                { text: 'tokens', start_time: 0.3, end_time: 0.8, token_idx: 1 }
            ];
            waveformEditor.setTokens(newTokens);
            
            expect(waveformEditor.overlay.children).to.have.length(2);
        });
        
        it('should handle empty token array', function() {
            waveformEditor.setTokens(mockTokens);
            expect(waveformEditor.overlay.children).to.have.length(3);
            
            waveformEditor.setTokens([]);
            expect(waveformEditor.overlay.children).to.have.length(0);
        });
    });
    
    describe('Token Selection', function() {
        let mockTokens;
        
        beforeEach(function() {
            mockTokens = [
                { text: 'hello', start_time: 0.0, end_time: 0.5, token_idx: 0 },
                { text: 'world', start_time: 0.5, end_time: 1.0, token_idx: 1 },
                { text: 'test', start_time: 1.0, end_time: 1.5, token_idx: 2 }
            ];
            waveformEditor.setTokens(mockTokens);
        });
        
        it('should select single token', function() {
            const selectedToken = waveformEditor.selectToken(1);
            
            expect(waveformEditor.selectedTokens).to.deep.equal([1]);
            expect(selectedToken).to.equal(mockTokens[1]);
            
            // Check visual selection
            const tokenElements = waveformEditor.overlay.querySelectorAll('.token');
            expect(tokenElements[1].classList.contains('selected')).to.be.true;
            expect(tokenElements[0].classList.contains('selected')).to.be.false;
            expect(tokenElements[2].classList.contains('selected')).to.be.false;
        });
        
        it('should clear previous selection when selecting new token', function() {
            waveformEditor.selectToken(0);
            expect(waveformEditor.selectedTokens).to.deep.equal([0]);
            
            waveformEditor.selectToken(2);
            expect(waveformEditor.selectedTokens).to.deep.equal([2]);
            
            // Check visual selection
            const tokenElements = waveformEditor.overlay.querySelectorAll('.token');
            expect(tokenElements[2].classList.contains('selected')).to.be.true;
            expect(tokenElements[0].classList.contains('selected')).to.be.false;
        });
        
        it('should select token range', function() {
            const selectedTokens = waveformEditor.selectTokenRange(0, 2);
            
            expect(waveformEditor.selectedTokens).to.deep.equal([0, 1, 2]);
            expect(selectedTokens).to.have.length(3);
            expect(selectedTokens[0]).to.equal(mockTokens[0]);
            expect(selectedTokens[2]).to.equal(mockTokens[2]);
            
            // Check visual selection
            const tokenElements = waveformEditor.overlay.querySelectorAll('.token');
            tokenElements.forEach(el => {
                expect(el.classList.contains('selected')).to.be.true;
            });
        });
        
        it('should handle single token range', function() {
            const selectedTokens = waveformEditor.selectTokenRange(1, 1);
            
            expect(waveformEditor.selectedTokens).to.deep.equal([1]);
            expect(selectedTokens).to.have.length(1);
            expect(selectedTokens[0]).to.equal(mockTokens[1]);
        });
        
        it('should get selected tokens', function() {
            waveformEditor.selectTokenRange(0, 1);
            const selectedTokens = waveformEditor.getSelectedTokens();
            
            expect(selectedTokens).to.have.length(2);
            expect(selectedTokens[0]).to.equal(mockTokens[0]);
            expect(selectedTokens[1]).to.equal(mockTokens[1]);
        });
        
        it('should handle click events on token elements', function() {
            const selectSpy = sinon.spy(waveformEditor, 'selectToken');
            
            const tokenElements = waveformEditor.overlay.querySelectorAll('.token');
            tokenElements[1].click();
            
            expect(selectSpy.calledOnce).to.be.true;
            expect(selectSpy.calledWith(1)).to.be.true;
            
            selectSpy.restore();
        });
    });
    
    describe('Pixel Scaling', function() {
        let mockTokens;
        
        beforeEach(function() {
            mockTokens = [
                { text: 'hello', start_time: 0.0, end_time: 0.5, token_idx: 0 },
                { text: 'world', start_time: 1.0, end_time: 1.5, token_idx: 1 }
            ];
        });
        
        it('should position tokens according to pixels per second', function() {
            waveformEditor.pixelsPerSecond = 200; // Different scale
            waveformEditor.setTokens(mockTokens);
            
            const tokenElements = waveformEditor.overlay.querySelectorAll('.token');
            
            // First token: 0.0s * 200 = 0px, width: 0.5s * 200 = 100px
            expect(tokenElements[0].style.left).to.equal('0px');
            expect(tokenElements[0].style.width).to.equal('100px');
            
            // Second token: 1.0s * 200 = 200px, width: 0.5s * 200 = 100px
            expect(tokenElements[1].style.left).to.equal('200px');
            expect(tokenElements[1].style.width).to.equal('100px');
        });
        
        it('should handle very small time intervals', function() {
            const smallTokens = [
                { text: 'quick', start_time: 0.0, end_time: 0.001, token_idx: 0 }
            ];
            
            waveformEditor.setTokens(smallTokens);
            
            const tokenElement = waveformEditor.overlay.querySelector('.token');
            expect(tokenElement.style.width).to.equal('0.4px'); // 0.001 * 400
        });
    });
    
    describe('Error Handling', function() {
        it('should handle renderTokens without overlay', function() {
            waveformEditor.overlay = null;
            
            // Should not throw error
            expect(() => waveformEditor.renderTokens()).to.not.throw();
        });
        
        it('should handle invalid token data', function() {
            const invalidTokens = [
                { text: 'invalid', start_time: 'not_a_number', end_time: 1.0 }
            ];
            
            // Should not throw error
            expect(() => waveformEditor.setTokens(invalidTokens)).to.not.throw();
        });
        
        it('should handle selectToken with invalid index', function() {
            const mockTokens = [
                { text: 'hello', start_time: 0.0, end_time: 0.5, token_idx: 0 }
            ];
            waveformEditor.setTokens(mockTokens);
            
            const result = waveformEditor.selectToken(10); // Index out of range
            expect(result).to.be.undefined;
        });
        
        it('should handle selectTokenRange with invalid indices', function() {
            const mockTokens = [
                { text: 'hello', start_time: 0.0, end_time: 0.5, token_idx: 0 }
            ];
            waveformEditor.setTokens(mockTokens);
            
            const result = waveformEditor.selectTokenRange(5, 10); // Indices out of range
            expect(result).to.be.an('array');
            expect(result).to.have.length(0);
        });
    });
});