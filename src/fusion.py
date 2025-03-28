"""
Token fusion module for voice inpainting.
Combines original and generated RVQ tokens with smooth transitions.
"""

import torch
import numpy as np
from enum import Enum
from typing import Tuple, List, Optional
from dataclasses import dataclass
from loguru import logger


class FusionMethod(Enum):
    """Available fusion methods"""

    LINEAR = "linear"
    CROSSFADE = "crossfade"
    CONTEXTUAL = "contextual"
    DIRECT = "direct"


@dataclass
class FusionConfig:
    """Configuration for token fusion"""

    method: FusionMethod = FusionMethod.CONTEXTUAL
    crossfade_frames: int = 3
    alpha: float = 0.2  # For linear interpolation
    decay_factor: float = 0.1  # For exponential decay
    use_semantic_preservation: bool = True
    transition_codebooks: List[int] = None  # Codebooks to apply transition to

    def __post_init__(self):
        # Default: apply transition to all codebooks except the first (semantic)
        if self.transition_codebooks is None:
            self.transition_codebooks = list(range(1, 32))  # Assuming 32 codebooks


class TokenFusion:
    """Fuses original and generated RVQ tokens"""

    def __init__(self, config: Optional[FusionConfig] = None):
        """Initialize the token fusion module

        Args:
            config: Fusion configuration
        """
        self.config = config or FusionConfig()

    def fuse_tokens(
        self,
        original_tokens: torch.Tensor,
        generated_tokens: torch.Tensor,
        edit_range: Tuple[int, int],
    ) -> torch.Tensor:
        """Fuse original and generated tokens

        Args:
            original_tokens: Original RVQ tokens (num_codebooks, seq_len)
            generated_tokens: Generated RVQ tokens (num_codebooks, gen_len)
            edit_range: Tuple of (start_token_idx, end_token_idx)

        Returns:
            Fused RVQ tokens
        """
        start_idx, end_idx = edit_range

        # Validate input
        if start_idx < 0 or end_idx < start_idx:
            logger.error(f"Invalid edit range: [{start_idx}, {end_idx}]")
            raise ValueError(
                f"Invalid edit range: start_idx={start_idx}, end_idx={end_idx}"
            )

        if start_idx >= original_tokens.shape[1]:
            logger.error(
                f"Start index {start_idx} is out of bounds for tensor of length {original_tokens.shape[1]}"
            )
            start_idx = min(start_idx, original_tokens.shape[1] - 1)

        if end_idx > original_tokens.shape[1]:
            logger.error(
                f"End index {end_idx} is out of bounds for tensor of length {original_tokens.shape[1]}"
            )
            end_idx = min(end_idx, original_tokens.shape[1])

        # Special case: if start_idx == end_idx, this is an insertion (no tokens removed)
        # Handle edge case: empty original text (pure insertion)
        edit_len = end_idx - start_idx
        if edit_len <= 0:
            logger.info(f"Insertion detected at position {start_idx}")
            edit_len = 0

        # Get dimensions
        num_codebooks, orig_len = original_tokens.shape
        _, gen_len = generated_tokens.shape

        # Log if generated tokens are shorter than the edit range
        if gen_len < edit_len and edit_len > 0:
            logger.info(
                f"Generated tokens ({gen_len} frames) are shorter than edit range ({edit_len} frames)"
            )

        # Log dimensions for debugging
        logger.info(f"Original tokens shape: {original_tokens.shape}")
        logger.info(f"Generated tokens shape: {generated_tokens.shape}")
        logger.info(f"Edit range: [{start_idx}, {end_idx}] (length: {edit_len})")

        # Create the output tensor based on generated tokens length
        fused_len = orig_len - edit_len + gen_len
        logger.info(f"Creating fused tokens with length {fused_len}")

        fused_tokens = torch.zeros(
            (num_codebooks, fused_len), dtype=torch.long, device=original_tokens.device
        )

        # Copy the tokens before the edit
        if start_idx > 0:
            logger.info(f"Copying tokens before edit: 0 to {start_idx}")
            fused_tokens[:, :start_idx] = original_tokens[:, :start_idx]

        # Copy the generated tokens into the middle section
        if gen_len > 0:
            middle_section = slice(start_idx, start_idx + gen_len)
            logger.info(
                f"Inserting generated tokens at position {start_idx} to {start_idx + gen_len}"
            )
            fused_tokens[:, middle_section] = generated_tokens

        # Copy the tokens after the edit - using original end_idx
        after_section_start = start_idx + gen_len
        if after_section_start < fused_len and end_idx < orig_len:
            logger.info(f"Copying tokens after edit from position {end_idx} to end")
            fused_tokens[:, after_section_start:] = original_tokens[:, end_idx:]

        # Choose fusion method
        if self.config.method == FusionMethod.DIRECT:
            # Direct replacement without transitions
            logger.info("Using direct replacement without transitions")
            # Generated tokens already copied above
            pass

        elif self.config.method == FusionMethod.LINEAR:
            # Linear interpolation at the boundaries
            logger.info("Applying linear fusion at boundaries")
            self._apply_linear_fusion(
                fused_tokens, original_tokens, generated_tokens, start_idx, end_idx
            )

        elif self.config.method == FusionMethod.CROSSFADE:
            # Crossfade transition
            logger.info("Applying crossfade fusion")
            self._apply_crossfade_fusion(
                fused_tokens, original_tokens, generated_tokens, start_idx, end_idx
            )

        elif self.config.method == FusionMethod.CONTEXTUAL:
            # Contextual adaptation (more complex)
            logger.info("Applying contextual fusion")
            self._apply_contextual_fusion(
                fused_tokens, original_tokens, generated_tokens, start_idx, end_idx
            )

        logger.info(
            f"Fused tokens with method: {self.config.method.value}, final shape: {fused_tokens.shape}"
        )

        # Validate the output
        if torch.isnan(fused_tokens).any():
            logger.error("NaN values detected in fused tokens")

        if torch.max(fused_tokens) >= 2051:  # Assuming 2051 is the vocab size
            logger.error(
                f"Invalid token detected: max value = {torch.max(fused_tokens).item()}"
            )

        return fused_tokens

    def _apply_linear_fusion(
        self,
        fused_tokens: torch.Tensor,
        original_tokens: torch.Tensor,
        generated_tokens: torch.Tensor,
        start_idx: int,
        end_idx: int,
    ) -> None:
        """Apply linear interpolation fusion

        Args:
            fused_tokens: Output tensor to modify in-place
            original_tokens: Original RVQ tokens
            generated_tokens: Generated RVQ tokens
            start_idx: Start index of edit
            end_idx: End index of edit
        """
        # Copy the generated tokens to the middle section
        gen_len = generated_tokens.shape[1]
        middle_section = slice(start_idx, start_idx + gen_len)
        fused_tokens[:, middle_section] = generated_tokens

        # Apply alpha-blending to semantic tokens if needed
        if not self.config.use_semantic_preservation:
            blend_region = self.config.transition_codebooks
        else:
            # Skip the first (semantic) codebook
            blend_region = [cb for cb in self.config.transition_codebooks if cb > 0]

        crossfade_frames = self.config.crossfade_frames

        # Apply left transition (beginning of edit)
        if start_idx >= crossfade_frames:
            for i in range(crossfade_frames):
                # Create interpolation factor that goes from 0.0 to 1.0
                alpha = i / crossfade_frames
                blend_idx = start_idx - crossfade_frames + i

                if blend_idx < 0 or blend_idx >= fused_tokens.shape[1]:
                    continue  # Skip invalid indices

                # Only blend specific codebooks
                for cb in blend_region:
                    if cb >= fused_tokens.shape[0]:
                        continue  # Skip invalid codebook indices

                    # Use the original token with probability (1-alpha)
                    if torch.rand(1).item() > alpha:
                        # Get a suitable token from original sequence
                        orig_idx = min(blend_idx, original_tokens.shape[1] - 1)
                        if orig_idx >= 0:
                            fused_tokens[cb, blend_idx] = original_tokens[cb, orig_idx]

        # Apply right transition (end of edit)
        right_start = start_idx + gen_len - crossfade_frames
        if right_start >= 0 and end_idx < original_tokens.shape[1]:
            for i in range(crossfade_frames):
                # Create interpolation factor that goes from 1.0 to 0.0
                alpha = (crossfade_frames - i) / crossfade_frames
                blend_idx = right_start + i

                if blend_idx < 0 or blend_idx >= fused_tokens.shape[1]:
                    continue  # Skip invalid indices

                # Only blend specific codebooks
                for cb in blend_region:
                    if cb >= fused_tokens.shape[0]:
                        continue  # Skip invalid codebook indices

                    # Use the original token with probability (1-alpha)
                    if torch.rand(1).item() > alpha:
                        # Get a suitable token from original sequence
                        orig_idx = min(
                            end_idx - crossfade_frames + i, original_tokens.shape[1] - 1
                        )
                        if orig_idx >= 0:
                            fused_tokens[cb, blend_idx] = original_tokens[cb, orig_idx]

    def _apply_crossfade_fusion(
        self,
        fused_tokens: torch.Tensor,
        original_tokens: torch.Tensor,
        generated_tokens: torch.Tensor,
        start_idx: int,
        end_idx: int,
    ) -> None:
        """Apply crossfade fusion

        Args:
            fused_tokens: Output tensor to modify in-place
            original_tokens: Original RVQ tokens
            generated_tokens: Generated RVQ tokens
            start_idx: Start index of edit
            end_idx: End index of edit
        """
        # Copy the generated tokens to the middle section
        gen_len = generated_tokens.shape[1]
        middle_section = slice(start_idx, start_idx + gen_len)
        fused_tokens[:, middle_section] = generated_tokens

        # Apply crossfade to transition regions
        crossfade_frames = self.config.crossfade_frames

        # Determine which codebooks to transition
        if not self.config.use_semantic_preservation:
            blend_region = self.config.transition_codebooks
        else:
            # Skip the first (semantic) codebook
            blend_region = [cb for cb in self.config.transition_codebooks if cb > 0]

        # Left transition (beginning of edit)
        left_start = max(0, start_idx - crossfade_frames)
        if start_idx > 0 and left_start < start_idx:
            for cb in blend_region:
                if cb >= fused_tokens.shape[0]:
                    continue  # Skip if codebook index is invalid

                for i in range(start_idx - left_start):
                    pos = left_start + i
                    # Calculate crossfade weight
                    alpha = i / (start_idx - left_start)

                    # For codebooks, we can't interpolate directly, so we use stochastic mixing
                    if torch.rand(1).item() > alpha:
                        # This position should still use original token
                        if (
                            pos < fused_tokens.shape[1]
                            and pos < original_tokens.shape[1]
                        ):
                            fused_tokens[cb, pos] = original_tokens[cb, pos]

        # Right transition (end of edit)
        right_start = start_idx + gen_len
        right_end = min(right_start + crossfade_frames, fused_tokens.shape[1])

        if right_start < fused_tokens.shape[1] and end_idx < original_tokens.shape[1]:
            for cb in blend_region:
                if cb >= fused_tokens.shape[0]:
                    continue  # Skip if codebook index is invalid

                for i in range(right_end - right_start):
                    # Calculate crossfade weight
                    alpha = 1 - (i / min(crossfade_frames, right_end - right_start))
                    pos = right_start + i

                    # For codebooks, we can't interpolate directly, so we use stochastic mixing
                    if torch.rand(1).item() > alpha:
                        # This position should use original token
                        right_orig_idx = min(end_idx + i, original_tokens.shape[1] - 1)
                        if right_orig_idx >= 0 and pos < fused_tokens.shape[1]:
                            fused_tokens[cb, pos] = original_tokens[cb, right_orig_idx]

    def _apply_contextual_fusion(
        self,
        fused_tokens: torch.Tensor,
        original_tokens: torch.Tensor,
        generated_tokens: torch.Tensor,
        start_idx: int,
        end_idx: int,
    ) -> None:
        """Apply contextual fusion with adaptive transitions

        Args:
            fused_tokens: Output tensor to modify in-place
            original_tokens: Original RVQ tokens
            generated_tokens: Generated RVQ tokens
            start_idx: Start index of edit
            end_idx: End index of edit
        """
        # This implementation is more advanced, using features from both contexts
        # First, insert the generated tokens
        gen_len = generated_tokens.shape[1]

        # Safety check
        if start_idx < 0 or start_idx + gen_len > fused_tokens.shape[1]:
            logger.error(
                f"Invalid indices for inserting generated tokens: {start_idx} to {start_idx + gen_len}"
            )
            # Adjust to valid range
            start_pos = max(0, start_idx)
            end_pos = min(fused_tokens.shape[1], start_idx + gen_len)
            if end_pos > start_pos:
                gen_slice = slice(0, end_pos - start_pos)
                fused_tokens[:, start_pos:end_pos] = generated_tokens[:, gen_slice]
        else:
            fused_tokens[:, start_idx : start_idx + gen_len] = generated_tokens

        # Define a larger context window for analysis
        context_size = 2 * self.config.crossfade_frames

        # Analyze left context (before edit)
        left_start = max(0, start_idx - context_size)
        left_context = original_tokens[:, left_start:start_idx]

        # Analyze right context (after edit)
        right_end = min(original_tokens.shape[1], end_idx + context_size)
        right_context = original_tokens[:, end_idx:right_end]

        # Extract pattern statistics
        def get_token_stats(tokens):
            if tokens.shape[1] == 0:
                return None
            # For each codebook, calculate token distribution
            stats = {}
            for cb in range(tokens.shape[0]):
                unique, counts = torch.unique(tokens[cb], return_counts=True)
                stats[cb] = dict(zip(unique.tolist(), counts.tolist()))
            return stats

        left_stats = get_token_stats(left_context)
        right_stats = get_token_stats(right_context)

        # Apply adaptive transitions based on statistical patterns
        crossfade_frames = self.config.crossfade_frames

        # For each codebook that needs transition
        if not self.config.use_semantic_preservation:
            blend_region = self.config.transition_codebooks
        else:
            # Skip the first (semantic) codebook
            blend_region = [cb for cb in self.config.transition_codebooks if cb > 0]

        # Left transition (beginning of edit)
        if start_idx >= crossfade_frames and left_stats:
            for cb in blend_region:
                if cb >= fused_tokens.shape[0]:
                    continue  # Skip invalid codebook indices

                for i in range(crossfade_frames):
                    # Exponential decay for smoother transition
                    # This puts more weight on context near the boundary
                    alpha = (i / crossfade_frames) ** self.config.decay_factor
                    blend_idx = start_idx - crossfade_frames + i

                    if blend_idx >= 0 and blend_idx < fused_tokens.shape[1]:
                        # With probability (1-alpha), use a token from left context distribution
                        if torch.rand(1).item() > alpha and cb in left_stats:
                            # Sample from left context distribution
                            token_choices = list(left_stats[cb].keys())
                            weights = list(left_stats[cb].values())
                            if token_choices:
                                # Convert to probabilities
                                weights = np.array(weights) / sum(weights)
                                sampled_token = np.random.choice(
                                    token_choices, p=weights
                                )
                                fused_tokens[cb, blend_idx] = sampled_token

        # Right transition (end of edit)
        right_start = start_idx + gen_len
        if right_start < fused_tokens.shape[1] and right_stats:
            for cb in blend_region:
                if cb >= fused_tokens.shape[0]:
                    continue  # Skip invalid codebook indices

                for i in range(crossfade_frames):
                    if right_start + i >= fused_tokens.shape[1]:
                        continue

                    # Exponential decay for smoother transition
                    alpha = (
                        (crossfade_frames - i) / crossfade_frames
                    ) ** self.config.decay_factor
                    blend_idx = right_start + i

                    # With probability (1-alpha), use a token from right context distribution
                    if torch.rand(1).item() > alpha and cb in right_stats:
                        # Sample from right context distribution
                        token_choices = list(right_stats[cb].keys())
                        weights = list(right_stats[cb].values())
                        if token_choices:
                            # Convert to probabilities
                            weights = np.array(weights) / sum(weights)
                            sampled_token = np.random.choice(token_choices, p=weights)
                            fused_tokens[cb, blend_idx] = sampled_token
