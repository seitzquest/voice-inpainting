/**
 * Tests for Audio Processor functionality
 */

describe('AudioProcessor', function() {
    let audioProcessor;
    
    beforeEach(function() {
        audioProcessor = new AudioProcessor();
    });
    
    afterEach(function() {
        if (audioProcessor) {
            audioProcessor.stop();
        }
    });
    
    describe('Initialization', function() {
        it('should initialize with AudioContext', function() {
            expect(audioProcessor.audioContext).to.not.be.null;
            expect(audioProcessor.gainNode).to.not.be.null;
            expect(audioProcessor.currentBuffer).to.be.null;
            expect(audioProcessor.currentSource).to.be.null;
            expect(audioProcessor.isPlaying).to.be.false;
        });
        
        it('should connect gain node to destination', function() {
            // This is mocked, but we can verify the structure exists
            expect(audioProcessor.gainNode.connect).to.be.a('function');
            expect(audioProcessor.audioContext.destination).to.not.be.null;
        });
    });
    
    describe('Audio Loading', function() {
        it('should load audio from blob', async function() {
            const mockBlob = new Blob(['mock audio data'], { type: 'audio/wav' });
            
            const buffer = await audioProcessor.loadAudioFromBlob(mockBlob);
            
            expect(buffer).to.not.be.null;
            expect(audioProcessor.currentBuffer).to.equal(buffer);
            expect(buffer.length).to.be.a('number');
            expect(buffer.sampleRate).to.be.a('number');
        });
        
        it('should load audio from URL', async function() {
            // Mock successful fetch
            const originalFetch = window.fetch;
            window.fetch = sinon.stub().resolves({
                arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024))
            });
            
            try {
                const buffer = await audioProcessor.loadAudioFromUrl('/test/audio.wav');
                
                expect(buffer).to.not.be.null;
                expect(audioProcessor.currentBuffer).to.equal(buffer);
            } finally {
                window.fetch = originalFetch;
            }
        });
        
        it('should handle loading errors', async function() {
            const originalFetch = window.fetch;
            window.fetch = sinon.stub().rejects(new Error('Failed to fetch'));
            
            try {
                await audioProcessor.loadAudioFromUrl('/nonexistent.wav');
                expect.fail('Should have thrown error');
            } catch (error) {
                expect(error.message).to.equal('Failed to fetch');
            } finally {
                window.fetch = originalFetch;
            }
        });
    });
    
    describe('Playback Control', function() {
        beforeEach(async function() {
            // Load a mock audio buffer
            const mockBlob = new Blob(['mock audio data'], { type: 'audio/wav' });
            await audioProcessor.loadAudioFromBlob(mockBlob);
        });
        
        it('should start playback', function() {
            const result = audioProcessor.play();
            
            expect(result).to.be.true;
            expect(audioProcessor.isPlaying).to.be.true;
            expect(audioProcessor.currentSource).to.not.be.null;
        });
        
        it('should start playback from specific time', function() {
            const startTime = 10;
            const result = audioProcessor.play(startTime);
            
            expect(result).to.be.true;
            expect(audioProcessor.isPlaying).to.be.true;
        });
        
        it('should pause playback', function() {
            audioProcessor.play();
            const result = audioProcessor.pause();
            
            expect(result).to.be.true;
            expect(audioProcessor.isPlaying).to.be.false;
        });
        
        it('should stop playback', function() {
            audioProcessor.play();
            const result = audioProcessor.stop();
            
            expect(result).to.be.true;
            expect(audioProcessor.isPlaying).to.be.false;
            expect(audioProcessor.currentSource).to.be.null;
            expect(audioProcessor.startTime).to.equal(0);
            expect(audioProcessor.pauseTime).to.equal(0);
        });
        
        it('should fail to play without loaded buffer', function() {
            audioProcessor.currentBuffer = null;
            
            expect(() => audioProcessor.play()).to.throw('No audio buffer loaded');
        });
        
        it('should stop existing source when starting new playback', function() {
            audioProcessor.play();
            const firstSource = audioProcessor.currentSource;
            const stopSpy = sinon.spy(firstSource, 'stop');
            
            audioProcessor.play();
            
            expect(stopSpy.calledOnce).to.be.true;
            expect(audioProcessor.currentSource).to.not.equal(firstSource);
        });
    });
    
    describe('Volume Control', function() {
        it('should set volume within valid range', function() {
            let result = audioProcessor.setVolume(0.8);
            expect(result).to.equal(0.8);
            expect(audioProcessor.gainNode.gain.value).to.equal(0.8);
            
            // Test boundary conditions
            result = audioProcessor.setVolume(-0.1);
            expect(result).to.equal(0);
            expect(audioProcessor.gainNode.gain.value).to.equal(0);
            
            result = audioProcessor.setVolume(1.5);
            expect(result).to.equal(1);
            expect(audioProcessor.gainNode.gain.value).to.equal(1);
        });
        
        it('should maintain volume settings', function() {
            audioProcessor.setVolume(0.3);
            expect(audioProcessor.gainNode.gain.value).to.equal(0.3);
            
            audioProcessor.setVolume(0.9);
            expect(audioProcessor.gainNode.gain.value).to.equal(0.9);
        });
    });
    
    describe('Time Tracking', function() {
        beforeEach(async function() {
            const mockBlob = new Blob(['mock audio data'], { type: 'audio/wav' });
            await audioProcessor.loadAudioFromBlob(mockBlob);
        });
        
        it('should track current time during playback', function() {
            audioProcessor.play();
            
            // Mock AudioContext currentTime
            audioProcessor.audioContext.currentTime = 5;
            audioProcessor.startTime = 2;
            
            const currentTime = audioProcessor.getCurrentTime();
            expect(currentTime).to.equal(3); // 5 - 2
        });
        
        it('should return pause time when not playing', function() {
            audioProcessor.pauseTime = 10;
            audioProcessor.isPlaying = false;
            
            const currentTime = audioProcessor.getCurrentTime();
            expect(currentTime).to.equal(10);
        });
        
        it('should calculate audio duration', function() {
            const duration = audioProcessor.getDuration();
            
            expect(duration).to.be.a('number');
            expect(duration).to.be.greaterThan(0);
        });
        
        it('should return 0 duration when no buffer loaded', function() {
            audioProcessor.currentBuffer = null;
            
            const duration = audioProcessor.getDuration();
            expect(duration).to.equal(0);
        });
    });
    
    describe('State Management', function() {
        beforeEach(async function() {
            const mockBlob = new Blob(['mock audio data'], { type: 'audio/wav' });
            await audioProcessor.loadAudioFromBlob(mockBlob);
        });
        
        it('should manage playing state correctly', function() {
            expect(audioProcessor.isPlaying).to.be.false;
            
            audioProcessor.play();
            expect(audioProcessor.isPlaying).to.be.true;
            
            audioProcessor.pause();
            expect(audioProcessor.isPlaying).to.be.false;
            
            audioProcessor.play();
            expect(audioProcessor.isPlaying).to.be.true;
            
            audioProcessor.stop();
            expect(audioProcessor.isPlaying).to.be.false;
        });
        
        it('should reset time tracking on stop', function() {
            audioProcessor.play();
            audioProcessor.startTime = 5;
            audioProcessor.pauseTime = 3;
            
            audioProcessor.stop();
            
            expect(audioProcessor.startTime).to.equal(0);
            expect(audioProcessor.pauseTime).to.equal(0);
        });
    });
    
    describe('Error Handling', function() {
        it('should handle malformed audio data', async function() {
            const mockBlob = new Blob(['invalid audio data'], { type: 'audio/wav' });
            
            // Mock AudioContext.decodeAudioData to reject
            const originalDecodeAudioData = audioProcessor.audioContext.decodeAudioData;
            audioProcessor.audioContext.decodeAudioData = sinon.stub().rejects(new Error('Invalid audio format'));
            
            try {
                await audioProcessor.loadAudioFromBlob(mockBlob);
                expect.fail('Should have thrown error');
            } catch (error) {
                expect(error.message).to.equal('Invalid audio format');
            } finally {
                audioProcessor.audioContext.decodeAudioData = originalDecodeAudioData;
            }
        });
        
        it('should handle pause when not playing', function() {
            audioProcessor.isPlaying = false;
            audioProcessor.currentSource = null;
            
            const result = audioProcessor.pause();
            expect(result).to.be.true; // Should not throw error
        });
        
        it('should handle stop when already stopped', function() {
            audioProcessor.currentSource = null;
            audioProcessor.isPlaying = false;
            
            const result = audioProcessor.stop();
            expect(result).to.be.true; // Should not throw error
        });
    });
});