"""
Main pipeline for voice inpainting with RVQ tokens.
"""

import torch
import torchaudio
import os
import time
import argparse
import platform
from loguru import logger

from src.tokenization import AudioTokenizer
from src.semantic_edit import SemanticEditor
from src.generation import TokenGenerator
from src.fusion import TokenFusion, FusionConfig, FusionMethod


def setup_device() -> str:
    """Set up the device for inference

    Returns:
        Device string ("cuda", "mps", or "cpu")
    """
    device = "cpu"
    if torch.cuda.is_available():
        device = "cuda"
    elif (
        platform.system() == "Darwin"
        and hasattr(torch.backends, "mps")
        and torch.backends.mps.is_available()
    ):
        device = "mps"

    logger.info(f"Using device: {device}")
    return device


def voice_inpainting(
    edit_prompt: str,
    input_file: str,
    output_file: str,
    fusion_method: str = "crossfade",
    debug: bool = True,
    debug_dir: str = "data/debug_output",
    temperature: float = 0.7,
    topk: int = 30,
) -> None:
    """Edit a voice message based on a prompt using RVQ tokens

    Args:
        edit_prompt: The prompt to edit the voice message
        input_file: Path to the input voice message audio file
        output_file: Path to store the output audio
        fusion_method: Method for token fusion
        debug: Whether to save intermediate files for debugging
        debug_dir: Directory to save debug files if debug is True
        temperature: Temperature for token generation
        topk: Top-k value for sampling during generation
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

        # Save tokenized representation info
        with open(os.path.join(debug_dir, "02_tokenization.txt"), "w") as f:
            f.write(f"RVQ Tokens shape: {tokenized_audio.rvq_tokens.shape}\n")
            f.write("Frame rate: 12.5 Hz (80ms per frame)\n")
            f.write(
                f"Duration: {tokenized_audio.rvq_tokens.shape[1] / 12.5:.2f} seconds\n"
            )
            f.write(f"Extracted text: {tokenized_audio.text}\n")
            f.write(f"Speaker ID: {tokenized_audio.speaker_id}\n\n")

            f.write("Word timestamps from Whisper:\n")
            if tokenized_audio.word_timestamps:
                for i, word in enumerate(tokenized_audio.word_timestamps):
                    f.write(
                        f"{i}: '{word['word']}' ({word['start']:.2f}s - {word['end']:.2f}s)\n"
                    )

    # Step 2: Identify edit region in tokens
    logger.info("Identifying edit region based on prompt...")
    editor = SemanticEditor(tokenizer)
    edit_op = editor.find_edit_region(tokenized_audio, edit_prompt)

    # Calculate time range for the edit
    token_frame_rate = 12.5  # frames per second
    start_time_sec = edit_op.start_token_idx / token_frame_rate
    end_time_sec = edit_op.end_token_idx / token_frame_rate

    if debug:
        with open(os.path.join(debug_dir, "03_edit_region.txt"), "w") as f:
            f.write(f"Edit prompt: {edit_prompt}\n")
            f.write(f"Original text: '{edit_op.original_text}'\n")
            f.write(f"Edited text: '{edit_op.edited_text}'\n")
            f.write(
                f"Token range: {edit_op.start_token_idx} to {edit_op.end_token_idx}\n"
            )
            f.write(f"Time range: {start_time_sec:.2f}s to {end_time_sec:.2f}s\n")
            f.write(
                f"Edit length: {edit_op.end_token_idx - edit_op.start_token_idx} frames, {end_time_sec - start_time_sec:.2f} seconds\n"
            )

        # Extract and save just the portion to be edited
        with torch.inference_mode():
            edit_tokens = tokenized_audio.rvq_tokens[
                :, edit_op.start_token_idx : edit_op.end_token_idx
            ]
            if edit_tokens.shape[1] > 0:
                edit_audio, edit_sr = tokenizer.reconstruct_audio(edit_tokens)
                edit_path = os.path.join(debug_dir, "03b_original_edit_region.wav")
                torchaudio.save(edit_path, edit_audio.unsqueeze(0), edit_sr)

    # Step 3: Generate new tokens for the edit
    logger.info("Generating new tokens for the edited segment...")
    generator = TokenGenerator(device=device)

    with torch.inference_mode():
        generated_tokens = generator.generate_replacement_tokens(
            tokenized_audio, edit_op, temperature=temperature, topk=topk
        )

    if debug:
        # Reconstruct and save just the generated audio
        with torch.inference_mode():
            gen_audio, gen_sr = tokenizer.reconstruct_audio(generated_tokens)
            gen_path = os.path.join(debug_dir, "04_generated_segment.wav")
            torchaudio.save(gen_path, gen_audio.unsqueeze(0), gen_sr)

        with open(os.path.join(debug_dir, "04b_generation_info.txt"), "w") as f:
            f.write(f"Generated tokens shape: {generated_tokens.shape}\n")
            f.write(
                f"Generated duration: {generated_tokens.shape[1] / 12.5:.2f} seconds\n"
            )
            f.write("Generation parameters:\n")
            f.write(f"  Temperature: {temperature}\n")
            f.write(f"  Top-k: {topk}\n")

    # Step 4: Fuse tokens
    logger.info(f"Fusing tokens using {fusion_method} method...")
    fusion_config = FusionConfig(
        method=FusionMethod(fusion_method),
        crossfade_frames=5,
        alpha=0.5,
        use_semantic_preservation=True,
    )

    fusion = TokenFusion(config=fusion_config)

    with torch.inference_mode():
        fused_tokens = fusion.fuse_tokens(
            tokenized_audio.rvq_tokens,
            generated_tokens,
            (edit_op.start_token_idx, edit_op.end_token_idx),
        )

    # Step 5: Reconstruct audio from fused tokens
    logger.info("Reconstructing audio from fused tokens...")
    with torch.inference_mode():
        final_audio, final_sr = tokenizer.reconstruct_audio(fused_tokens)

    # Save the result
    out_dir = os.path.dirname(output_file)
    if out_dir and not os.path.exists(out_dir):
        os.makedirs(out_dir, exist_ok=True)

    logger.info(f"Saving final audio to {output_file}")
    torchaudio.save(output_file, final_audio.unsqueeze(0), final_sr)

    if debug:
        # Also save a debug copy
        debug_output = os.path.join(debug_dir, "05_final_result.wav")
        torchaudio.save(debug_output, final_audio.unsqueeze(0), final_sr)

        # Save fusion information
        with open(os.path.join(debug_dir, "06_fusion_info.txt"), "w") as f:
            f.write(f"Fusion method: {fusion_method}\n")
            f.write(f"Original tokens shape: {tokenized_audio.rvq_tokens.shape}\n")
            f.write(f"Generated tokens shape: {generated_tokens.shape}\n")
            f.write(f"Fused tokens shape: {fused_tokens.shape}\n")
            f.write(f"Final duration: {fused_tokens.shape[1] / 12.5:.2f} seconds\n")

    elapsed_time = time.time() - start_time
    logger.info(
        f"Voice inpainting completed successfully in {elapsed_time:.2f} seconds"
    )
    return fused_tokens, final_audio, final_sr


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

    voice_inpainting(
        edit_prompt=args.prompt,
        input_file=args.input,
        output_file=args.output,
        fusion_method=args.fusion,
        debug=args.debug,
        debug_dir=args.debug_dir,
        temperature=args.temperature,
        topk=args.topk,
    )


if __name__ == "__main__":
    main()
