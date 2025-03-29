"""
Integrated voice inpainting with end-to-end generation.
Replaces the separate generation and fusion steps with a single coherent process.
"""

import os
import torch
import torchaudio
import tempfile
from dataclasses import dataclass
from typing import List, Tuple
from loguru import logger
from huggingface_hub import hf_hub_download

from src.tokenization import TokenizedAudio, AudioTokenizer
from src.semantic_edit import EditOperation
from src.generator import load_csm_1b


@dataclass
class Segment:
    """Segment for CSM model, representing a speaker's utterance"""
    speaker: int
    text: str
    # (num_samples,), sample_rate = 24_000
    audio: torch.Tensor


class IntegratedVoiceInpainting:
    """Performs voice inpainting in an end-to-end manner without separate generation and fusion"""
    
    def __init__(self, device="cuda"):
        """Initialize the integrated voice inpainting module
        
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
            # Download the model if needed and load it
            model_path = hf_hub_download(repo_id="sesame/csm-1b", filename="ckpt.pt")
            generator = load_csm_1b(model_path, self.device)
            logger.info("CSM model loaded successfully")
            return generator
        except Exception as e:
            logger.error(f"Error loading CSM model: {e}")
            raise RuntimeError(f"Failed to load CSM model: {e}")
    
    def _prepare_context_segments(
        self,
        tokenized_audio: TokenizedAudio,
        edit_range: Tuple[int, int],
        edit_text: str,
        context_seconds: float = 3.0
    ) -> List[Segment]:
        """Prepare context segments from the original audio
        
        Args:
            tokenized_audio: TokenizedAudio object
            edit_range: (start_token_idx, end_token_idx) tuple
            edit_text: Text to insert
            context_seconds: Amount of context to extract
            
        Returns:
            List of context Segment objects
        """
        start_idx, end_idx = edit_range
        segments = []
        
        # Extract pre-edit context
        if start_idx > 0:
            # Determine an appropriate amount of context to include
            pre_start_idx = max(0, start_idx - int(context_seconds * 12.5))  # 12.5 frames/second
            
            # Extract audio for the pre-edit context
            pre_context_audio = self.tokenizer.extract_context_audio(
                tokenized_audio,
                (pre_start_idx, start_idx),
                context_seconds
            )
            
            # Extract text for this context segment if possible
            pre_context_text = ""
            if tokenized_audio.token_to_text_map:
                # Find text positions corresponding to token range
                start_char_pos = None
                end_char_pos = None
                
                for token_idx, char_idx in tokenized_audio.token_to_text_map.items():
                    if token_idx >= pre_start_idx and token_idx < start_idx:
                        if start_char_pos is None or char_idx < start_char_pos:
                            start_char_pos = char_idx
                    if token_idx == start_idx - 1:
                        end_char_pos = char_idx
                
                if start_char_pos is not None and end_char_pos is not None:
                    # Extract text subsequence
                    pre_context_text = tokenized_audio.text[start_char_pos:end_char_pos+1]
            
            # Create segment
            pre_segment = Segment(
                speaker=tokenized_audio.speaker_id,
                text=pre_context_text,
                audio=pre_context_audio.to(self.device)
            )
            segments.append(pre_segment)
        
        # Extract post-edit context
        if end_idx < tokenized_audio.rvq_tokens.shape[1]:
            # Determine an appropriate amount of context
            post_end_idx = min(
                tokenized_audio.rvq_tokens.shape[1],
                end_idx + int(context_seconds * 12.5)  # 12.5 frames/second
            )
            
            # Extract audio for the post-edit context
            post_context_audio = self.tokenizer.extract_context_audio(
                tokenized_audio,
                (end_idx, post_end_idx),
                context_seconds
            )
            
            # Extract text for this context segment if possible
            post_context_text = ""
            if tokenized_audio.token_to_text_map:
                # Find text positions corresponding to token range
                start_char_pos = None
                end_char_pos = None
                
                for token_idx, char_idx in tokenized_audio.token_to_text_map.items():
                    if token_idx == end_idx:
                        start_char_pos = char_idx
                    if token_idx >= end_idx and token_idx <= post_end_idx:
                        if end_char_pos is None or char_idx > end_char_pos:
                            end_char_pos = char_idx
                
                if start_char_pos is not None and end_char_pos is not None:
                    # Extract text subsequence
                    post_context_text = tokenized_audio.text[start_char_pos:end_char_pos+1]
            
            # Create segment
            post_segment = Segment(
                speaker=tokenized_audio.speaker_id,
                text=post_context_text,
                audio=post_context_audio.to(self.device)
            )
            segments.append(post_segment)
        
        return segments
    
    def _estimate_audio_length(self, edit_text: str, tokenized_audio: TokenizedAudio) -> int:
        """Estimate appropriate maximum audio length based on speaking rate
        
        Args:
            edit_text: Text to generate
            tokenized_audio: Original audio for reference
            
        Returns:
            Maximum audio length in milliseconds
        """
        # Default if we can't calculate
        default_ms_per_char = 80
        
        try:
            # Try to calculate speaking rate from original audio
            if tokenized_audio.word_timestamps and len(tokenized_audio.word_timestamps) > 3:
                total_chars = 0
                total_duration_ms = 0
                
                for word_info in tokenized_audio.word_timestamps:
                    if 'text' in word_info and 'start' in word_info and 'end' in word_info:
                        word = word_info['text']
                        word_duration_ms = (word_info['end'] - word_info['start']) * 1000
                        word_chars = len(word)
                        
                        # Only count words with reasonable duration
                        if word_chars > 0 and 20 < word_duration_ms < 1000:
                            total_chars += word_chars
                            total_duration_ms += word_duration_ms
                
                # Calculate average if we have enough data
                if total_chars > 10 and total_duration_ms > 0:
                    ms_per_char = total_duration_ms / total_chars
                    # Sanity check the result
                    if 40 <= ms_per_char <= 200:
                        logger.info(f"Detected speaking rate: {ms_per_char:.1f}ms per character")
                        default_ms_per_char = ms_per_char
        except Exception as e:
            logger.warning(f"Error estimating speaking rate: {e}, using default")
        
        # Calculate length with a generous buffer
        char_count = len(edit_text)
        min_audio_length_ms = max(1000, char_count * default_ms_per_char * 0.8)
        max_audio_length_ms = max(15000, char_count * default_ms_per_char * 2.0)
        
        # Use a conservative estimate for max_audio_length_ms to avoid truncation
        audio_length_ms = max(min_audio_length_ms, max_audio_length_ms)
        
        # Always ensure some minimum headroom (at least 5 seconds)
        audio_length_ms = max(audio_length_ms, 5000)
        
        return int(audio_length_ms)
    
    def inpaint(
        self,
        tokenized_audio: TokenizedAudio,
        edit_op: EditOperation,
        temperature: float = 0.7,
        topk: int = 25,
    ) -> Tuple[torch.Tensor, torch.Tensor, int]:
        """Perform integrated voice inpainting
        
        Args:
            tokenized_audio: TokenizedAudio object
            edit_op: EditOperation with token range and edit details
            temperature: Temperature for generation sampling
            topk: Top-k sampling parameter
            
        Returns:
            Tuple of (inpainted_tokens, inpainted_audio, sample_rate)
        """
        logger.info(f"Performing integrated voice inpainting for: '{edit_op.edited_text}'")
        
        # Handle empty edit text (deletion)
        if not edit_op.edited_text.strip():
            logger.info("Deletion detected, removing segment without generation")
            # Create output tokens by removing the specified range
            start_idx, end_idx = edit_op.start_token_idx, edit_op.end_token_idx
            inpainted_tokens = torch.cat([
                tokenized_audio.rvq_tokens[:, :start_idx],
                tokenized_audio.rvq_tokens[:, end_idx:]
            ], dim=1)
            
            # Reconstruct audio from tokens
            inpainted_audio, sr = self.tokenizer.reconstruct_audio(inpainted_tokens)
            return inpainted_tokens, inpainted_audio, sr
        
        # Prepare context segments from original audio
        context_segments = self._prepare_context_segments(
            tokenized_audio,
            (edit_op.start_token_idx, edit_op.end_token_idx),
            edit_op.edited_text
        )
        
        # Calculate appropriate audio length
        max_audio_length_ms = self._estimate_audio_length(edit_op.edited_text, tokenized_audio)
        logger.info(f"Using max audio length: {max_audio_length_ms}ms for generation")
        
        # Generate the inpainted segment using the CSM model
        with torch.inference_mode():
            # Generate new audio for the edited segment
            audio = self.generator.generate(
                text=edit_op.edited_text,
                speaker=tokenized_audio.speaker_id,
                context=context_segments,
                max_audio_length_ms=max_audio_length_ms,
                temperature=temperature,
                topk=topk,
            )
            
            # Convert to RVQ tokens
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_file:
                tmp_path = tmp_file.name
                
                # Save audio to temporary file
                audio_for_saving = audio.view(1, -1) if audio.dim() == 1 else audio
                torchaudio.save(tmp_path, audio_for_saving.cpu(), self.sample_rate)
                
                # Encode audio to get RVQ tokens
                audio_for_encoding = audio.to(self.device)
                
                try:
                    # Try streaming encoder first
                    new_tokens = self.tokenizer.mimi.encode_step(audio_for_encoding)
                    logger.info("Used streaming encoder for token generation")
                except Exception as e:
                    # Fall back to regular encode
                    logger.warning(f"Streaming encode failed: {e}, falling back to regular encode")
                    new_tokens = self.tokenizer.mimi.encode(audio_for_encoding)
                
                # Clean up temporary file
                os.unlink(tmp_path)
            
            # Create inpainted tokens by combining original and new tokens
            start_idx, end_idx = edit_op.start_token_idx, edit_op.end_token_idx
            inpainted_tokens = torch.cat([
                tokenized_audio.rvq_tokens[:, :start_idx],
                new_tokens,
                tokenized_audio.rvq_tokens[:, end_idx:]
            ], dim=1)
            
            # Reconstruct final audio
            inpainted_audio, sr = self.tokenizer.reconstruct_audio(inpainted_tokens)
            
            logger.info(f"Integrated inpainting completed: {new_tokens.shape[1]} generated frames inserted")
            return inpainted_tokens, inpainted_audio, sr
            
    def batch_inpaint(
        self,
        tokenized_audio: TokenizedAudio,
        edit_operations: List[EditOperation],
        temperature: float = 0.7,
        topk: int = 25,
    ) -> Tuple[torch.Tensor, torch.Tensor, int]:
        """Process multiple edits in a single batch
        
        Args:
            tokenized_audio: TokenizedAudio object
            edit_operations: List of EditOperation objects
            temperature: Temperature for generation sampling
            topk: Top-k sampling parameter
            
        Returns:
            Tuple of (inpainted_tokens, inpainted_audio, sample_rate)
        """
        if not edit_operations:
            logger.warning("No edit operations provided, returning original audio")
            audio, sr = self.tokenizer.reconstruct_audio(tokenized_audio.rvq_tokens)
            return tokenized_audio.rvq_tokens, audio, sr
        
        # Sort edit operations by start index (process from left to right)
        sorted_edits = sorted(edit_operations, key=lambda op: op.start_token_idx)
        
        # Start with the original tokens
        current_tokens = tokenized_audio.rvq_tokens
        token_offset = 0  # Track how indices shift due to previous edits
        
        # Process each edit sequentially
        for i, edit_op in enumerate(sorted_edits):
            logger.info(f"Processing edit {i+1}/{len(sorted_edits)}: '{edit_op.original_text}' -> '{edit_op.edited_text}'")
            
            # Adjust indices based on previous edits
            if token_offset != 0:
                edit_op.start_token_idx += token_offset
                edit_op.end_token_idx += token_offset
                if edit_op.prepadding_start_token_idx >= 0:
                    edit_op.prepadding_start_token_idx += token_offset
                if edit_op.prepadding_end_token_idx >= 0:
                    edit_op.prepadding_end_token_idx = edit_op.start_token_idx  # Always ends at start
            
            # Create updated TokenizedAudio with current tokens
            updated_audio = TokenizedAudio(
                audio=tokenized_audio.audio,
                sample_rate=tokenized_audio.sample_rate,
                rvq_tokens=current_tokens,
                text=tokenized_audio.text,
                segments=tokenized_audio.segments,
                semantic_tokens=tokenized_audio.semantic_tokens,
                text_to_token_map=tokenized_audio.text_to_token_map,
                token_to_text_map=tokenized_audio.token_to_text_map,
                speaker_id=tokenized_audio.speaker_id,
                word_timestamps=tokenized_audio.word_timestamps,
            )
            
            # Process this edit
            inpainted_tokens, _, _ = self.inpaint(
                updated_audio,
                edit_op,
                temperature=temperature,
                topk=topk
            )
            
            # Update current tokens and token offset
            old_length = edit_op.end_token_idx - edit_op.start_token_idx
            new_length = inpainted_tokens.shape[1] - (current_tokens.shape[1] - old_length)
            token_offset += new_length - old_length
            current_tokens = inpainted_tokens
        
        # Reconstruct final audio
        final_audio, sample_rate = self.tokenizer.reconstruct_audio(current_tokens)
        return current_tokens, final_audio, sample_rate