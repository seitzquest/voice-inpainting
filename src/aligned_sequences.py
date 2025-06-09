"""
Aligned Token Sequences abstraction for voice inpainting.
Provides consistent interface for working with temporally aligned:
1. Text tokens (from transcription)
2. RVQ tokens (acoustic tokens) 
3. WAV audio subsequences
"""

import torch
import torchaudio
from dataclasses import dataclass
from typing import List, Dict, Tuple, Optional, Union
from loguru import logger

from src.tokenization import TokenizedAudio


@dataclass
class AlignedToken:
    """A single token with alignment information"""
    
    # Token identifiers
    text_token_idx: int          # Index in the text token sequence
    rvq_token_idx: Optional[int] # Index in the RVQ token sequence (None if not available)
    
    # Content
    text: str                    # Text content of this token
    rvq_tokens: Optional[torch.Tensor] = None  # RVQ tokens for this segment (all codebooks)
    
    # Temporal alignment
    start_time: float = 0.0      # Start time in seconds
    end_time: float = 0.0        # End time in seconds
    start_sample: int = 0        # Start sample in audio
    end_sample: int = 0          # End sample in audio
    
    # Metadata
    confidence: float = 1.0      # Confidence score from ASR
    is_generated: bool = False   # Whether this token was generated (vs original)


@dataclass 
class AlignedSegment:
    """A segment containing multiple aligned tokens"""
    
    tokens: List[AlignedToken]
    start_time: float
    end_time: float
    start_sample: int
    end_sample: int
    text: str  # Combined text of all tokens
    is_generated: bool = False  # Whether this entire segment was generated


class AlignedTokenSequence:
    """
    Manages temporally aligned sequences of text tokens, RVQ tokens, and audio.
    Provides consistent abstraction for voice inpainting operations.
    """
    
    def __init__(self, tokenized_audio: TokenizedAudio):
        """Initialize from TokenizedAudio
        
        Args:
            tokenized_audio: TokenizedAudio object containing all tokenization data
        """
        self.tokenized_audio = tokenized_audio
        self.sample_rate = tokenized_audio.sample_rate
        self.audio = tokenized_audio.audio
        
        # Build aligned token sequence
        self.tokens = self._build_aligned_tokens()
        
        logger.info(f"Created AlignedTokenSequence with {len(self.tokens)} tokens")
    
    def _build_aligned_tokens(self) -> List[AlignedToken]:
        """Build aligned tokens from tokenized audio data"""
        tokens = []
        
        if not self.tokenized_audio.word_timestamps:
            logger.warning("No word timestamps available - creating minimal token sequence")
            return tokens
        
        # Create aligned tokens from word timestamps
        for i, word_info in enumerate(self.tokenized_audio.word_timestamps):
            # Get RVQ token index if mapping is available
            rvq_token_idx = None
            rvq_tokens = None
            
            try:
                if (self.tokenized_audio.semantic_to_rvq_map and 
                    i in self.tokenized_audio.semantic_to_rvq_map):
                    rvq_token_idx = self.tokenized_audio.semantic_to_rvq_map[i]
                    
                    # Extract RVQ tokens for this segment if available
                    if (self.tokenized_audio.rvq_tokens is not None and 
                        rvq_token_idx < self.tokenized_audio.rvq_tokens.shape[1]):
                        # For now, extract a single frame - could be enhanced to extract ranges
                        rvq_tokens = self.tokenized_audio.rvq_tokens[:, rvq_token_idx:rvq_token_idx+1]
            except Exception as e:
                logger.warning(f"Error processing RVQ tokens for token {i}: {e}")
                rvq_token_idx = None
                rvq_tokens = None
            
            # Calculate audio sample positions
            start_time = word_info.get("start", 0.0)
            end_time = word_info.get("end", start_time)
            start_sample = int(start_time * self.sample_rate)
            end_sample = int(end_time * self.sample_rate)
            
            # Ensure samples are within audio bounds
            start_sample = max(0, min(start_sample, len(self.audio) - 1))
            end_sample = max(start_sample, min(end_sample, len(self.audio)))
            
            token = AlignedToken(
                text_token_idx=i,
                rvq_token_idx=rvq_token_idx,
                text=word_info.get("text", ""),
                rvq_tokens=rvq_tokens,
                start_time=start_time,
                end_time=end_time,
                start_sample=start_sample,
                end_sample=end_sample,
                confidence=word_info.get("confidence", 1.0),
                is_generated=False
            )
            
            tokens.append(token)
        
        return tokens
    
    def get_token_range(self, start_idx: int, end_idx: int) -> List[AlignedToken]:
        """Get a range of aligned tokens
        
        Args:
            start_idx: Starting token index (inclusive)
            end_idx: Ending token index (exclusive)
            
        Returns:
            List of aligned tokens in the range
        """
        start_idx = max(0, start_idx)
        end_idx = min(len(self.tokens), end_idx)
        return self.tokens[start_idx:end_idx]
    
    def get_text_range(self, start_idx: int, end_idx: int) -> str:
        """Get text for a token range
        
        Args:
            start_idx: Starting token index (inclusive)
            end_idx: Ending token index (exclusive)
            
        Returns:
            Combined text for the token range
        """
        tokens = self.get_token_range(start_idx, end_idx)
        return " ".join(token.text for token in tokens)
    
    def get_audio_range(self, start_idx: int, end_idx: int) -> torch.Tensor:
        """Get audio samples for a token range
        
        Args:
            start_idx: Starting token index (inclusive)
            end_idx: Ending token index (exclusive)
            
        Returns:
            Audio tensor for the token range
        """
        tokens = self.get_token_range(start_idx, end_idx)
        if not tokens:
            return torch.empty(0)
        
        start_sample = tokens[0].start_sample
        end_sample = tokens[-1].end_sample
        
        return self.audio[start_sample:end_sample]
    
    def get_rvq_tokens_range(self, start_idx: int, end_idx: int) -> Optional[torch.Tensor]:
        """Get RVQ tokens for a token range
        
        Args:
            start_idx: Starting token index (inclusive)
            end_idx: Ending token index (exclusive)
            
        Returns:
            RVQ tokens tensor for the range (num_codebooks, seq_len) or None
        """
        tokens = self.get_token_range(start_idx, end_idx)
        if not tokens or not self.tokenized_audio.rvq_tokens:
            return None
        
        # Find the RVQ token range
        rvq_start = None
        rvq_end = None
        
        for token in tokens:
            if token.rvq_token_idx is not None:
                if rvq_start is None:
                    rvq_start = token.rvq_token_idx
                rvq_end = token.rvq_token_idx + 1
        
        if rvq_start is None or rvq_end is None:
            return None
        
        # Ensure indices are within bounds
        max_rvq_idx = self.tokenized_audio.rvq_tokens.shape[1]
        rvq_start = max(0, min(rvq_start, max_rvq_idx - 1))
        rvq_end = max(rvq_start, min(rvq_end, max_rvq_idx))
        
        return self.tokenized_audio.rvq_tokens[:, rvq_start:rvq_end]
    
    def get_temporal_range(self, start_idx: int, end_idx: int) -> Tuple[float, float]:
        """Get temporal range for token indices
        
        Args:
            start_idx: Starting token index (inclusive)
            end_idx: Ending token index (exclusive)
            
        Returns:
            Tuple of (start_time, end_time) in seconds
        """
        tokens = self.get_token_range(start_idx, end_idx)
        if not tokens:
            return (0.0, 0.0)
        
        return (tokens[0].start_time, tokens[-1].end_time)
    
    def replace_range(self, start_idx: int, end_idx: int, new_text: str, 
                     new_audio: torch.Tensor, new_rvq_tokens: Optional[torch.Tensor] = None) -> 'AlignedTokenSequence':
        """Replace a token range with new content
        
        Args:
            start_idx: Starting token index (inclusive)
            end_idx: Ending token index (exclusive)
            new_text: New text content
            new_audio: New audio content
            new_rvq_tokens: New RVQ tokens (optional)
            
        Returns:
            New AlignedTokenSequence with the replacement
        """
        # Get timing information for the replacement
        if self.tokens and start_idx < len(self.tokens):
            start_time = self.tokens[start_idx].start_time
            if end_idx <= len(self.tokens):
                end_time = self.tokens[end_idx - 1].end_time if end_idx > start_idx else start_time
            else:
                end_time = self.tokens[-1].end_time
        else:
            start_time = 0.0
            end_time = len(new_audio) / self.sample_rate
        
        # Calculate new timing
        new_duration = len(new_audio) / self.sample_rate
        
        # Create new tokenized audio with the replacement
        # This is a simplified version - in practice, we'd need to re-tokenize
        # the new text and create proper word timestamps
        
        # For now, create a single token for the new content
        new_token = AlignedToken(
            text_token_idx=start_idx,
            rvq_token_idx=None,  # Would need to be calculated
            text=new_text,
            rvq_tokens=new_rvq_tokens,
            start_time=start_time,
            end_time=start_time + new_duration,
            start_sample=int(start_time * self.sample_rate),
            end_sample=int((start_time + new_duration) * self.sample_rate),
            confidence=1.0,
            is_generated=True
        )
        
        # Build new token list
        new_tokens = []
        
        # Add tokens before the replacement
        new_tokens.extend(self.tokens[:start_idx])
        
        # Add the replacement token
        new_tokens.append(new_token)
        
        # Add tokens after the replacement (adjusting timing)
        time_offset = new_duration - (end_time - start_time)
        for token in self.tokens[end_idx:]:
            adjusted_token = AlignedToken(
                text_token_idx=token.text_token_idx - (end_idx - start_idx) + 1,
                rvq_token_idx=token.rvq_token_idx,
                text=token.text,
                rvq_tokens=token.rvq_tokens,
                start_time=token.start_time + time_offset,
                end_time=token.end_time + time_offset,
                start_sample=token.start_sample + int(time_offset * self.sample_rate),
                end_sample=token.end_sample + int(time_offset * self.sample_rate),
                confidence=token.confidence,
                is_generated=token.is_generated
            )
            new_tokens.append(adjusted_token)
        
        # Create new AlignedTokenSequence
        # Note: This is a simplified implementation
        # In practice, we'd need to update the underlying TokenizedAudio as well
        new_sequence = AlignedTokenSequence.__new__(AlignedTokenSequence)
        new_sequence.tokenized_audio = self.tokenized_audio  # Reference to original
        new_sequence.sample_rate = self.sample_rate
        new_sequence.audio = new_audio  # This should be the full new audio
        new_sequence.tokens = new_tokens
        
        return new_sequence
    
    def to_segments(self, segment_boundary_threshold: float = 1.0) -> List[AlignedSegment]:
        """Convert to segments based on timing gaps
        
        Args:
            segment_boundary_threshold: Minimum gap in seconds to create a new segment
            
        Returns:
            List of aligned segments
        """
        if not self.tokens:
            return []
        
        segments = []
        current_segment_tokens = [self.tokens[0]]
        
        for i in range(1, len(self.tokens)):
            prev_token = self.tokens[i-1]
            curr_token = self.tokens[i]
            
            # Check if there's a significant gap
            gap = curr_token.start_time - prev_token.end_time
            
            if gap > segment_boundary_threshold:
                # Create segment from current tokens
                segment = self._create_segment_from_tokens(current_segment_tokens)
                segments.append(segment)
                
                # Start new segment
                current_segment_tokens = [curr_token]
            else:
                current_segment_tokens.append(curr_token)
        
        # Add final segment
        if current_segment_tokens:
            segment = self._create_segment_from_tokens(current_segment_tokens)
            segments.append(segment)
        
        return segments
    
    def _create_segment_from_tokens(self, tokens: List[AlignedToken]) -> AlignedSegment:
        """Create an aligned segment from a list of tokens"""
        if not tokens:
            return AlignedSegment([], 0.0, 0.0, 0, 0, "", False)
        
        start_time = tokens[0].start_time
        end_time = tokens[-1].end_time
        start_sample = tokens[0].start_sample
        end_sample = tokens[-1].end_sample
        text = " ".join(token.text for token in tokens)
        is_generated = any(token.is_generated for token in tokens)
        
        return AlignedSegment(
            tokens=tokens,
            start_time=start_time,
            end_time=end_time,
            start_sample=start_sample,
            end_sample=end_sample,
            text=text,
            is_generated=is_generated
        )
    
    def get_full_text(self) -> str:
        """Get the complete text from all tokens"""
        return " ".join(token.text for token in self.tokens)
    
    def get_token_count(self) -> int:
        """Get the total number of tokens"""
        return len(self.tokens)
    
    def get_duration(self) -> float:
        """Get the total duration in seconds"""
        if not self.tokens:
            return 0.0
        return self.tokens[-1].end_time - self.tokens[0].start_time
    
    def find_tokens_by_text(self, search_text: str) -> List[int]:
        """Find token indices that contain the given text
        
        Args:
            search_text: Text to search for
            
        Returns:
            List of token indices that contain the search text
        """
        indices = []
        search_lower = search_text.lower()
        
        for i, token in enumerate(self.tokens):
            if search_lower in token.text.lower():
                indices.append(i)
        
        return indices
    
    def get_alignment_quality_score(self) -> float:
        """Calculate a quality score for the alignment
        
        Returns:
            Score between 0 and 1 indicating alignment quality
        """
        if not self.tokens:
            return 0.0
        
        # Calculate based on available alignment information
        total_tokens = len(self.tokens)
        tokens_with_rvq = sum(1 for token in self.tokens if token.rvq_token_idx is not None)
        tokens_with_timing = sum(1 for token in self.tokens if token.end_time > token.start_time)
        
        rvq_score = tokens_with_rvq / total_tokens if total_tokens > 0 else 0
        timing_score = tokens_with_timing / total_tokens if total_tokens > 0 else 0
        
        # Weight the scores
        overall_score = (rvq_score * 0.6) + (timing_score * 0.4)
        
        return overall_score