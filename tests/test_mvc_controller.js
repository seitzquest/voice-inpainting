/**
 * Tests for MVC Controller functionality
 */

describe('MVCVoiceController', function() {
    let mvcController;
    let fetchStub;
    
    beforeEach(function() {
        mvcController = new MVCVoiceController();
        // Use the global mock fetch function
        fetchStub = sinon.stub(window, 'fetch').callsFake(window.fetch);
    });
    
    afterEach(function() {
        fetchStub.restore();
    });
    
    describe('Initialization', function() {
        it('should initialize with default state', function() {
            expect(mvcController.sessionId).to.be.null;
            expect(mvcController.currentState).to.be.null;
            expect(mvcController.apiBaseUrl).to.equal('/api/v2');
        });
    });
    
    describe('Session Management', function() {
        it('should create a new session successfully', async function() {
            const mockBlob = new Blob(['mock audio data'], { type: 'audio/wav' });
            
            const result = await mvcController.createSession(mockBlob, 'test.wav', 'cpu');
            
            expect(result.session_id).to.equal('test-session-123');
            expect(result.status).to.equal('created');
            expect(mvcController.sessionId).to.equal('test-session-123');
        });
        
        it('should handle session creation failure', async function() {
            fetchStub.restore();
            fetchStub = sinon.stub(window, 'fetch').resolves({
                ok: false,
                status: 500
            });
            
            const mockBlob = new Blob(['mock audio data'], { type: 'audio/wav' });
            
            try {
                await mvcController.createSession(mockBlob);
                expect.fail('Should have thrown error');
            } catch (error) {
                expect(error.message).to.include('Failed to create session');
            }
        });
        
        it('should get session state successfully', async function() {
            mvcController.sessionId = 'test-session-123';
            
            const state = await mvcController.getSessionState();
            
            expect(state.session_id).to.equal('test-session-123');
            expect(state.text).to.equal('hello world test');
            expect(state.tokens).to.be.an('array');
            expect(state.tokens).to.have.length(3);
            expect(mvcController.currentState).to.equal(state);
        });
        
        it('should fail to get state without active session', async function() {
            try {
                await mvcController.getSessionState();
                expect.fail('Should have thrown error');
            } catch (error) {
                expect(error.message).to.equal('No active session');
            }
        });
    });
    
    describe('Edit Operations', function() {
        beforeEach(function() {
            mvcController.sessionId = 'test-session-123';
        });
        
        it('should apply edit successfully', async function() {
            const result = await mvcController.applyEdit(1, 2, 'universe');
            
            expect(result.session_id).to.equal('test-session-123');
            expect(result.text).to.equal('hello universe test');
            expect(result.can_undo).to.be.true;
            expect(mvcController.currentState).to.equal(result);
        });
        
        it('should fail to apply edit without active session', async function() {
            mvcController.sessionId = null;
            
            try {
                await mvcController.applyEdit(1, 2, 'universe');
                expect.fail('Should have thrown error');
            } catch (error) {
                expect(error.message).to.equal('No active session');
            }
        });
        
        it('should handle edit operation failure', async function() {
            fetchStub.restore();
            fetchStub = sinon.stub(window, 'fetch').resolves({
                ok: false,
                status: 400
            });
            
            try {
                await mvcController.applyEdit(1, 2, 'universe');
                expect.fail('Should have thrown error');
            } catch (error) {
                expect(error.message).to.include('Failed to apply edit');
            }
        });
    });
    
    describe('Undo/Redo Operations', function() {
        beforeEach(function() {
            mvcController.sessionId = 'test-session-123';
        });
        
        it('should perform undo successfully', async function() {
            // Mock undo response
            fetchStub.restore();
            fetchStub = sinon.stub(window, 'fetch').resolves({
                ok: true,
                status: 200,
                json: () => Promise.resolve({
                    session_id: 'test-session-123',
                    text: 'hello world test',
                    can_undo: false,
                    can_redo: true,
                    current_version_index: 0
                })
            });
            
            const result = await mvcController.undo();
            
            expect(result.can_undo).to.be.false;
            expect(result.can_redo).to.be.true;
            expect(result.current_version_index).to.equal(0);
            expect(mvcController.currentState).to.equal(result);
        });
        
        it('should perform redo successfully', async function() {
            // Mock redo response
            fetchStub.restore();
            fetchStub = sinon.stub(window, 'fetch').resolves({
                ok: true,
                status: 200,
                json: () => Promise.resolve({
                    session_id: 'test-session-123',
                    text: 'hello universe test',
                    can_undo: true,
                    can_redo: false,
                    current_version_index: 1
                })
            });
            
            const result = await mvcController.redo();
            
            expect(result.can_undo).to.be.true;
            expect(result.can_redo).to.be.false;
            expect(result.current_version_index).to.equal(1);
            expect(mvcController.currentState).to.equal(result);
        });
        
        it('should fail undo without active session', async function() {
            mvcController.sessionId = null;
            
            try {
                await mvcController.undo();
                expect.fail('Should have thrown error');
            } catch (error) {
                expect(error.message).to.equal('No active session');
            }
        });
        
        it('should fail redo without active session', async function() {
            mvcController.sessionId = null;
            
            try {
                await mvcController.redo();
                expect.fail('Should have thrown error');
            } catch (error) {
                expect(error.message).to.equal('No active session');
            }
        });
        
        it('should handle undo failure', async function() {
            fetchStub.restore();
            fetchStub = sinon.stub(window, 'fetch').resolves({
                ok: false,
                status: 400
            });
            
            try {
                await mvcController.undo();
                expect.fail('Should have thrown error');
            } catch (error) {
                expect(error.message).to.include('Failed to undo');
            }
        });
        
        it('should handle redo failure', async function() {
            fetchStub.restore();
            fetchStub = sinon.stub(window, 'fetch').resolves({
                ok: false,
                status: 400
            });
            
            try {
                await mvcController.redo();
                expect.fail('Should have thrown error');
            } catch (error) {
                expect(error.message).to.include('Failed to redo');
            }
        });
    });
    
    describe('API Integration', function() {
        it('should make correct API calls for session creation', async function() {
            const mockBlob = new Blob(['mock audio data'], { type: 'audio/wav' });
            
            await mvcController.createSession(mockBlob, 'test.wav', 'cpu');
            
            expect(fetchStub.calledOnce).to.be.true;
            const [url, options] = fetchStub.firstCall.args;
            expect(url).to.equal('/api/v2/sessions');
            expect(options.method).to.equal('POST');
            expect(options.body).to.be.an.instanceof(FormData);
        });
        
        it('should make correct API calls for getting session state', async function() {
            mvcController.sessionId = 'test-session-123';
            
            await mvcController.getSessionState();
            
            expect(fetchStub.calledOnce).to.be.true;
            const [url, options] = fetchStub.firstCall.args;
            expect(url).to.equal('/api/v2/sessions/test-session-123/state');
            expect(options).to.be.undefined; // GET request has no options
        });
        
        it('should make correct API calls for applying edits', async function() {
            mvcController.sessionId = 'test-session-123';
            
            await mvcController.applyEdit(1, 2, 'universe');
            
            expect(fetchStub.calledOnce).to.be.true;
            const [url, options] = fetchStub.firstCall.args;
            expect(url).to.equal('/api/v2/sessions/test-session-123/edit');
            expect(options.method).to.equal('POST');
            expect(options.headers['Content-Type']).to.equal('application/json');
            
            const body = JSON.parse(options.body);
            expect(body.start_token_idx).to.equal(1);
            expect(body.end_token_idx).to.equal(2);
            expect(body.new_text).to.equal('universe');
        });
        
        it('should make correct API calls for undo', async function() {
            mvcController.sessionId = 'test-session-123';
            
            // Set up mock response for undo
            fetchStub.restore();
            fetchStub = sinon.stub(window, 'fetch').resolves({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ can_undo: false, can_redo: true })
            });
            
            await mvcController.undo();
            
            expect(fetchStub.calledOnce).to.be.true;
            const [url, options] = fetchStub.firstCall.args;
            expect(url).to.equal('/api/v2/sessions/test-session-123/undo');
            expect(options.method).to.equal('POST');
        });
        
        it('should make correct API calls for redo', async function() {
            mvcController.sessionId = 'test-session-123';
            
            // Set up mock response for redo
            fetchStub.restore();
            fetchStub = sinon.stub(window, 'fetch').resolves({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ can_undo: true, can_redo: false })
            });
            
            await mvcController.redo();
            
            expect(fetchStub.calledOnce).to.be.true;
            const [url, options] = fetchStub.firstCall.args;
            expect(url).to.equal('/api/v2/sessions/test-session-123/redo');
            expect(options.method).to.equal('POST');
        });
    });
    
    describe('Error Handling', function() {
        it('should handle network errors gracefully', async function() {
            fetchStub.restore();
            fetchStub = sinon.stub(window, 'fetch').rejects(new Error('Network error'));
            
            const mockBlob = new Blob(['mock audio data'], { type: 'audio/wav' });
            
            try {
                await mvcController.createSession(mockBlob);
                expect.fail('Should have thrown error');
            } catch (error) {
                expect(error.message).to.equal('Network error');
            }
        });
        
        it('should handle invalid JSON responses', async function() {
            fetchStub.restore();
            fetchStub = sinon.stub(window, 'fetch').resolves({
                ok: true,
                status: 200,
                json: () => Promise.reject(new Error('Invalid JSON'))
            });
            
            mvcController.sessionId = 'test-session-123';
            
            try {
                await mvcController.getSessionState();
                expect.fail('Should have thrown error');
            } catch (error) {
                expect(error.message).to.equal('Invalid JSON');
            }
        });
    });
});