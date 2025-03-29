"""
Platform-specific adapter for audio tokenization using moshi_mlx.
"""

import platform
import torch
import numpy as np
from loguru import logger
from huggingface_hub import hf_hub_download

def is_apple_silicon():
    """Check if we're running on Apple Silicon"""
    return platform.system() == "Darwin" and platform.machine() == "arm64"

class MimiTokenizer:
    """
    Adapter class that uses moshi_mlx for Mimi tokenization on Apple Silicon.
    """
    
    def __init__(self, device="cuda", num_codebooks=32):
        """Initialize the moshi_mlx tokenizer
        
        Args:
            device: Device to run inference on ("cpu", "cuda", "mps")
            num_codebooks: Number of codebooks to use
        """
        self.device = device
        self.num_codebooks = num_codebooks
        self.sample_rate = 24000  # Fixed sample rate
        
        self._initialize_moshi_mlx()
    
    def _initialize_moshi_mlx(self):
        """Initialize the moshi_mlx tokenizer for Apple Silicon"""
        try:
            from moshi_mlx.models.mimi import Mimi, mimi_202407
            
            logger.info("Initializing moshi_mlx backend")
            
            # Download the tokenizer weights
            logger.info("Downloading moshi_mlx tokenizer weights")
            repo_id = "kyutai/moshiko-mlx-q8"
            weight_file = "tokenizer-e351c8d8-checkpoint125.safetensors"
            mimi_weight_path = hf_hub_download(repo_id, weight_file)
            
            # Initialize the main tokenizer
            logger.info(f"Creating Mimi MLX models with {self.num_codebooks} codebooks")
            cfg = mimi_202407(num_codebooks=self.num_codebooks)
            self.tokenizer = Mimi(cfg)
            self.tokenizer.load_pytorch_weights(mimi_weight_path)
            
            # Initialize a separate tokenizer for streaming operations
            self.stream_tokenizer = Mimi(cfg)
            self.stream_tokenizer.load_pytorch_weights(mimi_weight_path)
            
            # Warm up the models
            logger.info("Warming up MLX models")
            self.tokenizer.warmup()
            self.stream_tokenizer.warmup()
            
            logger.info("moshi_mlx initialization complete")
            
        except ImportError as e:
            logger.error(f"Failed to import moshi_mlx: {e}")
            raise ImportError(f"Could not initialize moshi_mlx: {e}. Make sure it's installed and you're on Apple Silicon.")
        except Exception as e:
            logger.error(f"Error initializing moshi_mlx: {e}")
            raise RuntimeError(f"Failed to initialize moshi_mlx: {e}")
    
    def encode(self, audio):
        """Encode audio to RVQ tokens
        
        Args:
            audio: Audio tensor to encode
            
        Returns:
            RVQ tokens with shape (num_codebooks, seq_len)
        """
        try:
            import mlx.core as mx
            
            # Convert input to numpy array
            if isinstance(audio, torch.Tensor):
                audio_np = audio.cpu().numpy()
            else:
                audio_np = np.asarray(audio)
            
            # Ensure correct shape [batch, channel, samples]
            if audio_np.ndim == 1:  # [samples]
                audio_np = audio_np.reshape(1, 1, -1)
            elif audio_np.ndim == 2:
                if audio_np.shape[0] == 1:  # [1, samples]
                    audio_np = audio_np.reshape(1, 1, -1)
                else:  # Assume [batch, samples]
                    audio_np = np.expand_dims(audio_np, 1)
            
            # Convert to MLX array
            audio_mx = mx.array(audio_np)
            
            # Encode using moshi_mlx
            tokens_mx = self.tokenizer.encode(audio_mx)
            
            # Convert back to torch tensor
            tokens_np = np.asarray(tokens_mx)
            
            # Ensure consistent shape [num_codebooks, seq_len]
            if tokens_np.ndim == 3:  # [batch, codebooks, seq_len]
                tokens_np = tokens_np[0]  # Take first batch
            
            return torch.from_numpy(tokens_np)
            
        except Exception as e:
            logger.error(f"moshi_mlx encode error: {e}")
            logger.error(f"Audio shape: {getattr(audio_np, 'shape', None)}")
            # Return a fallback empty tensor with the expected shape
            return torch.zeros((self.num_codebooks, 1), dtype=torch.long)
    
    def encode_step(self, audio):
        """Encode audio incrementally to RVQ tokens (for streaming)
        
        Args:
            audio: Audio tensor or numpy array to encode
            
        Returns:
            RVQ tokens with shape (num_codebooks, seq_len)
        """
        try:
            import mlx.core as mx
            
            # Reset state for streaming
            self.stream_tokenizer.reset_state()
            
            # Convert input to numpy array
            if isinstance(audio, torch.Tensor):
                audio_np = audio.cpu().numpy()
            else:
                audio_np = np.asarray(audio)
            
            # Ensure correct shape [batch, channel, samples]
            if audio_np.ndim == 1:  # [samples]
                audio_np = audio_np.reshape(1, 1, -1)
            elif audio_np.ndim == 2:
                if audio_np.shape[0] == 1:  # [1, samples]
                    audio_np = audio_np.reshape(1, 1, -1)
                else:  # Assume [batch, samples]
                    audio_np = np.expand_dims(audio_np, 1)
            
            # Convert to MLX array
            audio_mx = mx.array(audio_np)
            
            # Use encode_step for streaming
            tokens_mx = self.stream_tokenizer.encode_step(audio_mx)
            
            # Convert back to torch tensor
            tokens_np = np.asarray(tokens_mx)
            
            # Ensure consistent shape [num_codebooks, seq_len]
            if tokens_np.ndim == 3:  # [batch, codebooks, seq_len]
                tokens_np = tokens_np[0]  # Take first batch
            
            return torch.from_numpy(tokens_np)
            
        except Exception as e:
            logger.error(f"moshi_mlx encode_step error: {e}")
            logger.error(f"Audio shape: {getattr(audio_np, 'shape', None)}")
            # Return a fallback empty tensor with the expected shape
            return torch.zeros((self.num_codebooks, 1), dtype=torch.long)
    
    def decode(self, tokens):
        """Decode RVQ tokens to audio
        
        Args:
            tokens: RVQ tokens to decode [num_codebooks, seq_len]
            
        Returns:
            Audio tensor [samples]
        """
        try:
            import mlx.core as mx
            
            # Convert input to numpy array
            if isinstance(tokens, torch.Tensor):
                tokens_np = tokens.cpu().numpy()
            else:
                tokens_np = np.asarray(tokens)
            
            # Ensure correct shape [batch, codebooks, seq_len]
            if tokens_np.ndim == 2:  # [codebooks, seq_len]
                tokens_np = tokens_np.reshape(1, tokens_np.shape[0], tokens_np.shape[1])
            
            # Convert to MLX array
            tokens_mx = mx.array(tokens_np)
            
            # Decode
            audio_mx = self.tokenizer.decode(tokens_mx)
            
            # Convert back to torch tensor
            audio_np = np.asarray(audio_mx)
            
            # Ensure 1D output [samples]
            if audio_np.ndim > 1:
                audio_np = audio_np.reshape(-1)
            
            return torch.from_numpy(audio_np).float()
            
        except Exception as e:
            logger.error(f"moshi_mlx decode error: {e}")
            logger.error(f"Tokens shape: {getattr(tokens_np, 'shape', None)}")
            # Return a fallback empty audio tensor
            return torch.zeros(1920, dtype=torch.float32)
    
    def decode_step(self, tokens):
        """Decode RVQ tokens incrementally to audio (for streaming)
        
        Args:
            tokens: RVQ tokens to decode [num_codebooks, seq_len]
            
        Returns:
            Audio tensor [samples]
        """
        try:
            import mlx.core as mx
            
            # Reset state for streaming
            self.stream_tokenizer.reset_state()
            
            # Convert input to numpy array
            if isinstance(tokens, torch.Tensor):
                tokens_np = tokens.cpu().numpy()
            else:
                tokens_np = np.asarray(tokens)
            
            # Ensure correct shape [batch, codebooks, seq_len]
            if tokens_np.ndim == 2:  # [codebooks, seq_len]
                tokens_np = tokens_np.reshape(1, tokens_np.shape[0], tokens_np.shape[1])
            
            # Convert to MLX array
            tokens_mx = mx.array(tokens_np)
            
            # Use decode_step for streaming
            audio_mx = self.stream_tokenizer.decode_step(tokens_mx)
            
            # Convert back to torch tensor
            audio_np = np.asarray(audio_mx)
            
            # Ensure 1D output [samples]
            if audio_np.ndim > 1:
                audio_np = audio_np.reshape(-1)
            
            return torch.from_numpy(audio_np).float()
            
        except Exception as e:
            logger.error(f"moshi_mlx decode_step error: {e}")
            logger.error(f"Tokens shape: {getattr(tokens_np, 'shape', None)}")
            # Return a fallback empty audio tensor
            return torch.zeros(1920, dtype=torch.float32)
