# Voice Inpainting Test Suite

This directory contains comprehensive tests for the Voice Inpainting application, covering both backend and frontend functionality.

## Test Structure

### Backend Tests (Python)

#### Core Tests (`test_core.py`)
- Basic module imports and core functionality
- Data structure creation and validation
- No heavy dependencies (models) loaded

#### Tokenization Tests (`test_tokenization.py`)
- Audio tokenization functionality
- CrisperWhisper and Mimi integration (mocked)
- Audio loading and processing
- Memory management

#### Token Store Tests (`test_token_store.py`)
- TokenStore class functionality
- Version management and undo/redo
- Session management
- Audio state persistence

#### API Tests (`test_api_mvc.py`)
- FastAPI MVC endpoints
- Session creation and management
- Edit operations via REST API
- Error handling and validation

#### Configuration (`conftest.py`)
- Comprehensive mocking of heavy dependencies
- Test fixtures for audio files and mock data
- Automatic dependency injection

### Frontend Tests (JavaScript)

#### Test Runner (`test_frontend.html`)
- Browser-based test runner using Mocha + Chai
- Sinon for mocking and spying
- Tests can be run by opening the HTML file in a browser

#### Module Tests
- `test_ui_controller.js` - UI interaction and state management
- `test_mvc_controller.js` - MVC communication with backend
- `test_audio_processor.js` - Web Audio API integration
- `test_waveform_editor.js` - Waveform visualization and token selection
- `test_token_editor.js` - Text editing functionality
- `test_integration.js` - End-to-end workflow tests

#### Mock Modules (`test_modules.js`)
- Simplified versions of application modules for testing
- Mocked Web APIs (AudioContext, fetch)
- No external dependencies required

## Running Tests

### Backend Tests

```bash
# Run all backend tests
uv run python -m pytest tests/ -v

# Run specific test files
uv run python -m pytest tests/test_core.py -v
uv run python -m pytest tests/test_token_store.py -v
uv run python -m pytest tests/test_api_mvc.py -v

# Run with coverage (if coverage installed)
uv run python -m pytest tests/ --cov=src --cov-report=html

# Run only fast tests (exclude slow integration tests)
uv run python -m pytest tests/ -m "not slow" -v
```

### Frontend Tests

1. Open `tests/test_frontend.html` in a web browser
2. Tests will run automatically and display results
3. All tests should pass if the frontend modules are working correctly

### npm Scripts

Available via `package.json`:

```bash
# Run backend tests
npm run test
npm run test-backend

# Run integration tests only
npm run test-integration

# Watch mode for development
npm run test-watch
```

## Test Configuration

### pytest.ini
- Configures test discovery patterns
- Sets up markers for categorizing tests
- Filters warnings from dependencies

### Mocking Strategy

The test suite uses extensive mocking to avoid loading heavy ML models:

- **AudioTokenizer**: Mocked to return consistent test data
- **MimiTokenizer**: Mocked RVQ token encoding/decoding
- **CrisperWhisper**: Mocked transcription
- **IntegratedVoiceInpainting**: Mocked inpainting operations
- **MemoryManager**: Mocked GPU memory management

This allows tests to run quickly without requiring:
- GPU resources
- Large model downloads
- Actual audio processing

## Test Categories

### Unit Tests
- Test individual components in isolation
- Fast execution (< 1 second per test)
- Extensive mocking of dependencies

### Integration Tests
- Test component interactions
- API endpoint functionality
- Session management workflows

### Frontend Tests
- UI component behavior
- User interaction flows
- API communication
- Error handling

## Test Data

### Mock Audio Files
- Generated WAV files for testing
- Various durations and sample rates
- Automatic cleanup after tests

### Mock API Responses
- Consistent session and state data
- Error scenarios for robustness testing
- Device compatibility testing

## Coverage Goals

- **Core Logic**: 95%+ coverage
- **API Endpoints**: 100% coverage
- **Error Handling**: 90%+ coverage
- **Frontend Components**: 85%+ coverage

## Contributing

When adding new features:

1. **Add corresponding tests** for new functionality
2. **Update mocks** if new dependencies are introduced
3. **Follow naming conventions** (`test_*.py` for Python, `test_*.js` for JavaScript)
4. **Add appropriate markers** for test categorization
5. **Update this README** if new test patterns are introduced

## Troubleshooting

### Common Issues

1. **Import Errors**: Check that `src/` is in Python path (handled by conftest.py)
2. **Model Loading**: Ensure mocking is properly configured in conftest.py
3. **FastAPI Tests**: Verify httpx dependency is installed
4. **Frontend Tests**: Open developer tools to debug JavaScript issues

### Dependencies

Backend testing requires:
- pytest
- httpx (for FastAPI testing)
- torch/torchaudio (mocked but needed for imports)

Frontend testing requires:
- Modern web browser with JavaScript enabled
- No additional installations needed (CDN dependencies)

## Performance

### Test Execution Times

- Core tests: ~0.5 seconds
- Token store tests: ~3 seconds (with mocked models)
- API tests: ~1 second
- Full backend suite: ~5-10 seconds

### Optimization

Tests are optimized for speed through:
- Comprehensive mocking of slow operations
- Minimal file I/O with temporary files
- Parallel test execution support
- Selective test running with markers