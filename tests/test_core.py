"""
Core functionality tests without heavy dependencies
"""

import pytest
from unittest.mock import Mock, patch
import torch


def test_basic_imports():
    """Test that core modules can be imported"""
    try:
        from src.tokenization import TokenizedAudio
        from src.token_store import TokenStore, TokenStoreVersion
        from src.aligned_sequences import AlignedToken, AlignedTokenSequence
        assert True
    except ImportError as e:
        pytest.fail(f"Failed to import core modules: {e}")


def test_tokenized_audio_creation():
    """Test creating TokenizedAudio object directly"""
    from src.tokenization import TokenizedAudio
    
    # Create minimal valid TokenizedAudio
    audio = torch.randn(48000)  # 2 seconds at 24kHz
    rvq_tokens = torch.randint(0, 1024, (32, 25))
    
    word_timestamps = [
        {"text": "hello", "start": 0.0, "end": 0.5, "confidence": 0.95},
        {"text": "world", "start": 0.5, "end": 1.0, "confidence": 0.98},
    ]
    
    tokenized_audio = TokenizedAudio(
        audio=audio,
        sample_rate=24000,
        rvq_tokens=rvq_tokens,
        text="hello world",
        segments=[{"words": word_timestamps}],
        semantic_tokens=[100, 200],
        text_to_token_map={0: 0, 6: 1},
        token_to_text_map={0: 0, 1: 6},
        speaker_id=0,
        word_timestamps=word_timestamps,
        llama_tokens=[128000, 15339, 1917, 128001],
        semantic_to_rvq_map={0: 0, 1: 12}
    )
    
    assert tokenized_audio.text == "hello world"
    assert tokenized_audio.sample_rate == 24000
    assert tokenized_audio.speaker_id == 0
    assert len(tokenized_audio.word_timestamps) == 2
    assert tokenized_audio.rvq_tokens.shape == (32, 25)


def test_aligned_token_creation():
    """Test creating AlignedToken objects"""
    from src.aligned_sequences import AlignedToken
    
    token = AlignedToken(
        text_token_idx=0,
        rvq_token_idx=0,
        text="hello",
        rvq_tokens=torch.randint(0, 1024, (32, 5)),
        start_time=0.0,
        end_time=0.5,
        confidence=0.95
    )
    
    assert token.text == "hello"
    assert token.start_time == 0.0
    assert token.end_time == 0.5
    assert token.confidence == 0.95
    assert token.rvq_tokens.shape == (32, 5)


def test_aligned_sequence_creation():
    """Test creating AlignedTokenSequence"""
    from src.aligned_sequences import AlignedToken, AlignedTokenSequence
    
    tokens = [
        AlignedToken(
            text_token_idx=0,
            rvq_token_idx=0,
            text="hello",
            rvq_tokens=torch.randint(0, 1024, (32, 5)),
            start_time=0.0,
            end_time=0.5,
            confidence=0.95
        ),
        AlignedToken(
            text_token_idx=1,
            rvq_token_idx=5,
            text="world", 
            rvq_tokens=torch.randint(0, 1024, (32, 5)),
            start_time=0.5,
            end_time=1.0,
            confidence=0.98
        )
    ]
    
    # Need to mock TokenizedAudio for AlignedTokenSequence
    from src.tokenization import TokenizedAudio
    mock_tokenized_audio = TokenizedAudio(
        audio=torch.randn(24000),
        sample_rate=24000,
        rvq_tokens=torch.randint(0, 1024, (32, 25)),
        text="hello world",
        segments=[{"words": []}],
        semantic_tokens=[100, 200],
        text_to_token_map={0: 0, 6: 1},
        token_to_text_map={0: 0, 1: 6},
        speaker_id=0,
        word_timestamps=[],
        llama_tokens=[128000, 15339, 1917, 128001],
        semantic_to_rvq_map={0: 0, 1: 5}
    )
    
    sequence = AlignedTokenSequence(mock_tokenized_audio)
    
    assert sequence.tokenized_audio == mock_tokenized_audio
    assert sequence.tokens is not None


def test_token_store_version_creation():
    """Test creating TokenStoreVersion"""
    from src.token_store import TokenStoreVersion
    from src.tokenization import TokenizedAudio
    
    # Create mock tokenized audio
    audio = torch.randn(48000)
    rvq_tokens = torch.randint(0, 1024, (32, 25))
    word_timestamps = [{"text": "test", "start": 0.0, "end": 1.0}]
    
    tokenized_audio = TokenizedAudio(
        audio=audio,
        sample_rate=24000,
        rvq_tokens=rvq_tokens,
        text="test",
        segments=[{"words": word_timestamps}],
        semantic_tokens=[100],
        text_to_token_map={0: 0},
        token_to_text_map={0: 0},
        speaker_id=0,
        word_timestamps=word_timestamps,
        llama_tokens=[128000, 1296, 128001],
        semantic_to_rvq_map={0: 0}
    )
    
    version = TokenStoreVersion(
        id="test-version",
        label="Test Version",
        timestamp=1640995200.0,
        token_data=tokenized_audio,
        audio_path="/test/audio.wav",
        edit_description="Test edit",
        modified_token_indices=[0],
        generated_regions=[{"start": 0.0, "end": 1.0}]
    )
    
    assert version.id == "test-version"
    assert version.label == "Test Version"
    assert version.token_data == tokenized_audio
    assert version.edit_description == "Test edit"
    assert len(version.modified_token_indices) == 1


@patch('src.token_store.AudioTokenizer')
@patch('src.token_store.IntegratedVoiceInpainting')
def test_token_store_initialization(mock_inpainting, mock_tokenizer):
    """Test TokenStore initialization with mocked dependencies"""
    from src.token_store import TokenStore
    
    # Set up mocks
    mock_tokenizer_instance = Mock()
    mock_tokenizer.return_value = mock_tokenizer_instance
    
    mock_inpainting_instance = Mock()
    mock_inpainting.return_value = mock_inpainting_instance
    
    # Create TokenStore
    token_store = TokenStore(device="cpu")
    
    assert token_store.device == "cpu"
    assert token_store.session_id is not None
    assert len(token_store.versions) == 0
    assert token_store.current_version_index == -1
    assert token_store.current_state is None


def test_session_id_generation():
    """Test session ID generation using uuid"""
    import uuid
    
    # Test that we can generate UUIDs like the TokenStore does
    session_id = str(uuid.uuid4())
    
    assert isinstance(session_id, str)
    assert len(session_id) > 0
    assert '-' in session_id  # UUID format includes dashes
    
    # Generate multiple IDs to ensure they're unique
    ids = [str(uuid.uuid4()) for _ in range(10)]
    assert len(set(ids)) == 10  # All should be unique


def test_global_token_store_registry():
    """Test global token store registry functions"""
    from src.token_store import register_token_store, get_token_store_by_id, cleanup_token_store
    
    # Create mock token store
    mock_store = Mock()
    mock_store.get_session_id.return_value = "test-session-123"
    
    # Test registration
    register_token_store(mock_store)
    
    # Test retrieval
    retrieved = get_token_store_by_id("test-session-123")
    assert retrieved == mock_store
    
    # Test cleanup
    cleanup_token_store("test-session-123")
    retrieved_after_cleanup = get_token_store_by_id("test-session-123")
    assert retrieved_after_cleanup is None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])