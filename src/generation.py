"""
Simplified token generation module focusing on natural voice inpainting.
"""

import os
import torch
import torchaudio
import tempfile
from dataclasses import dataclass
from loguru import logger
from huggingface_hub import hf_hub_download

from src.tokenization import TokenizedAudio, AudioTokenizer
from src.semantic_edit import EditOperation


@dataclass
class Segment:
    """Segment for CSM model, representing a speaker's utterance"""

    speaker: int
    text: str
    # (num_samples,), sample_rate = 24_000
    audio: torch.Tensor


class TokenGenerator:
    """Generates RVQ tokens using Sesame CSM model with natural speech"""

    def __init__(self, device="cuda"):
        """Initialize the token generator

        Args:
            device: Device to run inference on ("cpu", "cuda", "mps")
        """
        self.device = device
        self.generator = self._initialize_csm_model()
        self.sample_rate = self.generator.sample_rate
        self.tokenizer = AudioTokenizer(device=self.device)

    def _initialize_csm_model(self):
        """Initialize the CSM model

        Returns:
            Initialized CSM generator
        """
        logger.info("Initializing CSM model...")
        try:
            # Import and load the CSM model
            from src.generator import load_csm_1b

            # Download the model if needed and load it
            model_path = hf_hub_download(repo_id="sesame/csm-1b", filename="ckpt.pt")
            generator = load_csm_1b(model_path, self.device)
            logger.info("CSM model loaded successfully")
            return generator
        except Exception as e:
            logger.error(f"Error loading CSM model: {e}")
            raise RuntimeError(f"Failed to load CSM model: {e}")

    def _prepare_context_segment(
        self,
        tokenized_audio: TokenizedAudio,
        edit_op: EditOperation,
        context_seconds: float = 3.0,
    ) -> Segment:
        """Prepare a context segment for generation focusing primarily on pre-padding

        Args:
            tokenized_audio: TokenizedAudio object
            edit_op: EditOperation with token range and edit details
            context_seconds: Seconds of context to include

        Returns:
            Segment with context information
        """
        # Prioritize pre-padding context
        has_prepadding = (
            edit_op.prepadding_start_token_idx >= 0
            and edit_op.prepadding_end_token_idx >= 0
            and edit_op.prepadding_text
        )

        # Extract audio context based on pre-padding
        if has_prepadding:
            # Get audio from pre-padding section
            prepad_audio = self.tokenizer.extract_context_audio(
                tokenized_audio,
                (edit_op.prepadding_start_token_idx, edit_op.prepadding_end_token_idx),
                context_seconds,
            )
            logger.info(f"Using pre-padding context: '{edit_op.prepadding_text}'")
            context_audio = prepad_audio
        else:
            # Fall back to general context from the beginning of the audio
            logger.info("No explicit pre-padding available, extracting general context")
            general_audio = self.tokenizer.extract_context_audio(
                tokenized_audio,
                (0, edit_op.start_token_idx),
                context_seconds,
            )
            context_audio = general_audio

        # Move context audio to the same device as the model
        context_audio_device = context_audio.to(self.device)

        # Keep the context text simple - just the text to be generated
        # This lets the CSM model handle timing naturally
        context_text = edit_op.edited_text

        # Create context segment
        return Segment(
            text=context_text,
            speaker=tokenized_audio.speaker_id,
            audio=context_audio_device,
        )

    def generate_replacement_tokens(
        self,
        tokenized_audio: TokenizedAudio,
        edit_op: EditOperation,
        temperature: float = 0.7,
        topk: int = 30,
    ) -> torch.Tensor:
        """Generate replacement RVQ tokens with natural speech pacing

        Args:
            tokenized_audio: TokenizedAudio object
            edit_op: EditOperation with token range and edit details
            temperature: Sampling temperature
            topk: Top-k sampling parameter

        Returns:
            Generated RVQ tokens
        """
        # Handle special cases
        if not edit_op.edited_text.strip():
            # Pure deletion - return empty tensor
            logger.info("Pure deletion detected, returning empty token tensor")
            return torch.zeros(
                (tokenized_audio.rvq_tokens.shape[0], 0),
                dtype=tokenized_audio.rvq_tokens.dtype,
                device=tokenized_audio.rvq_tokens.device,
            )

        logger.info(f"Generating replacement tokens for: '{edit_op.edited_text}'")

        # Prepare context with pre-padding info
        context_segment = self._prepare_context_segment(tokenized_audio, edit_op)

        # Calculate approximate audio length - avoid complex calculations
        # Use a simple approach based on characters with min/max bounds
        char_count = len(edit_op.edited_text)
        base_ms_per_char = 80  # Average speaking rate

        # Simple estimation with reasonable bounds
        audio_length_ms = max(1000, min(15000, char_count * base_ms_per_char))

        # Add padding based on sentence complexity
        if "," in edit_op.edited_text or "." in edit_op.edited_text:
            audio_length_ms += 500  # Add time for natural pauses

        logger.info(f"Using audio length: {audio_length_ms}ms for generation")

        # Generate audio using CSM with the simplified approach
        with torch.inference_mode():
            audio = self.generator.generate(
                text=edit_op.edited_text,
                speaker=tokenized_audio.speaker_id,
                context=[context_segment],
                max_audio_length_ms=audio_length_ms,
                temperature=temperature,
                topk=topk,
            )

        # Convert generated audio back to RVQ tokens
        with (
            torch.inference_mode(),
            tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_file,
        ):
            tmp_path = tmp_file.name
            
            # Save the audio to a temporary file
            # Note: torchaudio.save requires a [channels, samples] format
            audio_for_saving = audio.view(1, -1) if audio.dim() == 1 else audio
            torchaudio.save(tmp_path, audio_for_saving.cpu(), self.sample_rate)

            # Use our MLX adapter to get RVQ tokens
            # Move audio to the device (no unsqueeze needed - the MLX adapter handles dimensions)
            audio_for_encoding = audio.to(self.device)
            
            try:
                # Try using the streaming encoder which works better for incremental processing
                new_tokens = self.tokenizer.mimi.encode_step(audio_for_encoding)
                logger.info("Used streaming encoder for token generation")
            except Exception as e:
                # Fall back to regular encode if encode_step fails
                logger.warning(f"Streaming encode failed: {e}, falling back to regular encode")
                new_tokens = self.tokenizer.mimi.encode(audio_for_encoding)

            # Clean up temporary file
            os.unlink(tmp_path)

        logger.info(f"Generated {new_tokens.shape[1]} token frames")
        return new_tokens
