/**
 * dropdown-handler.js
 * Enhanced dropdown functionality for both edit modes
 */

// Edit mode dropdown functionality
function initEditModeDropdowns() {
    // Initialize manual mode dropdown
    initDropdown('editModeSelector', 'manual');
    
    // Initialize prompt mode dropdown
    initDropdown('promptModeSelector', 'prompt');
    
    // Close all dropdowns when clicking outside
    document.addEventListener('click', () => {
        document.querySelectorAll('.mode-options').forEach(options => {
            options.classList.add('hidden');
        });
        document.querySelectorAll('.selected-mode').forEach(selected => {
            selected.classList.remove('active');
        });
    });
}

function initDropdown(dropdownId, defaultMode) {
    const modeSelector = document.getElementById(dropdownId);
    if (!modeSelector) return;
    
    const selectedMode = modeSelector.querySelector('.selected-mode');
    const modeOptions = modeSelector.querySelector('.mode-options');
    const modeOptionElements = modeSelector.querySelectorAll('.mode-option');
    
    // Toggle dropdown on click
    selectedMode.addEventListener('click', (e) => {
        e.stopPropagation();
        
        // Close all other dropdowns first
        document.querySelectorAll('.mode-options').forEach(options => {
            if (options !== modeOptions) {
                options.classList.add('hidden');
            }
        });
        document.querySelectorAll('.selected-mode').forEach(selected => {
            if (selected !== selectedMode) {
                selected.classList.remove('active');
            }
        });
        
        // Toggle this dropdown
        modeOptions.classList.toggle('hidden');
        selectedMode.classList.toggle('active');
    });
    
    // Prevent clicks inside dropdown from closing it
    modeOptions.addEventListener('click', (e) => {
        e.stopPropagation();
    });
    
    // Handle mode selection
    modeOptionElements.forEach(option => {
        option.addEventListener('click', () => {
            const mode = option.getAttribute('data-mode');
            const modeName = option.querySelector('.mode-name').textContent;
            
            // Update display text (shortened)
            const currentMode = selectedMode.querySelector('span');
            if (currentMode) {
                currentMode.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
            }
            
            // Hide dropdown
            modeOptions.classList.add('hidden');
            selectedMode.classList.remove('active');
            
            // Call the edit mode selector
            if (window.uiController && typeof window.uiController.selectEditMode === 'function') {
                window.uiController.selectEditMode(mode);
            } else if (window.voiceInpaintingApp && typeof window.voiceInpaintingApp.selectEditMode === 'function') {
                window.voiceInpaintingApp.selectEditMode(mode);
            }
        });
    });
}

// Sync the two dropdowns when edit mode changes
function syncEditModeDropdowns(mode) {
    // Update manual editor dropdown
    const manualDropdown = document.getElementById('editModeSelector');
    if (manualDropdown) {
        const manualModeText = manualDropdown.querySelector('span');
        if (manualModeText) {
            manualModeText.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
        }
    }
    
    // Update prompt editor dropdown
    const promptDropdown = document.getElementById('promptModeSelector');
    if (promptDropdown) {
        const promptModeText = promptDropdown.querySelector('span');
        if (promptModeText) {
            promptModeText.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
        }
    }
}

// Add uiController listener if available
document.addEventListener('DOMContentLoaded', () => {
    // Initialize dropdowns
    initEditModeDropdowns();
    
    // If uiController exists, hook into the edit mode selection
    if (window.uiController) {
        // We're going to extend the selectEditMode function
        const originalSelectEditMode = window.uiController.selectEditMode;
        
        if (typeof originalSelectEditMode === 'function') {
            window.uiController.selectEditMode = function(mode) {
                // Call the original function
                originalSelectEditMode.call(window.uiController, mode);
                
                // Update both dropdowns
                syncEditModeDropdowns(mode);
            };
        }
    }
});