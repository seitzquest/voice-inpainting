"""
Audio watermarking module with improved memory management.
"""

import argparse

import silentcipher
import torch
import torchaudio
from loguru import logger
from src.memory_manager import MemoryManager

# This watermark key is public, it is not secure.
# If using CSM 1B in another application, use a new private key and keep it secret.
CSM_1B_GH_WATERMARK = [212, 211, 146, 56, 201]


def cli_check_audio() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio_path", type=str, required=True)
    args = parser.parse_args()

    check_audio_from_file(args.audio_path)


def load_watermarker(device: str = "cuda") -> silentcipher.server.Model:
    """Load the watermarking model with memory tracking

    Args:
        device: Device to load the model on

    Returns:
        Watermarking model
    """
    # Log memory before loading
    MemoryManager.log_memory_stats("Before loading watermarker")

    logger.info(f"Loading watermarker model on {device}")
    model = silentcipher.get_model(
        model_type="44.1k",
        device=device,
    )

    # Log memory after loading
    MemoryManager.log_memory_stats("After loading watermarker")

    return model


@torch.inference_mode()
def watermark(
    watermarker: silentcipher.server.Model,
    audio_array: torch.Tensor,
    sample_rate: int,
    watermark_key: list[int],
) -> tuple[torch.Tensor, int]:
    """Apply watermark to audio with memory tracking

    Args:
        watermarker: Watermarking model
        audio_array: Audio tensor
        sample_rate: Sample rate of audio
        watermark_key: Watermark key to embed

    Returns:
        Tuple of watermarked audio and sample rate
    """
    # Log memory before watermarking
    MemoryManager.log_memory_stats("Before watermarking")

    # Get the device - silentcipher models don't have parameters() method
    # so we need to determine device differently
    try:
        # Try to access the device attribute directly if it exists
        device = watermarker.device
    except AttributeError:
        # If no device attribute, use the device passed to load_watermarker
        # or default to CUDA if available
        device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info(f"Using inferred device for watermarking: {device}")

    # Make sure audio is on the correct device
    audio_array = audio_array.to(device)

    # Resample to 44.1kHz (required by watermarker)
    audio_array_44khz = torchaudio.functional.resample(
        audio_array, orig_freq=sample_rate, new_freq=44100
    )

    # Apply watermark
    encoded, _ = watermarker.encode_wav(
        audio_array_44khz, 44100, watermark_key, calc_sdr=False, message_sdr=36
    )

    # Resample back to original rate if needed
    output_sample_rate = min(44100, sample_rate)
    encoded = torchaudio.functional.resample(
        encoded, orig_freq=44100, new_freq=output_sample_rate
    )

    # Move result to CPU to free GPU memory
    result = encoded.cpu()

    # Log memory after watermarking
    MemoryManager.log_memory_stats("After watermarking")

    return result, output_sample_rate


@torch.inference_mode()
def verify(
    watermarker: silentcipher.server.Model,
    watermarked_audio: torch.Tensor,
    sample_rate: int,
    watermark_key: list[int],
) -> bool:
    """Verify watermark in audio with memory tracking

    Args:
        watermarker: Watermarking model
        watermarked_audio: Audio tensor
        sample_rate: Sample rate of audio
        watermark_key: Watermark key to check

    Returns:
        True if watermark is present and matches the key
    """
    # Log memory before verification
    MemoryManager.log_memory_stats("Before watermark verification")

    # Get the device - silentcipher models don't have parameters() method
    # so we need to determine device differently
    try:
        # Try to access the device attribute directly if it exists
        device = watermarker.device
    except AttributeError:
        # If no device attribute, use the device passed to load_watermarker
        # or default to CUDA if available
        device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info(f"Using inferred device for watermarking: {device}")

    # Make sure audio is on the correct device
    watermarked_audio = watermarked_audio.to(device)

    # Resample to 44.1kHz (required by watermarker)
    watermarked_audio_44khz = torchaudio.functional.resample(
        watermarked_audio, orig_freq=sample_rate, new_freq=44100
    )

    # Verify watermark
    result = watermarker.decode_wav(
        watermarked_audio_44khz, 44100, phase_shift_decoding=True
    )

    is_watermarked = result["status"]
    if is_watermarked:
        is_csm_watermarked = result["messages"][0] == watermark_key
    else:
        is_csm_watermarked = False

    # Log memory after verification
    MemoryManager.log_memory_stats("After watermark verification")

    return is_watermarked and is_csm_watermarked


def check_audio_from_file(audio_path: str) -> None:
    """Check if audio file contains watermark

    Args:
        audio_path: Path to audio file
    """
    # Load watermarker
    watermarker = load_watermarker(device="cuda")

    # Load audio
    audio_array, sample_rate = load_audio(audio_path)

    # Verify watermark
    is_watermarked = verify(watermarker, audio_array, sample_rate, CSM_1B_GH_WATERMARK)

    # Output result
    outcome = "Watermarked" if is_watermarked else "Not watermarked"
    print(f"{outcome}: {audio_path}")

    # Clean up
    del watermarker
    MemoryManager.clear_gpu_memory()


def load_audio(audio_path: str) -> tuple[torch.Tensor, int]:
    """Load audio file

    Args:
        audio_path: Path to audio file

    Returns:
        Tuple of audio tensor and sample rate
    """
    audio_array, sample_rate = torchaudio.load(audio_path)
    audio_array = audio_array.mean(dim=0)
    return audio_array, int(sample_rate)


if __name__ == "__main__":
    cli_check_audio()
