/**
 * Tests for Token Text Editor functionality
 */

describe('TokenTextEditor', function() {
    let tokenEditor;
    let mockContainer;
    let mockTextElement;
    let mockApplyBtn;
    let mockCancelBtn;
    
    beforeEach(function() {
        // Create mock DOM structure
        mockContainer = document.createElement('div');
        mockContainer.id = 'testTokenEditor';
        
        mockTextElement = document.createElement('div');
        mockTextElement.id = 'tokenText';
        mockTextElement.textContent = 'hello world test';
        
        mockApplyBtn = document.createElement('button');
        mockApplyBtn.id = 'applyEditBtn';
        mockApplyBtn.textContent = 'Apply Edit';
        
        mockCancelBtn = document.createElement('button');
        mockCancelBtn.id = 'cancelEditBtn';
        mockCancelBtn.textContent = 'Cancel';
        
        mockContainer.appendChild(mockTextElement);
        mockContainer.appendChild(mockApplyBtn);
        mockContainer.appendChild(mockCancelBtn);
        document.body.appendChild(mockContainer);
        
        tokenEditor = new TokenTextEditor('testTokenEditor');
    });
    
    afterEach(function() {
        document.body.removeChild(mockContainer);
    });
    
    describe('Initialization', function() {
        it('should initialize with DOM elements', function() {
            expect(tokenEditor.container).to.equal(mockContainer);
            expect(tokenEditor.textElement).to.equal(mockTextElement);
            expect(tokenEditor.applyBtn).to.equal(mockApplyBtn);
            expect(tokenEditor.cancelBtn).to.equal(mockCancelBtn);
        });
        
        it('should initialize with default state', function() {
            expect(tokenEditor.isEditing).to.be.false;
            expect(tokenEditor.originalText).to.equal('');
            expect(tokenEditor.selectedTokens).to.be.an('array');
            expect(tokenEditor.selectedTokens).to.have.length(0);
        });
        
        it('should handle missing container', function() {
            const editorWithoutContainer = new TokenTextEditor('nonexistent');
            expect(editorWithoutContainer.container).to.be.null;
            expect(editorWithoutContainer.textElement).to.be.null;
            expect(editorWithoutContainer.applyBtn).to.be.null;
            expect(editorWithoutContainer.cancelBtn).to.be.null;
        });
        
        it('should set up event listeners', function() {
            const applyEventSpy = sinon.spy(tokenEditor, 'applyEdit');
            const cancelEventSpy = sinon.spy(tokenEditor, 'cancelEdit');
            
            mockApplyBtn.click();
            mockCancelBtn.click();
            
            expect(applyEventSpy.calledOnce).to.be.true;
            expect(cancelEventSpy.calledOnce).to.be.true;
            
            applyEventSpy.restore();
            cancelEventSpy.restore();
        });
    });
    
    describe('Text Management', function() {
        it('should set text content', function() {
            const newText = 'new text content';
            tokenEditor.setText(newText);
            
            expect(tokenEditor.textElement.textContent).to.equal(newText);
        });
        
        it('should get text content', function() {
            const expectedText = 'hello world test';
            const actualText = tokenEditor.getText();
            
            expect(actualText).to.equal(expectedText);
        });
        
        it('should handle setText without text element', function() {
            tokenEditor.textElement = null;
            
            // Should not throw error
            expect(() => tokenEditor.setText('test')).to.not.throw();
        });
        
        it('should handle getText without text element', function() {
            tokenEditor.textElement = null;
            
            const result = tokenEditor.getText();
            expect(result).to.equal('');
        });
    });
    
    describe('Edit Mode', function() {
        let mockTokens;
        
        beforeEach(function() {
            mockTokens = [
                { text: 'hello', token_idx: 0, start_time: 0.0, end_time: 0.5 },
                { text: 'world', token_idx: 1, start_time: 0.5, end_time: 1.0 }
            ];
        });
        
        it('should start edit mode', function() {
            const result = tokenEditor.startEdit(mockTokens);
            
            expect(result).to.be.true;
            expect(tokenEditor.isEditing).to.be.true;
            expect(tokenEditor.selectedTokens).to.equal(mockTokens);
            expect(tokenEditor.originalText).to.equal('hello world');
            expect(tokenEditor.textElement.contentEditable).to.equal('true');
            expect(tokenEditor.textElement.textContent).to.equal('hello world');
        });
        
        it('should focus text element when starting edit', function() {
            const focusSpy = sinon.spy(tokenEditor.textElement, 'focus');
            
            tokenEditor.startEdit(mockTokens);
            
            expect(focusSpy.calledOnce).to.be.true;
            focusSpy.restore();
        });
        
        it('should handle single token edit', function() {
            const singleToken = [mockTokens[0]];
            
            tokenEditor.startEdit(singleToken);
            
            expect(tokenEditor.originalText).to.equal('hello');
            expect(tokenEditor.textElement.textContent).to.equal('hello');
        });
        
        it('should handle empty token array', function() {
            tokenEditor.startEdit([]);
            
            expect(tokenEditor.originalText).to.equal('');
            expect(tokenEditor.textElement.textContent).to.equal('');
        });
    });
    
    describe('Apply Edit', function() {
        let mockTokens;
        
        beforeEach(function() {
            mockTokens = [
                { text: 'hello', token_idx: 0, start_time: 0.0, end_time: 0.5 },
                { text: 'world', token_idx: 1, start_time: 0.5, end_time: 1.0 }
            ];
            tokenEditor.startEdit(mockTokens);
        });
        
        it('should apply edit with new text', async function() {
            tokenEditor.textElement.textContent = 'hello universe';
            
            const result = await tokenEditor.applyEdit();
            
            expect(result.originalText).to.equal('hello world');
            expect(result.newText).to.equal('hello universe');
            expect(result.startTokenIdx).to.equal(0);
            expect(result.endTokenIdx).to.equal(1);
            expect(tokenEditor.isEditing).to.be.false;
            expect(tokenEditor.textElement.contentEditable).to.equal('false');
        });
        
        it('should trim whitespace from new text', async function() {
            tokenEditor.textElement.textContent = '  hello universe  ';
            
            const result = await tokenEditor.applyEdit();
            
            expect(result.newText).to.equal('hello universe');
        });
        
        it('should handle empty new text', async function() {
            tokenEditor.textElement.textContent = '';
            
            const result = await tokenEditor.applyEdit();
            
            expect(result.newText).to.equal('');
        });
        
        it('should reject when not in edit mode', async function() {
            tokenEditor.isEditing = false;
            
            try {
                await tokenEditor.applyEdit();
                expect.fail('Should have thrown error');
            } catch (error) {
                expect(error.message).to.equal('Not in edit mode');
            }
        });
        
        it('should reject without text element', async function() {
            tokenEditor.textElement = null;
            
            try {
                await tokenEditor.applyEdit();
                expect.fail('Should have thrown error');
            } catch (error) {
                expect(error.message).to.equal('Not in edit mode');
            }
        });
        
        it('should handle single token correctly', async function() {
            const singleToken = [mockTokens[0]];
            tokenEditor.selectedTokens = singleToken;
            tokenEditor.textElement.textContent = 'hi';
            
            const result = await tokenEditor.applyEdit();
            
            expect(result.startTokenIdx).to.equal(0);
            expect(result.endTokenIdx).to.equal(0);
        });
    });
    
    describe('Cancel Edit', function() {
        let mockTokens;
        
        beforeEach(function() {
            mockTokens = [
                { text: 'hello', token_idx: 0, start_time: 0.0, end_time: 0.5 },
                { text: 'world', token_idx: 1, start_time: 0.5, end_time: 1.0 }
            ];
            tokenEditor.startEdit(mockTokens);
        });
        
        it('should cancel edit and restore original text', function() {
            tokenEditor.textElement.textContent = 'modified text';
            
            const result = tokenEditor.cancelEdit();
            
            expect(result).to.be.true;
            expect(tokenEditor.isEditing).to.be.false;
            expect(tokenEditor.textElement.contentEditable).to.equal('false');
            expect(tokenEditor.textElement.textContent).to.equal('hello world');
        });
        
        it('should work when not in edit mode', function() {
            tokenEditor.isEditing = false;
            
            const result = tokenEditor.cancelEdit();
            expect(result).to.be.true;
        });
        
        it('should handle missing text element', function() {
            tokenEditor.textElement = null;
            
            const result = tokenEditor.cancelEdit();
            expect(result).to.be.true;
        });
    });
    
    describe('Event Handling', function() {
        let mockTokens;
        
        beforeEach(function() {
            mockTokens = [
                { text: 'hello', token_idx: 0, start_time: 0.0, end_time: 0.5 },
                { text: 'world', token_idx: 1, start_time: 0.5, end_time: 1.0 }
            ];
        });
        
        it('should handle apply button click during edit', async function() {
            tokenEditor.startEdit(mockTokens);
            tokenEditor.textElement.textContent = 'new text';
            
            const applyPromise = new Promise((resolve) => {
                tokenEditor.applyEdit = () => {
                    resolve('applied');
                    return Promise.resolve({ success: true });
                };
            });
            
            mockApplyBtn.click();
            
            const result = await applyPromise;
            expect(result).to.equal('applied');
        });
        
        it('should handle cancel button click during edit', function() {
            tokenEditor.startEdit(mockTokens);
            tokenEditor.textElement.textContent = 'modified text';
            
            mockCancelBtn.click();
            
            expect(tokenEditor.isEditing).to.be.false;
            expect(tokenEditor.textElement.textContent).to.equal('hello world');
        });
        
        it('should handle apply button click when not editing', async function() {
            const applySpy = sinon.spy(tokenEditor, 'applyEdit');
            
            mockApplyBtn.click();
            
            expect(applySpy.calledOnce).to.be.true;
            
            try {
                await applySpy.returnValues[0];
                expect.fail('Should have thrown error');
            } catch (error) {
                expect(error.message).to.equal('Not in edit mode');
            }
            
            applySpy.restore();
        });
    });
    
    describe('Edge Cases', function() {
        it('should handle very long text', function() {
            const longText = 'a'.repeat(10000);
            tokenEditor.setText(longText);
            
            expect(tokenEditor.getText()).to.equal(longText);
        });
        
        it('should handle special characters', function() {
            const specialText = 'Hello! @#$%^&*()_+ 日本語 émojis 🎵🎶';
            tokenEditor.setText(specialText);
            
            expect(tokenEditor.getText()).to.equal(specialText);
        });
        
        it('should handle HTML content safely', function() {
            const htmlText = '<script>alert("xss")</script>';
            tokenEditor.setText(htmlText);
            
            // textContent should escape HTML
            expect(tokenEditor.getText()).to.equal(htmlText);
            expect(tokenEditor.textElement.innerHTML).to.not.include('<script>');
        });
        
        it('should handle tokens with missing properties', function() {
            const incompleteTokens = [
                { text: 'hello' }, // Missing token_idx
                { token_idx: 1 }    // Missing text
            ];
            
            const result = tokenEditor.startEdit(incompleteTokens);
            expect(result).to.be.true;
            expect(tokenEditor.originalText).to.equal('hello ');
        });
    });
    
    describe('State Management', function() {
        it('should maintain state correctly through edit cycle', function() {
            const mockTokens = [
                { text: 'test', token_idx: 0, start_time: 0.0, end_time: 0.5 }
            ];
            
            // Initial state
            expect(tokenEditor.isEditing).to.be.false;
            
            // Start edit
            tokenEditor.startEdit(mockTokens);
            expect(tokenEditor.isEditing).to.be.true;
            expect(tokenEditor.selectedTokens).to.equal(mockTokens);
            
            // Cancel edit
            tokenEditor.cancelEdit();
            expect(tokenEditor.isEditing).to.be.false;
            
            // Start new edit
            tokenEditor.startEdit(mockTokens);
            expect(tokenEditor.isEditing).to.be.true;
        });
        
        it('should reset state properly on cancel', function() {
            const mockTokens = [
                { text: 'test', token_idx: 0, start_time: 0.0, end_time: 0.5 }
            ];
            
            tokenEditor.startEdit(mockTokens);
            tokenEditor.textElement.textContent = 'modified';
            
            tokenEditor.cancelEdit();
            
            expect(tokenEditor.isEditing).to.be.false;
            expect(tokenEditor.textElement.textContent).to.equal('test');
            expect(tokenEditor.textElement.contentEditable).to.equal('false');
        });
    });
});