"""
Pytest configuration and fixtures for voice inpainting tests
"""

import pytest
import tempfile
import wave
import os
import sys
from pathlib import Path
from unittest.mock import Mock, patch
import torch
import numpy as np

# Add src directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.tokenization import TokenizedAudio


@pytest.fixture
def mock_audio_file():
    """Create a temporary WAV file for testing"""
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
        # Create a simple WAV file
        with wave.open(tmp_file.name, 'wb') as wav_file:
            wav_file.setnchannels(1)  # Mono
            wav_file.setsampwidth(2)  # 16-bit
            wav_file.setframerate(16000)  # 16kHz
            # 2 seconds of silence with some variation
            duration = 2
            samples = np.sin(2 * np.pi * 440 * np.linspace(0, duration, duration * 16000)) * 0.1
            audio_data = (samples * 32767).astype(np.int16).tobytes()
            wav_file.writeframes(audio_data)
        
        yield tmp_file.name
        
        # Cleanup
        try:
            os.unlink(tmp_file.name)
        except FileNotFoundError:
            pass


@pytest.fixture
def mock_audio_bytes(mock_audio_file):
    """Get audio file as bytes"""
    with open(mock_audio_file, 'rb') as f:
        return f.read()


@pytest.fixture
def mock_tokenized_audio():
    """Create mock TokenizedAudio for testing"""
    # Create mock audio tensor (2 seconds at 24kHz)
    sample_rate = 24000
    duration = 2
    num_samples = sample_rate * duration
    audio = torch.randn(num_samples) * 0.1
    
    # Create mock RVQ tokens (32 codebooks, ~12.5Hz token rate)
    token_frames = int(duration * 12.5)  # ~25 frames for 2 seconds
    rvq_tokens = torch.randint(0, 1024, (32, token_frames))
    
    # Create mock word timestamps
    word_timestamps = [
        {"text": "hello", "start": 0.0, "end": 0.5, "confidence": 0.95},
        {"text": "world", "start": 0.5, "end": 1.0, "confidence": 0.98},
        {"text": "test", "start": 1.0, "end": 1.5, "confidence": 0.92},
    ]
    
    # Create semantic to RVQ mapping
    semantic_to_rvq_map = {0: 0, 1: 6, 2: 12}  # Map word indices to RVQ token indices
    
    # Create token mappings
    text_to_token_map = {0: 0, 5: 1, 11: 2}  # Character positions to token indices
    token_to_text_map = {0: 0, 1: 5, 2: 11}  # Token indices to character positions
    
    return TokenizedAudio(
        audio=audio,
        sample_rate=sample_rate,
        rvq_tokens=rvq_tokens,
        text="hello world test",
        segments=[{"words": word_timestamps}],
        semantic_tokens=[100, 200, 300],  # Mock semantic tokens
        text_to_token_map=text_to_token_map,
        token_to_text_map=token_to_text_map,
        speaker_id=0,
        word_timestamps=word_timestamps,
        llama_tokens=None,
        semantic_to_rvq_map=semantic_to_rvq_map
    )


@pytest.fixture
def mock_tokenizer():
    """Mock AudioTokenizer to avoid loading heavy models"""
    with patch('src.tokenization.AudioTokenizer') as mock_class:
        mock_instance = Mock()
        mock_class.return_value = mock_instance
        mock_instance.device = "cpu"
        mock_instance.sample_rate = 24000
        mock_instance.cleanup = Mock()
        
        # Mock the tokenize method to return appropriate data based on parameters
        def mock_tokenize(audio_path, speaker_id=0, semantic_only=False):
            # Create mock data based on parameters
            sample_rate = 24000
            duration = 2
            num_samples = sample_rate * duration
            audio = torch.randn(num_samples) * 0.1
            
            # RVQ tokens for non-semantic mode
            token_frames = int(duration * 12.5)
            rvq_tokens = torch.randint(0, 1024, (32, token_frames)) if not semantic_only else None
            
            word_timestamps = [
                {"text": "hello", "start": 0.0, "end": 0.5, "confidence": 0.95},
                {"text": "world", "start": 0.5, "end": 1.0, "confidence": 0.98},
                {"text": "test", "start": 1.0, "end": 1.5, "confidence": 0.92},
            ]
            
            # Different llama_tokens behavior for semantic_only
            llama_tokens = None if semantic_only else [128000, 58, 15, 60, 15339, 1917, 1296, 128001]
            
            from src.tokenization import TokenizedAudio
            return TokenizedAudio(
                audio=audio,
                sample_rate=sample_rate,
                rvq_tokens=rvq_tokens,
                text="hello world test",
                segments=[{"words": word_timestamps}],
                semantic_tokens=[100, 200, 300],
                text_to_token_map={0: 0, 5: 1, 11: 2},
                token_to_text_map={0: 0, 1: 5, 2: 11},
                speaker_id=speaker_id,
                word_timestamps=word_timestamps,
                llama_tokens=llama_tokens,
                semantic_to_rvq_map={0: 0, 1: 6, 2: 12}
            )
        
        mock_instance.tokenize.side_effect = mock_tokenize
        
        # Mock other methods
        mock_instance._load_llama3_tokenizer.return_value = Mock()
        mock_instance.create_semantic_to_rvq_mapping.return_value = {0: 0, 1: 6, 2: 12}
        
        yield mock_instance


@pytest.fixture
def mock_mimi_tokenizer():
    """Mock MimiTokenizer to avoid loading heavy models"""
    with patch('src.mimi_tokenizer.MimiTokenizer') as mock_class:
        mock_instance = Mock()
        mock_class.return_value = mock_instance
        
        mock_instance.sample_rate = 24000
        mock_instance.encode.return_value = torch.randint(0, 1024, (32, 25))
        mock_instance.decode.return_value = torch.randn(48000)  # 2 seconds at 24kHz
        
        yield mock_instance


@pytest.fixture
def mock_whisper_model():
    """Mock Whisper model to avoid loading heavy models"""
    with patch('src.tokenization.AutoModelForSpeechSeq2Seq') as mock_model, \
         patch('src.tokenization.AutoProcessor') as mock_processor, \
         patch('src.tokenization.pipeline') as mock_pipeline:
        
        # Mock pipeline output
        mock_pipeline_instance = Mock()
        mock_pipeline.return_value = mock_pipeline_instance
        mock_pipeline_instance.return_value = {
            "text": "hello world test",
            "chunks": [
                {"text": "hello", "timestamp": [0.0, 0.5]},
                {"text": "world", "timestamp": [0.5, 1.0]},
                {"text": "test", "timestamp": [1.0, 1.5]},
            ]
        }
        
        yield mock_pipeline_instance


@pytest.fixture
def mock_semantic_editor():
    """Mock SemanticEditor to avoid loading heavy models"""
    with patch('src.semantic_edit.SemanticEditor') as mock_class:
        mock_instance = Mock()
        mock_class.return_value = mock_instance
        
        # Mock edit operation
        from src.semantic_edit import EditOperation
        mock_edit_op = EditOperation(
            original_text="world",
            edited_text="universe",
            start_token_idx=1,
            end_token_idx=2,
            confidence=0.95
        )
        
        mock_instance.find_edit_region.return_value = mock_edit_op
        
        yield mock_instance


@pytest.fixture
def mock_integrated_inpainting():
    """Mock IntegratedVoiceInpainting to avoid loading heavy models"""
    with patch('src.integrated_inpainting.IntegratedVoiceInpainting') as mock_class:
        mock_instance = Mock()
        mock_class.return_value = mock_instance
        
        # Mock inpainting result
        mock_rvq_tokens = torch.randint(0, 1024, (32, 25))
        mock_audio = torch.randn(48000)  # 2 seconds at 24kHz
        
        mock_instance.inpaint.return_value = (mock_rvq_tokens, mock_audio, 24000)
        
        yield mock_instance


@pytest.fixture
def mock_memory_manager():
    """Mock MemoryManager to avoid GPU operations"""
    with patch('src.memory_manager.MemoryManager') as mock_class:
        mock_class.log_memory_stats = Mock()
        mock_class.clear_gpu_memory = Mock()
        yield mock_class


@pytest.fixture
def test_client():
    """Create a test client for FastAPI testing"""
    try:
        from fastapi.testclient import TestClient
        from main import app
        
        return TestClient(app)
    except ImportError as e:
        # Skip if imports fail during testing
        pytest.skip(f"TestClient dependencies not available: {e}")
        return None


@pytest.fixture(autouse=True)
def mock_heavy_dependencies():
    """Automatically mock all heavy dependencies for all tests"""
    with patch('src.tokenization.AudioTokenizer') as mock_tokenizer_class, \
         patch('src.mimi_tokenizer.MimiTokenizer') as mock_mimi_class, \
         patch('src.memory_manager.MemoryManager') as mock_memory_class, \
         patch('src.integrated_inpainting.IntegratedVoiceInpainting') as mock_inpainting_class, \
         patch('src.semantic_edit.SemanticEditor') as mock_semantic_class:
        
        # Set up memory manager mock
        mock_memory_class.log_memory_stats = Mock()
        mock_memory_class.clear_gpu_memory = Mock()
        
        # Set up basic return values to prevent attribute errors
        mock_tokenizer_instance = Mock()
        mock_tokenizer_instance.sample_rate = 24000
        mock_tokenizer_instance.device = "cpu"
        mock_tokenizer_instance.cleanup = Mock()
        mock_tokenizer_class.return_value = mock_tokenizer_instance
        
        mock_mimi_instance = Mock()
        mock_mimi_instance.sample_rate = 24000
        mock_mimi_class.return_value = mock_mimi_instance
        
        mock_inpainting_instance = Mock()
        mock_inpainting_class.return_value = mock_inpainting_instance
        
        mock_semantic_instance = Mock()
        mock_semantic_class.return_value = mock_semantic_instance
        
        yield {
            'tokenizer': mock_tokenizer_instance,
            'mimi': mock_mimi_instance,
            'memory': mock_memory_class,
            'inpainting': mock_inpainting_instance,
            'semantic': mock_semantic_instance
        }


@pytest.fixture
def mock_device_cpu():
    """Force CPU device for testing"""
    with patch('src.main.setup_device') as mock_setup:
        mock_setup.return_value = "cpu"
        yield mock_setup


class MockTorchAudio:
    """Mock torchaudio operations"""
    
    @staticmethod
    def load(path):
        # Return mock audio tensor and sample rate
        return torch.randn(32000), 16000  # 2 seconds at 16kHz
    
    @staticmethod
    def save(path, tensor, sample_rate):
        # Mock save operation
        pass


@pytest.fixture
def mock_torchaudio():
    """Mock torchaudio to avoid file I/O issues"""
    with patch('torchaudio.load', MockTorchAudio.load), \
         patch('torchaudio.save', MockTorchAudio.save), \
         patch('torchaudio.functional.resample') as mock_resample:
        
        mock_resample.return_value = torch.randn(48000)  # Resampled to 24kHz
        yield MockTorchAudio


# Test data constants
TEST_SESSION_ID = "test-session-123"
TEST_AUDIO_DURATION = 2.0
TEST_TEXT = "hello world test"
TEST_TOKENS = [
    {"token_idx": 0, "text": "hello", "start_time": 0.0, "end_time": 0.5, "confidence": 0.95},
    {"token_idx": 1, "text": "world", "start_time": 0.5, "end_time": 1.0, "confidence": 0.98},
    {"token_idx": 2, "text": "test", "start_time": 1.0, "end_time": 1.5, "confidence": 0.92},
]


@pytest.fixture
def mock_session_state():
    """Mock session state for API testing"""
    return {
        "session_id": TEST_SESSION_ID,
        "text": TEST_TEXT,
        "tokens": TEST_TOKENS,
        "versions": [
            {
                "id": "version-1",
                "label": "Original",
                "timestamp": 1640995200.0,
                "edit_description": "Original audio",
                "modified_token_indices": [],
                "generated_regions": [],
                "index": 0,
                "is_current": True
            }
        ],
        "current_version_index": 0,
        "can_undo": False,
        "can_redo": False,
        "session_info": {
            "session_id": TEST_SESSION_ID,
            "created_at": 1640995200.0,
            "last_accessed": 1640995200.0,
            "audio_duration": TEST_AUDIO_DURATION,
            "original_filename": "test.wav",
            "current_text": TEST_TEXT,
            "total_versions": 1,
            "current_version_index": 0
        },
        "audio_duration": TEST_AUDIO_DURATION,
        "sample_rate": 24000
    }