/**
 * Improved theme-controller.js
 * Enhanced theme switching with local storage persistence and system preference detection
 */

class ThemeController {
    constructor() {
        this.html = document.documentElement;
        this.themeToggle = document.getElementById('themeToggle');
        this.lightIcon = document.getElementById('lightIcon');
        this.darkIcon = document.getElementById('darkIcon');
        
        // Event listeners
        this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        this.themeChangeListeners = [];
    }
    
    /**
     * Initialize theme controller
     */
    init() {
        // Ensure DOM elements exist
        if (!this.themeToggle || !this.lightIcon || !this.darkIcon) {
            console.warn('Theme toggle elements not found');
            return;
        }
        
        // Check saved theme or system preference
        const savedTheme = localStorage.getItem('theme');
        const prefersDark = this.mediaQuery.matches;
        
        if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
            this.setDarkTheme(false);
        } else {
            this.setLightTheme(false);
        }
        
        // Add toggle event listener
        this.themeToggle.addEventListener('click', () => this.toggleTheme());
        
        // Listen for system theme changes
        this.mediaQuery.addEventListener('change', e => {
            if (!localStorage.getItem('theme')) {
                // Only auto-switch if user hasn't set preference
                if (e.matches) {
                    this.setDarkTheme(false);
                } else {
                    this.setLightTheme(false);
                }
            }
        });
        
        // Initialize any custom theme elements (e.g., for components that need theme info)
        this.initializeThemeVars();
    }
    
    /**
     * Initialize CSS variables based on theme
     */
    initializeThemeVars() {
        // Update any theme-dependent variables
        this.updateThemeVars();
        
        // Add observer to keep vars updated on theme changes
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.attributeName === 'class' && 
                    (this.html.classList.contains('dark') || 
                     !this.html.classList.contains('dark'))) {
                    this.updateThemeVars();
                }
            });
        });
        
        observer.observe(this.html, { attributes: true });
    }
    
    /**
     * Update theme-dependent CSS variables
     */
    updateThemeVars() {
        // This method can be extended to update additional theme variables as needed
        const isDark = this.html.classList.contains('dark');
        
        // You could update custom properties here if needed
        // document.documentElement.style.setProperty('--custom-var', isDark ? 'darkValue' : 'lightValue');
        
        // Notify listeners of theme change
        this.notifyThemeChangeListeners(isDark);
    }
    
    /**
     * Toggle between light and dark themes
     */
    toggleTheme() {
        if (this.html.classList.contains('dark')) {
            this.setLightTheme();
        } else {
            this.setDarkTheme();
        }
    }
    
    /**
     * Set dark theme
     * @param {boolean} savePreference - Whether to save preference to localStorage
     */
    setDarkTheme(savePreference = true) {
        this.html.classList.add('dark');
        
        if (this.lightIcon && this.darkIcon) {
            this.lightIcon.classList.remove('hidden');
            this.darkIcon.classList.add('hidden');
        }
        
        if (savePreference) {
            localStorage.setItem('theme', 'dark');
        }
        
        // Update theme vars and notify listeners
        this.updateThemeVars();
    }
    
    /**
     * Set light theme
     * @param {boolean} savePreference - Whether to save preference to localStorage
     */
    setLightTheme(savePreference = true) {
        this.html.classList.remove('dark');
        
        if (this.lightIcon && this.darkIcon) {
            this.darkIcon.classList.remove('hidden');
            this.lightIcon.classList.add('hidden');
        }
        
        if (savePreference) {
            localStorage.setItem('theme', 'light');
        }
        
        // Update theme vars and notify listeners
        this.updateThemeVars();
    }
    
    /**
     * Check if dark mode is active
     * @returns {boolean} - True if dark mode is active
     */
    isDarkMode() {
        return this.html.classList.contains('dark');
    }
    
    /**
     * Add a listener for theme changes
     * @param {Function} listener - Callback function that receives isDark boolean
     * @returns {Function} - Unsubscribe function
     */
    addThemeChangeListener(listener) {
        if (typeof listener === 'function') {
            this.themeChangeListeners.push(listener);
            
            // Initialize with current theme
            listener(this.isDarkMode());
            
            // Return unsubscribe function
            return () => {
                this.themeChangeListeners = this.themeChangeListeners.filter(l => l !== listener);
            };
        }
        return () => {}; // Empty unsubscribe if not a function
    }
    
    /**
     * Notify all listeners of theme change
     * @param {boolean} isDark - Whether dark mode is active
     */
    notifyThemeChangeListeners(isDark) {
        this.themeChangeListeners.forEach(listener => {
            try {
                listener(isDark);
            } catch (error) {
                console.error('Error in theme change listener:', error);
            }
        });
    }
}

// Initialize theme controller when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const themeController = new ThemeController();
    themeController.init();
    
    // Make it globally available
    window.themeController = themeController;
});