import json
import uuid
import torch
import torchaudio
import os
import time
import tempfile
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Tuple, Optional, Union, Any
from copy import deepcopy
from pathlib import Path
from loguru import logger

from src.tokenization import TokenizedAudio, AudioTokenizer
from src.semantic_edit import EditOperation
from src.integrated_inpainting import IntegratedVoiceInpainting
from src.memory_manager import MemoryManager


@dataclass
class TokenStoreVersion:
    """Represents a version of the token state with metadata"""

    # Version metadata
    id: str
    label: str
    timestamp: float  # Unix timestamp

    # Token data
    token_data: TokenizedAudio

    # Audio path for persistence
    audio_path: Optional[str] = None

    # Edit metadata
    edit_description: str = ""
    modified_token_indices: List[int] = field(default_factory=list)
    generated_regions: List[Dict] = field(default_factory=list)


class TokenStore:
    """
    Maintains the state of tokens for voice inpainting with version history.
    Serves as a single source of truth for token alignment.
    """

    def __init__(self, device="cuda", session_dir=None):
        """Initialize the token store

        Args:
            device: Device to use for tokenization and processing
            session_dir: Directory to store session data (defaults to tmp)
        """
        self.device = device
        self.tokenizer = AudioTokenizer(device=device)

        # Set up inpainting engine for applying edits
        self.inpainting = IntegratedVoiceInpainting(device=device)

        # Version history
        self.versions = []
        self.current_version_index = -1

        # Original (ground truth) state
        self.original_state = None

        # Current working state
        self.current_state = None

        # Session management
        self.session_id = str(uuid.uuid4())

        # Set up session directory for persistence
        if session_dir:
            self.session_dir = Path(session_dir)
        else:
            self.session_dir = (
                Path(tempfile.gettempdir()) / "token_store" / self.session_id
            )

        # Create session directory if it doesn't exist
        self.session_dir.mkdir(parents=True, exist_ok=True)

        # Paths for audio storage
        self.audio_dir = self.session_dir / "audio"
        self.audio_dir.mkdir(exist_ok=True)

        logger.info(f"TokenStore initialized with session ID: {self.session_id}")

    def initialize(self, audio_path, speaker_id=0):
        """Initialize token store with audio file

        Args:
            audio_path: Path to audio file
            speaker_id: Speaker identifier (default 0)

        Returns:
            TokenizedAudio representing the initial state
        """
        logger.info(f"Initializing TokenStore with audio from: {audio_path}")

        # Log memory before tokenization
        MemoryManager.log_memory_stats("Before TokenStore initialization")

        # Tokenize the audio only once for the entire session
        tokenized_audio = self.tokenizer.tokenize(audio_path, speaker_id=speaker_id)

        # Store as original and current state
        self.original_state = tokenized_audio
        self.current_state = deepcopy(tokenized_audio)

        # Save a copy of the original audio
        original_audio_path = self._save_audio(audio_path, "original")

        # Create initial version
        version_id = self._save_version_internal(
            "Original", "Original audio", [], original_audio_path
        )

        # Log memory after tokenization
        MemoryManager.log_memory_stats("After TokenStore initialization")

        logger.info(
            f"TokenStore initialized with audio length: {tokenized_audio.audio.shape[0] / tokenized_audio.sample_rate:.2f}s"
        )
        logger.info(f"Transcript: {tokenized_audio.text}")
        if tokenized_audio.rvq_tokens is not None:
            logger.info(f"RVQ tokens shape: {tokenized_audio.rvq_tokens.shape}")

        return self.current_state

    def initialize_from_blob(self, audio_blob, speaker_id=0):
        """Initialize token store from an audio blob

        Args:
            audio_blob: Audio blob (bytes or file-like object)
            speaker_id: Speaker identifier (default 0)

        Returns:
            TokenizedAudio representing the initial state
        """
        logger.info("Initializing TokenStore from audio blob")

        # Save blob to temporary file
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_file:
            tmp_path = tmp_file.name

            # If blob is bytes, write directly
            if isinstance(audio_blob, bytes):
                tmp_file.write(audio_blob)
            # If blob is a file-like object, read and write
            else:
                tmp_file.write(audio_blob.read())

        try:
            # Initialize from the temp file
            result = self.initialize(tmp_path, speaker_id)
        finally:
            # Always clean up the temp file
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)

        return result

    def apply_edit(self, start_token_idx, end_token_idx, new_text):
        """Apply a text edit to the current state

        Args:
            start_token_idx: Starting token index (inclusive)
            end_token_idx: Ending token index (exclusive)
            new_text: New text to replace the token range

        Returns:
            Modified TokenizedAudio state
        """
        if self.current_state is None:
            raise ValueError("TokenStore not initialized")

        logger.info(
            f"Applying edit: tokens [{start_token_idx}:{end_token_idx}] -> '{new_text}'"
        )

        # Get original text
        original_text = self._get_text_for_token_range(start_token_idx, end_token_idx)

        # Create an edit operation
        edit_op = EditOperation(
            original_text=original_text,
            edited_text=new_text,
            start_token_idx=start_token_idx,
            end_token_idx=end_token_idx,
        )

        # Apply the edit to generate new audio and tokens
        modified_audio, modified_tokens, generated_regions = self._apply_edit_operation(
            edit_op
        )

        # Update the current state with modified data
        self._update_state_from_edit(
            edit_op, modified_audio, modified_tokens, generated_regions
        )

        # Save the new version
        description = f"{original_text} → {new_text}"
        modified_indices = list(range(start_token_idx, end_token_idx))
        version_id = self.save_version(
            "Edit", description, modified_indices, generated_regions
        )

        logger.info(f"Edit applied successfully. New version: {version_id}")

        return self.current_state

    def apply_edit_operations(self, edit_operations):
        """Apply multiple edit operations at once

        Args:
            edit_operations: List of EditOperation objects or dicts

        Returns:
            Modified TokenizedAudio state
        """
        if self.current_state is None:
            raise ValueError("TokenStore not initialized")

        logger.info(f"Applying {len(edit_operations)} edit operations")

        # Convert dicts to EditOperation objects if needed
        normalized_ops = []
        for op in edit_operations:
            if isinstance(op, dict):
                # Get the original text if not provided
                original_text = op.get("original_text", "")
                if not original_text:
                    original_text = self._get_text_for_token_range(
                        op.get("start_token_idx", 0), op.get("end_token_idx", 0)
                    )

                normalized_ops.append(
                    EditOperation(
                        original_text=original_text,
                        edited_text=op.get("edited_text", ""),
                        start_token_idx=op.get("start_token_idx", 0),
                        end_token_idx=op.get("end_token_idx", 0),
                    )
                )
            else:
                normalized_ops.append(op)

        # Sort by start position (process from left to right)
        normalized_ops.sort(key=lambda op: op.start_token_idx)

        # Track token indices that get modified
        modified_indices = []

        # Track all generated regions
        all_generated_regions = []

        # Apply each edit operation
        for op in normalized_ops:
            # Collect modified token indices
            for i in range(op.start_token_idx, op.end_token_idx):
                if i not in modified_indices:
                    modified_indices.append(i)

            # Apply the edit to generate new audio and tokens
            modified_audio, modified_tokens, generated_regions = (
                self._apply_edit_operation(op)
            )

            # Update the current state with modified data
            self._update_state_from_edit(
                op, modified_audio, modified_tokens, generated_regions
            )

            # Collect generated regions
            all_generated_regions.extend(generated_regions)

        # Create a combined edit description
        edit_description = " | ".join(
            [f"{op.original_text} → {op.edited_text}" for op in normalized_ops]
        )

        # Save a version with the edits
        version_id = self.save_version(
            "Multi-edit", edit_description, modified_indices, all_generated_regions
        )

        logger.info(f"Multiple edits applied successfully. New version: {version_id}")

        return self.current_state

    def get_current_state(self):
        """Get the current TokenizedAudio state

        Returns:
            Current TokenizedAudio state
        """
        return self.current_state

    def save_version(
        self, label, description="", modified_token_indices=None, generated_regions=None
    ):
        """Save current state as a new version

        Args:
            label: Short label for the version
            description: Longer description of changes
            modified_token_indices: List of token indices that were modified
            generated_regions: List of {start, end} time ranges that were generated

        Returns:
            Version ID
        """
        # Save the current audio to a file
        current_audio_path = self._save_audio_from_tensor(
            self.current_state.audio,
            self.current_state.sample_rate,
            label.lower().replace(" ", "_"),
        )

        # Save version
        return self._save_version_internal(
            label,
            description,
            modified_token_indices or [],
            current_audio_path,
            generated_regions or [],
        )

    def restore_version(self, version_id=None, version_index=None):
        """Restore to a previous version by ID or index

        Args:
            version_id: Version ID to restore
            version_index: Version index to restore (alternative to version_id)

        Returns:
            Restored TokenizedAudio state
        """
        if self.current_state is None:
            raise ValueError("TokenStore not initialized")

        if version_id is not None:
            # Find version by ID
            for i, version in enumerate(self.versions):
                if version.id == version_id:
                    version_index = i
                    break
            else:
                raise ValueError(f"Version ID {version_id} not found")

        if version_index is not None:
            if version_index < 0 or version_index >= len(self.versions):
                raise ValueError(f"Version index {version_index} out of range")

            logger.info(f"Restoring to version index {version_index}")

            # Set current version index
            self.current_version_index = version_index

            # Restore state from version
            self.current_state = deepcopy(self.versions[version_index].token_data)

            logger.info(f"Restored to version: {self.versions[version_index].label}")
        else:
            raise ValueError("Must provide either version_id or version_index")

        return self.current_state

    def get_versions(self):
        """Get all versions

        Returns:
            List of version metadata (without full token data)
        """
        # Return lightweight version info without full token data
        result = []
        for i, v in enumerate(self.versions):
            result.append(
                {
                    "id": v.id,
                    "label": v.label,
                    "timestamp": v.timestamp,
                    "edit_description": v.edit_description,
                    "modified_token_indices": v.modified_token_indices,
                    "generated_regions": v.generated_regions,
                    "index": i,
                    "is_current": (i == self.current_version_index),
                }
            )
        return result

    def get_version(self, version_id=None, version_index=None):
        """Get a specific version

        Args:
            version_id: Version ID to get
            version_index: Version index to get (alternative to version_id)

        Returns:
            TokenStoreVersion object
        """
        if version_id is not None:
            # Find version by ID
            for i, version in enumerate(self.versions):
                if version.id == version_id:
                    version_index = i
                    break
            else:
                raise ValueError(f"Version ID {version_id} not found")

        if version_index is not None:
            if version_index < 0 or version_index >= len(self.versions):
                raise ValueError(f"Version index {version_index} out of range")

            return self.versions[version_index]
        else:
            raise ValueError("Must provide either version_id or version_index")

    def get_current_version_index(self):
        """Get the current version index

        Returns:
            Current version index
        """
        return self.current_version_index

    def get_session_id(self):
        """Get the session ID

        Returns:
            Session ID
        """
        return self.session_id

    def _save_version_internal(
        self,
        label,
        description,
        modified_token_indices,
        audio_path,
        generated_regions=None,
    ):
        """Internal method to save a version

        Args:
            label: Short label for the version
            description: Longer description of changes
            modified_token_indices: List of token indices that were modified
            audio_path: Path to the audio file for this version
            generated_regions: List of {start, end} time ranges that were generated

        Returns:
            Version ID
        """
        # Generate a unique ID
        version_id = str(uuid.uuid4())

        # Create a new version object
        version = TokenStoreVersion(
            id=version_id,
            label=label,
            timestamp=time.time(),
            token_data=deepcopy(self.current_state),
            audio_path=audio_path,
            edit_description=description,
            modified_token_indices=modified_token_indices,
            generated_regions=generated_regions or [],
        )

        # If we've gone back in history and then made a change, remove future versions
        if self.current_version_index < len(self.versions) - 1:
            logger.info(
                f"Removing {len(self.versions) - self.current_version_index - 1} future versions"
            )
            self.versions = self.versions[: self.current_version_index + 1]

        # Add to versions list
        self.versions.append(version)
        self.current_version_index = len(self.versions) - 1

        return version_id

    def _get_text_for_token_range(self, start_token_idx, end_token_idx):
        """Get text for a token range

        Args:
            start_token_idx: Starting token index (inclusive)
            end_token_idx: Ending token index (exclusive)

        Returns:
            Text for the token range
        """
        if self.current_state is None:
            raise ValueError("TokenStore not initialized")

        # Initialize empty result
        result_text = ""

        # Use token_to_text_map to find the text positions
        if self.current_state.token_to_text_map:
            # Find the text ranges for each token in the range
            start_positions = []
            end_positions = []

            for token_idx in range(start_token_idx, end_token_idx):
                if token_idx in self.current_state.token_to_text_map:
                    char_idx = self.current_state.token_to_text_map[token_idx]
                    start_positions.append(char_idx)

                    # Try to find end position from next token
                    for next_idx in range(token_idx + 1, end_token_idx + 2):
                        if next_idx in self.current_state.token_to_text_map:
                            end_positions.append(
                                self.current_state.token_to_text_map[next_idx]
                            )
                            break

            if start_positions:
                # Get the range of text from min start to max end position
                min_start = min(start_positions)

                if end_positions:
                    max_end = max(end_positions)
                else:
                    # If no end positions, use the length of the text
                    max_end = len(self.current_state.text)

                # Extract the text from the current state
                result_text = self.current_state.text[min_start:max_end]

        # If we couldn't determine the text from the token map, try using word timestamps
        if not result_text and self.current_state.word_timestamps:
            # Find words that correspond to the token range
            words = []

            # Filter word timestamps to those in our token range
            for word_info in self.current_state.word_timestamps:
                # This depends on how word_timestamps is structured
                token_idx = word_info.get("token_idx")

                if (
                    token_idx is not None
                    and start_token_idx <= token_idx < end_token_idx
                ):
                    words.append(word_info.get("text", ""))

            # Join words with spaces
            result_text = " ".join(words)

        # If we still have no text, use a placeholder
        if not result_text:
            result_text = f"[Tokens {start_token_idx}-{end_token_idx}]"
            logger.warning(
                f"Could not determine text for token range {start_token_idx}-{end_token_idx}"
            )

        return result_text

    def _apply_edit_operation(self, edit_op):
        """Apply an edit operation to the audio

        Uses the integrated inpainting module to regenerate audio for the edited segment.

        Args:
            edit_op: EditOperation to apply

        Returns:
            Tuple of (modified_audio, modified_tokens, generated_regions)
        """
        if self.current_state is None:
            raise ValueError("TokenStore not initialized")

        start_idx = edit_op.start_token_idx
        end_idx = edit_op.end_token_idx

        logger.info(
            f"Applying edit operation: [{start_idx}:{end_idx}] '{edit_op.original_text}' -> '{edit_op.edited_text}'"
        )

        try:
            # Log memory before inpainting
            MemoryManager.log_memory_stats("Before inpainting in TokenStore")

            # Apply inpainting to generate new audio for the edited region
            inpainted_tokens, inpainted_audio, sr = self.inpainting.inpaint(
                self.current_state, edit_op, temperature=0.7, topk=25
            )

            # Log memory after inpainting
            MemoryManager.log_memory_stats("After inpainting in TokenStore")

            # Create a record of the generated region based on token timing
            generated_regions = []

            # Get timing information for the tokens
            if self.current_state.word_timestamps:
                # Find the word timestamps that correspond to our token range
                for word_info in self.current_state.word_timestamps:
                    token_idx = word_info.get("token_idx")
                    if token_idx is not None and start_idx <= token_idx < end_idx:
                        generated_regions.append(
                            {
                                "start": word_info.get("start_time", 0),
                                "end": word_info.get("end_time", 0),
                                "original": edit_op.original_text,
                                "edited": edit_op.edited_text,
                            }
                        )
                        break  # Just need one region for now

            # If no timestamps found, create a generic region
            if not generated_regions:
                # Create a placeholder region - in real system this would have actual timing
                generated_regions.append(
                    {
                        "start": 0.5,  # Placeholder
                        "end": 1.5,  # Placeholder
                        "original": edit_op.original_text,
                        "edited": edit_op.edited_text,
                    }
                )

            return inpainted_audio, inpainted_tokens, generated_regions

        except Exception as e:
            logger.error(f"Error applying edit operation: {e}")
            # Return unmodified audio and tokens on error
            return self.current_state.audio, self.current_state.rvq_tokens, []

    def _update_state_from_edit(
        self, edit_op, modified_audio, modified_tokens, generated_regions
    ):
        """Update the current state after an edit

        Args:
            edit_op: The edit operation that was applied
            modified_audio: The modified audio tensor
            modified_tokens: The modified RVQ tokens
            generated_regions: The regions that were generated
        """
        if self.current_state is None:
            raise ValueError("TokenStore not initialized")

        # Update audio
        self.current_state.audio = modified_audio

        # Update RVQ tokens
        self.current_state.rvq_tokens = modified_tokens

        # Update text with the edited text
        if (
            self.current_state.token_to_text_map
            and edit_op.start_token_idx in self.current_state.token_to_text_map
        ):
            # Get start char position
            start_char = self.current_state.token_to_text_map[edit_op.start_token_idx]

            # Get end char position if available, otherwise estimate
            end_char = None
            if edit_op.end_token_idx in self.current_state.token_to_text_map:
                end_char = self.current_state.token_to_text_map[edit_op.end_token_idx]
            else:
                # Look for the nearest token after end_token_idx
                token_indices = sorted(self.current_state.token_to_text_map.keys())
                for token_idx in token_indices:
                    if token_idx > edit_op.end_token_idx:
                        end_char = self.current_state.token_to_text_map[token_idx]
                        break

            # If end char not found, use end of text
            if end_char is None:
                end_char = len(self.current_state.text)

            # Update text with the edited text
            self.current_state.text = (
                self.current_state.text[:start_char]
                + edit_op.edited_text
                + self.current_state.text[end_char:]
            )

    def _save_audio(self, audio_path, label):
        """Save a copy of an audio file to the session's audio directory

        Args:
            audio_path: Path to the audio file
            label: Label for the audio file

        Returns:
            Path to the saved audio file
        """
        # Generate a unique filename
        filename = f"{label}_{int(time.time())}.wav"
        save_path = self.audio_dir / filename

        # Copy the audio file
        import shutil

        shutil.copy2(audio_path, save_path)

        return str(save_path)

    def _save_audio_from_tensor(self, audio_tensor, sample_rate, label):
        """Save an audio tensor to the session's audio directory

        Args:
            audio_tensor: Audio tensor
            sample_rate: Sample rate
            label: Label for the audio file

        Returns:
            Path to the saved audio file
        """
        # Generate a unique filename
        filename = f"{label}_{int(time.time())}.wav"
        save_path = self.audio_dir / filename

        # Ensure tensor has the right shape for torchaudio.save
        if audio_tensor.dim() == 1:
            audio_tensor = audio_tensor.unsqueeze(0)

        # Save the audio
        torchaudio.save(str(save_path), audio_tensor.cpu(), sample_rate)

        return str(save_path)

    def cleanup(self):
        """Clean up resources used by the token store"""
        # Clear GPU memory
        MemoryManager.clear_gpu_memory()

        # Clean up the tokenizer
        if hasattr(self.tokenizer, "cleanup"):
            self.tokenizer.cleanup()

        # Clean up the inpainting engine
        if hasattr(self.inpainting, "_unload_csm_model"):
            self.inpainting._unload_csm_model()

        logger.info("TokenStore cleaned up")

    def to_dict(self):
        """Convert current state to a dictionary for API responses

        Returns:
            Dictionary representation of the current state
        """
        if self.current_state is None:
            return {"error": "TokenStore not initialized"}

        # Extract serializable data from the current state
        result = {
            "text": self.current_state.text,
            "tokens": [],
            "session_id": self.session_id,
            "current_version_index": self.current_version_index,
            "total_versions": len(self.versions),
            "versions": self.get_versions(),
        }

        # Convert tokens to a serializable format
        if self.current_state.word_timestamps:
            for word_info in self.current_state.word_timestamps:
                token_info = {
                    "token_idx": word_info.get("token_idx", -1),
                    "text": word_info.get("text", ""),
                    "start_time": word_info.get("start", 0),
                    "end_time": word_info.get("end", 0),
                    "confidence": word_info.get("confidence", 1.0),
                }
                result["tokens"].append(token_info)

        return result


# Global registry of token stores
_TOKEN_STORES = {}


def register_token_store(token_store):
    """Register a token store in the global registry

    Args:
        token_store: TokenStore instance
    """
    global _TOKEN_STORES
    session_id = token_store.get_session_id()
    _TOKEN_STORES[session_id] = token_store
    return session_id


def get_token_store_by_id(session_id):
    """Get a token store by session ID

    Args:
        session_id: Session ID

    Returns:
        TokenStore instance or None if not found
    """
    return _TOKEN_STORES.get(session_id)


def cleanup_token_store(session_id):
    """Clean up and remove a token store from the registry

    Args:
        session_id: Session ID
    """
    global _TOKEN_STORES
    if session_id in _TOKEN_STORES:
        token_store = _TOKEN_STORES[session_id]
        token_store.cleanup()
        del _TOKEN_STORES[session_id]
