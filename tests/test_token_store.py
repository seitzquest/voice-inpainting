"""
Tests for TokenStore functionality
"""

import pytest
import torch
import tempfile
import os
from unittest.mock import patch, Mock, MagicMock

from src.token_store import TokenStore, TokenStoreVersion, register_token_store, get_token_store_by_id, cleanup_token_store
from src.semantic_edit import EditOperation


class TestTokenStore:
    """Test TokenStore functionality"""
    
    def test_token_store_initialization(self, mock_tokenizer, mock_integrated_inpainting):
        """Test TokenStore initializes correctly"""
        token_store = TokenStore(device="cpu")
        
        assert token_store.device == "cpu"
        assert token_store.session_id is not None
        assert len(token_store.versions) == 0
        assert token_store.current_version_index == -1
        assert token_store.current_state is None
    
    def test_initialize_with_audio_file(self, mock_tokenizer, mock_integrated_inpainting, 
                                       mock_audio_file, mock_torchaudio, mock_tokenized_audio):
        """Test initializing TokenStore with audio file"""
        token_store = TokenStore(device="cpu")
        
        # Mock the tokenizer to return our mock data
        token_store.tokenizer.tokenize.return_value = mock_tokenized_audio
        
        result = token_store.initialize(mock_audio_file, speaker_id=0)
        
        assert result is not None
        assert token_store.current_state is not None
        assert token_store.original_state is not None
        assert len(token_store.versions) == 1
        assert token_store.current_version_index == 0
        assert token_store.versions[0].label == "Original"
    
    def test_initialize_from_blob(self, mock_tokenizer, mock_integrated_inpainting, 
                                 mock_audio_bytes, mock_torchaudio, mock_tokenized_audio):
        """Test initializing TokenStore from audio blob"""
        token_store = TokenStore(device="cpu")
        
        # Mock the tokenizer to return our mock data
        token_store.tokenizer.tokenize.return_value = mock_tokenized_audio
        
        result = token_store.initialize_from_blob(mock_audio_bytes, speaker_id=0)
        
        assert result is not None
        assert token_store.current_state is not None
        assert len(token_store.versions) == 1
    
    def test_apply_edit(self, mock_tokenizer, mock_integrated_inpainting, 
                       mock_audio_file, mock_torchaudio, mock_tokenized_audio):
        """Test applying a single edit"""
        token_store = TokenStore(device="cpu")
        token_store.tokenizer.tokenize.return_value = mock_tokenized_audio
        token_store.initialize(mock_audio_file)
        
        # Mock the inpainting result
        mock_audio = torch.randn(48000)
        mock_tokens = torch.randint(0, 1024, (32, 25))
        token_store.inpainting.inpaint.return_value = (mock_tokens, mock_audio, 24000)
        
        # Apply edit
        result = token_store.apply_edit(1, 2, "universe")
        
        assert result is not None
        assert len(token_store.versions) == 2  # Original + Edit
        assert token_store.current_version_index == 1
        assert "world → universe" in token_store.versions[1].edit_description
    
    def test_apply_multiple_edits(self, mock_tokenizer, mock_integrated_inpainting, 
                                 mock_audio_file, mock_torchaudio, mock_tokenized_audio):
        """Test applying multiple edits"""
        token_store = TokenStore(device="cpu")
        token_store.tokenizer.tokenize.return_value = mock_tokenized_audio
        token_store.initialize(mock_audio_file)
        
        # Mock the inpainting result
        mock_audio = torch.randn(48000)
        mock_tokens = torch.randint(0, 1024, (32, 25))
        token_store.inpainting.inpaint.return_value = (mock_tokens, mock_audio, 24000)
        
        # Apply multiple edits
        edit_operations = [
            {
                "original_text": "hello",
                "edited_text": "hi",
                "start_token_idx": 0,
                "end_token_idx": 1
            },
            {
                "original_text": "world",
                "edited_text": "universe",
                "start_token_idx": 1,
                "end_token_idx": 2
            }
        ]
        
        result = token_store.apply_edit_operations(edit_operations)
        
        assert result is not None
        assert len(token_store.versions) == 2  # Original + Multi-edit
        assert token_store.current_version_index == 1
        assert "Multi-edit" == token_store.versions[1].label
    
    def test_undo_redo_functionality(self, mock_tokenizer, mock_integrated_inpainting, 
                                    mock_audio_file, mock_torchaudio, mock_tokenized_audio):
        """Test undo and redo functionality"""
        token_store = TokenStore(device="cpu")
        token_store.tokenizer.tokenize.return_value = mock_tokenized_audio
        token_store.initialize(mock_audio_file)
        
        # Mock the inpainting result
        mock_audio = torch.randn(48000)
        mock_tokens = torch.randint(0, 1024, (32, 25))
        token_store.inpainting.inpaint.return_value = (mock_tokens, mock_audio, 24000)
        
        # Apply an edit
        token_store.apply_edit(1, 2, "universe")
        assert token_store.current_version_index == 1
        assert token_store.can_undo() == True
        assert token_store.can_redo() == False
        
        # Undo
        result = token_store.undo()
        assert result is not None
        assert token_store.current_version_index == 0
        assert token_store.can_undo() == False
        assert token_store.can_redo() == True
        
        # Redo
        result = token_store.redo()
        assert result is not None
        assert token_store.current_version_index == 1
        assert token_store.can_undo() == True
        assert token_store.can_redo() == False
    
    def test_undo_redo_bounds(self, mock_tokenizer, mock_integrated_inpainting, 
                             mock_audio_file, mock_torchaudio, mock_tokenized_audio):
        """Test undo/redo boundary conditions"""
        token_store = TokenStore(device="cpu")
        token_store.tokenizer.tokenize.return_value = mock_tokenized_audio
        token_store.initialize(mock_audio_file)
        
        # Try to undo when at beginning
        result = token_store.undo()
        assert result is None
        assert token_store.current_version_index == 0
        
        # Try to redo when at end
        result = token_store.redo()
        assert result is None
        assert token_store.current_version_index == 0
    
    def test_restore_version(self, mock_tokenizer, mock_integrated_inpainting, 
                            mock_audio_file, mock_torchaudio, mock_tokenized_audio):
        """Test restoring to a specific version"""
        token_store = TokenStore(device="cpu")
        token_store.tokenizer.tokenize.return_value = mock_tokenized_audio
        token_store.initialize(mock_audio_file)
        
        # Mock the inpainting result
        mock_audio = torch.randn(48000)
        mock_tokens = torch.randint(0, 1024, (32, 25))
        token_store.inpainting.inpaint.return_value = (mock_tokens, mock_audio, 24000)
        
        # Apply two edits
        token_store.apply_edit(1, 2, "universe")
        token_store.apply_edit(2, 3, "example")
        
        assert token_store.current_version_index == 2
        assert len(token_store.versions) == 3
        
        # Restore to version 1
        result = token_store.restore_version(version_index=1)
        assert result is not None
        assert token_store.current_version_index == 1
    
    def test_version_management(self, mock_tokenizer, mock_integrated_inpainting, 
                               mock_audio_file, mock_torchaudio, mock_tokenized_audio):
        """Test version management and history"""
        token_store = TokenStore(device="cpu")
        token_store.tokenizer.tokenize.return_value = mock_tokenized_audio
        token_store.initialize(mock_audio_file)
        
        # Mock the inpainting result
        mock_audio = torch.randn(48000)
        mock_tokens = torch.randint(0, 1024, (32, 25))
        token_store.inpainting.inpaint.return_value = (mock_tokens, mock_audio, 24000)
        
        # Apply edit, undo, then apply different edit
        token_store.apply_edit(1, 2, "universe")
        token_store.undo()
        token_store.apply_edit(1, 2, "cosmos")
        
        # Should have 2 versions: Original + New edit (universe version should be discarded)
        assert len(token_store.versions) == 2
        assert token_store.current_version_index == 1
        assert "cosmos" in token_store.versions[1].edit_description
    
    def test_get_text_for_token_range(self, mock_tokenizer, mock_integrated_inpainting, 
                                     mock_audio_file, mock_torchaudio, mock_tokenized_audio):
        """Test getting text for token range"""
        token_store = TokenStore(device="cpu")
        token_store.tokenizer.tokenize.return_value = mock_tokenized_audio
        token_store.initialize(mock_audio_file)
        
        # Test getting text for different ranges
        text = token_store._get_text_for_token_range(0, 1)
        assert text == "hello"
        
        text = token_store._get_text_for_token_range(1, 2)
        assert text == "world"
        
        text = token_store._get_text_for_token_range(0, 3)
        assert text == "hello world test"
    
    def test_session_management(self, mock_tokenizer, mock_integrated_inpainting):
        """Test session ID and management"""
        token_store = TokenStore(device="cpu")
        
        session_id = token_store.get_session_id()
        assert session_id is not None
        assert len(session_id) > 0
        
        # Test global registry
        register_token_store(token_store)
        retrieved = get_token_store_by_id(session_id)
        assert retrieved is token_store
        
        # Test cleanup
        cleanup_token_store(session_id)
        retrieved = get_token_store_by_id(session_id)
        assert retrieved is None
    
    def test_cleanup(self, mock_tokenizer, mock_integrated_inpainting, mock_memory_manager):
        """Test TokenStore cleanup"""
        token_store = TokenStore(device="cpu")
        
        # Mock cleanup methods
        token_store.tokenizer.cleanup = Mock()
        token_store.inpainting._unload_csm_model = Mock()
        
        token_store.cleanup()
        
        # Verify cleanup was called
        token_store.tokenizer.cleanup.assert_called_once()
        token_store.inpainting._unload_csm_model.assert_called_once()
        mock_memory_manager.clear_gpu_memory.assert_called()
    
    def test_to_dict_serialization(self, mock_tokenizer, mock_integrated_inpainting, 
                                  mock_audio_file, mock_torchaudio, mock_tokenized_audio):
        """Test converting TokenStore to dictionary"""
        token_store = TokenStore(device="cpu")
        token_store.tokenizer.tokenize.return_value = mock_tokenized_audio
        token_store.initialize(mock_audio_file)
        
        result = token_store.to_dict()
        
        assert isinstance(result, dict)
        assert "text" in result
        assert "tokens" in result
        assert "session_id" in result
        assert "current_version_index" in result
        assert "total_versions" in result
        assert "versions" in result
        
        assert result["text"] == "hello world test"
        assert result["session_id"] == token_store.get_session_id()
        assert result["total_versions"] == 1
        assert len(result["tokens"]) == 3


class TestTokenStoreVersion:
    """Test TokenStoreVersion data structure"""
    
    def test_version_creation(self, mock_tokenized_audio):
        """Test creating a TokenStoreVersion"""
        version = TokenStoreVersion(
            id="test-version",
            label="Test Version",
            timestamp=1640995200.0,
            token_data=mock_tokenized_audio,
            audio_path="/path/to/audio.wav",
            edit_description="Test edit",
            modified_token_indices=[1, 2],
            generated_regions=[{"start": 0.5, "end": 1.0}]
        )
        
        assert version.id == "test-version"
        assert version.label == "Test Version"
        assert version.timestamp == 1640995200.0
        assert version.token_data == mock_tokenized_audio
        assert version.audio_path == "/path/to/audio.wav"
        assert version.edit_description == "Test edit"
        assert version.modified_token_indices == [1, 2]
        assert len(version.generated_regions) == 1


class TestErrorHandling:
    """Test error handling in TokenStore"""
    
    def test_uninitialized_token_store(self, mock_tokenizer, mock_integrated_inpainting):
        """Test operations on uninitialized TokenStore"""
        token_store = TokenStore(device="cpu")
        
        with pytest.raises(ValueError, match="TokenStore not initialized"):
            token_store.apply_edit(0, 1, "test")
    
    def test_invalid_version_index(self, mock_tokenizer, mock_integrated_inpainting, 
                                  mock_audio_file, mock_torchaudio, mock_tokenized_audio):
        """Test invalid version index handling"""
        token_store = TokenStore(device="cpu")
        token_store.tokenizer.tokenize.return_value = mock_tokenized_audio
        token_store.initialize(mock_audio_file)
        
        with pytest.raises(ValueError, match="Version index .* out of range"):
            token_store.restore_version(version_index=10)
        
        with pytest.raises(ValueError, match="Version index .* out of range"):
            token_store.restore_version(version_index=-1)
    
    def test_invalid_version_id(self, mock_tokenizer, mock_integrated_inpainting, 
                               mock_audio_file, mock_torchaudio, mock_tokenized_audio):
        """Test invalid version ID handling"""
        token_store = TokenStore(device="cpu")
        token_store.tokenizer.tokenize.return_value = mock_tokenized_audio
        token_store.initialize(mock_audio_file)
        
        with pytest.raises(ValueError, match="Version ID .* not found"):
            token_store.restore_version(version_id="nonexistent")
    
    def test_inpainting_failure(self, mock_tokenizer, mock_integrated_inpainting, 
                               mock_audio_file, mock_torchaudio, mock_tokenized_audio):
        """Test handling of inpainting failures"""
        token_store = TokenStore(device="cpu")
        token_store.tokenizer.tokenize.return_value = mock_tokenized_audio
        token_store.initialize(mock_audio_file)
        
        # Mock inpainting failure
        token_store.inpainting.inpaint.side_effect = Exception("Inpainting failed")
        
        # Should return original audio/tokens on failure
        result = token_store.apply_edit(1, 2, "universe")
        assert result is not None  # Should not crash
    
    def test_aligned_sequence_failure(self, mock_tokenizer, mock_integrated_inpainting, 
                                     mock_audio_file, mock_torchaudio, mock_tokenized_audio):
        """Test handling of aligned sequence creation failure"""
        with patch('src.aligned_sequences.AlignedTokenSequence') as mock_aligned:
            mock_aligned.side_effect = Exception("Aligned sequence failed")
            
            token_store = TokenStore(device="cpu")
            token_store.tokenizer.tokenize.return_value = mock_tokenized_audio
            
            # Should still initialize but with warning
            result = token_store.initialize(mock_audio_file)
            assert result is not None
            assert token_store.current_aligned_sequence is None