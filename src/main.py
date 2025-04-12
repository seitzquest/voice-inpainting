"""
Improved main pipeline for voice inpainting with RVQ tokens
Uses integrated approach for more seamless inpainting with correctly identified padding
and efficient memory management to reduce VRAM usage
"""

from typing import Dict, List, Union
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
) -> Dict:
    """Improved function for voice inpainting with integrated generation and tokenization
    and memory-efficient processing

    Args:
        input_file: Path to the input voice message audio file
        output_file: Path to store the output audio
        edits: Either a single edit prompt (str) or a list of edit operations (List[Dict])
               Each dict should have 'original_text', 'edited_text', 'start_token_idx', 'end_token_idx'
        debug: Whether to save intermediate files for debugging
        debug_dir: Directory to save debug files if debug is True
        temperature: Temperature for token generation
        topk: Top-k value for sampling during generation

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

    # Step 1: Tokenize input audio to RVQ tokens
    logger.info("Tokenizing input audio to RVQ tokens...")
    MemoryManager.log_memory_stats("Before tokenization")

    tokenizer = AudioTokenizer(device=device)
    tokenized_audio = tokenizer.tokenize(input_file)

    MemoryManager.log_memory_stats("After tokenization")

    if debug:
        # Save original audio for reference
        torchaudio.save(
            os.path.join(debug_dir, "01_original.wav"),
            tokenized_audio.audio.unsqueeze(0),
            tokenized_audio.sample_rate,
        )

        # Also save transcription
        with open(os.path.join(debug_dir, "02_transcription.txt"), "w") as f:
            f.write(f"Original transcription: {tokenized_audio.text}\n")

    # Step 2: Process the edits - either convert a single prompt to an edit operation
    #         or use the provided list of edits
    edit_operations = []

    if isinstance(edits, str):
        # Single edit prompt provided - use SemanticEditor to find edit region
        logger.info(f"Processing single edit prompt: {edits}")
        MemoryManager.log_memory_stats("Before semantic editing")

        editor = SemanticEditor(tokenizer, load_llm=True)
        edit_op = editor.find_edit_region(tokenized_audio, edits)
        edit_operations.append(edit_op)

        # Clear memory after using LLM
        MemoryManager.clear_gpu_memory()
        MemoryManager.log_memory_stats("After semantic editing")

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
    else:
        # Multiple edit operations provided as dictionaries
        logger.info(f"Processing {len(edits)} edit operations")

        # Sort edit operations by their start_token_idx to process from left to right
        sorted_edits = sorted(edits, key=lambda op: op["start_token_idx"])

        # Process each edit operation to create EditOperation objects
        editor = SemanticEditor(
            tokenizer, load_llm=False
        )  # No LLM needed for manual edits

        for i, edit_dict in enumerate(sorted_edits):
            # Create basic EditOperation object
            basic_op = EditOperation(
                original_text=edit_dict["original_text"],
                edited_text=edit_dict["edited_text"],
                start_token_idx=edit_dict["start_token_idx"],
                end_token_idx=edit_dict["end_token_idx"],
                confidence=1.0,
            )

            # Find the position of this edit in the original text
            original_start_pos = tokenized_audio.text.find(basic_op.original_text)
            if original_start_pos == -1:
                # If exact match not found, try a more flexible approach
                logger.warning(
                    f"Could not find exact match for '{basic_op.original_text}' in text, using approximation"
                )
                # Calculate approximate position based on token indices
                if basic_op.start_token_idx in tokenized_audio.token_to_text_map:
                    original_start_pos = tokenized_audio.token_to_text_map[
                        basic_op.start_token_idx
                    ]
                else:
                    # Fallback: find nearest token position
                    nearest_token = min(
                        tokenized_audio.token_to_text_map.keys(),
                        key=lambda x: abs(x - basic_op.start_token_idx),
                    )
                    original_start_pos = tokenized_audio.token_to_text_map[
                        nearest_token
                    ]

            original_end_pos = original_start_pos + len(basic_op.original_text)

            # Find appropriate pre-padding context (text BEFORE the edit)
            prepadding_text, prepadding_start_char_idx = editor.find_prepadding_context(
                tokenized_audio.text, original_start_pos
            )

            # Find appropriate post-padding context (text AFTER the edit)
            postpadding_text, postpadding_end_char_idx = (
                editor.find_postpadding_context(tokenized_audio.text, original_end_pos)
            )

            # Map prepadding to token indices
            prepadding_start_token_idx = -1
            prepadding_end_token_idx = -1
            if prepadding_text:
                # Find the nearest token index to the pre-padding text start position
                char_positions = sorted(tokenized_audio.text_to_token_map.keys())
                nearest_pos = min(
                    char_positions, key=lambda pos: abs(pos - prepadding_start_char_idx)
                )
                prepadding_start_token_idx = tokenized_audio.text_to_token_map[
                    nearest_pos
                ]
                prepadding_end_token_idx = basic_op.start_token_idx

            # Map postpadding to token indices
            postpadding_start_token_idx = basic_op.end_token_idx
            postpadding_end_token_idx = -1
            if postpadding_text:
                # Find the nearest token index to the post-padding text end position
                char_positions = sorted(tokenized_audio.text_to_token_map.keys())
                nearest_pos = min(
                    char_positions, key=lambda pos: abs(pos - postpadding_end_char_idx)
                )
                postpadding_end_token_idx = tokenized_audio.text_to_token_map[
                    nearest_pos
                ]

            # Create complete EditOperation with pre-padding and post-padding
            operation = EditOperation(
                original_text=basic_op.original_text,
                edited_text=basic_op.edited_text,
                start_token_idx=basic_op.start_token_idx,
                end_token_idx=basic_op.end_token_idx,
                confidence=1.0,
                prepadding_text=prepadding_text,
                prepadding_start_token_idx=prepadding_start_token_idx,
                prepadding_end_token_idx=prepadding_end_token_idx,
                postpadding_text=postpadding_text,
                postpadding_start_token_idx=postpadding_start_token_idx,
                postpadding_end_token_idx=postpadding_end_token_idx,
            )

            edit_operations.append(operation)

            if debug:
                with open(os.path.join(debug_dir, f"03_edit_{i + 1}.txt"), "w") as f:
                    f.write(f"Edit {i + 1}:\n")
                    f.write(f"Original text: '{operation.original_text}'\n")
                    f.write(f"Edited text: '{operation.edited_text}'\n")
                    f.write(
                        f"Token range: {operation.start_token_idx} to {operation.end_token_idx}\n"
                    )
                    if operation.prepadding_text:
                        f.write(
                            f"Pre-padding (before edit): '{operation.prepadding_text}'\n"
                        )
                    if operation.postpadding_text:
                        f.write(
                            f"Post-padding (after edit): '{operation.postpadding_text}'\n"
                        )

    # Step 3: Perform integrated inpainting
    logger.info("Performing integrated voice inpainting...")
    MemoryManager.log_memory_stats("Before inpainting")

    inpainting = IntegratedVoiceInpainting(device=device)

    with torch.inference_mode():
        if len(edit_operations) == 1:
            # Process single edit
            inpainted_tokens, final_audio, final_sr = inpainting.inpaint(
                tokenized_audio, edit_operations[0], temperature=temperature, topk=topk
            )
        else:
            # Process multiple edits
            inpainted_tokens, final_audio, final_sr = inpainting.batch_inpaint(
                tokenized_audio, edit_operations, temperature=temperature, topk=topk
            )

        if debug:
            # Save the intermediate result
            debug_output = os.path.join(debug_dir, "04_inpainted_result.wav")
            torchaudio.save(debug_output, final_audio.unsqueeze(0), final_sr)

    MemoryManager.log_memory_stats("After inpainting")

    # Save the result
    out_dir = os.path.dirname(output_file)
    if out_dir and not os.path.exists(out_dir):
        os.makedirs(out_dir, exist_ok=True)

    logger.info(f"Saving final audio to {output_file}")
    torchaudio.save(output_file, final_audio.unsqueeze(0), final_sr)

    # Clear GPU memory before tokenizing final audio
    MemoryManager.clear_gpu_memory()

    # Tokenize the final audio to get transcript and token data
    logger.info("Tokenizing final audio to get transcript and token data...")
    MemoryManager.log_memory_stats("Before final tokenization")

    tokenized_result = tokenizer.tokenize(output_file)

    MemoryManager.log_memory_stats("After final tokenization")

    # Extract token metadata
    tokens_metadata = []
    char_to_word = {}

    if tokenized_result.word_timestamps:
        for word_info in tokenized_result.word_timestamps:
            word = word_info["text"]
            word_start = tokenized_result.text.find(word)
            if word_start >= 0:
                for i in range(word_start, word_start + len(word)):
                    char_to_word[i] = word_info

    # Map tokens to text positions and extract metadata
    if tokenized_result.semantic_tokens:
        for i in range(len(tokenized_result.semantic_tokens)):
            # Check if this token index maps to a text position
            if i in tokenized_result.token_to_text_map:
                char_idx = tokenized_result.token_to_text_map[i]

                # Find the corresponding word/segment
                word_info = char_to_word.get(char_idx)

                if word_info:
                    tokens_metadata.append(
                        {
                            "token_idx": i,
                            "text": word_info["text"],
                            "start_time": word_info["start"],
                            "end_time": word_info["end"],
                            "confidence": word_info.get("confidence", 1.0),
                        }
                    )

    # Create a dictionary to store the tokenization result
    tokenization_result = {
        "text": tokenized_result.text,
        "tokens": tokens_metadata,
        "token_to_text_map": {
            str(k): v for k, v in (tokenized_result.token_to_text_map or {}).items()
        },
        "text_to_token_map": {
            str(k): v for k, v in (tokenized_result.text_to_token_map or {}).items()
        },
        "word_timestamps": tokenized_result.word_timestamps,
        "semantic_to_rvq_map": {
            str(k): v for k, v in (tokenized_result.semantic_to_rvq_map or {}).items()
        },
    }

    # Create generated regions based on token timing
    generated_regions = []
    for op in edit_operations:
        # Find start and end times based on token indices
        start_token = next(
            (t for t in tokens_metadata if t["token_idx"] == op.start_token_idx), None
        )
        # For end token, find the one just before the end index
        end_token = next(
            (t for t in reversed(tokens_metadata) if t["token_idx"] < op.end_token_idx),
            None,
        )

        if start_token and end_token:
            generated_regions.append(
                {
                    "start": start_token["start_time"],
                    "end": end_token["end_time"],
                    "original": op.original_text,
                    "edited": op.edited_text,
                }
            )
        else:
            # If tokens not found, use the original token indices
            generated_regions.append(
                {
                    "start": op.start_token_idx,
                    "end": op.end_token_idx,
                    "original": op.original_text,
                    "edited": op.edited_text,
                }
            )

    elapsed_time = time.time() - start_time
    logger.info(
        f"Voice inpainting completed successfully in {elapsed_time:.2f} seconds"
    )

    # Final memory cleanup
    MemoryManager.clear_gpu_memory()
    MemoryManager.log_memory_stats("Final memory state")

    # Prepare the result with tokenization data
    result = {
        "tokenization": tokenization_result,
        "processing_time": elapsed_time,
        "edit_operations": [
            {
                "original_text": op.original_text,
                "edited_text": op.edited_text,
                "start_token_idx": op.start_token_idx,
                "end_token_idx": op.end_token_idx,
            }
            for op in edit_operations
        ],
        "generated_regions": generated_regions,
    }

    return result


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
