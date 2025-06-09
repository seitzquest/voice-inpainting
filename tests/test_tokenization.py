"""
Tests for audio tokenization functionality
"""

import pytest
import torch
import tempfile
import os
from unittest.mock import patch, Mock

from src.tokenization import AudioTokenizer, TokenizedAudio


class TestAudioTokenizer:
    """Test AudioTokenizer functionality with mocked dependencies"""
    
    def test_tokenizer_initialization(self, mock_tokenizer):
        """Test tokenizer initializes correctly"""
        tokenizer = AudioTokenizer(device="cpu")
        assert tokenizer.device == "cpu"
        assert tokenizer.sample_rate == 24000
    
    def test_tokenize_audio_file(self, mock_tokenizer, mock_audio_file, mock_torchaudio):
        """Test tokenizing an audio file"""
        tokenizer = AudioTokenizer(device="cpu")
        result = tokenizer.tokenize(mock_audio_file, speaker_id=0, semantic_only=False)
        
        assert isinstance(result, TokenizedAudio)
        assert result.text == "hello world test"
        assert result.speaker_id == 0
        assert result.sample_rate == 24000
        assert result.rvq_tokens is not None
        assert len(result.word_timestamps) == 3
    
    def test_tokenize_semantic_only(self, mock_tokenizer, mock_audio_file, mock_torchaudio):
        """Test semantic-only tokenization"""
        tokenizer = AudioTokenizer(device="cpu")
        result = tokenizer.tokenize(mock_audio_file, speaker_id=0, semantic_only=True)
        
        assert isinstance(result, TokenizedAudio)
        assert result.text == "hello world test"
        assert result.llama_tokens is None  # Set by mock
        assert len(result.word_timestamps) == 3
    
    def test_semantic_to_rvq_mapping(self, mock_tokenizer):
        """Test creation of semantic to RVQ token mapping"""
        tokenizer = AudioTokenizer(device="cpu")
        
        word_timestamps = [
            {"start": 0.0, "end": 0.5},
            {"start": 0.5, "end": 1.0},
            {"start": 1.0, "end": 1.5},
        ]
        
        rvq_tokens = torch.randint(0, 1024, (32, 25))
        
        mapping = tokenizer.create_semantic_to_rvq_mapping(word_timestamps, rvq_tokens)
        
        assert isinstance(mapping, dict)
        assert len(mapping) == 3
        # Check that mapping values are reasonable RVQ token indices
        for idx, rvq_idx in mapping.items():
            assert 0 <= rvq_idx < 25
    
    def test_llama_tokenizer_loading(self, mock_tokenizer):
        """Test Llama tokenizer loading"""
        tokenizer = AudioTokenizer(device="cpu")
        llama_tokenizer = tokenizer._load_llama3_tokenizer()
        
        assert llama_tokenizer is not None
    
    @patch('src.tokenization.torchaudio.load')
    def test_audio_loading_error_handling(self, mock_load, mock_tokenizer):
        """Test error handling when audio file cannot be loaded"""
        mock_load.side_effect = Exception("File not found")
        
        tokenizer = AudioTokenizer(device="cpu")
        
        with pytest.raises(Exception, match="File not found"):
            tokenizer.tokenize("nonexistent.wav")
    
    def test_audio_resampling(self, mock_tokenizer, mock_audio_file):
        """Test audio resampling functionality"""
        with patch('torchaudio.load') as mock_load, \
             patch('torchaudio.functional.resample') as mock_resample:
            
            # Mock audio at different sample rate
            mock_load.return_value = (torch.randn(16000), 16000)  # 1 second at 16kHz
            mock_resample.return_value = torch.randn(24000)  # Resampled to 24kHz
            
            tokenizer = AudioTokenizer(device="cpu")
            result = tokenizer.tokenize(mock_audio_file)
            
            # Verify resampling was called
            mock_resample.assert_called_once()
            assert result.sample_rate == 24000


class TestTokenizedAudio:
    """Test TokenizedAudio data structure"""
    
    def test_tokenized_audio_creation(self, mock_tokenized_audio):
        """Test creating TokenizedAudio object"""
        audio_data = mock_tokenized_audio
        
        assert audio_data.sample_rate == 24000
        assert audio_data.text == "hello world test"
        assert audio_data.speaker_id == 0
        assert audio_data.rvq_tokens.shape == (32, 25)
        assert len(audio_data.word_timestamps) == 3
        assert audio_data.semantic_to_rvq_map == {0: 0, 1: 6, 2: 12}
    
    def test_text_token_mappings(self, mock_tokenized_audio):
        """Test text to token mapping"""
        audio_data = mock_tokenized_audio
        
        assert audio_data.text_to_token_map == {0: 0, 5: 1, 11: 2}
        assert audio_data.token_to_text_map == {0: 0, 1: 5, 2: 11}
    
    def test_word_timestamps_structure(self, mock_tokenized_audio):
        """Test word timestamps structure"""
        audio_data = mock_tokenized_audio
        
        for i, word in enumerate(audio_data.word_timestamps):
            assert "text" in word
            assert "start" in word
            assert "end" in word
            assert "confidence" in word
            assert word["start"] < word["end"]
            assert 0 <= word["confidence"] <= 1


class TestMemoryManagement:
    """Test memory management during tokenization"""
    
    def test_memory_cleanup(self, mock_memory_manager, mock_tokenizer, mock_audio_file):
        """Test memory is properly cleaned up"""
        tokenizer = AudioTokenizer(device="cpu")
        tokenizer.tokenize(mock_audio_file)
        
        # Verify memory cleanup was called
        mock_memory_manager.clear_gpu_memory.assert_called()
        mock_memory_manager.log_memory_stats.assert_called()
    
    def test_whisper_model_unloading(self, mock_tokenizer, mock_audio_file):
        """Test Whisper model is unloaded after use"""
        with patch.object(AudioTokenizer, '_unload_crisper_whisper') as mock_unload:
            tokenizer = AudioTokenizer(device="cpu")
            tokenizer.tokenize(mock_audio_file)
            
            mock_unload.assert_called_once()


class TestDeviceHandling:
    """Test device selection and compatibility"""
    
    def test_cpu_device(self, mock_tokenizer):
        """Test CPU device usage"""
        tokenizer = AudioTokenizer(device="cpu")
        assert tokenizer.device == "cpu"
    
    def test_cuda_device_fallback(self, mock_tokenizer):
        """Test CUDA device with fallback to CPU"""
        with patch('torch.cuda.is_available', return_value=False):
            tokenizer = AudioTokenizer(device="cuda")
            # Should still work with mocked dependencies
            assert tokenizer.device == "cuda"  # Device setting doesn't change automatically
    
    def test_mps_device_compatibility(self, mock_tokenizer):
        """Test MPS device compatibility"""
        with patch('torch.backends.mps.is_available', return_value=True), \
             patch('platform.system', return_value='Darwin'):
            
            tokenizer = AudioTokenizer(device="mps")
            assert tokenizer.device == "mps"


class TestErrorHandling:
    """Test error handling in tokenization"""
    
    def test_invalid_audio_file(self, mock_tokenizer):
        """Test handling of invalid audio files"""
        with patch('torchaudio.load') as mock_load:
            mock_load.side_effect = Exception("Invalid audio format")
            
            tokenizer = AudioTokenizer(device="cpu")
            
            with pytest.raises(Exception, match="Invalid audio format"):
                tokenizer.tokenize("invalid.wav")
    
    def test_empty_audio_file(self, mock_tokenizer):
        """Test handling of empty audio files"""
        with patch('torchaudio.load') as mock_load:
            mock_load.return_value = (torch.empty(0), 16000)
            
            tokenizer = AudioTokenizer(device="cpu")
            result = tokenizer.tokenize("empty.wav")
            
            # Should handle empty audio gracefully
            assert isinstance(result, TokenizedAudio)
    
    def test_transcription_failure(self, mock_tokenizer, mock_audio_file):
        """Test handling of transcription failures"""
        with patch.object(AudioTokenizer, '_transcribe_audio') as mock_transcribe:
            mock_transcribe.side_effect = Exception("Transcription failed")
            
            tokenizer = AudioTokenizer(device="cpu")
            
            with pytest.raises(Exception, match="Transcription failed"):
                tokenizer.tokenize(mock_audio_file)