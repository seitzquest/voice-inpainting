"""
Improved main pipeline for voice inpainting with RVQ tokens
Uses integrated approach for more seamless inpainting with correctly identified padding
and efficient memory management to reduce VRAM usage
"""

from typing import Dict, List, Optional, Union
import torch
import torchaudio
import os
import time
import argparse
import platform
from loguru import logger

from src.tokenization import AudioTokenizer
from src.semantic_edit import EditOperation, SemanticEditor
from src.integrated_inpainting import IntegratedVoiceInpainting
from src.memory_manager import MemoryManager


def setup_device() -> str:
    """Set up the device for inference

    Returns:
        Device string ("cuda" or "cpu")
    """
    device = "cpu"
    if torch.cuda.is_available():
        device = "cuda"
    elif (
        platform.system() == "Darwin"
        and hasattr(torch.backends, "mps")
        and torch.backends.mps.is_available()
    ):
        # MPS (Apple Silicon GPU) is available but has compatibility issues with sparse operations
        logger.warning(
            "MPS backend detected but not used due to compatibility issues with sparse tensors. "
            "Falling back to CPU. This will be slower but more reliable."
        )
        device = "cpu"  # Force CPU on macOS to avoid sparse tensor issues

    logger.info(f"Using device: {device}")

    # Log initial memory state
    if device == "cuda":
        MemoryManager.log_memory_stats("Initial GPU memory")

    return device


def voice_inpainting(
    input_file: str,
    output_file: str,
    edits: Union[str, List[Dict]],
    debug: bool = True,
    debug_dir: str = "data/debug_output",
    temperature: float = 0.7,
    topk: int = 25,
    session_id: Optional[str] = None,
) -> Dict:
    """Improved function for voice inpainting using TokenStore for state management

    Args:
        input_file: Path to the input voice message audio file
        output_file: Path to store the output audio
        edits: Either a single edit prompt (str) or a list of edit operations (List[Dict])
               Each dict should have 'original_text', 'edited_text', 'start_token_idx', 'end_token_idx'
        debug: Whether to save intermediate files for debugging
        debug_dir: Directory to save debug files if debug is True
        temperature: Temperature for token generation
        topk: Top-k value for sampling during generation
        session_id: Optional session ID for persistent edit history

    Returns:
        Dictionary containing:
        - tokenization: Result of tokenizing the inpainted audio with transcript and token metadata
        - processing_time: Time taken to process the edit
        - edit_operations: Edit operations that were applied
        - generated_regions: Regions of the audio that were generated
    """
    start_time = time.time()

    # Create debug directory if debug mode is enabled
    if debug:
        logger.info(
            f"Debug mode enabled. Intermediate files will be saved to {debug_dir}"
        )
        os.makedirs(debug_dir, exist_ok=True)

    # Set up device
    device = setup_device()

    # Load or create token store
    token_store = None
    is_new_session = True

    # Check if we have an existing session
    if session_id:
        # Try to retrieve existing session
        from src.token_store import get_token_store_by_id

        token_store = get_token_store_by_id(session_id)
        if token_store:
            logger.info(f"Using existing token store session: {session_id}")
            is_new_session = False

    # Create new token store if needed
    if token_store is None:
        from src.token_store import TokenStore

        token_store = TokenStore(device=device)
        logger.info(
            f"Created new token store with session ID: {token_store.get_session_id()}"
        )

        # Initialize token store with input audio
        token_store.initialize(input_file)

        # Save original audio for reference if in debug mode
        if debug:
            original_state = token_store.get_current_state()
            torchaudio.save(
                os.path.join(debug_dir, "01_original.wav"),
                original_state.audio.unsqueeze(0),
                original_state.sample_rate,
            )

            # Save transcription
            with open(os.path.join(debug_dir, "02_transcription.txt"), "w") as f:
                f.write(f"Original transcription: {original_state.text}\n")

    # Get the current token state
    current_state = token_store.get_current_state()

    # Process edits based on type
    if isinstance(edits, str):
        # Single edit prompt
        logger.info(f"Processing single edit prompt: {edits}")

        # Use SemanticEditor to find edit region
        from src.semantic_edit import SemanticEditor

        editor = SemanticEditor(token_store.tokenizer, load_llm=True)
        edit_op = editor.find_edit_region(current_state, edits)

        # Apply edit through token store
        token_store.apply_edit(
            edit_op.start_token_idx, edit_op.end_token_idx, edit_op.edited_text
        )

        # Save debug info if enabled
        if debug:
            with open(os.path.join(debug_dir, "03_edit_region.txt"), "w") as f:
                f.write(f"Edit prompt: {edits}\n")
                f.write(f"Original text: '{edit_op.original_text}'\n")
                f.write(f"Edited text: '{edit_op.edited_text}'\n")
                f.write(
                    f"Token range: {edit_op.start_token_idx} to {edit_op.end_token_idx}\n"
                )
                if edit_op.prepadding_text:
                    f.write(f"Pre-padding (before edit): '{edit_op.prepadding_text}'\n")
                if edit_op.postpadding_text:
                    f.write(
                        f"Post-padding (after edit): '{edit_op.postpadding_text}'\n"
                    )

        # Track the single edit operation for the response
        edit_operations = [
            {
                "original_text": edit_op.original_text,
                "edited_text": edit_op.edited_text,
                "start_token_idx": edit_op.start_token_idx,
                "end_token_idx": edit_op.end_token_idx,
            }
        ]
    else:
        # Multiple edit operations
        logger.info(f"Processing {len(edits)} edit operations")

        # Apply all edits through token store
        token_store.apply_edit_operations(edits)

        # Save debug info for each edit if enabled
        if debug:
            for i, edit_dict in enumerate(edits):
                with open(os.path.join(debug_dir, f"03_edit_{i + 1}.txt"), "w") as f:
                    f.write(f"Edit {i + 1}:\n")
                    f.write(f"Original text: '{edit_dict.get('original_text', '')}'\n")
                    f.write(f"Edited text: '{edit_dict.get('edited_text', '')}'\n")
                    f.write(
                        f"Token range: {edit_dict.get('start_token_idx', 0)} to {edit_dict.get('end_token_idx', 0)}\n"
                    )

        # Track edit operations for the response
        edit_operations = edits

    # Get the updated state and save the output
    result_state = token_store.get_current_state()

    # Save output audio
    out_dir = os.path.dirname(output_file)
    if out_dir and not os.path.exists(out_dir):
        os.makedirs(out_dir, exist_ok=True)

    logger.info(f"Saving final audio to {output_file}")
    torchaudio.save(
        output_file, result_state.audio.unsqueeze(0), result_state.sample_rate
    )

    # Save debug output if enabled
    if debug:
        debug_output = os.path.join(debug_dir, "04_inpainted_result.wav")
        torchaudio.save(
            debug_output, result_state.audio.unsqueeze(0), result_state.sample_rate
        )

    # Get version information
    versions = token_store.get_versions()
    current_version = versions[token_store.get_current_version_index()]

    # Extract generated regions
    generated_regions = current_version.get("generated_regions", [])

    # Calculate total processing time
    elapsed_time = time.time() - start_time
    logger.info(
        f"Voice inpainting completed successfully in {elapsed_time:.2f} seconds"
    )

    # Prepare response with tokens, text, and metadata
    response = {
        "tokenization": {
            "text": result_state.text,
            "tokens": [],
            "token_to_text_map": {
                str(k): v for k, v in (result_state.token_to_text_map or {}).items()
            },
            "text_to_token_map": {
                str(k): v for k, v in (result_state.text_to_token_map or {}).items()
            },
            "word_timestamps": result_state.word_timestamps,
            "semantic_to_rvq_map": {
                str(k): v for k, v in (result_state.semantic_to_rvq_map or {}).items()
            },
        },
        "processing_time": elapsed_time,
        "edit_operations": edit_operations,
        "generated_regions": generated_regions,
        "session_id": token_store.get_session_id(),
        "version_index": token_store.get_current_version_index(),
        "total_versions": len(versions),
    }

    # Extract token metadata for the response
    if result_state.word_timestamps:
        for word_info in result_state.word_timestamps:
            token_info = {
                "token_idx": word_info.get("token_idx", -1),
                "text": word_info.get("text", ""),
                "start_time": word_info.get("start", 0),
                "end_time": word_info.get("end", 0),
                "confidence": word_info.get("confidence", 1.0),
            }
            response["tokenization"]["tokens"].append(token_info)

    return response


def main():
    """Main entry point for voice inpainting CLI"""
    parser = argparse.ArgumentParser(description="Voice Inpainting with RVQ Tokens")
    parser.add_argument("--input", "-i", required=True, help="Input audio file")
    parser.add_argument("--output", "-o", required=True, help="Output audio file")
    parser.add_argument("--prompt", "-p", required=True, help="Edit prompt")
    parser.add_argument(
        "--temperature", "-t", type=float, default=0.7, help="Generation temperature"
    )
    parser.add_argument(
        "--topk", "-k", type=int, default=25, help="Top-k for token sampling"
    )
    parser.add_argument("--debug", "-d", action="store_true", help="Enable debug mode")
    parser.add_argument(
        "--debug-dir", default="data/debug_output", help="Debug output directory"
    )

    args = parser.parse_args()

    # Configure logging
    logger.remove()
    logger.add(lambda msg: print(msg, flush=True), level="INFO")
    logger.add("voice_inpainting.log", rotation="10 MB", level="DEBUG")

    voice_inpainting(
        input_file=args.input,
        output_file=args.output,
        edits=args.prompt,  # Use the prompt as a single edit
        debug=args.debug,
        debug_dir=args.debug_dir,
        temperature=args.temperature,
        topk=args.topk,
    )


if __name__ == "__main__":
    main()
