"""
RVQ tokenization module for voice inpainting.
Converts audio to semantic and acoustic tokens using Mimi and Llama.
"""

import os
import torch
import torchaudio
import whisper_timestamped
from dataclasses import dataclass
from typing import List, Dict, Tuple, Optional
from loguru import logger
from huggingface_hub import hf_hub_download
from moshi.models import loaders
from transformers import AutoTokenizer
from tokenizers.processors import TemplateProcessing


@dataclass
class TokenizedAudio:
    """Representation of audio as RVQ token sequences"""

    # Original audio and metadata
    audio: torch.Tensor
    sample_rate: int

    # Mimi RVQ tokens (num_codebooks, seq_len) - may be None when semantic_only=True
    rvq_tokens: Optional[torch.Tensor] = None

    # Text extracted from semantic tokens via Whisper
    text: str = ""

    # Segment-level whisper results with timestamps
    segments: List[Dict] = None

    # Semantic token indices from first codebook or Llama tokens
    semantic_tokens: List[int] = None

    # Mapping between text position and token indices
    text_to_token_map: Dict[int, int] = None
    token_to_text_map: Dict[int, int] = None

    # Speaker identifier
    speaker_id: int = 0

    # Word timestamps from Whisper
    word_timestamps: Optional[List[Dict]] = None

    # Llama tokens when semantic_only=True
    llama_tokens: Optional[List[int]] = None


class AudioTokenizer:
    """Tokenizes audio into RVQ tokens using Mimi and Llama"""

    def __init__(self, device="cuda"):
        """Initialize the audio tokenizer

        Args:
            device: Device to run inference on ("cpu", "cuda", "mps")
        """
        self.device = device
        self._initialize_tokenizers()

    def _initialize_tokenizers(self):
        """Initialize Mimi RVQ tokenizer, Llama text tokenizer, and Whisper model"""
        logger.info("Initializing Mimi RVQ tokenizer...")
        mimi_weight = hf_hub_download(loaders.DEFAULT_REPO, loaders.MIMI_NAME)
        self.mimi = loaders.get_mimi(mimi_weight, device=self.device)
        self.mimi.set_num_codebooks(32)  # CSM uses 32 codebooks
        self.sample_rate = self.mimi.sample_rate  # 24000 Hz

        logger.info("Initializing Llama text tokenizer...")
        self.text_tokenizer = self._load_llama3_tokenizer()

        logger.info("Loading Whisper ASR model...")
        # Load the whisper model directly - whisper_timestamped uses this in its transcribe function
        self.whisper_model = whisper_timestamped.load_model("base", device=self.device)

    def _load_llama3_tokenizer(self):
        """Load the Llama 3 tokenizer with special token handling

        Returns:
            Configured tokenizer
        """
        tokenizer_name = "meta-llama/Llama-3.2-1B"
        tokenizer = AutoTokenizer.from_pretrained(tokenizer_name)
        bos = tokenizer.bos_token
        eos = tokenizer.eos_token

        # Configure the post-processor for correct generation
        tokenizer._tokenizer.post_processor = TemplateProcessing(
            single=f"{bos}:0 $A:0 {eos}:0",
            pair=f"{bos}:0 $A:0 {eos}:0 {bos}:1 $B:1 {eos}:1",
            special_tokens=[
                (f"{bos}", tokenizer.bos_token_id),
                (f"{eos}", tokenizer.eos_token_id),
            ],
        )

        return tokenizer

    def tokenize(
        self, audio_path: str, speaker_id: int = 0, semantic_only: bool = False
    ) -> TokenizedAudio:
        """Tokenize audio to RVQ tokens or semantic tokens only

        Args:
            audio_path: Path to the audio file
            speaker_id: Speaker identifier
            semantic_only: If True, only perform semantic tokenization (faster)

        Returns:
            TokenizedAudio object with tokens and metadata
        """
        logger.info(
            f"Tokenizing audio from {audio_path}, semantic_only={semantic_only}"
        )

        # Load audio and normalize
        waveform, sr = torchaudio.load(audio_path)
        if waveform.shape[0] > 1:  # Convert to mono
            waveform = waveform.mean(dim=0, keepdim=True)

        # Resample to Mimi sample rate if needed
        if sr != self.sample_rate:
            logger.info(f"Resampling from {sr}Hz to {self.sample_rate}Hz")
            waveform = torchaudio.functional.resample(
                waveform, orig_freq=sr, new_freq=self.sample_rate
            )

        # Normalize the audio
        waveform = waveform / (torch.max(torch.abs(waveform)) + 1e-8)

        # Initialize variables
        rvq_tokens = None
        semantic_tokens = None
        llama_tokens = None

        # Tokenize with Mimi if not semantic_only
        if not semantic_only:
            logger.info("Extracting RVQ tokens with Mimi...")
            waveform_device = waveform.to(self.device)
            rvq_tokens = self.mimi.encode(waveform_device.unsqueeze(0))[
                0
            ]  # (num_codebooks, seq_len)
            semantic_tokens = (
                rvq_tokens[0].cpu().tolist()
            )  # First codebook contains semantic tokens

        # Transcribe audio with whisper_timestamped
        logger.info("Transcribing audio with whisper_timestamped...")

        # Save temporary file for Whisper if tensor is provided
        temp_path = None
        if os.path.exists(audio_path):
            # Use whisper_timestamped.transcribe instead
            whisper_result = whisper_timestamped.transcribe(
                model=self.whisper_model, audio=audio_path, language="en"
            )
        else:
            # Create a temporary file to use with whisper_timestamped
            temp_path = "/tmp/temp_whisper_input.wav"
            torchaudio.save(temp_path, waveform, self.sample_rate)
            whisper_result = whisper_timestamped.transcribe(
                model=self.whisper_model, audio=temp_path, language="en"
            )

        # Clean up temporary file if created
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)

        # Extract text and timestamps
        transcribed_text = whisper_result["text"]
        segments = whisper_result["segments"]

        # Create flat list of all words with timestamps
        # whisper_timestamped provides words directly in each segment
        word_timestamps = []
        for segment in segments:
            if "words" in segment:
                word_timestamps.extend(segment["words"])

        # If semantic-only, get Llama tokens for the transcribed text
        if semantic_only:
            logger.info("Creating Llama tokens for transcribed text...")
            llama_tokens = self._get_llama_tokens_for_text(transcribed_text, speaker_id)

        # Create mappings between text positions and token positions
        text_to_token_map = {}
        token_to_text_map = {}

        if not semantic_only:
            text_to_token_map, token_to_text_map = self._align_text_to_tokens(
                transcribed_text, word_timestamps, rvq_tokens
            )
        else:
            # Create simplified mapping based on word timestamps when in semantic_only mode
            text_to_token_map, token_to_text_map = self._create_semantic_text_token_map(
                transcribed_text, word_timestamps
            )

        logger.info(f"Transcribed text: {transcribed_text}")
        if not semantic_only:
            logger.info(f"RVQ tokens shape: {rvq_tokens.shape}")

        if semantic_only:
            logger.info(
                f"Llama tokens count: {len(llama_tokens) if llama_tokens else 0}"
            )

        return TokenizedAudio(
            audio=waveform.squeeze(0).cpu(),
            sample_rate=self.sample_rate,
            rvq_tokens=rvq_tokens.cpu() if rvq_tokens is not None else None,
            text=transcribed_text,
            segments=segments,
            semantic_tokens=semantic_tokens if not semantic_only else None,
            text_to_token_map=text_to_token_map,
            token_to_text_map=token_to_text_map,
            speaker_id=speaker_id,
            word_timestamps=word_timestamps,
            llama_tokens=llama_tokens,
        )

    def _get_llama_tokens_for_text(self, text: str, speaker_id: int) -> List[int]:
        """Get Llama tokens for the given text

        Args:
            text: Text to tokenize
            speaker_id: Speaker identifier to include in the formatted text

        Returns:
            List of Llama token IDs
        """
        # Format text with speaker ID as expected by the model
        formatted_text = f"[{speaker_id}]{text}"

        # Tokenize using the Llama tokenizer
        tokens = self.text_tokenizer.encode(formatted_text)

        return tokens

    def _create_semantic_text_token_map(
        self, text: str, word_timestamps: List[Dict]
    ) -> Tuple[Dict[int, int], Dict[int, int]]:
        """Create a simplified mapping between text and semantic token positions

        When in semantic_only mode, this creates an approximate mapping that can
        be used for alignment purposes. Actual token indices are based on word positions.

        Args:
            text: Transcribed text
            word_timestamps: List of word timestamps from Whisper

        Returns:
            Tuple of (text_to_token_map, token_to_text_map)
        """
        text_to_token_map = {}
        token_to_text_map = {}

        # Track the current position in the text
        text_pos = 0
        token_idx = 0

        # For each word with timestamp
        for word_data in word_timestamps:
            word = word_data[
                "text"
            ]  # Changed from "word" to "text" for whisper_timestamped

            # Find the word position in text
            word_pos = text[text_pos:].find(word)
            if word_pos >= 0:
                word_pos += text_pos

                # Map each character in the word to an approximate token position
                for i in range(len(word)):
                    char_pos = word_pos + i
                    # Each character in a word maps to the same token index for simplicity
                    text_to_token_map[char_pos] = token_idx
                    token_to_text_map[token_idx] = char_pos

                # Move to next token position
                token_idx += 1

                # Update text position for next search
                text_pos = word_pos + len(word)

        return text_to_token_map, token_to_text_map

    def _align_text_to_tokens(
        self, text: str, word_timestamps: List[Dict], rvq_tokens: torch.Tensor
    ) -> Tuple[Dict[int, int], Dict[int, int]]:
        """Align text positions to token positions

        Args:
            text: Transcribed text
            word_timestamps: List of word timestamps from Whisper
            rvq_tokens: RVQ tokens

        Returns:
            Tuple of (text_to_token_map, token_to_text_map)
        """
        # Calculate token frame rate: Mimi uses 12.5 Hz (80ms per frame)
        token_frame_rate = 12.5  # frames per second

        text_to_token_map = {}
        token_to_text_map = {}

        # Track the current position in the text
        text_pos = 0

        # For each word with timestamp
        for word_data in word_timestamps:
            word = word_data[
                "text"
            ]  # Changed from "word" to "text" for whisper_timestamped
            start_time = word_data["start"]
            end_time = word_data["end"]

            # Convert times to token indices
            start_token_idx = round(start_time * token_frame_rate)
            end_token_idx = round(end_time * token_frame_rate)

            # Clamp to valid range
            start_token_idx = min(max(0, start_token_idx), rvq_tokens.shape[1] - 1)
            end_token_idx = min(max(0, end_token_idx), rvq_tokens.shape[1] - 1)

            # Find the word position in text (may need to handle whitespace/punctuation differences)
            word_pos = text[text_pos:].find(word)
            if word_pos >= 0:
                word_pos += text_pos

                # Map each character in the word to the appropriate token
                word_len = len(word)
                for i in range(word_len):
                    char_pos = word_pos + i

                    # Calculate interpolated token position
                    token_pos = start_token_idx
                    if end_token_idx > start_token_idx:
                        # Linearly interpolate between start and end
                        progress = i / word_len
                        token_pos = int(
                            start_token_idx
                            + progress * (end_token_idx - start_token_idx)
                        )

                    # Add to maps
                    text_to_token_map[char_pos] = token_pos
                    token_to_text_map[token_pos] = char_pos

                # Update text position for next search
                text_pos = word_pos + word_len

        return text_to_token_map, token_to_text_map

    def reconstruct_audio(self, rvq_tokens: torch.Tensor) -> Tuple[torch.Tensor, int]:
        """Reconstruct audio from RVQ tokens

        Args:
            rvq_tokens: RVQ tokens (num_codebooks, seq_len)

        Returns:
            Tuple of (audio_tensor, sample_rate)
        """
        logger.info("Reconstructing audio from RVQ tokens...")
        rvq_tokens = rvq_tokens.to(self.device)
        # MIMI expects tokens in shape (1, num_codebooks, seq_len)
        audio = self.mimi.decode(rvq_tokens.unsqueeze(0)).squeeze(0).squeeze(0)
        return audio.cpu(), self.sample_rate

    def find_token_range(
        self, tokenized_audio: TokenizedAudio, text_range: Tuple[int, int]
    ) -> Tuple[int, int]:
        """Find token range corresponding to a text range

        Args:
            tokenized_audio: TokenizedAudio object
            text_range: Tuple of (start_idx, end_idx) in the text

        Returns:
            Tuple of (start_token_idx, end_token_idx)
        """
        start_char_idx, end_char_idx = text_range

        # For start position: find the nearest mapped character position
        if start_char_idx in tokenized_audio.text_to_token_map:
            start_token_idx = tokenized_audio.text_to_token_map[start_char_idx]
        else:
            # Find nearest position at or before the start
            available_positions = [
                pos
                for pos in tokenized_audio.text_to_token_map.keys()
                if pos <= start_char_idx
            ]
            if available_positions:
                nearest_pos = max(available_positions)
                start_token_idx = tokenized_audio.text_to_token_map[nearest_pos]
            else:
                # If no positions before, take the earliest available
                nearest_pos = min(tokenized_audio.text_to_token_map.keys())
                start_token_idx = tokenized_audio.text_to_token_map[nearest_pos]

        # For end position: find the next position after the end
        if end_char_idx in tokenized_audio.text_to_token_map:
            end_token_idx = tokenized_audio.text_to_token_map[end_char_idx]
        else:
            # Find the next position that's after our end_char_idx
            available_positions = [
                pos
                for pos in tokenized_audio.text_to_token_map.keys()
                if pos >= end_char_idx
            ]
            if available_positions:
                next_pos = min(available_positions)
                end_token_idx = tokenized_audio.text_to_token_map[next_pos]
            else:
                # If no positions after, take the latest available
                next_pos = max(tokenized_audio.text_to_token_map.keys())
                end_token_idx = tokenized_audio.text_to_token_map[next_pos]

        # Add a small buffer to ensure we capture the entire content
        end_token_idx += 3

        # Ensure we don't exceed the available tokens
        if tokenized_audio.rvq_tokens is not None:
            end_token_idx = min(end_token_idx, tokenized_audio.rvq_tokens.shape[1] - 1)

        # Ensure start_token_idx is before end_token_idx
        if start_token_idx > end_token_idx:
            start_token_idx, end_token_idx = end_token_idx, start_token_idx

        logger.info(
            f"Text range {text_range} maps to token range [{start_token_idx}, {end_token_idx}]"
        )
        return start_token_idx, end_token_idx

    def extract_context_audio(
        self,
        tokenized_audio: TokenizedAudio,
        edit_range: Tuple[int, int],
        context_seconds: float = 3.0,
    ) -> torch.Tensor:
        """Extract audio context around edit point

        Args:
            tokenized_audio: TokenizedAudio object
            edit_range: Tuple of (start_token_idx, end_token_idx)
            context_seconds: Seconds of context to include before and after

        Returns:
            Audio tensor with context
        """
        # Convert token indices to time (seconds)
        token_frame_rate = 12.5  # frames per second
        start_time = edit_range[0] / token_frame_rate
        end_time = edit_range[1] / token_frame_rate

        # Calculate context boundaries (in samples)
        sample_rate = tokenized_audio.sample_rate
        context_samples = int(context_seconds * sample_rate)

        start_sample = max(0, int(start_time * sample_rate) - context_samples)
        end_sample = min(
            len(tokenized_audio.audio), int(end_time * sample_rate) + context_samples
        )

        # Extract context audio
        context_audio = tokenized_audio.audio[start_sample:end_sample]

        logger.info(
            f"Extracted context audio from {start_time - context_seconds:.2f}s to {end_time + context_seconds:.2f}s"
        )
        return context_audio

    def extract_tokens_for_context(
        self,
        tokenized_audio: TokenizedAudio,
        edit_range: Tuple[int, int],
        context_frames: int = 40,  # ~3.2 seconds at 12.5 Hz
    ) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """Extract tokens for context before and after the edit point

        Args:
            tokenized_audio: TokenizedAudio object
            edit_range: Tuple of (start_token_idx, end_token_idx)
            context_frames: Number of context frames to include

        Returns:
            Tuple of (left_context_tokens, edit_region_tokens, right_context_tokens)
        """
        if tokenized_audio.rvq_tokens is None:
            raise ValueError(
                "Cannot extract token context when using semantic_only mode"
            )

        start_idx, end_idx = edit_range

        # Extract context tokens
        left_start = max(0, start_idx - context_frames)
        right_end = min(tokenized_audio.rvq_tokens.shape[1], end_idx + context_frames)

        left_context = tokenized_audio.rvq_tokens[:, left_start:start_idx]
        edit_region = tokenized_audio.rvq_tokens[:, start_idx:end_idx]
        right_context = tokenized_audio.rvq_tokens[:, end_idx:right_end]

        logger.info(
            f"Extracted context tokens: left={left_context.shape[1]}, edit={edit_region.shape[1]}, right={right_context.shape[1]}"
        )
        return left_context, edit_region, right_context
