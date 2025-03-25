/**
 * button-initializer.js
 * Initializes all play/pause buttons with the proper classes on page load
 */

document.addEventListener('DOMContentLoaded', () => {
    // Initialize the pause recording button (initially in pause state)
    const pauseRecordingBtn = document.getElementById('pauseRecordingBtn');
    if (pauseRecordingBtn) {
        // Remove old classes and inline styles
        pauseRecordingBtn.classList.remove('toggle-btn');
        pauseRecordingBtn.className = 'control-btn pause-btn';
        pauseRecordingBtn.removeAttribute('style');
    }
    
    // Initialize the play recording button (initially in play state)
    const playRecordingBtn = document.getElementById('playRecordingBtn');
    if (playRecordingBtn) {
        playRecordingBtn.classList.remove('toggle-btn');
        playRecordingBtn.classList.remove('play');
        playRecordingBtn.className = 'control-btn play-btn';
        playRecordingBtn.removeAttribute('style');
    }
});