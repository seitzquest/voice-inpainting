import subprocess
import soundfile as sf
from loguru import logger

from src.transcription import VoiceMessage
from src.text_edit import LLM
from src.text_to_speech import F5TTS


def voice_inpainting(edit_prompt: str, input_file: str, edit_file: str = "data/edit.wav", output_file: str = "data/output.wav"):
    """Edit a voice message based on a prompt

    Args:
        edit_prompt: the prompt to edit the voice message
        input_file: path to the input voice message audio file
        edit_file: path to store the generated audio. Defaults to "data/edit.wav".
        output_file: path to store the output audio. Defaults to "data/output.wav".
    """

    # Transcribe the voice message
    source_audio = VoiceMessage(input_file)
    logger.info(f"Transcribed voice message: {source_audio.text}")

    # Find the subsequence to edit and its indices
    subseq_original, subseq_edited = LLM().find_edit_substring(source_audio.text, edit_prompt)
    logger.info(f"Edit proposal: {subseq_original} -> {subseq_edited}")
    start_index, end_index = source_audio._find_subsequence_indices(subseq_original)

    if start_index == -1 or end_index == -1:
        raise ValueError(f"Subsequence not {subseq_original} found in the voice message {source_audio.text}. Please try again.")

    # Generate the edited audio
    final_wave, final_sample_rate = F5TTS().infer(source_audio.path, source_audio.text, subseq_edited)
    sf.write(edit_file, final_wave, final_sample_rate)
    logger.info("Generated audio for the edit.")

    # Fuse the edited audio with the original audio
    source_audio.fuse_audio(start_index, end_index, edit_file, output_file)
    logger.info("Audio editing complete.")


def main(verbose: bool = False):
    """Run the Streamlit app to edit voice messages
    """
    subprocess.run(["streamlit", "run", "src/app.py"])
