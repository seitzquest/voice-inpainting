# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Setup and Development
- `uv sync` - Install dependencies using uv package manager
- `uv run main.py` - Start the FastAPI uvicorn server on port 8000
- `uv run src/main.py --input <file> --output <file> --prompt "<text>"` - CLI voice inpainting

### Testing
- `uv run python -m pytest tests/` - Run test suite
- `uv run python tests/test_token_store.py` - Run specific test file

### Architecture Documentation
- `d2 --watch architecture_diagram.d2 architecture_diagram.svg` - Render architecture diagram

## Project Architecture

### Core Components

**Voice Inpainting Pipeline**: The main processing flow operates on RVQ (Residual Vector Quantization) tokens rather than word-level timestamps for higher fidelity edits:

1. **AudioTokenizer** (`src/tokenization.py`): Converts audio to semantic and acoustic tokens using Mimi RVQ and Whisper
2. **TokenStore** (`src/token_store.py`): Manages versioned audio state with edit operations and undo/redo functionality  
3. **SemanticEditor** (`src/semantic_edit.py`): Uses LLaMA 3 to automatically identify edit regions from natural language prompts
4. **IntegratedVoiceInpainting** (`src/integrated_inpainting.py`): Generates new audio using Sesame CSM while preserving voice characteristics
5. **SessionManager** (`src/session_manager.py`): Manages sessions following MVC principles with backend as single source of truth
6. **AlignedTokenSequence** (`src/aligned_sequences.py`): Consistent abstraction for temporally aligned text tokens, RVQ tokens, and audio

### Key Technical Details

**MVC Architecture**: Follows Model-View-Controller pattern where backend maintains single source of truth:
- **Model/Controller**: TokenStore and SessionManager manage all state
- **View**: Frontend is stateless, only displays what backend provides
- **APIs**: RESTful v2 endpoints at `/api/v2/` for session-based operations

**Token-Level Processing**: Works directly with acoustic tokens (RVQ) instead of word-timestamps for seamless audio transitions and voice preservation.

**Aligned Token Sequences**: Three types of temporally aligned information:
- Text tokens (from transcription) 
- RVQ tokens (acoustic tokens)
- WAV audio subsequences
All maintained in consistent alignment through `AlignedTokenSequence` abstraction.

**Memory Management**: `MemoryManager` (`src/memory_manager.py`) provides GPU memory tracking and cleanup to handle large models efficiently.

**Versioning System**: Linear undo/redo history like text editors:
- Each edit creates new version
- Can navigate through version history
- Editing from past version discards future versions

**Frontend-Backend Integration**: 
- Legacy API (`/api/`) for backwards compatibility
- New MVC API (`/api/v2/`) with session-based state management
- Static frontend (`static/`) with both legacy and MVC controllers
- Session-based file management with automatic cleanup

**Model Dependencies**:
- Mimi tokenizer for RVQ token extraction
- Whisper (CrisperWhisper fork) for speech-to-text with timestamps  
- LLaMA 3 8B Instruct for semantic understanding
- Sesame CSM 1B for voice generation

## API Usage

### Legacy API (Backwards Compatible)
```bash
POST /api/process           # Single edit with audio file
POST /api/process-multi     # Multiple edits
POST /api/tokenize         # Tokenize audio only
```

### New MVC API (Recommended)
```bash
POST /api/v2/sessions                    # Create session
GET /api/v2/sessions/{id}/state          # Get current state
POST /api/v2/sessions/{id}/edit          # Apply single edit
POST /api/v2/sessions/{id}/multi-edit    # Apply multiple edits
POST /api/v2/sessions/{id}/undo          # Undo last edit
POST /api/v2/sessions/{id}/redo          # Redo next edit
GET /api/v2/sessions/{id}/audio          # Get current audio
DELETE /api/v2/sessions/{id}             # Delete session
```

### Development Notes

**Environment Setup**: Requires HuggingFace access to LLaMA 3 8B Instruct and CSM 1B models. Set `HF_TOKEN` environment variable.

**Platform Compatibility**: 
- CUDA support for GPU acceleration on Linux/Windows
- MLX support for Apple Silicon via `moshi-mlx` 
- CPU fallback for compatibility

**MVC Frontend Demo**: Visit `http://localhost:8000/mvc-demo.html` to see the new stateless frontend architecture.

**Debug Mode**: Enable with `debug=True` to save intermediate files showing tokenization, edit regions, and generation steps.

**Session Management**: Sessions automatically expire after 24 hours. Use `/api/v2/maintenance/cleanup` to manually clean up expired sessions.