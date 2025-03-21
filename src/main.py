import tempfile
import soundfile as sf
import torch
from loguru import logger
import os
import platform

from src.transcription import VoiceMessage
from src.text_edit import LLM
from src.text_to_speech import F5TTS
from src.audio_processing import AudioProcessor


def voice_inpainting(
    edit_prompt: str,
    input_file: str,
    output_file: str,
    debug: bool = True,
    debug_dir: str = "data/debug_output",
):
    """Edit a voice message based on a prompt

    Args:
        edit_prompt: the prompt to edit the voice message
        input_file: path to the input voice message audio file
        output_file: path to store the output audio
        debug: whether to save intermediate files for debugging
        debug_dir: directory to save debug files if debug is True
    """
    # Create debug directory if debug mode is enabled
    if debug:
        logger.info(
            f"Debug mode enabled. Intermediate files will be saved to {debug_dir}"
        )
        os.makedirs(debug_dir, exist_ok=True)
    # Initialize audio processor
    audio_processor = AudioProcessor()

    # Set device based on platform
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

    # Transcribe the enhanced voice message with Whisper
    # The VoiceMessage class now handles both Whisper transcription and Wav2Vec2 alignment
    logger.info("Transcribing voice message with Whisper and aligning with Wav2Vec2...")
    source_audio = VoiceMessage(input_file, device=device)
    logger.info(f"Transcribed voice message: {source_audio.text}")

    # Save transcription details if in debug mode
    if debug:
        with open(os.path.join(debug_dir, "transcription.txt"), "w") as f:
            f.write(f"Full text: {source_audio.text}\n\n")
            f.write("Word timestamps:\n")
            for i, word in enumerate(source_audio.word_list):
                f.write(f"{i}: {word}\n")

    # Find the subsequence to edit and its indices
    logger.info("Finding edit region...")
    subseq_original, subseq_edited = LLM().find_edit_substring(
        source_audio.text, edit_prompt
    )
    logger.info(f"Edit proposal: '{subseq_original}' -> '{subseq_edited}'")

    start_index, end_index = source_audio._find_subsequence_indices(subseq_original)

    if start_index == -1 or end_index == -1:
        raise ValueError(
            f"Subsequence '{subseq_original}' not found in the voice message '{source_audio.text}'. Please try again with a different edit prompt."
        )

    # Generate the edited audio
    logger.info("Generating audio for the edit...")
    final_wave, final_sample_rate = F5TTS().infer(
        input_file, source_audio.text, subseq_edited
    )

    # Save the generated audio
    if debug:
        raw_generated_path = os.path.join(debug_dir, "02_raw_generated.wav")
        sf.write(raw_generated_path, final_wave, final_sample_rate)
        generated_audio_path = raw_generated_path
    else:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as f:
            sf.write(f.name, final_wave, final_sample_rate)
            generated_audio_path = f.name

    logger.info("Generated audio for the edit.")

    # Match volume of the generated audio with the original
    logger.info("Matching audio volumes...")
    if debug:
        volume_matched_audio = audio_processor.match_volume(
            generated_audio_path,
            input_file,
            output_path=os.path.join(debug_dir, "04_volume_matched.wav"),
        )
    else:
        volume_matched_audio = audio_processor.match_volume(
            generated_audio_path, input_file
        )

    # Analyze speech rhythm and prosody for better fusion
    # Extract just the words being replaced for rhythm analysis
    target_words = source_audio.word_list[start_index : end_index + 1]
    logger.info(
        f"Analyzing rhythm for {len(target_words)} words: "
        + ", ".join([w.word for w in target_words])
    )

    rhythm_metrics = audio_processor.analyze_speech_rhythm(input_file, target_words)
    logger.info(f"Speech rhythm metrics: {rhythm_metrics}")

    # Adjust timing to match prosody
    logger.info("Adjusting prosody...")
    if debug:
        prosody_adjusted_audio = audio_processor.adjust_timing_to_match_prosody(
            input_file,
            volume_matched_audio,
            output_path=os.path.join(debug_dir, "05_prosody_adjusted.wav"),
        )
    else:
        prosody_adjusted_audio = audio_processor.adjust_timing_to_match_prosody(
            input_file, volume_matched_audio
        )

    # Fuse the edited audio with the original audio
    logger.info("Fusing audio segments...")
    logger.info(f"Replacing words from index {start_index} to {end_index}")
    logger.info(
        "Original words: "
        + " ".join(
            [w.word for w in source_audio.word_list[start_index : end_index + 1]]
        )
    )
    logger.info(f"New text: {subseq_edited}")

    source_audio.fuse_audio(start_index, end_index, prosody_adjusted_audio, output_file)
    logger.info(f"Enhanced output saved to {output_file}")

    # Save edit info
    if debug:
        with open(os.path.join(debug_dir, "edit_info.txt"), "w") as f:
            f.write(f"Edit prompt: {edit_prompt}\n")
            f.write(f"Original text: {source_audio.text}\n")
            f.write(f"Replaced: '{subseq_original}' with '{subseq_edited}'\n")
            f.write(
                f"Words replaced: {source_audio.word_list[start_index : end_index + 1]}\n"
            )
            f.write(f"Start time: {source_audio.word_list[start_index].start}s\n")
            f.write(f"End time: {source_audio.word_list[end_index].end}s\n")
            f.write(f"Rhythm metrics: {rhythm_metrics}\n")
    else:
        # Clean up temporary files
        try:
            os.remove(generated_audio_path)
            os.remove(volume_matched_audio)
            os.remove(prosody_adjusted_audio)
        except Exception as e:
            logger.warning(f"Failed to clean up temporary files: {e}")

    logger.info("Audio editing complete.")
