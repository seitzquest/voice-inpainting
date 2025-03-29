"""
Main pipeline for voice inpainting with RVQ tokens
"""

from typing import Dict, List, Tuple, Union
import torch
import torchaudio
import os
import time
import argparse
import platform
from loguru import logger

from src.tokenization import AudioTokenizer, TokenizedAudio
from src.semantic_edit import EditOperation, SemanticEditor
from src.generation import TokenGenerator
from src.fusion import TokenFusion, FusionConfig, FusionMethod


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
    return device


def voice_inpainting_unified(
    input_file: str,
    output_file: str,
    edits: Union[str, List[Dict]],
    fusion_method: str = "crossfade",
    debug: bool = True,
    debug_dir: str = "data/debug_output",
    temperature: float = 0.7,
    topk: int = 30,
) -> Tuple[torch.Tensor, torch.Tensor, int]:
    """Unified function for voice inpainting with single or multiple edits

    Args:
        input_file: Path to the input voice message audio file
        output_file: Path to store the output audio
        edits: Either a single edit prompt (str) or a list of edit operations (List[Dict])
               Each dict should have 'original_text', 'edited_text', 'start_token_idx', 'end_token_idx'
        fusion_method: Method for token fusion
        debug: Whether to save intermediate files for debugging
        debug_dir: Directory to save debug files if debug is True
        temperature: Temperature for token generation
        topk: Top-k value for sampling during generation

    Returns:
        Tuple of (fused_tokens, final_audio, final_sr)
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
    tokenizer = AudioTokenizer(device=device)
    tokenized_audio = tokenizer.tokenize(input_file)

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
        editor = SemanticEditor(tokenizer, load_llm=True)
        edit_op = editor.find_edit_region(tokenized_audio, edits)
        edit_operations.append(edit_op)

        if debug:
            with open(os.path.join(debug_dir, "03_edit_region.txt"), "w") as f:
                f.write(f"Edit prompt: {edits}\n")
                f.write(f"Original text: '{edit_op.original_text}'\n")
                f.write(f"Edited text: '{edit_op.edited_text}'\n")
                f.write(
                    f"Token range: {edit_op.start_token_idx} to {edit_op.end_token_idx}\n"
                )
                if edit_op.prepadding_text:
                    f.write(f"Pre-padding: '{edit_op.prepadding_text}'\n")
                if edit_op.postpadding_text:
                    f.write(f"Post-padding: '{edit_op.postpadding_text}'\n")
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

            # Find appropriate pre-padding context (text before the edit)
            prepadding_text, prepadding_start_char_idx = editor.find_prepadding_context(
                tokenized_audio.text, tokenized_audio.text.find(basic_op.original_text)
            )

            # Map prepadding to token indices
            prepadding_start_token_idx = -1
            if prepadding_text:
                text_pos = tokenized_audio.text.find(prepadding_text)
                if text_pos >= 0:
                    # Find the nearest token index to this text position
                    char_positions = sorted(tokenized_audio.text_to_token_map.keys())
                    nearest_pos = min(
                        char_positions, key=lambda pos: abs(pos - text_pos)
                    )
                    prepadding_start_token_idx = tokenized_audio.text_to_token_map[
                        nearest_pos
                    ]

            # Create complete EditOperation with pre-padding
            operation = EditOperation(
                original_text=basic_op.original_text,
                edited_text=basic_op.edited_text,
                start_token_idx=basic_op.start_token_idx,
                end_token_idx=basic_op.end_token_idx,
                confidence=1.0,
                prepadding_text=prepadding_text,
                prepadding_start_token_idx=prepadding_start_token_idx,
                prepadding_end_token_idx=basic_op.start_token_idx,
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
                        f.write(f"Pre-padding: '{operation.prepadding_text}'\n")

    # Step 3: Process each edit operation sequentially
    current_tokens = tokenized_audio.rvq_tokens
    token_offset = 0  # Track how token indices shift due to previous edits

    generator = TokenGenerator(device=device)

    for i, edit_op in enumerate(edit_operations):
        logger.info(
            f"Processing edit {i + 1}/{len(edit_operations)}: '{edit_op.original_text}' -> '{edit_op.edited_text}'"
        )

        # Adjust token indices based on previous edits
        if token_offset != 0:
            edit_op.start_token_idx += token_offset
            edit_op.end_token_idx += token_offset
            if edit_op.prepadding_start_token_idx >= 0:
                edit_op.prepadding_start_token_idx += token_offset
            if edit_op.prepadding_end_token_idx >= 0:
                edit_op.prepadding_end_token_idx = (
                    edit_op.start_token_idx
                )  # Always ends at start

        # Create an updated TokenizedAudio object with the current tokens
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

        # Generate new tokens for the edit
        with torch.inference_mode():
            generated_tokens = generator.generate_replacement_tokens(
                updated_audio, edit_op, temperature=temperature, topk=topk
            )

        if debug:
            # Save this generation
            with torch.inference_mode():
                if generated_tokens.shape[1] > 0:
                    gen_audio, gen_sr = tokenizer.reconstruct_audio(generated_tokens)
                    gen_path = os.path.join(
                        debug_dir, f"04_generated_segment_{i + 1}.wav"
                    )
                    torchaudio.save(gen_path, gen_audio.unsqueeze(0), gen_sr)

        # Fuse tokens
        logger.info(f"Fusing tokens for edit {i + 1} using {fusion_method} method...")
        fusion_config = FusionConfig(
            method=FusionMethod(fusion_method),
            crossfade_frames=10,  # Increased for smoother transitions
            alpha=0.4,
            decay_factor=0.2,
            use_semantic_preservation=True,
        )

        fusion = TokenFusion(config=fusion_config)

        with torch.inference_mode():
            fused_tokens = fusion.fuse_tokens(
                current_tokens,
                generated_tokens,
                (edit_op.start_token_idx, edit_op.end_token_idx),
            )

            # Update current tokens for next iteration
            current_tokens = fused_tokens

            # Update token offset based on length difference
            old_length = edit_op.end_token_idx - edit_op.start_token_idx
            new_length = generated_tokens.shape[1]
            token_offset += new_length - old_length

            if debug:
                # Save intermediate result for this edit
                intermediate_audio, intermediate_sr = tokenizer.reconstruct_audio(
                    fused_tokens
                )
                intermediate_path = os.path.join(
                    debug_dir, f"05_intermediate_result_{i + 1}.wav"
                )
                torchaudio.save(
                    intermediate_path, intermediate_audio.unsqueeze(0), intermediate_sr
                )

    # Step 4: Reconstruct final audio from fused tokens
    logger.info("Reconstructing audio from final fused tokens...")
    with torch.inference_mode():
        final_audio, final_sr = tokenizer.reconstruct_audio(current_tokens)

    # Save the result
    out_dir = os.path.dirname(output_file)
    if out_dir and not os.path.exists(out_dir):
        os.makedirs(out_dir, exist_ok=True)

    logger.info(f"Saving final audio to {output_file}")
    torchaudio.save(output_file, final_audio.unsqueeze(0), final_sr)

    if debug:
        # Also save a debug copy
        debug_output = os.path.join(debug_dir, "06_final_result.wav")
        torchaudio.save(debug_output, final_audio.unsqueeze(0), final_sr)

    elapsed_time = time.time() - start_time
    logger.info(
        f"Voice inpainting completed successfully in {elapsed_time:.2f} seconds"
    )
    return current_tokens, final_audio, final_sr


def main():
    """Main entry point for voice inpainting CLI"""
    parser = argparse.ArgumentParser(description="Voice Inpainting with RVQ Tokens")
    parser.add_argument("--input", "-i", required=True, help="Input audio file")
    parser.add_argument("--output", "-o", required=True, help="Output audio file")
    parser.add_argument("--prompt", "-p", required=True, help="Edit prompt")
    parser.add_argument(
        "--fusion",
        "-f",
        default="crossfade",
        choices=["direct", "linear", "crossfade", "contextual"],
        help="Fusion method",
    )
    parser.add_argument(
        "--temperature", "-t", type=float, default=0.7, help="Generation temperature"
    )
    parser.add_argument(
        "--topk", "-k", type=int, default=30, help="Top-k for token sampling"
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

    voice_inpainting_unified(
        input_file=args.input,
        output_file=args.output,
        edits=args.prompt,  # Use the prompt as a single edit
        fusion_method=args.fusion,
        debug=args.debug,
        debug_dir=args.debug_dir,
        temperature=args.temperature,
        topk=args.topk,
    )


if __name__ == "__main__":
    main()
