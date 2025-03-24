/**
 * theme-controller.js
 * Handles theme switching functionality
 */

class ThemeController {
    constructor() {
        this.html = document.documentElement;
        this.themeToggle = document.getElementById('themeToggle');
        this.lightIcon = document.getElementById('lightIcon');
        this.darkIcon = document.getElementById('darkIcon');
        
        this.init();
    }
    
    init() {
        // Check saved theme or browser preference
        const savedTheme = localStorage.getItem('theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        
        if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
            this.setDarkTheme();
        }
        
        // Add event listener to the theme toggle button
        this.themeToggle.addEventListener('click', () => this.toggleTheme());
        
        // Listen for system theme changes
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
            if (!localStorage.getItem('theme')) {
                // Only auto-switch if user hasn't manually set a preference
                if (e.matches) {
                    this.setDarkTheme();
                } else {
                    this.setLightTheme();
                }
            }
        });
    }
    
    toggleTheme() {
        if (this.html.classList.contains('dark')) {
            this.setLightTheme();
        } else {
            this.setDarkTheme();
        }
    }
    
    setDarkTheme() {
        this.html.classList.add('dark');
        this.lightIcon.classList.remove('hidden');
        this.darkIcon.classList.add('hidden');
        localStorage.setItem('theme', 'dark');
    }
    
    setLightTheme() {
        this.html.classList.remove('dark');
        this.darkIcon.classList.remove('hidden');
        this.lightIcon.classList.add('hidden');
        localStorage.setItem('theme', 'light');
    }
}

// Initialize theme controller when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.themeController = new ThemeController();
});