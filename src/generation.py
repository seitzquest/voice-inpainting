"""
Token generation module for voice inpainting using Sesame CSM.
Generates new RVQ tokens based on text edits and surrounding context.
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


# Import CSM model components (adapting from the voice cloning repository)
@dataclass
class Segment:
    """Segment for CSM model, representing a speaker's utterance"""

    speaker: int
    text: str
    # (num_samples,), sample_rate = 24_000
    audio: torch.Tensor


class TokenGenerator:
    """Generates RVQ tokens using Sesame CSM model"""

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
            # This is adapted from the voice cloning repository
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
        """Prepare a context segment for generation

        Args:
            tokenized_audio: TokenizedAudio object
            edit_op: EditOperation with token range and edit details
            context_seconds: Seconds of context to include around edit

        Returns:
            Segment with context information
        """
        # Determine if we have pre-padding context from the EditOperation
        has_prepadding = (
            edit_op.prepadding_start_token_idx >= 0
            and edit_op.prepadding_end_token_idx >= 0
            and edit_op.prepadding_text
        )

        # Extract audio context based on pre-padding if available
        if has_prepadding:
            logger.info(f"Using pre-padding context: '{edit_op.prepadding_text}'")
            # Use the prepadding context for audio as well
            context_audio = self.tokenizer.extract_context_audio(
                tokenized_audio,
                (edit_op.prepadding_start_token_idx, edit_op.start_token_idx),
                context_seconds,
            )
        else:
            # Fall back to regular context extraction (from both sides)
            logger.info("No pre-padding available, extracting general context")
            context_audio = self.tokenizer.extract_context_audio(
                tokenized_audio,
                (edit_op.start_token_idx, edit_op.end_token_idx),
                context_seconds,
            )

        # Prepare the text context, combining pre-padding and general context
        token_frame_rate = 12.5  # frames per second

        if has_prepadding:
            # Use the pre-padding text directly, ensuring we maintain its integrity
            context_text = edit_op.prepadding_text

            # For insertion or deletion cases, handle special formatting
            if not edit_op.original_text.strip():
                # Insertion case: no text to remove
                context_text = f"{context_text}"
            elif not edit_op.edited_text.strip():
                # Deletion case: text is removed without replacement
                context_text = f"{context_text}"
            else:
                # Standard replacement
                context_text = f"{context_text}"

            logger.info(f"Using pre-padding context text: '{context_text}'")
        else:
            # Fall back to the original approach of extracting context from transcript
            start_time = max(
                0, (edit_op.start_token_idx / token_frame_rate) - context_seconds
            )
            end_time = (edit_op.end_token_idx / token_frame_rate) + context_seconds

            # Get text segments that overlap with our context window
            context_text = ""
            for segment in tokenized_audio.segments:
                seg_start = segment["start"]
                seg_end = segment["end"]

                # If segment overlaps with our context window and isn't the part we're replacing
                if seg_end > start_time and seg_start < end_time:
                    segment_text = segment["text"]
                    if edit_op.original_text in segment_text:
                        # Skip the part we're replacing to avoid confusing the model
                        segment_text = segment_text.replace(
                            edit_op.original_text, "[...]"
                        )
                    context_text += " " + segment_text

            # Clean up context text
            context_text = context_text.strip()

        # Fallback if no context was found
        if not context_text:
            # Provide a neutral context that won't bias the generation
            context_text = "Please continue with natural tone and pace."

        logger.info(f"Final context for generation: '{context_text}'")

        # Move context audio to the same device as the model
        context_audio_device = context_audio.to(self.device)

        # Create context segment
        return Segment(
            text=context_text,
            speaker=tokenized_audio.speaker_id,
            audio=context_audio_device,
        )

    def _estimate_audio_length_ms(self, text: str) -> int:
        """Estimate appropriate audio length in milliseconds

        Args:
            text: Text to estimate length for

        Returns:
            Estimated length in milliseconds
        """
        # If text is empty (deletion case), return minimal duration
        if not text.strip():
            return 500  # Minimal duration for deletion

        # Average speaking rate is about 150 words per minute
        # That's 2.5 words per second or 400ms per word
        words = text.split()
        word_count = len(words)

        # Add extra time for longer words
        char_count = sum(len(word) for word in words)
        avg_word_length = char_count / max(1, word_count)
        length_factor = max(0.8, min(1.5, avg_word_length / 5))

        # Base time: 500ms per word (slightly conservative)
        # Adjust based on word length
        base_ms = word_count * 500 * length_factor

        # Add padding to avoid cutoffs
        padding_ms = 2000

        return int(base_ms + padding_ms)

    def generate_replacement_tokens(
        self,
        tokenized_audio: TokenizedAudio,
        edit_op: EditOperation,
        temperature: float = 0.7,
        topk: int = 30,
    ) -> torch.Tensor:
        """Generate replacement RVQ tokens

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

        # Estimate appropriate audio length
        audio_length_ms = self._estimate_audio_length_ms(edit_op.edited_text)
        logger.info(
            f"Estimated audio length: {audio_length_ms}ms for {len(edit_op.edited_text)} chars"
        )

        # Generate audio using CSM
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
            # Save the audio to the temporary file
            torchaudio.save(tmp_path, audio.unsqueeze(0).cpu(), self.sample_rate)

            # Use Mimi directly to get RVQ tokens
            audio_for_encoding = audio.to(self.device).unsqueeze(0).unsqueeze(0)
            new_tokens = self.tokenizer.mimi.encode(audio_for_encoding)[0]

            # Clean up
            os.unlink(tmp_path)

        logger.info(f"Generated {new_tokens.shape[1]} token frames")
        return new_tokens
