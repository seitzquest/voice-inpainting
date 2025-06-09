# MVC Architecture Migration Guide

This document explains the transition from the old decoupled architecture to the new MVC architecture for the voice inpainting editor.

## Overview

The refactored application now follows proper MVC (Model-View-Controller) principles where:
- **Backend (Model + Controller)**: Single source of truth for all state
- **Frontend (View)**: Stateless display layer that only shows what backend tells it

## Key Changes

### 1. Single Source of Truth

**Before**: Frontend and backend maintained separate state
```javascript
// Old approach - frontend had its own state
this.currentText = "...";
this.tokens = [...];
this.versions = [...];
```

**After**: Backend is the only source of truth
```javascript
// New approach - frontend queries backend for current state
const state = await fetch('/api/v2/sessions/{id}/state').then(r => r.json());
this.updateUI(state); // Replace entire UI state
```

### 2. State Management

**Before**: 
- Frontend managed its own transcription and token state
- Inconsistencies between frontend and backend
- Unnecessary retokenization on each edit

**After**:
- TokenStore in backend maintains all state with versioning
- Frontend always refreshes from backend after operations
- Deterministic token changes - only edit regions are modified

### 3. API Design

**Before**: Stateless endpoints that returned processed audio
```javascript
POST /api/process        // Process and return audio file
POST /api/process-multi  // Process multiple edits
```

**After**: Stateful session-based endpoints following REST principles
```javascript
POST /api/v2/sessions                    // Create session
GET /api/v2/sessions/{id}/state          // Get current state
POST /api/v2/sessions/{id}/edit          // Apply edit
POST /api/v2/sessions/{id}/undo          // Undo last edit
POST /api/v2/sessions/{id}/redo          // Redo next edit
```

### 4. Version Control

**Before**: Limited or no version history

**After**: Full undo/redo system with linear history
- Each edit creates a new version
- Can undo/redo through version history
- Editing from past version discards future versions (like text editors)

## File Structure

### New Files Added

```
src/
├── session_manager.py     # Manages sessions with MVC principles
├── api_mvc.py            # New MVC API endpoints
└── token_store.py        # Enhanced with undo/redo methods

static/
├── js/mvc-controller.js  # Stateless frontend controller
└── mvc-demo.html         # Demo page showing MVC approach
```

### Enhanced Files

```
main.py                   # Includes new MVC router
src/token_store.py        # Added undo/redo functionality
```

## Usage Examples

### Creating a Session (New Approach)

```javascript
// Upload audio and create session
const formData = new FormData();
formData.append('audio', audioFile);

const response = await fetch('/api/v2/sessions', {
    method: 'POST',
    body: formData
});

const result = await response.json();
const sessionId = result.session_id;
```

### Applying Edits (New Approach)

```javascript
// Apply edit and get updated state
const response = await fetch(`/api/v2/sessions/${sessionId}/edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        start_token_idx: 5,
        end_token_idx: 10,
        new_text: "edited text"
    })
});

// Backend returns complete updated state
const updatedState = await response.json();

// Frontend replaces entire state with backend response
this.updateUI(updatedState);
```

### Undo/Redo (New Feature)

```javascript
// Undo last edit
const response = await fetch(`/api/v2/sessions/${sessionId}/undo`, {
    method: 'POST'
});

const updatedState = await response.json();
this.updateUI(updatedState);
```

## Migration Benefits

1. **Consistency**: No more state inconsistencies between frontend and backend
2. **Reliability**: Backend is always the source of truth
3. **Undo/Redo**: Full version history with linear undo/redo
4. **Performance**: No unnecessary retokenization
5. **Maintainability**: Clear separation of concerns
6. **Scalability**: Session-based architecture supports multiple concurrent users

## Testing the New Architecture

1. Start the server: `uv run main.py`
2. Open the MVC demo: `http://localhost:8000/mvc-demo.html`
3. Upload an audio file to create a session
4. Observe how all state comes from the backend
5. Test undo/redo functionality

## Compatibility

- Old API endpoints (`/api/process`, `/api/tokenize`) are still available for backwards compatibility
- New MVC endpoints are under `/api/v2/` prefix
- Both approaches can be used simultaneously during transition

## Best Practices for MVC Frontend

1. **Never store state locally** - always query backend
2. **Replace entire UI state** after each operation
3. **Use loading indicators** during backend operations
4. **Handle errors gracefully** and always refresh state on recovery
5. **Implement optimistic UI updates** only if you refresh from backend immediately after

## Token-Level Editing

The new architecture maintains consistent abstraction for aligned token sequences:
- Text tokens (from transcription)
- RVQ tokens (acoustic tokens)
- WAV audio subsequences
- All three remain temporally aligned through TokenStore

This enables precise voice inpainting where only the edited region is regenerated while preserving the original audio characteristics.